import test from 'node:test';
import assert from 'node:assert/strict';
import {httpUrl, headersOf, exactUrl, redirectHeaders, requestChanges, validateRequest} from '../browser-extension/policy.mjs';
import {APP_MATCHES, appOrigin} from '../browser-extension/app-policy.mjs';
import {readFileSync} from 'node:fs';

test('automatic bridge activation is restricted to Vega and local development pages', () => {
  for (const url of ['https://vega-app.in/', 'https://vega-app.in/watch?next=https://other.example', 'http://localhost:5173/', 'https://localhost:4443/', 'http://127.0.0.1:1427/']) assert.equal(appOrigin(url), new URL(url).origin);
  for (const url of ['https://other.example/', 'https://vega-app.in.evil.example/', 'https://evilvega-app.in/', 'https://localhost.evil.example/', 'https://sub.vega-app.in/', 'http://vega-app.in/', 'https://vega-app.in:8443/', 'file:///vega-app.in', 'https://vega-app.in@evil.example/']) assert.equal(appOrigin(url), undefined, url);
  const manifest = JSON.parse(readFileSync(new URL('../browser-extension/manifest.json', import.meta.url)));
  for (const script of manifest.content_scripts) {assert.deepEqual(script.matches, APP_MATCHES); assert.equal(script.all_frames, false);}
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.deepEqual(manifest.host_permissions, APP_MATCHES);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*','https://*/*']);
});

test('extension permits only valid HTTP requests and safely escaped exact URLs', () => {
  for (const url of ['file:///etc/passwd', 'data:text/plain,a', 'https://user:pass@example.com/']) assert.throws(() => httpUrl(url));
  for (const name of ['Host', 'Content-Length', 'Proxy-Authorization', 'Sec-WebSocket-Key', 'Sec-Unknown-Protocol']) assert.throws(() => headersOf([[name, 'value']]));
  assert.throws(() => headersOf([['referer', 'value\r\nInjected:1']]));
  const url = 'https://example.com/a+b.mp4?token=a.b&n=1';
  const regex = new RegExp(exactUrl(url));
  assert.equal(regex.test(url), true); assert.equal(regex.test(`${url}0`), false); assert.equal(regex.test(url.replace('a+b', 'aaab')), false);
  assert.throws(() => validateRequest({url, method: 'CONNECT', redirect: 'follow', credentials: 'omit'}));
  assert.throws(() => validateRequest({url, method: 'POST', redirect: 'follow', credentials: 'omit', body: [256]}));
});

test('provider client hints and fetch metadata reach DNR and survive redirects', () => {
  const identity = headersOf([
    ['Sec-CH-UA', '"Chromium";v="137"'], ['sec-ch-ua-mobile', '?0'], ['Sec-Ch-Ua-Platform', '"Windows"'],
    ['Sec-CH-UA-Full-Version-List', '"Chromium";v="137.0.0.0"'],
    ['Sec-Fetch-Site', 'none'], ['Sec-Fetch-Mode', 'navigate'], ['Sec-Fetch-Dest', 'document'], ['Sec-Fetch-User', '?1'],
  ]);
  const redirected = redirectHeaders([...identity, ['cookie', 'secret=1'], ['authorization', 'secret']], 'https://a.example/', 'https://b.example/');
  assert.deepEqual(redirected, identity);
  for (const [header, value] of identity) assert.ok(requestChanges(identity).some(change => change.header === header && change.value === value && change.operation === 'set'));
  assert.throws(() => headersOf([['Sec-CH-UA', 'value\r\nConnection: close']]));
});

test('cross-origin redirects strip credentials and custom secrets; profile credentials are removed', () => {
  const headers = headersOf([['Cookie', 'secret=1'], ['Authorization', 'secret'], ['X-Api-Key', 'secret'], ['Referer', 'https://source.example/']]);
  assert.deepEqual(redirectHeaders(headers, 'https://a.example/one', 'https://a.example/two'), headers);
  assert.deepEqual(redirectHeaders(headers, 'https://a.example/', 'https://b.example/'), [['referer', 'https://source.example/']]);
  assert.deepEqual(requestChanges([]), [{header: 'cookie', operation: 'remove'}, {header: 'authorization', operation: 'remove'}]);
});
