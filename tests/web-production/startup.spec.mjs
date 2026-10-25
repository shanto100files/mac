import {test, expect} from '@playwright/test';

test('production web build boots and serves shared routes without native APIs', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Welcome to Vega'})).toBeVisible();
  const policy=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).toContain("object-src 'none'");
  expect(await page.evaluate(() => {
    window.inlineProbe=false; const script=document.createElement('script'); script.textContent='window.inlineProbe=true'; document.head.append(script); script.remove();
    return window.inlineProbe;
  })).toBe(false);
  // DevTools evaluation itself bypasses CSP's eval restriction. Test from an
  // ordinary allowed script, served only by this controlled test route.
  await page.route('**/csp-probe.js', route => route.fulfill({contentType:'application/javascript',body:"window.evalBlocked=false;try{Function('return 1')();}catch{window.evalBlocked=true;}"}));
  await page.evaluate(() => new Promise((resolve,reject) => {const script=document.createElement('script');script.src='/csp-probe.js';script.onload=resolve;script.onerror=reject;document.head.append(script);}));
  expect(await page.evaluate(()=>window.evalBlocked)).toBe(true);
  const navigation = page.getByRole('navigation', {name: 'Main navigation'});
  await expect(navigation.getByRole('button', {name: 'Downloads', exact: true})).toHaveCount(0);
  await navigation.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Libmedia', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Built-in', exact: true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible();
  await navigation.getByRole('button', {name: 'Library', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Import folder', exact: true})).toHaveCount(0);
  await page.goto('/downloads');
  await expect(page).toHaveURL(/\/watchlist$/);
  await page.goto('/extensions');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No providers available'})).toBeVisible();
  expect(errors).toEqual([]);
});
