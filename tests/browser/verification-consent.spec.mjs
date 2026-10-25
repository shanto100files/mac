import {test, expect} from '@playwright/test';

test('verification consent, remembered choices and Settings apply before any window opens', async ({page}, testInfo) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', {name:'Provider verification windows', exact:true})).toBeVisible();
  await page.evaluate(() => {
    window.verificationCalls = 0;
    window.vegaPlatformHost = {version:1, kind:'browser-extension', capabilities:{restrictedHeaders:true, isolatedCookies:true,publicDestinationChecks:true, manualRedirects:true, mediaDelivery:false},
      verifyProvider: async input => {window.verificationCalls++; return {url:input.url, userAgent:navigator.userAgent, cookie:{name:'cf_clearance',value:'test-clearance',path:'/',secure:true}};},
      request: async input => ({url:input.url,status:200,headers:[],body:[...new TextEncoder().encode('<html>Verified provider response</html>')]}),
    };
  });
  const start = () => page.evaluate(async () => {
    const {openWebView} = await import('/src/platform/waf.ts'); window.verificationResult = undefined;
    void openWebView('https://verification.example/challenge', {waitForCookie:'cf_clearance',force:true}, 'test-source', 'Test provider')
      .then(result => window.verificationResult = {data:result.data}, error => window.verificationResult = {error:error.message});
  });
  const policy = () => page.evaluate(async () => (await import('/src/lib/storage/SettingsStorage.ts')).settingsStorage.getVerificationWindowPolicy());
  await start();
  const dialog = page.getByRole('dialog', {name:'Open provider verification window?'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Test provider'); await expect(dialog).toContainText('https://verification.example');
  await expect(dialog).toContainText('Only enter personal information in this window if you trust the provider.');
  expect(await page.evaluate(() => window.verificationCalls)).toBe(0);
  await dialog.screenshot({path:testInfo.outputPath('verification-permission.png')});
  await dialog.getByRole('button', {name:'Stop',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.verificationResult?.error)).toContain('stopped');
  expect(await policy()).toBe('ask');
  await start(); await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').click(); await dialog.getByRole('button', {name:'Confirm',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.verificationResult?.data)).toContain('Verified provider response');
  expect(await policy()).toBe('allow'); expect(await page.evaluate(() => window.verificationCalls)).toBe(1);
  await start();
  await expect.poll(() => page.evaluate(() => window.verificationCalls)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.verificationResult?.data)).toContain('Verified');
  await expect(dialog).toHaveCount(0);
  const row = page.locator('.settings-row').filter({has:page.getByRole('heading',{name:'Provider verification windows',exact:true})});
  await row.getByRole('button',{name:'Allow',exact:true}).click(); await page.getByRole('option',{name:'Block',exact:true}).click();
  await start(); await expect.poll(() => page.evaluate(() => window.verificationResult?.error)).toContain('blocked');
  expect(await page.evaluate(() => window.verificationCalls)).toBe(2); await expect(dialog).toHaveCount(0);
  await row.getByRole('button',{name:'Block',exact:true}).click(); await page.getByRole('option',{name:'Ask every time',exact:true}).click();
  await start(); await expect(dialog).toBeVisible(); await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button',{name:'Stop',exact:true}).click();
  await expect.poll(policy).toBe('block');
  await page.reload(); await expect(row.getByRole('button',{name:'Block',exact:true})).toBeVisible();
});
