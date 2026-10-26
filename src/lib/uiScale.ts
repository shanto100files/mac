import {settingsStorage} from './storage/SettingsStorage';
import {updateAllLayouts} from '@noriginmedia/norigin-spatial-navigation-core';

// CSS zoom reflows UI and fixed overlays together without changing the
// viewport covered by the player. Browser/native window zoom is independent.
export function initializeUiScale() {
  const apply = () => {
    document.documentElement.style.setProperty('zoom', String(settingsStorage.getUiScale() / 100));
    requestAnimationFrame(() => {
      updateAllLayouts();
      window.dispatchEvent(new Event('resize'));
    });
  };
  apply();
  window.addEventListener('vega-ui-scale-change', apply);
  window.addEventListener('storage', apply);
}
