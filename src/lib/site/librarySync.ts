import {isTauriRuntime} from "../../platform/host";
import {cacheStorage, mainStorage} from "../storage/StorageService";
import {watchHistoryStorage, watchListStorage} from "../storage";
import type {WatchHistoryItem} from "../storage/WatchHistoryStorage";
import {WatchListKeys, type WatchListItem} from "../storage/WatchListStorage";
import useWatchHistoryStore from "../zustand/watchHistrory";
import useWatchListStore from "../zustand/watchListStore";
import {getSession} from "./accountStore";
import {
  fetchProgress,
  fetchWatchlist,
  pushProgress,
  pushWatchlist,
  type LibraryItem,
} from "./siteApi";

/**
 * Two-way sync of the two lists the site also owns: the watchlist and continue
 * watching. Local storage stays the source of truth the UI reads from, so the
 * app behaves identically offline or signed out; this module only converges the
 * two and mirrors each side's adds, edits and deletes.
 */

const JOURNAL_KEY = "cinepix-sync-journal";
const PUSH_DELAY_MS = 4000;

/**
 * `watchlist`/`progress` remember the stamp each row was last synced at, and
 * `keys` remembers the media key the server used for a link. The app derives
 * keys from title + type, but a title saved on the site may be a series the
 * local watchlist cannot tell, so the server's own key is reused once known.
 */
type Journal = {
  watchlist: Record<string, number>;
  progress: Record<string, number>;
  keys: Record<string, string>;
};

const loadJournal = (): Journal => {
  const journal = mainStorage.getObject<Journal>(JOURNAL_KEY);
  return journal?.watchlist && journal.progress
    ? {watchlist: journal.watchlist, progress: journal.progress, keys: journal.keys || {}}
    : {watchlist: {}, progress: {}, keys: {}};
};

const saveJournal = (journal: Journal) => mainStorage.setObject(JOURNAL_KEY, journal);

