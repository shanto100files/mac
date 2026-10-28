import { mainStorage } from "../storage/StorageService";
import { getDeviceId } from "../sync/syncService";

/**
 * Session for the Cinepix account the app optionally signs in with. Everything
 * here is local: the app keeps working signed out, and logging in only adds the
 * account headers our server uses for provider access and library sync.
 */
export interface AccountSession {
  token: string;
  username: string;
  role: string;
  expiresAt: number;
}

export interface SiteProfile {
  id: number;
  name: string;
  adult: boolean;
}

const SESSION_KEY = "cinepix-session";
const PROFILE_KEY = "cinepix-profile-id";

/** Dispatched whenever the session or chosen profile changes. */
export const ACCOUNT_CHANGE_EVENT = "cinepix-account-change";

const announce = () => {
  window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT));
};

export const getSession = (): AccountSession | null => {
  const session = mainStorage.getObject<AccountSession>(SESSION_KEY);
  if (!session?.token) return null;
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    clearSession();
    return null;
  }
  return session;
};

export const saveSession = (session: AccountSession): void => {
  mainStorage.setObject(SESSION_KEY, session);
  announce();
};

export const clearSession = (): void => {
  mainStorage.delete(SESSION_KEY);
  mainStorage.delete(PROFILE_KEY);
  announce();
};

export const getProfileId = (): number => mainStorage.getNumber(PROFILE_KEY) || 0;

export const setProfileId = (id: number): void => {
  mainStorage.setNumber(PROFILE_KEY, id > 0 ? id : 0);
  announce();
};

const osName = (): string => {
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "macos";
  if (/android/i.test(ua)) return "android";
  return "linux";
};

/**
 * Headers our own endpoints key access on. Device identity travels even when
 * signed out: login records it on the new session, and a missing profile id is
 * left out so the server falls back to profile 0 instead of rejecting it.
 */
export const authHeaders = (): Record<string, string> => {
  const os = osName();
  const headers: Record<string, string> = {
    "x-device-id": getDeviceId(),
    "x-device-label": `Cinepix Desktop (${os})`,
    "x-device-platform": os,
  };
  const session = getSession();
  if (!session) return headers;
  headers["x-admin-token"] = session.token;
  const profileId = getProfileId();
  if (profileId > 0) headers["x-profile-id"] = String(profileId);
  return headers;
};
