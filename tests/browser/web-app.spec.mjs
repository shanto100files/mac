import {test, expect} from '@playwright/test';

test('shared app boots and navigates without Tauri, providers or extension', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nativeErrors = [];
  page.on('console', message => {
    if (/(__TAURI|\.invoke|transformCallback|native Tauri|set_stream_doh)/i.test(message.text()) && message.type() === 'error') nativeErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('.layout-root')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Minimize', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Downloads', exact: true})).toHaveCount(0);
  for (const [name, pathname] of [['Search', '/search'], ['Library', '/watchlist'], ['Extensions', '/extensions'], ['Settings', '/settings'], ['Home', '/']]) {
    await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name, exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`${pathname === '/' ? '/$' : pathname}`));
    await expect(page.locator('.layout-content')).toBeVisible();
    if (pathname === '/extensions') await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const state = await page.evaluate(async () => {
    const {extensionStorage} = await import('/src/lib/storage/extensionStorage.ts');
    const {settingsStorage, SettingsKeys} = await import('/src/lib/storage/SettingsStorage.ts');
    const {mainStorage} = await import('/src/platform/storage.ts');
    mainStorage.setString(SettingsKeys.PLAYER_ENGINE, 'mpv');
    return {sources: extensionStorage.getProviderSources(), providers: extensionStorage.getInstalledProviders(), engine: settingsStorage.getPlayerEngine(), saved: mainStorage.getString(SettingsKeys.PLAYER_ENGINE)};
  });
  expect(state).toEqual({sources: [], providers: [], engine: 'libmedia', saved: 'mpv'});
  expect(errors).toEqual([]); expect(nativeErrors).toEqual([]);
});

test('browser settings expose supported actions and preserve browser shortcuts', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/settings');
  await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible();
  for (const name of ['Download Directory', 'Concurrent Downloads', 'DNS over HTTPS', 'VLC Player', 'Detailed Logging']) {
    await expect(page.getByRole('heading', {name, exact: true})).toHaveCount(0);
  }
  await expect(page.getByRole('button', {name: 'Built-in', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Libmedia', exact: true})).toBeVisible();
  const blocked = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {key: 'r', ctrlKey: true, bubbles: true, cancelable: true});
    window.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(blocked).toBe(false); expect(errors).toEqual([]);
});

test('shared TV mode supports arrow and Enter navigation in the browser shell', async ({page}) => {
  await page.goto('/settings');
  await page.getByRole('switch', {name: 'Enable TV mode', exact: true}).setChecked(true);
  await expect(page.getByRole('switch', {name: 'Enable TV mode', exact: true})).toBeChecked();
  await page.goto('/');
  const navigation = page.getByRole('navigation', {name: 'Main navigation'});
  await expect(navigation.getByRole('button', {name: 'Home', exact: true})).toHaveClass(/tv-focus/);
  await page.keyboard.press('ArrowDown');
  await expect(navigation.getByRole('button', {name: 'Search', exact: true})).toHaveClass(/tv-focus/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search$/);
});
