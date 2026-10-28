/**
 * Every remote this build talks to. Keeping them here means the site origin,
 * the provider catalog and the release channel move together in one edit.
 * VITE_SITE_ORIGIN only exists for testing a local server before it is live.
 */
export const SITE_ORIGIN =
  String(import.meta.env.VITE_SITE_ORIGIN || "").replace(/\/+$/, "") ||
  "https://bdix.cinepix.top";

/**
 * Vega's ExtensionManager derives `{url}/manifest.json` and
 * `{url}/dist/{value}/{file}.js` from this, which is the shape our server's
 * /api/app/vega routes publish.
 */
export const PROVIDER_SOURCE = {
  author: 'cinepix',
  url: `${SITE_ORIGIN}/api/app/vega`,
};

/**
 * When on, the source above is the only one the app accepts, so the provider
 * list, 18+ gating and per-account allowlists stay server-side decisions
 * instead of something a user can override on their machine.
 */
export const LOCK_PROVIDER_SOURCE = true;

export const DOWNLOAD_PAGE_URL = `${SITE_ORIGIN}/download`;

/** Kill switch + forced-update gate for this build's release channel. */
export const desktopStatusUrl = (opts: {
  appVersion: string;
  deviceId?: string;
  platform?: string;
  label?: string;
}): string => {
  const q = new URLSearchParams({ v: opts.appVersion });
  if (opts.deviceId) q.set('device', opts.deviceId);
  if (opts.platform) q.set('platform', opts.platform);
  if (opts.label) q.set('label', opts.label);
  return `${SITE_ORIGIN}/api/app/desktop/status?${q.toString()}`;
};

/** The phone build's channel; used by the Android branch of the updater. */
export const mobileStatusUrl = (appVersion: string, deviceId?: string): string => {
  const q = new URLSearchParams({ v: appVersion });
  if (deviceId) q.set('device', deviceId);
  return `${SITE_ORIGIN}/api/app/status?${q.toString()}`;
};

/** Our endpoints key access on headers, so only first-party calls get them. */
export const isSiteRemote = (url: string): boolean => {
  try {
    return new URL(url).origin === new URL(SITE_ORIGIN).origin;
  } catch {
    return false;
  }
};
