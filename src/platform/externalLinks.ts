import {isTauriRuntime} from './host';

/** Launching a local VLC executable requires the installed desktop host. */
export function supportsVlcLaunch(): boolean {
  return isTauriRuntime() && !import.meta.env.VITE_TV_HOST &&
    !/android|iphone|ipad|webos|web0s|smarttv|tizen/i.test(navigator.userAgent);
}

export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be opened');
  if (isTauriRuntime()) {
    const {openUrl} = await import('@tauri-apps/plugin-opener');
    await openUrl(url.href);
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}
