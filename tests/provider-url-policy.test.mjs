import test from 'node:test';
import assert from 'node:assert/strict';
import {publicHttpUrl, isPublicAddress} from '../browser-extension/networkPolicy.mjs';
import {assertPublicDestination} from '../browser-extension/network-guard.mjs';

test('normalizes encoded addresses and blocks private, special and local destinations', () => {
  for (const value of ['http://localhost./','http://router.local/','http://router.home.arpa/','http://127.1/','http://2130706433/','http://0x7f000001/','http://10.0.0.1/','http://100.64.1.1/','http://169.254.169.254/','http://192.168.1.1/','http://[::1]/','http://[::ffff:127.0.0.1]/','http://[fc00::1]/','http://[2001:db8::1]/','http://[2002:7f00:1::]/','file:///secret','https://user:pass@provider.example/']) assert.throws(() => publicHttpUrl(value), undefined, value);
  for (const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  assert.equal(publicHttpUrl('https://provider.example/path').href, 'https://provider.example/path');
});
test('DNS preflight fails closed for private, mixed, empty and failed answers', async () => {
  for (const addresses of [[],['127.0.0.1'],['1.1.1.1','10.0.0.1'],['::ffff:192.168.1.1'],['fe80::1']]) await assert.rejects(assertPublicDestination('https://provider.example/', new AbortController().signal, async () => addresses), /blocked|unavailable/);
  await assert.rejects(assertPublicDestination('https://provider.example/', new AbortController().signal, async () => {throw new Error('DNS failed');}), /DNS failed/);
  assert.equal(await assertPublicDestination('https://provider.example/', new AbortController().signal, async () => ['1.1.1.1','2606:4700:4700::1111']), 'https://provider.example/');
});
