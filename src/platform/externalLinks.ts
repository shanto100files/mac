import {isTauriRuntime} from './host';

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
