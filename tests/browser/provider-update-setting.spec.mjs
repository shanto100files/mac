import {test,expect} from '@playwright/test';

test('provider auto-update setting is available on web, persists and remains available in TV mode',async({page},testInfo)=>{
  await page.goto('/settings');
  const control=page.getByRole('switch',{name:'Auto update providers',exact:true});
  await expect(control).toBeChecked();
  await control.click();await expect(control).not.toBeChecked();
  await page.reload();await expect(control).not.toBeChecked();
  expect(await page.evaluate(async()=>{
    const {settingsStorage}=await import('/src/lib/storage/SettingsStorage.ts');
    const enabled=settingsStorage.isProviderAutoUpdateEnabled();settingsStorage.setTvModeEnabled(true);return enabled;
  })).toBe(false);
  await page.reload();await expect(control).toBeVisible();await expect(control).not.toBeChecked();
  await control.scrollIntoViewIfNeeded();
  await control.locator('..').screenshot({path:testInfo.outputPath('provider-auto-update-setting.png')});
});
