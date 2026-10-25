import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fixtureExtension,approvedFixtureContext} from '../helpers/extension-fixture.mjs';

test('extension activates automatically only on Vega/local pages and delivers protected requests and video', async ({}, testInfo) => {
  const requests = [];
  const ffmpeg = fileURLToPath(new URL('../../src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe', import.meta.url));
  test.skip(!existsSync(ffmpeg), 'Existing fixture generator required.');
  const directory = testInfo.outputPath('media'); mkdirSync(directory, {recursive: true});
  const video = path.join(directory, 'movie.mp4');
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], {encoding: 'utf8'});
  expect(result.status, result.stderr).toBe(0);
  writeFileSync(path.join(directory, 'key.bin'), Buffer.alloc(16, 7));
  writeFileSync(path.join(directory, 'keyinfo'), `key.bin\n${path.join(directory, 'key.bin')}\n`);
  const hls = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-c', 'copy', '-hls_time', '2', '-hls_list_size', '0', '-hls_key_info_file', path.join(directory, 'keyinfo'), '-hls_segment_filename', path.join(directory, 'segment%d.ts'), path.join(directory, 'vod.m3u8')], {encoding: 'utf8'});
  expect(hls.status, hls.stderr).toBe(0);
  const server = createServer((request, response) => {
    requests.push({url: request.url, headers: request.headers});
    if (request.url === '/redirect') {response.writeHead(302, {Location: '/data'}).end(); return;}
    if (request.url === '/redirect-private') {response.writeHead(302, {Location: 'http://127.0.0.1:1/blocked'}).end(); return;}
    if (request.url === '/redirect-cross') {response.writeHead(302, {Location: `http://localhost:${server.address().port}/data`}).end(); return;}
    if (request.url === '/auth/start') {response.writeHead(302, {Location: '/auth/check', 'Set-Cookie': 'login=ok; Path=/auth'}).end(); return;}
    if (request.url === '/auth/check') {
      if (!request.headers.cookie?.includes('login=ok')) {response.writeHead(401).end('Missing redirect cookie'); return;}
      response.writeHead(303, {Location: '/auth/data', 'Set-Cookie': 'step=two; Path=/auth'}).end(); return;
    }
    if (request.url === '/auth/escape') {response.writeHead(302, {Location: '/data', 'Set-Cookie': 'inside=only-auth; Path=/auth'}).end(); return;}
    if (request.url === '/auth/logout') {response.writeHead(302, {Location: '/auth/data', 'Set-Cookie': 'login=; Max-Age=0; Path=/auth'}).end(); return;}
    if (request.url === '/auth/cross-start') {response.writeHead(302, {Location: `http://localhost:${server.address().port}/data`, 'Set-Cookie': 'cross=source-only; Path=/'}).end(); return;}
    if (request.url === '/slow') {setTimeout(() => response.end('late'), 5000); return;}
    if (request.url === '/set-cookie') {response.writeHead(200, {'Set-Cookie': ['provider=owned; Path=/', 'other=two; Path=/']}).end('cookie'); return;}
    if (request.url === '/data' || request.url === '/auth/data') {response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.headers)); return;}
    if (request.url === '/live.m3u8') {response.end('#EXTM3U\n#EXTINF:5,\nsegment0.ts\n'); return;}
    if (request.url === '/redirect-movie') {response.writeHead(302, {Location: '/secured/movie.mp4', 'Set-Cookie': 'stream-auth=granted; Path=/secured'}).end(); return;}
    if (request.url === '/redirect-master.m3u8') {response.writeHead(302, {Location: '/secured/master.m3u8', 'Set-Cookie': 'stream-auth=granted; Path=/secured'}).end(); return;}
    if (request.url.startsWith('/secured/') && !request.headers.cookie?.includes('stream-auth=granted')) {response.writeHead(401).end('Missing media redirect cookie'); return;}
    if (!request.headers.referer?.includes('source.example') || !request.headers.cookie?.includes('media=secret')) {response.writeHead(403).end('headers required'); return;}
    const name = request.url.replace(/^\/(?:secured\/)?/, '').split('?')[0];
    if (name === 'master.m3u8') {response.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvod.m3u8\n'); return;}
    if (!/^(movie\.mp4|vod\.m3u8|segment\d+\.ts|key\.bin)$/.test(name)) {response.writeHead(404).end(); return;}
    const bytes = readFileSync(path.join(directory, name));
    response.setHeader('Content-Type', name.endsWith('m3u8') ? 'application/vnd.apple.mpegurl' : name.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    if (range) {const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1; response.writeHead(206, {'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes'}).end(bytes.subarray(start, end + 1));}
    else response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${server.address().port}`;
  const extension = fixtureExtension(testInfo, [remote, remote.replace('127.0.0.1', 'localhost')]);
  const context = await approvedFixtureContext(testInfo,extension);
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const workerErrors = []; worker.on('console', message => {if (message.type() === 'error') workerErrors.push(message.text());});
    const page = await context.newPage(); await page.goto('http://127.0.0.1:1427');
    await expect.poll(() => page.evaluate(() => window.vegaPlatformHost?.kind)).toBe('browser-extension');
    expect(await page.evaluate(()=>window.vegaPlatformHost.capabilities.publicDestinationChecks)).toBe(true);
    const blocked = await page.evaluate(async remote => {
      const {platformFetch}=await import('/src/platform/network.ts');
      const errors=[];
      for (const url of ['http://127.0.0.1:1/blocked', `${remote}/redirect-private`]) {
        try {await platformFetch(url);errors.push('unexpected success');} catch(error) {errors.push(error.message);}
      }
      return errors;
    }, remote);
    expect(blocked).toHaveLength(2); for (const error of blocked) expect(error).toMatch(/blocked|public HTTP/i);
    await expect.poll(() => worker.evaluate(async () => {const [tab] = await chrome.tabs.query({url: 'http://127.0.0.1:1427/*'}); return chrome.action.getBadgeText({tabId: tab.id});})).toBe('ON');
    const popup = await context.newPage();
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({url: 'http://127.0.0.1:1427/*'});
      await chrome.tabs.update(tabs[0].id, {active: true});
    });
    await popup.goto(new URL('popup.html', worker.url()).href);
    await expect(popup.locator('#origin')).toHaveText('127.0.0.1:1427');
    await expect(popup.getByRole('status')).toHaveText('Active');
    await expect(popup.getByRole('button',{name:'Remove website access',exact:true})).toBeVisible();
    await expect(popup.getByRole('button',{name:/^connect|^disconnect/i})).toHaveCount(0);
    expect(await popup.locator('.brand img').evaluate(image => image.complete && image.naturalWidth === 128)).toBe(true);
    await popup.locator('body').screenshot({path: testInfo.outputPath('popup-active.png')}); await popup.close();
    expect(await page.evaluate(async url => {try {await fetch(url); return false;} catch {return true;}}, `${remote}/data`)).toBe(true);
    const data = await page.evaluate(async remote => {
      const {platformFetch, providerFetch} = await import('/src/platform/network.ts');
      const {headers: commonHeaders} = await import('/src/lib/providers/headers.ts');
      const browserHeaders = {...commonHeaders, 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-User': '?1'};
      const response = await platformFetch(`${remote}/data`, {headers: {...browserHeaders, Referer: 'https://source.example/', Cookie: 'explicit=1', 'User-Agent': 'VegaHostTest'}});
      const headers = await response.json();
      const redirect = await platformFetch(`${remote}/redirect`, {redirect: 'manual'});
      const followed = await platformFetch(`${remote}/redirect`);
      const cross = await (await platformFetch(`${remote}/redirect-cross`, {headers: {...browserHeaders, Cookie: 'secret=1', Authorization: 'Bearer secret', 'X-Api-Key': 'secret'}})).json();
      const cookie = await providerFetch('source-a', `${remote}/set-cookie`);
      const own = await (await providerFetch('source-a', `${remote}/data`)).json();
      const other = await (await providerFetch('source-b', `${remote}/data`)).json();
      return {headers, browserHeaders, redirect: redirect.status, location: redirect.headers.get('location'), followed: followed.status, cross, cookies: cookie.headers.getSetCookie(), own, other};
    }, remote);
    expect(data.headers.referer).toBe('https://source.example/'); expect(data.headers.cookie).toBe('explicit=1'); expect(data.headers['user-agent']).toBe('VegaHostTest');
    for (const [name, value] of Object.entries(data.browserHeaders)) if (name.toLowerCase().startsWith('sec-')) {
      expect(data.headers[name.toLowerCase()], name).toBe(value);
      expect(data.cross[name.toLowerCase()], `redirect ${name}`).toBe(value);
    }
    expect(data.redirect).toBe(302); expect(data.location).toBe('/data'); expect(data.followed).toBe(200);
    expect(data.cross.cookie).toBeUndefined(); expect(data.cross.authorization).toBeUndefined(); expect(data.cross['x-api-key']).toBeUndefined();
    expect(data.cookies).toHaveLength(2); expect(data.own.cookie).toContain('provider=owned'); expect(data.other.cookie).toBeUndefined();
    expect((await context.cookies(remote)).some(cookie => cookie.name === 'provider')).toBe(false);
    const auth = await page.evaluate(async remote => {
      const {providerFetch} = await import('/src/platform/network.ts');
      const followed = await (await providerFetch('redirect-source', `${remote}/auth/start`, {method: 'POST', body: 'sign-in'})).json();
      const saved = await (await providerFetch('redirect-source', `${remote}/auth/data`)).json();
      const outside = await (await providerFetch('redirect-source', `${remote}/auth/escape`)).json();
      const other = await (await providerFetch('other-source', `${remote}/auth/data`)).json();
      const cross = await (await providerFetch('redirect-source', `${remote}/auth/cross-start`)).json();
      const origin = await (await providerFetch('redirect-source', `${remote}/data`)).json();
      const logout = await (await providerFetch('redirect-source', `${remote}/auth/logout`)).json();
      const after = await (await providerFetch('redirect-source', `${remote}/auth/data`)).json();
      const manual = await providerFetch('manual-source', `${remote}/auth/start`, {redirect: 'manual'});
      const manualSaved = await (await providerFetch('manual-source', `${remote}/auth/data`)).json();
      return {followed, saved, outside, other, cross, origin, logout, after, manual: manual.status, manualSaved};
    }, remote);
    for (const item of [auth.followed, auth.saved]) {expect(item.cookie).toContain('login=ok'); expect(item.cookie).toContain('step=two');}
    expect(auth.outside.cookie).toBeUndefined(); expect(auth.other.cookie).toBeUndefined(); expect(auth.cross.cookie).toBeUndefined();
    expect(auth.origin.cookie).toBe('cross=source-only');
    for (const item of [auth.logout, auth.after]) {expect(item.cookie).not.toContain('login='); expect(item.cookie).toContain('step=two');}
    expect(auth.manual).toBe(302); expect(auth.manualSaved.cookie).toBe('login=ok');
    expect((await context.cookies(remote)).some(cookie => ['login', 'step', 'inside', 'cross'].includes(cookie.name))).toBe(false);
    const cancel = await page.evaluate(async remote => {
      const {platformFetch} = await import('/src/platform/network.ts');
      const controller = new AbortController(); const task = platformFetch(`${remote}/slow`, {signal: controller.signal});
      setTimeout(() => controller.abort(), 100); try {await task;} catch (error) {return error.name;}
    }, remote);
    expect(cancel).toBe('AbortError');
    // Synthetic playback uses the real shared player and a server with no CORS headers.
    for (const [name, format] of [['movie.mp4', 'mp4'], ['master.m3u8', 'hls'], ['redirect-movie', 'mp4'], ['redirect-master.m3u8', 'hls']]) {
      await page.evaluate(async ({url, format}) => {
        const {LibmediaPlayerAdapter} = await import('/src/lib/player/LibmediaPlayerAdapter.ts');
        const anchor = document.createElement('video'); document.body.append(anchor);
        window.adapter = new LibmediaPlayerAdapter(anchor);
        await window.adapter.load(url, {streamType: format, headers: {Referer: 'https://source.example/', Cookie: 'media=secret', 'Sec-CH-UA': '"Vega Media Test";v="1"', 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"'}});
      }, {url: `${remote}/${name}`, format});
      await expect.poll(() => page.evaluate(() => window.adapter.state.currentTime)).toBeGreaterThan(1);
      await page.evaluate(() => window.adapter.seek(3));
      await expect.poll(() => page.evaluate(() => window.adapter.state.currentTime)).toBeGreaterThanOrEqual(3);
      expect(await page.evaluate(() => window.adapter.state.error)).toBeNull();
      const tab2 = await context.newPage(); await tab2.goto('http://127.0.0.1:1427');
      expect(await tab2.evaluate(async url => {try {await fetch(url); return false;} catch {return true;}}, `${remote}/movie.mp4`)).toBe(true); await tab2.close();
      await page.evaluate(() => window.adapter.destroy());
      await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length)).toBe(0);
    }
    const live = await page.evaluate(async url => {
      try {await window.vegaPlatformHost.prepareMediaSource({id: 'live', source: url, format: 'hls'});} catch (error) {return error.message;}
    }, `${remote}/live.m3u8`);
    expect(live).toContain('Live HLS');
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()); expect(rules).toEqual([]);
    await page.reload(); await expect.poll(() => page.evaluate(() => window.vegaPlatformHost?.kind)).toBe('browser-extension');
    await page.evaluate(() => {window.bridgeEvents = []; window.addEventListener('message', event => {if (event.data?.vegaHost && event.data.type === 'status') window.bridgeEvents.push(event.data);});});
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({url: 'http://127.0.0.1:1427/*'});
      await chrome.scripting.registerContentScripts([{id: 'vega-6f6c64', matches: ['https://outside-vega.example/*'], js: ['page-bridge.js'], world: 'MAIN', runAt: 'document_start'}]);
      await chrome.declarativeNetRequest.updateSessionRules({addRules: [{id: 900, condition: {urlFilter: '|https://outside-vega.example/legacy|', tabIds: [tab.id]}, action: {type: 'modifyHeaders', requestHeaders: [{header: 'cookie', operation: 'set', value: 'legacy=1'}]}}]});
      await chrome.storage.session.set({leases: {legacy: {tabId: tab.id, documentId: 'old-document', origin: 'https://outside-vega.example', urls: ['https://outside-vega.example/legacy'], ruleIds: [900], expires: Date.now() + 120_000}}});
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(() => page.evaluate(async remote => {
      try {return (await window.vegaPlatformHost?.request({url: `${remote}/data`, method: 'GET', headers: [], redirect: 'follow', credentials: 'omit'}, new AbortController().signal))?.status;} catch {return 0;}
    }, remote), {timeout: 10_000}).toBe(200);
    await cdp.detach();
    expect(await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id))).not.toContain('vega-6f6c64');
    expect(await worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id))).not.toContain(900);
    const localAlias = await context.newPage(); await localAlias.goto('http://localhost:1427');
    await expect.poll(() => localAlias.evaluate(() => window.vegaPlatformHost?.kind)).toBe('browser-extension'); await localAlias.close();
    expect(requests.some(request => request.url.endsWith('.ts'))).toBe(true);
    expect(requests.some(request => request.url === '/key.bin' && request.headers.cookie === 'media=secret')).toBe(true);
    expect(requests.some(request => request.url === '/movie.mp4' && request.headers['sec-ch-ua'] === '"Vega Media Test";v="1"')).toBe(true);
    for (const suffix of ['movie.mp4', 'segment0.ts', 'key.bin']) expect(requests.some(request => request.url === `/secured/${suffix}` && request.headers.cookie.includes('stream-auth=granted'))).toBe(true);
    await context.route('https://vega-app.in/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Vega app activation test</title>'}));
    const production = await context.newPage(); await production.goto('https://vega-app.in');
    await expect.poll(() => production.evaluate(() => window.vegaPlatformHost?.kind)).toBe('browser-extension');
    expect(await production.evaluate(async url => (await window.vegaPlatformHost.request({url, method: 'GET', headers: [], redirect: 'follow', credentials: 'omit'}, new AbortController().signal)).status, `${remote}/data`)).toBe(200);
    await production.close();
    await context.route('https://outside-vega.example/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Unrelated website</title>'}));
    const outside = await context.newPage(); await outside.goto('https://outside-vega.example');
    expect(await outside.evaluate(() => window.vegaPlatformHost || window.__vegaBrowserBridge)).toBeUndefined();
    const inactivePopup = await context.newPage();
    const currentWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await currentWorker.evaluate(async () => {
      const [outside] = await chrome.tabs.query({url: 'https://outside-vega.example/*'}); await chrome.tabs.update(outside.id, {active: true});
      // Even legacy approval data and forced old script registrations cannot
      // enable the bridge on an unrelated site after upgrading.
      await chrome.storage.local.set({appOrigins: ['https://outside-vega.example']});
      await chrome.scripting.executeScript({target: {tabId: outside.id}, files: ['page-bridge.js'], world: 'MAIN'});
      await chrome.scripting.executeScript({target: {tabId: outside.id}, files: ['content.js']});
    });
    expect(await outside.evaluate(() => window.vegaPlatformHost || window.__vegaBrowserBridge)).toBeUndefined();
    await inactivePopup.goto(new URL('popup.html', currentWorker.url()).href);
    await expect(inactivePopup.getByRole('status')).toHaveText('Inactive');
    await expect(inactivePopup.getByRole('button',{name:/^connect|^disconnect/i})).toHaveCount(0);
    await inactivePopup.locator('body').screenshot({path: testInfo.outputPath('popup-inactive.png')});
    await inactivePopup.close();
    await page.goto('https://outside-vega.example');
    expect(await page.evaluate(() => window.vegaPlatformHost || window.__vegaBrowserBridge)).toBeUndefined();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.vegaPlatformHost?.kind)).toBe('browser-extension');
    expect(workerErrors).toEqual([]);
  } finally {
    for (const page of context.pages()) if (page.url().startsWith('http://127.0.0.1:1427')) await testInfo.attach('bridge-events', {body: JSON.stringify(await page.evaluate(() => window.bridgeEvents || [])), contentType: 'application/json'}).catch(() => {});
    await testInfo.attach('requests', {body: JSON.stringify(requests, null, 2), contentType: 'application/json'}); await context.close(); await new Promise(resolve => server.close(resolve));
  }
});
