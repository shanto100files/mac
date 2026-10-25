import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceModule} from './helpers/platform-modules.mjs';
const {parseProviderIntegrity, verifyProviderModule} = await import(await sourceModule('lib/services/providerIntegrity.ts'));
const {runWithProviderSlot} = await import(await sourceModule('lib/services/providerExecutionLimits.ts'));

test('declared module hashes fail closed on missing, malformed and modified code', async () => {
  const code = 'exports.catalog=[];';
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
  const hash = Buffer.from(bytes).toString('hex');
  const integrity = Object.fromEntries(['posts','meta','stream','catalog'].map(key => [key,hash]));
  await verifyProviderModule('catalog',code,parseProviderIntegrity(integrity));
  await assert.rejects(verifyProviderModule('catalog',code+'malicious()',integrity), /integrity check failed/);
  await assert.rejects(verifyProviderModule('episodes',code,integrity), /missing/);
  assert.throws(() => parseProviderIntegrity({catalog:hash}), /all required/);
  assert.throws(() => parseProviderIntegrity({...integrity,posts:'not-a-hash'}), /SHA-256/);
  await assert.rejects(verifyProviderModule('posts','x'.repeat(2_000_001)), /too large/);
});

test('execution slots cap active VMs and cancellation removes queued work', async () => {
  let active = 0, peak = 0;
  const release = [];
  const task = () => runWithProviderSlot(async () => {active++; peak=Math.max(peak,active); await new Promise(resolve => release.push(resolve)); active--;});
  const running = [task(),task(),task()];
  await new Promise(resolve => setTimeout(resolve,0));
  const controller = new AbortController();
  const cancelled = runWithProviderSlot(async () => {throw new Error('Queued work must not execute');},controller.signal);
  const rejection = assert.rejects(cancelled,{name:'AbortError'}); controller.abort(); await rejection;
  const next=task();
  assert.equal(peak,3); release.shift()();
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(peak,3); release.forEach(resolve => resolve());
  await Promise.all([...running,next]);
  assert.equal(active,0);
});
