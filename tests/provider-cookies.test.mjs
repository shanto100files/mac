import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {cookieRulesUrl, cookieUrl} from './helpers/platform-modules.mjs';
const {cookieHeader, cookieMap, decodeCookieJar, matchingCookies, putCookies, responseCookies} = await import(cookieRulesUrl);
const {getJarCookieHeader, buildRequestCookieHeader, storeSetCookies, storeJarCookies, deleteJarCookie} = await import(cookieUrl);
const secure = 'https://video.example.com';

beforeEach(() => {
  const values = new Map();
  globalThis.localStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
});

test('cookies obey path boundaries, default directories and duplicate-name ordering', () => {
  let jar = responseCookies([], `${secure}/account/login`, ['sid=root; Path=/', 'sid=account; Path=/account', 'directory=one']);
  assert.equal(cookieHeader(jar, `${secure}/account/episodes`), 'sid=account; directory=one; sid=root');
  assert.equal(cookieMap(jar, `${secure}/account/episodes`).sid, 'account');
  assert.equal(cookieHeader(jar, `${secure}/accounting`), 'sid=root');
  jar = responseCookies(jar, `${secure}/account/logout`, ['sid=; Path=/account; Max-Age=0']);
  assert.equal(cookieHeader(jar, `${secure}/account`), 'directory=one; sid=root');
});

test('Secure cookies are never sent to HTTP or overwritten/deleted by insecure responses', () => {
  let jar = responseCookies([], `${secure}/`, ['sid=secret; Secure; Path=/']);
  assert.equal(cookieHeader(jar, secure), 'sid=secret');
  assert.equal(cookieHeader(jar, 'http://video.example.com/'), '');
  jar = responseCookies(jar, 'http://video.example.com/', ['sid=attacker; Path=/', 'sid=; Max-Age=0; Path=/', 'bad=one; Secure']);
  assert.equal(cookieHeader(jar, secure), 'sid=secret');
});

test('domain cookies reject unrelated domains, public/private suffixes and IP suffix tricks', () => {
  const jar = responseCookies([], `${secure}/`, ['host=only', 'shared=yes; Domain=example.com', 'bad=x; Domain=other.com', 'tld=x; Domain=com']);
  assert.equal(cookieHeader(jar, 'https://cdn.example.com/'), 'shared=yes');
  assert.equal(cookieHeader(jar, 'https://example.com.attacker.com/'), '');
  assert.equal(cookieHeader(responseCookies([], 'https://a.co.uk/', ['bad=1; Domain=co.uk']), 'https://b.co.uk/'), '');
  assert.equal(cookieHeader(responseCookies([], 'https://a.github.io/', ['bad=1; Domain=github.io']), 'https://b.github.io/'), '');
  assert.equal(cookieHeader(responseCookies([], 'http://127.0.0.1/', ['bad=1; Domain=0.0.1']), 'http://0.0.1/'), '');
});

test('Max-Age takes precedence over Expires, deleting only its domain/path identity', () => {
  let jar = responseCookies([], `${secure}/`, ['a=one; Path=/; Max-Age=5; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'a=two; Path=/other'], 1000);
  assert.deepEqual(matchingCookies(jar, `${secure}/other`, 6000).map(cookie => cookie.value), ['two']);
  assert.equal(jar.find(cookie => cookie.path === '/').expiresAt, 6000);
  jar = responseCookies(jar, `${secure}/`, ['a=; Path=/; Max-Age=0'], 2000);
  assert.deepEqual(jar.map(cookie => [cookie.path, cookie.value]), [['/other', 'two']]);
});

test('cookie prefixes, invalid stored entries and expired snapshots cannot broaden access', () => {
  const jar = responseCookies([], `${secure}/`, ['__Host-good=1; Secure; Path=/', '__Host-bad=1; Secure; Domain=video.example.com; Path=/', '__Secure-bad=1', 'valid=1']);
  assert.equal(cookieHeader(jar, secure), '__Host-good=1; valid=1');
  assert.deepEqual(decodeCookieJar({version: 2, cookies: [{...jar[0], domain: 'com', hostOnly: false}, {...jar[0], expiresAt: 0}, {name: 'broken'}]}), []);
  const poisoned = responseCookies([], `${secure}/`, ['__proto__=safe']);
  assert.equal(Object.getOwnPropertyDescriptor(cookieMap(poisoned, secure), '__proto__').value, 'safe');
});

test('legacy saved cookies survive reading and upgrade without changing other source profiles', () => {
  const legacy = JSON.stringify({'video.example.com': {session: {value: 'saved', hostOnly: true, expiresAt: null}}});
  localStorage.setItem('vega_provider_cookies:source-a', legacy);
  localStorage.setItem('vega_provider_cookies:source-b', legacy);
  assert.equal(getJarCookieHeader('source-a', `${secure}/movie`), 'session=saved');
  assert.equal(localStorage.getItem('vega_provider_cookies:source-a'), legacy);
  storeSetCookies('source-a', `${secure}/`, ['new=one; Path=/']);
  assert.equal(getJarCookieHeader('source-a', secure), 'session=saved; new=one');
  assert.equal(JSON.parse(localStorage.getItem('vega_provider_cookies:source-a')).version, 2);
  assert.equal(localStorage.getItem('vega_provider_cookies:source-b'), legacy);
});

test('explicit cookies, WAF imports and deletes preserve source, path and Secure boundaries', () => {
  storeSetCookies('source-a', `${secure}/`, ['sid=path; Path=/private']);
  assert.equal(buildRequestCookieHeader('source-a', `${secure}/private`, 'sid=manual'), 'sid=manual');
  assert.equal(getJarCookieHeader('source-b', secure), '');
  storeJarCookies('source-a', secure, [{name: 'waf', value: 'clearance', domain: 'video.example.com', path: '/private', secure: true}]);
  assert.equal(getJarCookieHeader('source-a', `${secure}/`).includes('waf='), false);
  assert.equal(getJarCookieHeader('source-a', 'http://video.example.com/private'), 'sid=path');
  deleteJarCookie('source-a', `${secure}/private`, 'waf');
  assert.equal(getJarCookieHeader('source-a', `${secure}/private`).includes('waf='), false);
});

test('cookie identity replacement keeps domain siblings and longer paths intact', () => {
  let jar = putCookies([], `${secure}/`, [{name: 'sid', value: 'parent', domain: 'example.com', path: '/'}, {name: 'sid', value: 'host', path: '/'}]);
  jar = putCookies(jar, `${secure}/`, [{name: 'sid', value: 'replacement', path: '/'}]);
  assert.equal(cookieHeader(jar, 'https://cdn.example.com/'), 'sid=parent');
  assert.deepEqual(jar.map(cookie => cookie.value), ['parent', 'replacement']);
});
