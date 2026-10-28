import {platformFetch} from "../../platform/network";
import type {Stream} from "../providers/types";
import {SITE_ORIGIN} from "../siteConfig";
import {settingsStorage} from "../storage";
import {authHeaders} from "./accountStore";

/**
 * Streams for one title from every provider the site allows, resolved by the
 * site's own aggregation engine (`/api/unified/*`). The engine already knows
 * how to find the same title on other providers, so the app only has to hand
 * it the link it is playing and merge the answer into its own list.
 */

interface SiteSource {
  provider: string;
  link: string;
  title?: string;
}

interface MergedEpisode {
  number?: number;
  title?: string;
  sources?: SiteSource[];
}

interface MergedSeason {
  number?: number;
  label?: string;
  episodes?: MergedEpisode[];
}

interface MergedMeta {
  title?: string;
  type?: string;
  sources?: SiteSource[];
  seasons?: MergedSeason[];
}

export interface AggregateRequest {
  provider: string;
  link: string;
  title?: string;
  type?: string;
  season?: number;
  episode?: number;
  isDownload?: boolean;
  signal?: AbortSignal;
}

const ENRICH_TIMEOUT_MS = 45_000;
const STREAM_TIMEOUT_MS = 75_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_STREAMS = 200;
/* The engine returns once this many files are resolved (UNIFIED_STREAM_EARLY). */
const EARLY_STREAM_CUTOFF = 20;

const cache = new Map<string, {at: number; streams: Stream[]}>();
const inflight = new Map<string, Promise<Stream[]>>();

const requestKey = (req: AggregateRequest) =>
  [
    req.provider,
    req.link,
    req.isDownload ? 1 : 0,
    req.type || "movie",
    req.season ?? "",
    req.episode ?? "",
  ].join("|");

const withTimeout = (signal: AbortSignal | undefined, ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
};