/** Same djb2 seed as the site and the server, so all three name a title alike. */
const mediaKeyOf = (title: string, type: string): string => {
  const seed = `t:${String(title || "").toLowerCase().trim()}|${type || "movie"}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** The watchlist keeps no type, so borrow it from history when it was watched. */
const typeOfTitle = (title: string, history: WatchHistoryItem[]): string => {
  const match = history.find(item => item.title === title && (item.type || item.isSeries));
  if (match) return match.isSeries || match.type === "series" ? "series" : "movie";
  return "movie";
};

const toLibraryItem = (
  item: WatchListItem,
  mediaKey: string,
  type: string,
): LibraryItem => ({
  mediaKey,
  title: item.title,
  image: item.poster,
  type,
  provider: item.provider,
  link: item.link,
});

const toProgressItem = (
  item: WatchHistoryItem,
  mediaKey: string,
): LibraryItem => ({
  mediaKey,
  title: item.title,
  image: item.poster || "",
  type: item.isSeries || item.type === "series" ? "series" : "movie",
  provider: item.provider || "",
  link: item.link,
  epTitle: item.episodeTitle || "",
  position: Math.floor(item.progress ?? item.currentTime ?? 0),
  duration: Math.floor(item.duration ?? 0),
});

const stamp = (raw?: number) => (raw && raw > 0 ? raw : 0);

/**
 * A journal stamp only answers "has this row changed since we last agreed on
 * it", so it keeps the newest of the two sides. The server's own stamp can be
 * older than the one written right after a push.
 */
const remember = (journal: Record<string, number>, key: string, raw?: number) => {
  journal[key] = Math.max(journal[key] || 0, stamp(raw));
};

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let syncRequest: Promise<void> | undefined;

const mergeWatchlist = (serverItems: LibraryItem[], journal: Journal): void => {
  const local = watchListStorage.getWatchList();
  const localByLink = new Map(local.map(item => [item.link, item]));
  const serverKeys = new Set<string>();
  const next = [...local];

  for (const serverItem of serverItems) {
    // Titles saved on the site without a provider link cannot be opened here.
    if (!serverItem.link || !serverItem.title) continue;
    serverKeys.add(serverItem.mediaKey);
    remember(journal.watchlist, serverItem.mediaKey, serverItem.updatedAt || serverItem.addedAt);
    journal.keys[serverItem.link] = serverItem.mediaKey;
    const existing = localByLink.get(serverItem.link);
    if (existing) {
      const localStamp = stamp(existing.updatedAt);
      if (stamp(serverItem.addedAt) > localStamp) {
        const index = next.findIndex(item => item.link === serverItem.link);
        if (index >= 0) {
          next[index] = {...next[index], updatedAt: stamp(serverItem.addedAt) || localStamp};
        }
      }
      continue;
    }
    next.push({
      title: serverItem.title,
      poster: serverItem.image,
      link: serverItem.link,
      provider: serverItem.provider,
      updatedAt: stamp(serverItem.addedAt) || stamp(serverItem.updatedAt),
    });
  }

  // A title this app pushed but the account no longer has was deleted on
  // another device. Titles never pushed stay untouched.
  for (const key of Object.keys(journal.watchlist)) {
    if (serverKeys.has(key)) continue;
    delete journal.watchlist[key];
    const index = next.findIndex(item => journal.keys[item.link] === key);
    if (index >= 0) {
      delete journal.keys[next[index].link];
      next.splice(index, 1);
    }
  }

  applyingRemote = true;
  mainStorage.setArray<WatchListItem>(WatchListKeys.WATCH_LIST, next);
  useWatchListStore.setState({watchList: next});
  applyingRemote = false;
};

const mergeProgress = (serverItems: LibraryItem[], journal: Journal): void => {
  const local = watchHistoryStorage.getWatchHistory();
  const localByLink = new Map(local.map(item => [item.link, item]));
  const serverKeys = new Set<string>();

  applyingRemote = true;
  for (const serverItem of serverItems) {
    if (!serverItem.link || !serverItem.title) continue;
    serverKeys.add(serverItem.mediaKey);
    remember(journal.progress, serverItem.mediaKey, serverItem.updatedAt);
    journal.keys[serverItem.link] = serverItem.mediaKey;
    const existing = localByLink.get(serverItem.link);
    if (existing && stamp(existing.timestamp) >= stamp(serverItem.updatedAt)) continue;
    if (serverItem.duration && serverItem.position) {
      cacheStorage.setString(
        serverItem.link,
        JSON.stringify({position: serverItem.position, duration: serverItem.duration}),
      );
    }
    watchHistoryStorage.addToWatchHistory({
      ...(existing || {}),
      id: existing?.id || serverItem.link,
      title: serverItem.title,
      poster: serverItem.image || existing?.poster,
      provider: serverItem.provider || existing?.provider,
      link: serverItem.link,
      timestamp: stamp(serverItem.updatedAt) || Date.now(),
      progress: serverItem.position || 0,
      duration: serverItem.duration || existing?.duration,
      episodeTitle: serverItem.epTitle || existing?.episodeTitle,
      type: serverItem.type,
      isSeries: serverItem.type === "series",
    });
  }

  for (const key of Object.keys(journal.progress)) {
    if (serverKeys.has(key)) continue;
    delete journal.progress[key];
    local
      .filter(item => journal.keys[item.link] === key)
      .forEach(item => {
        delete journal.keys[item.link];
        watchHistoryStorage.removeFromWatchHistory(item.link);
      });
  }
  useWatchHistoryStore.setState({
    history: watchHistoryStorage
      .getWatchHistory()
      .map(item => ({...item, lastPlayed: item.timestamp, currentTime: item.progress || 0})),
  });
  applyingRemote = false;
};

const collectWatchlistChanges = (journal: Journal) => {
  const history = watchHistoryStorage.getWatchHistory();
  const local = watchListStorage.getWatchList();
  const items: LibraryItem[] = [];
  const localKeys = new Set<string>();
  for (const item of local) {
    const type = typeOfTitle(item.title, history);
    const mediaKey = journal.keys[item.link] || mediaKeyOf(item.title, type);
    localKeys.add(mediaKey);
    if (stamp(journal.watchlist[mediaKey]) >= stamp(item.updatedAt)) continue;
    items.push(toLibraryItem(item, mediaKey, type));
  }
  const removed = Object.keys(journal.watchlist).filter(key => !localKeys.has(key));
  return {items, removed};
};

const collectProgressChanges = (journal: Journal) => {
  const items: LibraryItem[] = [];
  const localKeys = new Set<string>();
  for (const item of watchHistoryStorage.getWatchHistory()) {
    if (!item.link || !item.title) continue;
    const mediaKey =
      journal.keys[item.link] ||
      mediaKeyOf(
        item.title,
        item.isSeries || item.type === "series" ? "series" : "movie",
      );
    localKeys.add(mediaKey);
    if (stamp(journal.progress[mediaKey]) >= stamp(item.timestamp)) continue;
    items.push(toProgressItem(item, mediaKey));
  }
  const removed = Object.keys(journal.progress).filter(key => !localKeys.has(key));
  return {items, removed};
};

const pushLists = async (journal: Journal): Promise<void> => {
  const watchlist = collectWatchlistChanges(journal);
  if (watchlist.items.length || watchlist.removed.length) {
    await pushWatchlist(watchlist.items, watchlist.removed);
    watchlist.items.forEach(item => {
      remember(journal.watchlist, item.mediaKey, Date.now());
      journal.keys[item.link] = item.mediaKey;
    });
    watchlist.removed.forEach(key => delete journal.watchlist[key]);
    saveJournal(journal);
  }

  const progress = collectProgressChanges(journal);
  if (progress.items.length || progress.removed.length) {
    await pushProgress(progress.items, progress.removed);
    progress.items.forEach(item => {
      remember(journal.progress, item.mediaKey, Date.now());
      journal.keys[item.link] = item.mediaKey;
    });
    progress.removed.forEach(key => delete journal.progress[key]);
    saveJournal(journal);
  }
};

/** Push what changed here, then pull the account's state back. */
export const syncLibrary = (): Promise<void> => {
  if (!syncRequest) {
    syncRequest = runSync().finally(() => {
      syncRequest = undefined;
    });
  }
  return syncRequest;
};

async function runSync(): Promise<void> {
  if (!getSession()) return;
  const journal = loadJournal();
  // The push has to come first: a title deleted locally is still on the
  // server, and pulling it back before that delete is sent would add it to the
  // local list and make the next diff see nothing removed at all.
  await pushLists(journal);
  const [watchlist, progress] = await Promise.all([fetchWatchlist(), fetchProgress()]);
  mergeWatchlist(watchlist, journal);
  mergeProgress(progress, journal);
  saveJournal(journal);
}

const schedulePush = () => {
  if (applyingRemote || pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    const journal = loadJournal();
    pushLists(journal).catch(error =>
      console.warn("[Cinepix] Library sync failed:", error),
    );
  }, PUSH_DELAY_MS);
};

export const initializeSiteSync = (): void => {
  if (!isTauriRuntime()) return;
  useWatchListStore.subscribe(() => schedulePush());
  useWatchHistoryStore.subscribe(() => schedulePush());
  syncLibrary().catch(error =>
    console.warn("[Cinepix] Initial library sync failed:", error),
  );
};

/** Called on sign-in, sign-out and profile change. */
export const resetLibrarySync = (): void => {
  mainStorage.delete(JOURNAL_KEY);
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
};
