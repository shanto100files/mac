import {mainStorage} from './storage/StorageService';
import {SettingsKeys, settingsStorage} from './storage/SettingsStorage';
import {ProvidersKeys} from './storage/ProvidersStorage';
import {
  ExtensionKeys,
  type ProviderExtension,
  type ProviderModule,
  type ProviderSource,
} from './storage/extensionStorage';
import useContentStore from './zustand/contentStore';
import useThemeStore from './zustand/themeStore';
import {createLibraryBackup, restoreLibraryBackup, validateLibraryBackup, type LibraryBackup} from './libraryBackup';

export const BACKUP_VERSION = 1;

type SettingType = 'bool' | 'string' | 'number' | 'array';

// Download location and launcher icon are left out because they point to
// device state (a folder permission and an activity alias) that a restore
// cannot bring back. Buffer sizes (forwardBufferMB, backBufferMB) are also
// left out because their safe limits depend on the device's physical RAM and heap.
const BACKUP_SETTINGS: Record<string, SettingType> = {
  [SettingsKeys.PRIMARY_COLOR]: 'string',
  [SettingsKeys.IS_CUSTOM_THEME]: 'bool',
  [SettingsKeys.SHOW_TAB_BAR_LABELS]: 'bool',
  [SettingsKeys.SHOW_CONTINUE_WATCHING]: 'bool',
  [SettingsKeys.CUSTOM_COLOR]: 'string',
  [SettingsKeys.HAPTIC_FEEDBACK]: 'bool',
  [SettingsKeys.NOTIFICATIONS_ENABLED]: 'bool',
  [SettingsKeys.AUTO_CHECK_UPDATE]: 'bool',
  [SettingsKeys.AUTO_DOWNLOAD]: 'bool',
  [SettingsKeys.SHOW_MEDIA_CONTROLS]: 'bool',
  [SettingsKeys.SHOW_HAMBURGER_MENU]: 'bool',
  [SettingsKeys.HIDE_SEEK_BUTTONS]: 'bool',
  [SettingsKeys.SHOW_PLAYER_EPISODE_SIDEBAR]: 'bool',
  [SettingsKeys.ENABLE_2X_GESTURE]: 'bool',
  [SettingsKeys.ENABLE_SWIPE_GESTURE]: 'bool',
  [SettingsKeys.EXCLUDED_QUALITIES]: 'array',
  [SettingsKeys.DOWNLOAD_CONCURRENCY]: 'number',
  [SettingsKeys.DOWNLOAD_CONNECTIONS]: 'number',
  [SettingsKeys.SUBTITLE_FONT_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_BOTTOM_PADDING]: 'number',
  [SettingsKeys.SUBTITLE_TEXT_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_FONT_FAMILY]: 'string',
  [SettingsKeys.LIST_VIEW_TYPE]: 'string',
  [SettingsKeys.TELEMETRY_OPT_IN]: 'bool',
  [SettingsKeys.TMDB_API_KEY]: 'string',
  [SettingsKeys.TMDB_API_KEY_REVISION]: 'number',
  [SettingsKeys.WARP_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_CMD_ARGS]: 'string',
  // Saved by the Preferences screen without a SettingsKeys entry.
  disableDrawer: 'bool',
  showRecentlyWatched: 'bool',
  useExternalPlayer: 'bool',
  alwaysExternalDownloader: 'bool',
  [SettingsKeys.TV_MODE_ENABLED]: 'bool',
  [SettingsKeys.INFO_PAGE_DYNAMIC_THEME]: 'bool',
  [SettingsKeys.SUBTITLE_FONT_WEIGHT]: 'number',
  [SettingsKeys.SUBTITLE_OUTLINE_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_OUTLINE_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_SHADOW_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_SHADOW_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_SHADOW_STYLE]: 'string',
  [SettingsKeys.HARDWARE_ACCELERATION]: 'bool',
  [SettingsKeys.DEVTOOLS_SHORTCUTS_ENABLED]: 'bool',
  [SettingsKeys.EXTERNAL_PLAYER_ENABLED]: 'bool',
  [SettingsKeys.VLC_ENABLED]: 'bool',
  [SettingsKeys.PLAYER_ZOOM]: 'number',
  [SettingsKeys.PLAYER_ENGINE]: 'string',
};
type SettingValue = boolean | string | number | string[];

export interface VegaBackup {
  library?: LibraryBackup;
  app: 'vega';
  version: number;
  createdAt: string;
  settings: Record<string, SettingValue>;
  providers: {
    installed: ProviderExtension[];
    sources: ProviderSource[];
    modules: ProviderModule[];
    disabled?: string[];
    selected?: ProviderExtension;
  };
}

const readSetting = (key: string, type: SettingType) => {
  switch (type) {
    case 'bool':
      return mainStorage.getBool(key);
    case 'string':
      return mainStorage.getString(key);
    case 'number':
      return mainStorage.getNumber(key);
    case 'array':
      return mainStorage.getArray<string>(key);
  }
};

const isValidSetting = (value: unknown, type: SettingType) => {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'array':
      return isStringArray(value);
  }
};