const siteFetch = async (
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<any> => {
  const response = await platformFetch(`${SITE_ORIGIN}${path}`, {
    ...init,
    signal,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? {"Content-Type": "application/json"} : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Site aggregation failed (HTTP ${response.status})`);
  }
  return response.json();
};

const streamType = (raw: unknown, link: string): string => {
  const type = String(raw || "").trim();
  if (type) return type;
  return /\.m3u8(\?|#|$)/i.test(link) ? "m3u8" : "mp4";
};

const toStream = (raw: any): Stream | null => {
  const link = String(raw?.link || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) return null;
  const provider = String(raw?.providerName || raw?.provider || "").trim();
  const server = String(raw?.server || "Server").trim();
  const stream: Stream = {
    server: provider && !server.startsWith(provider) ? `${provider} · ${server}` : server,
    link,
    type: streamType(raw?.type, link),
  };
  if (raw?.quality) stream.quality = String(raw.quality);
  if (raw?.headers && typeof raw.headers === "object") stream.headers = raw.headers;
  if (Array.isArray(raw?.subtitles) && raw.subtitles.length) {
    stream.subtitles = raw.subtitles;
  }
  return stream;
};

const episodeSources = (merged: MergedMeta, req: AggregateRequest): SiteSource[] => {
  const seasons = Array.isArray(merged.seasons) ? merged.seasons : [];
  const season = Number(req.season) || 1;
  const episode = Number(req.episode) || 1;
  const inSeason = seasons.filter((item) => (Number(item?.number) || 1) === season);

  /* The seed link identifies the exact episode even when numbering differs
     between providers (absolute vs per-season). */
  for (const seasonItem of inSeason) {
    for (const episodeItem of seasonItem?.episodes || []) {
      const sources = episodeItem?.sources || [];
      if (
        sources.some((s) => s.provider === req.provider && s.link === req.link)
      ) {
        return sources;
      }
    }
  }

  for (const seasonItem of inSeason) {
    const match = (seasonItem?.episodes || []).find(
      (episodeItem) => Number(episodeItem?.number) === episode,
    );
    if (match?.sources?.length) return match.sources;
  }
  return [];
};

const resolveSources = (merged: MergedMeta, req: AggregateRequest): SiteSource[] => {
  if (req.type === "series") {
    return episodeSources(merged, req);
  }
  return Array.isArray(merged.sources) ? merged.sources : [];
};

const dedupe = (rawSources: SiteSource[]): SiteSource[] => {
  const seen = new Set<string>();
  const out: SiteSource[] = [];
  for (const source of rawSources) {
    if (!source || !source.provider || !source.link) continue;
    const key = `${source.provider}|${source.link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({provider: String(source.provider), link: String(source.link), title: source.title});
  }
  return out;
};

const run = async (
  req: AggregateRequest,
  onUpdate?: (streams: Stream[]) => void,
): Promise<Stream[]> => {
  const timeout = withTimeout(req.signal, ENRICH_TIMEOUT_MS + STREAM_TIMEOUT_MS * 2);
  let phaseTimer = withTimeout(timeout.signal, ENRICH_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({provider: req.provider, link: req.link});
    if (req.title) query.set("t", req.title);
    const enriched = await siteFetch(
      `/api/unified/enrich?${query.toString()}`,
      {method: "GET"},
      phaseTimer.signal,
    );
    phaseTimer.done();

    const merged: MergedMeta | undefined = enriched?.merged;
    if (!merged) return [];

    const sources = dedupe(resolveSources(merged, req));
    if (!sources.length) return [];

    const body = JSON.stringify({
      sources,
      isDownload: Boolean(req.isDownload),
      type: req.type || "movie",
    });
    const collect = (rawStreams: unknown): Stream[] => {
      if (!Array.isArray(rawStreams)) return [];
      const seen = new Set<string>();
      const streams: Stream[] = [];
      for (const raw of rawStreams) {
        const stream = toStream(raw);
        if (!stream || seen.has(stream.link)) continue;
        seen.add(stream.link);
        streams.push(stream);
        if (streams.length >= MAX_STREAMS) break;
      }
      return streams;
    };

    const fetchStreams = async (): Promise<Stream[]> => {
      const timer = withTimeout(timeout.signal, STREAM_TIMEOUT_MS);
      try {
        const rawStreams = await siteFetch(
          "/api/unified/stream",
          {method: "POST", body},
          timer.signal,
        );
        return collect(rawStreams);
      } finally {
        timer.done();
      }
    };

    const first = await fetchStreams();
    if (!first.length) return [];
    onUpdate?.(first);

    /* The server answers as soon as EARLY (20) files are in hand and never
       resolves the remaining sources, so a short second call — which replays
       the cached links and only scrapes the leftovers — fills the list out. */
    if (first.length >= EARLY_STREAM_CUTOFF) {
      try {
        const rest = await fetchStreams();
        const union = mergeAggregatedStreams(first, rest);
        if (union.length > first.length) {
          onUpdate?.(union);
          return union;
        }
      } catch {
        /* the fast list is already on screen */
      }
    }
    return first;
  } finally {
    phaseTimer.done();
    timeout.done();
  }
};

/**
 * Never throws: a title that the site cannot expand, a signed-out session or a
 * slow engine all fall back to the provider the user actually opened.
 */
export const fetchAggregatedStreams = async (
  req: AggregateRequest,
  onUpdate?: (streams: Stream[]) => void,
): Promise<Stream[]> => {
  if (!req.provider || !req.link || !req.title) return [];
  if (!settingsStorage.isMergeProviderStreamsEnabled()) return [];

  const key = requestKey(req);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    onUpdate?.(cached.streams);
    return cached.streams;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = run(req, onUpdate)
    .then((streams) => {
      if (streams.length) cache.set(key, {at: Date.now(), streams});
      return streams;
    })
    .catch((error) => {
      if (!req.signal?.aborted) {
        console.warn("[aggregate] site stream merge failed:", error?.message || error);
      }
      return [];
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
};

/** Lets the settings toggle take effect without waiting for a stale cache. */
export const clearAggregateCache = (): void => {
  cache.clear();
};

/** Provider the user opened first, then the site's cross-provider files. */
export const mergeAggregatedStreams = (base: Stream[], extra: Stream[]): Stream[] => {
  if (!extra.length) return base;
  const seen = new Set(base.map((item) => item?.link).filter(Boolean));
  const merged = [...base];
  for (const stream of extra) {
    if (!stream?.link || seen.has(stream.link)) continue;
    seen.add(stream.link);
    merged.push(stream);
  }
  return merged;
};
