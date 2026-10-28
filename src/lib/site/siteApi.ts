import { platformFetch } from "../../platform/network";
import { SITE_ORIGIN } from "../siteConfig";
import {
  authHeaders,
  clearSession,
  saveSession,
  type AccountSession,
  type SiteProfile,
} from "./accountStore";

/** A watchlist or continue-watching row as our server stores it. */
export interface LibraryItem {
  mediaKey: string;
  title: string;
  image: string;
  type: string;
  provider: string;
  link: string;
  epTitle?: string;
  position?: number;
  duration?: number;
  addedAt?: number;
  updatedAt?: number;
}

const jsonHeaders = {"Content-Type": "application/json"};

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {error?: string};
    return String(body?.error || `Request failed (HTTP ${response.status})`);
  } catch {
    return `Request failed (HTTP ${response.status})`;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await platformFetch(`${SITE_ORIGIN}${path}`, {
    ...init,
    headers: {...authHeaders(), Accept: "application/json", ...(init.headers || {})},
  });
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new Error(await errorMessage(response));
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {method: "POST", headers: jsonHeaders, body: JSON.stringify(body)});

export const login = async (identity: string, password: string): Promise<AccountSession> => {
  const data = await post<AccountSession & {ok: boolean; email?: string}>("/api/auth/login", {
    identity,
    password,
  });
  const session: AccountSession = {
    token: data.token,
    username: data.username,
    role: data.role,
    expiresAt: data.expiresAt,
  };
  saveSession(session);
  return session;
};

export const logout = async (): Promise<void> => {
  try {
    await request("/api/auth/logout", {method: "POST"});
  } catch (error) {
    console.warn("Could not sign out on the server:", error);
  }
  clearSession();
};

export const fetchProfiles = (): Promise<{profiles: SiteProfile[]; adultGranted: boolean}> =>
  request("/api/auth/profiles");

/** Sent after signing in so the app can pick up the account's provider access. */
export const verifySession = (): Promise<{username: string; role: string}> =>
  request("/api/auth/me");

export const fetchWatchlist = async (): Promise<LibraryItem[]> =>
  (await request<{items: LibraryItem[]}>("/api/watchlist")).items;

export const fetchProgress = async (): Promise<LibraryItem[]> =>
  (await request<{items: LibraryItem[]}>("/api/progress")).items;

/**
 * Bulk routes: the app sends only what changed, and the server answers with the
 * profile's full list so the local cache converges on it.
 */
export const pushWatchlist = async (
  items: LibraryItem[],
  removed: string[],
): Promise<LibraryItem[]> =>
  (await post<{items: LibraryItem[]}>("/api/watchlist/sync", {items, removed})).items;

export const pushProgress = async (
  items: LibraryItem[],
  removed: string[],
): Promise<LibraryItem[]> =>
  (await post<{items: LibraryItem[]}>("/api/progress/sync", {items, removed})).items;
