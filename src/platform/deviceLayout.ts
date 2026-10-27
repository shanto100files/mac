import {isTauriRuntime} from './host';

declare global {
  interface Window {VegaDevice?: {isTelevision(): boolean}}
}

export function isAndroidRuntime(): boolean {
  return isTauriRuntime() && /android/i.test(navigator.userAgent);
}

/** Android's system UI mode distinguishes phones/tablets from Android TV. */
export function isTelevisionDevice(): boolean {
  if (import.meta.env.VITE_TV_HOST) return true;
  if (isAndroidRuntime() && window.VegaDevice) {
    try {return window.VegaDevice.isTelevision() === true;} catch { /* Older host: use UA below. */ }
  }
  if (/smarttv|googletv|leanback|\btv\b|web[o0]s|tizen/i.test(navigator.userAgent)) return true;
  // A desktop development TV flag must not turn Android phones into TVs.
  return !isAndroidRuntime() && import.meta.env.VITE_TV_MODE === 'true';
}

export function usesResponsiveLayout(): boolean {
  return !import.meta.env.VITE_TV_HOST &&
    (!isTauriRuntime() || (isAndroidRuntime() && !isTelevisionDevice()));
}