const writeSetting = (key: string, type: SettingType, value: SettingValue) => {
  switch (type) {
    case 'bool':
      mainStorage.setBool(key, value as boolean);
      break;
    case 'string':
      mainStorage.setString(key, value as string);
      break;
    case 'number':
      mainStorage.setNumber(key, value as number);
      break;
    case 'array':
      mainStorage.setArray(key, value as string[]);
      break;
  }
};

const isProvider = (value: unknown): value is ProviderExtension => {
  const provider = value as ProviderExtension;
  return (
    typeof provider?.value === 'string' &&
    typeof provider.display_name === 'string' &&
    typeof provider.type === 'string' &&
    typeof provider.version === 'string' &&
    typeof provider.source?.author === 'string' &&
    typeof provider.source?.url === 'string'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isProviderModule = (value: unknown): value is ProviderModule =>
  typeof (value as ProviderModule)?.value === 'string' &&
  !!(value as ProviderModule).modules &&
  typeof (value as ProviderModule).modules === 'object';

const isProviderSource = (value: unknown): value is ProviderSource =>
  typeof (value as ProviderSource)?.author === 'string' &&
  typeof (value as ProviderSource)?.url === 'string';

export const createBackup = (): VegaBackup => {
  const settings: Record<string, SettingValue> = {};
  for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
    // Only saved values are included so defaults stay defaults after restore.
    if (!mainStorage.contains(key)) {
      continue;
    }
    const value = readSetting(key, type);
    if (value !== undefined) {
      settings[key] = value;
    }
  }

  const selected = useContentStore.getState().provider;

  return {
    library: createLibraryBackup(),
    app: 'vega',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    settings,
    providers: {
      installed:
        mainStorage.getArray<ProviderExtension>(
          ExtensionKeys.INSTALLED_PROVIDERS,
        ) || [],
      sources:
        mainStorage.getArray<ProviderSource>(ExtensionKeys.PROVIDER_SOURCES) ||
        [],
      modules:
        mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) ||
        [],
      disabled: mainStorage.getArray<string>(ProvidersKeys.DISABLED_PROVIDERS),
      selected: selected?.value ? selected : undefined,
    },
  };
};

export const parseBackup = (text: string): VegaBackup => {
  let data: VegaBackup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Cinepix backup');
  }
  if (data?.app !== 'vega' || typeof data.version !== 'number') {
    throw new Error('This file is not a Cinepix backup');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Cinepix');
  }
  const {settings, providers} = data;
  if (
    !settings ||
    typeof settings !== 'object' ||
    Array.isArray(settings) ||
    !Array.isArray(providers?.installed) ||
    !Array.isArray(providers.sources) ||
    !Array.isArray(providers.modules)
  ) {
    throw new Error('This backup file is incomplete');
  }
  validateLibraryBackup(data.library);
  return data;
};

export const restoreBackup = (backup: VegaBackup): void => {
  validateLibraryBackup(backup.library);
  restoreLibraryBackup(backup.library);
  const settings = backup.settings || {};
  for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
    const value = settings[key];
    if (isValidSetting(value, type)) {
      writeSetting(key, type, value);
    }
  }

  // The theme store keeps its own persisted copy, so update it too. Do this
  // before selecting the provider so it cannot overwrite it (see #526).
  useThemeStore.setState({
    primary: settingsStorage.getPrimaryColor(),
    isCustom: settingsStorage.isCustomTheme(),

  });

  const {installed, sources, modules, disabled, selected} =
    backup.providers || {};
  if (Array.isArray(installed)) {
    const providers = installed.filter(isProvider);
    mainStorage.setArray(ExtensionKeys.INSTALLED_PROVIDERS, providers);
    useContentStore.getState().setInstalledProviders(providers);
  }
  if (Array.isArray(sources)) {
    mainStorage.setArray(
      ExtensionKeys.PROVIDER_SOURCES,
      sources.filter(isProviderSource),
    );
  }
  if (Array.isArray(modules)) {
    mainStorage.setArray(
      ExtensionKeys.PROVIDER_MODULES,
      modules.filter(isProviderModule),
    );
  }
  if (isStringArray(disabled)) {
    mainStorage.setArray(ProvidersKeys.DISABLED_PROVIDERS, disabled);
  }
  if (isProvider(selected)) {
    useContentStore.getState().setProvider(selected);
  }
};

export const exportBackup = async (): Promise<boolean> => {
  const {save} = await import('@tauri-apps/plugin-dialog');
  const {writeTextFile} = await import('@tauri-apps/plugin-fs');
  const path = await save({defaultPath: `cinepix-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{name: 'Cinepix backup', extensions: ['json']}]});
  if (!path) return false;
  await writeTextFile(path, JSON.stringify(createBackup(), null, 2));
  return true;
};

export const pickBackup = async (): Promise<VegaBackup | undefined> => {
  const {open} = await import('@tauri-apps/plugin-dialog');
  const {readTextFile} = await import('@tauri-apps/plugin-fs');
  const path = await open({multiple: false, filters: [{name: 'Cinepix backup', extensions: ['json']}]});
  if (!path) return undefined;
  return parseBackup(await readTextFile(path));
};
