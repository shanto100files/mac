import {test,expect,chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {fixtureExtension,approvedFixtureContext} from '../helpers/extension-fixture.mjs';

test('optional all-website access gates requests, grants from popup and cleans up on removal',async({},testInfo)=>{
  const requests=[];
  const server=createServer((req,res)=>{requests.push(req.url);if(req.url==='/slow'){setTimeout(()=>res.end('late'),5000);return;}res.end('fixture response');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const remote=`http://127.0.0.1:${server.address().port}`;
  const extension=fixtureExtension(testInfo,[remote]);
  const launch=profile=>chromium.launchPersistentContext(testInfo.outputPath(profile),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let context=await launch('fresh-profile');
  try {
    let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const origins=['http://*/*','https://*/*'];
    expect(await worker.evaluate(origins=>chrome.permissions.contains({origins}),origins)).toBe(false);
    let page=await context.newPage();await page.goto('http://127.0.0.1:1427');
    await expect.poll(()=>page.evaluate(()=>window.vegaPlatformHost?.kind)).toBe('browser-extension');
    const request=path=>page.evaluate(async url=>{try{return {value:await window.vegaPlatformHost.request({url,method:'GET',headers:[],redirect:'follow',credentials:'omit'},new AbortController().signal)};}catch(error){return {error:error.message};}},remote+path);
    expect((await request('/before')).error).toContain('Allow all websites');expect(requests).toEqual([]);
    const popup=await context.newPage();await popup.goto(new URL('popup.html',worker.url()).href);
    await expect(popup.getByRole('button',{name:'Allow all websites',exact:true})).toBeVisible();
    await popup.locator('body').screenshot({path:testInfo.outputPath('permission-needed.png')});
    // Simulate decline at Chrome's API boundary. Never click a native security
    // approval prompt; the granted branch below uses an isolated approved fixture.
    await popup.evaluate(()=>{window.permissionCalls=[];chrome.permissions.request=async input=>{window.permissionCalls.push({input,gesture:navigator.userActivation.isActive});return false;};});
    await popup.getByRole('button',{name:'Allow all websites',exact:true}).click();
    await expect(popup.locator('#access-feedback')).toContainText('not granted');
    expect(await popup.evaluate(()=>window.permissionCalls)).toEqual([{input:{origins},gesture:true}]);
    expect(await worker.evaluate(origins=>chrome.permissions.contains({origins}),origins)).toBe(false);
    await context.close();context=await approvedFixtureContext(testInfo,extension,'approved-profile');
    worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    page=await context.newPage();await page.goto('http://127.0.0.1:1427');
    await expect.poll(()=>page.evaluate(()=>window.vegaPlatformHost?.kind)).toBe('browser-extension');
    await expect(page.getByRole('heading',{name:'Welcome to Vega'})).toBeVisible();
    const approvedPopup=await context.newPage();await approvedPopup.goto(new URL('popup.html',worker.url()).href);
    await expect.poll(()=>worker.evaluate(origins=>chrome.permissions.contains({origins}),origins)).toBe(true);
    await expect(approvedPopup.getByRole('button',{name:'Remove website access',exact:true})).toBeVisible();
    expect((await request('/after')).value.status).toBe(200);
    await approvedPopup.locator('body').screenshot({path:testInfo.outputPath('permission-granted.png')});
    await approvedPopup.reload();await expect(approvedPopup.getByRole('button',{name:'Allow all websites',exact:true})).toBeHidden();
    // A fresh worker/browser profile session retains Chrome's permission grant.
    await context.close();context=await launch('approved-profile');worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(origins=>chrome.permissions.contains({origins}),origins)).toBe(true);
    const app=await context.newPage();await app.goto('http://127.0.0.1:1427');
    await expect.poll(()=>app.evaluate(()=>window.vegaPlatformHost?.kind)).toBe('browser-extension');
    const delivery=await app.evaluate(async url=>window.vegaPlatformHost.prepareMediaSource({id:'fixture',source:url,format:'mp4'}),remote+'/movie.mp4');
    expect(delivery.id).toBeTruthy();
    await app.evaluate(url=>{window.pendingRequest=window.vegaPlatformHost.request({url,method:'GET',headers:[],redirect:'follow',credentials:'omit'},new AbortController().signal).then(()=> 'unexpected',error=>error.message);},remote+'/slow');
    await expect.poll(()=>requests.includes('/slow')).toBe(true);
    const remove=await context.newPage();await remove.goto(new URL('popup.html',worker.url()).href);
    await remove.getByRole('button',{name:'Remove website access',exact:true}).click();
    await expect.poll(()=>worker.evaluate(origins=>chrome.permissions.contains({origins}),origins)).toBe(false);
    await expect.poll(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.session.get('leases')).leases||{}).length)).toBe(0);
    await expect.poll(()=>worker.evaluate(async()=> (await chrome.declarativeNetRequest.getSessionRules()).length)).toBe(0);
    expect(await app.evaluate(()=>window.pendingRequest)).toMatch(/removed|access|permission/i);
    const failed=await app.evaluate(async url=>{try{await window.vegaPlatformHost.request({url,method:'GET',headers:[],redirect:'follow',credentials:'omit'},new AbortController().signal);return 'unexpected';}catch(error){return error.message;}},remote+'/revoked');
    expect(failed).toContain('Allow all websites');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
});
