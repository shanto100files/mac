import { useEffect } from 'react';
import {isTauriRuntime} from '../../platform/host';
import { getVersion } from '@tauri-apps/api/app';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { settingsStorage } from '../storage';
import { getDeviceId } from '../sync/syncService';
import { desktopStatusUrl, DOWNLOAD_PAGE_URL, mobileStatusUrl } from '../siteConfig';
import type { Update } from '@tauri-apps/plugin-updater';
import axios from 'axios';

interface SiteStatus {
  killed?: boolean;
  kill_message?: string;
  force_update?: boolean;
  min_version?: string;
  latest_version?: string;
  update_message?: string;
}

// Helper to compare semver versions simply for Android
const isNewer = (latest: string, current: string) => {
  if (!latest || !current) return false;
  const l = latest.replace(/[^0-9.]/g, '').split('.').map(Number);
  const c = current.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const lPart = l[i] || 0;
    const cPart = c[i] || 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
};

/* Only labels the release channel, so an approximation is enough to keep
   desktop installs separable from the mobile ones in Admin -> Devices. */
const desktopPlatform = (): string => {
  const ua = navigator.userAgent;
  const arm = /arm64|aarch64/i.test(ua);
  if (/windows/i.test(ua)) return arm ? 'windows-aarch64' : 'windows-x86_64';
  if (/macintosh|mac os x/i.test(ua)) return arm ? 'darwin-aarch64' : 'darwin-x86_64';
  return arm ? 'linux-aarch64' : 'linux-x86_64';
};

const shutdown = async () => {
  try {
    await getCurrentWindow().destroy();
  } catch (err) {
    console.error('Could not close the window:', err);
  }
};

const applyForcedUpdate = async (note: string) => {
  let update: Update | null = null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check();
  } catch (err) {
    console.warn('Forced update check failed:', err);
  }

  if (update) {
    try {
      await update.downloadAndInstall();
      return; // Windows hands over to the installer, which restarts the app
    } catch (err) {
      console.error('Forced update install failed:', err);
    }
  }

  await message(
    `${note || 'A required update is available.'}\n\nOpening the download page.`,
    { title: 'Update required', kind: 'warning' },
  );
  await openUrl(DOWNLOAD_PAGE_URL);
  await shutdown();
};

/**
 * Server-side gate read from our site before the app does anything else:
 * `killed` stops the build outright and `force_update` makes it update or exit.
 * Returns false when the app must not keep running.
 */
export const checkSiteGuard = async (): Promise<boolean> => {
  if (!isTauriRuntime()) return true;

  let status: SiteStatus | null = null;
  try {
    const { data } = await axios.get<SiteStatus>(
      desktopStatusUrl({
        appVersion: await getVersion(),
        deviceId: getDeviceId(),
        platform: desktopPlatform(),
      }),
      { timeout: 8000 },
    );
    status = data;
  } catch (err) {
    // A site outage must not lock a working install out of the app.
    console.warn('Could not reach the release service:', err);
    return true;
  }

  if (!status) return true;

  if (status.killed) {
    await message(
      String(status.kill_message || 'Cinepix is temporarily disabled.'),
      { title: 'Cinepix', kind: 'error' },
    );
    await shutdown();
    return false;
  }

  if (status.force_update) {
    await applyForcedUpdate(String(status.update_message || ''));
    return false;
  }

  return true;
};

export const checkAppUpdates = async (manual = false) => {
  if (!isTauriRuntime()) return;
  try {
    const userAgent = navigator.userAgent.toLowerCase();

    // 0. Disable updater for Microsoft Store builds
    if (import.meta.env.VITE_IS_MS_STORE === 'true') {
      if (manual) {
        message('Updates are managed automatically by the Microsoft Store.', { title: 'Microsoft Store', kind: 'info' });
      }
      return;
    }
    // 1. Custom fallback for Android
    if (userAgent.includes('android')) {
      const { data } = await axios.get(mobileStatusUrl(await getVersion(), getDeviceId()), {
        timeout: 10000,
      });
      const latestVersion = String(data?.latest_version || '');
      const currentVersion = await getVersion();

      if (latestVersion && isNewer(latestVersion, currentVersion)) {
        const wantToUpdate = await ask(
          `Version ${latestVersion} is available! Would you like to go to the download page to get the new APK?`,
          { title: 'Cinepix Update', kind: 'info' }
        );
        if (wantToUpdate) {
          openUrl(DOWNLOAD_PAGE_URL);
        }
      } else if (manual) {
        message('You are already on the latest version of Cinepix.', { title: 'Up to Date', kind: 'info' });
      }
      return;
    }

    // 2. Official Tauri Auto-Updater for Desktop
    const { check } = await import('@tauri-apps/plugin-updater');

    // Checks the endpoints defined in tauri.conf.json
    const update = await check();

    if (!update) {
      if (manual) {
        message('You are already on the latest version of Cinepix.', { title: 'Up to Date', kind: 'info' });
      }
      return;
    }

    const wantToUpdate = await ask(
      `Version ${update.version} is available!\n\nRelease notes:\n${update.body || 'New version available.'}\n\nWould you like to install it now?`,
      { title: 'Cinepix Update', kind: 'info' }
    );
    if (!wantToUpdate) return;

    message(
      `Downloading new version (${update.version}) in the background. The app will restart when ready.`,
      { title: 'Updating Cinepix', kind: 'info' }
    );

    console.log(`Downloading update ${update.version}...`);

    let downloaded = 0;
    let contentLength = 0;

    // This seamlessly downloads the patch and overwrites the files silently
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (downloaded % (1024 * 1024 * 5) === 0) {
            console.log(`Downloaded ${downloaded} of ${contentLength} bytes`);
          }
          break;
        case 'Finished':
          console.log('Download finished! Restarting...');
          break;
      }
    });

    // NOTE: On Windows, downloadAndInstall will automatically close the app and launch the installer in silent mode.
    // So the app will restart itself automatically here!

  } catch (err: any) {
    console.error('Failed to check for app updates:', err);
    if (manual) {
      message('Failed to check for updates. Please check your internet connection.', { title: 'Error', kind: 'error' });
    }
  }
};

export const useAppUpdater = () => {
  useEffect(() => {
    // @ts-ignore - Tauri injects this globally
    if (!window.__TAURI_INTERNALS__) return;

    let cancelled = false;

    // Deliberately outside the auto-update preference: turning update checks off
    // must not also switch off the kill switch.
    const timer = setTimeout(async () => {
      if (!(await checkSiteGuard())) return;
      if (cancelled) return;
      if (settingsStorage.isAutoCheckUpdateEnabled()) checkAppUpdates(false);
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
};
