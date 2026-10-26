import {test, expect} from '@playwright/test';
import {installTestBrowserExtension} from '../helpers/browser-extension.mjs';
const store = 'https://chromewebstore.google.com/detail/vega/iofleagpffjfcaegclkgbjjfeoinmjhe';

test('app stays accessible without extension and only adding a source opens the prompt', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Welcome to Vega'})).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', {name:'Settings', exact:true})).toBeVisible();
  await page.goto('/extensions');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTitle('Add provider source', {exact:true}).click();
  const prompt = page.getByRole('dialog', {name:'Install the Vega extension'});
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('textbox', {name:'Provider source'})).toHaveCount(0);
  await page.route(store, route=>route.fulfill({contentType:'text/html',body:'Extension store fixture'}));
  const opened = page.waitForEvent('popup');
  await prompt.getByRole('button', {name:'Install extension', exact:true}).click();
  const popup = await opened;
  await expect(popup).toHaveURL(store);
  await popup.close();
  await page.screenshot({path:testInfo.outputPath('extension-prompt-desktop.png')});
  await page.setViewportSize({width:375,height:812});
  await expect(prompt.getByRole('button',{name:'Not now'})).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('extension-prompt-mobile.png')});
  await prompt.getByRole('button',{name:'Not now'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button',{name:'Settings', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Settings',exact:true})).toBeVisible();
});

test('connecting the extension opens the source form and disconnecting leaves the app available', async ({page}) => {
  await page.goto('/extensions');
  await page.getByTitle('Add provider source',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Install the Vega extension'})).toBeVisible();
  await page.evaluate(installTestBrowserExtension);
  await expect(page.getByRole('dialog',{name:'Add source',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Provider source'})).toBeVisible();
  await page.evaluate(()=>{delete window.vegaPlatformHost;window.dispatchEvent(new Event('vega-platform-host-change'));});
  await expect(page.getByRole('dialog',{name:'Install the Vega extension'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.layout-root')).toBeVisible();
});

test('installing a listed provider also prompts when the extension is missing', async ({page}) => {
  await page.addInitScript(()=>{
    const source = {author:'fixture',url:'https://fixture.vega.example',isDefault:true};
    const provider = {value:'fixture',display_name:'Test provider',version:'1.0.0',type:'global',installed:false,disabled:false,icon:'',source};
    localStorage.setItem('providerSources',JSON.stringify([source]));
    localStorage.setItem('availableProviders',JSON.stringify([provider]));
    localStorage.setItem('availableProviders_fixture',JSON.stringify([provider]));
  });
  await page.goto('/extensions');
  await page.getByRole('button',{name:'Install',exact:true}).click();
  const prompt = page.getByRole('dialog',{name:'Install the Vega extension'});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button',{name:'Not now'}).click();
  await expect(page.getByRole('button',{name:'Install',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('installedProviders')||'[]'))).toEqual([]);
});
