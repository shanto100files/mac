import {test, expect, chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {fixtureExtension,approvedFixtureContext} from '../helpers/extension-fixture.mjs';

test('real incognito verification protects normal login cookies and refuses existing private windows', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const seen = [];
  const server = createServer((request,response) => {
    seen.push({url:request.url,cookie:request.headers.cookie || '',userAgent:request.headers['user-agent']});
    if (request.url === '/wait') {response.setHeader('Content-Type','text/html');response.end('<h1>Waiting for verification</h1>');return;}
    if (request.headers.cookie?.includes('cf_clearance=challenge-only')) {response.end('<html>Verified public provider response</html>');return;}
    response.writeHead(200, {'Content-Type':'text/html', 'Set-Cookie':['cf_clearance=challenge-only; Path=/; HttpOnly; SameSite=Lax','sessionid=private-account-secret; Path=/; HttpOnly; SameSite=Lax']});
    response.end('<html>PRIVATE_BROWSER_ACCOUNT_DATA</html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const remote=`http://127.0.0.1:${server.address().port}`;
  const extension=fixtureExtension(testInfo, [remote]);
  const launch=()=>chromium.launchPersistentContext(testInfo.outputPath('profile'), {channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let context=await approvedFixtureContext(testInfo,extension);
  try {
    let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId=worker.url().split('/')[2];
    let page=await context.newPage();await page.goto('http://127.0.0.1:1427/settings');
    await expect.poll(()=>page.evaluate(()=>Boolean(window.vegaPlatformHost?.verifyProvider))).toBe(true);
    await context.addCookies([{url:remote,name:'sessionid',value:'normal-account-secret',httpOnly:true},{url:remote,name:'cf_clearance',value:'normal-clearance-secret',httpOnly:true}]);
    const start=path=>page.evaluate(async url=>{
      const {openWebView}=await import('/src/platform/waf.ts');window.solveResult=undefined;window.solveController=new AbortController();
      void openWebView(url,{waitForCookie:'cf_clearance',force:true},'verification-fixture','Verification fixture',window.solveController.signal)
        .then(result=>window.solveResult={result},error=>window.solveResult={error:error.message});
    },remote+path);
    const confirm=async()=>{const dialog=page.getByRole('dialog',{name:'Open provider verification window?'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Confirm',exact:true}).click();};
    await start('/challenge');await confirm();
    await expect.poll(()=>page.evaluate(()=>window.solveResult?.error)).toContain('Allow in Incognito');
    const management=await context.newPage();await management.goto(`chrome://extensions/?id=${extensionId}`);
    const incognitoToggle=management.locator('#allow-incognito cr-toggle');
    await expect(incognitoToggle).toBeVisible();
    await incognitoToggle.click();
    await expect.poll(()=>management.locator('extensions-detail-view').evaluate(element=>element.data?.incognitoAccess.isActive)).toBe(true);
    // The browser restarts the extension when its incognito grant changes. Use
    // the same test profile with the persisted user setting and fresh workers.
    await context.close();context=await launch();
    worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(()=>chrome.extension.isAllowedIncognitoAccess())).toBe(true);
    page=await context.newPage();await page.goto('http://127.0.0.1:1427/settings');
    await context.addCookies([{url:remote,name:'sessionid',value:'normal-account-secret',httpOnly:true},{url:remote,name:'cf_clearance',value:'normal-clearance-secret',httpOnly:true}]);
    await expect.poll(()=>page.evaluate(()=>Boolean(window.vegaPlatformHost?.verifyProvider))).toBe(true);
    const existing=await worker.evaluate(()=>chrome.windows.create({incognito:true,url:'about:blank'}));
    await start('/challenge');await confirm();
    await expect.poll(()=>page.evaluate(()=>window.solveResult?.error)).toContain('Close all existing incognito');
    expect(await worker.evaluate(async id=>(await chrome.windows.getAll()).some(window=>window.id===id),existing.id)).toBe(true);
    await worker.evaluate(id=>chrome.windows.remove(id),existing.id);
    await start('/challenge');await confirm();
    await expect.poll(()=>page.evaluate(()=>Boolean(window.solveResult)),{timeout:15_000}).toBe(true);
    expect(await page.evaluate(()=>window.solveResult)).toMatchObject({result:{cookies:'cf_clearance=challenge-only'}});
    const result=await page.evaluate(()=>window.solveResult.result);
    expect(result.data).toContain('Verified public provider response');expect(result.data).not.toContain('PRIVATE_BROWSER_ACCOUNT_DATA');
    expect(result.cookieMap).toEqual({cf_clearance:'challenge-only'});
    expect(seen.filter(request=>request.url==='/challenge')[0].cookie).toBe('');
    expect(seen.filter(request=>request.url==='/challenge').at(-1).cookie).toBe('cf_clearance=challenge-only');
    expect(seen.some(request=>request.cookie.includes('normal-account-secret'))).toBe(false);
    expect((await context.cookies(remote)).find(cookie=>cookie.name==='sessionid').value).toBe('normal-account-secret');
    expect((await context.cookies(remote)).find(cookie=>cookie.name==='cf_clearance').value).toBe('normal-clearance-secret');
    expect(await worker.evaluate(async()=>(await chrome.windows.getAll()).filter(window=>window.incognito).length)).toBe(0);
    const malicious=await page.evaluate(async remote=>{
      try{await window.vegaPlatformHost.verifyProvider({url:remote+'/challenge',scope:'malicious',waitForCookie:'sessionid',storeId:'0'},new AbortController().signal);}catch(error){return error.message;}
    },remote);
    expect(malicious).toContain('Only the cf_clearance');
    await start('/wait');await confirm();
    await expect.poll(()=>worker.evaluate(async()=>(await chrome.windows.getAll()).filter(window=>window.incognito).length)).toBe(1);
    await page.evaluate(()=>window.solveController.abort());
    await expect.poll(()=>page.evaluate(()=>window.solveResult?.error)).toMatch(/abort/i);
    await expect.poll(()=>worker.evaluate(async()=>(await chrome.windows.getAll()).filter(window=>window.incognito).length)).toBe(0);
    await start('/wait');await confirm();
    await expect.poll(()=>worker.evaluate(async()=>(await chrome.windows.getAll()).filter(window=>window.incognito).length)).toBe(1);
    const another=await worker.evaluate(()=>chrome.windows.create({incognito:true,url:'about:blank'}));
    await expect.poll(()=>page.evaluate(()=>window.solveResult?.error)).toMatch(/incognito.*(opened|changed)/i);
    const remaining=await worker.evaluate(async()=>(await chrome.windows.getAll()).filter(window=>window.incognito).map(window=>window.id));
    expect(remaining).toEqual([another.id]);await worker.evaluate(id=>chrome.windows.remove(id),another.id);
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
});
