import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {sourceModule, moduleUrl, cookieUrl, publicNetworkUrl} from './helpers/platform-modules.mjs';
const require=createRequire(import.meta.url);
const bridgeUrl=moduleUrl(`export const calls=[];export let responses=[];export const reset=value=>{calls.length=0;responses=value;};export async function invoke(command,{args}){calls.push(structuredClone(args));if(!responses.length)throw new Error('Unexpected request');return responses.shift();}export async function fetch(){throw new Error('Unexpected ambient native fetch');}`);
const bridge=await import(bridgeUrl);
const nativeUrl=await sourceModule('lib/providers/tauriAxiosAdapter.ts', {
  axios:new URL('./index.js',pathToFileURL(require.resolve('axios/package.json'))).href,
  '@tauri-apps/api/core':bridgeUrl, '@tauri-apps/plugin-http':bridgeUrl,
  './providerCookieJar':cookieUrl, '../../platform/publicNetworkPolicy':publicNetworkUrl,
  '../storage/SettingsStorage':moduleUrl(`export const settingsStorage={getDohProvider:()=> 'system',getDohCustomUrl:()=>''};`),
});
const {providerFetch}=await import(nativeUrl);
beforeEach(()=>{const entries=new Map();globalThis.window={};globalThis.localStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};bridge.reset([]);});
const response=(url,status=200,headers=[])=>({url,status,status_text:'fixture',headers,data:[111,107]});

test('native provider redirects reject private targets before another request', async()=>{
  bridge.reset([response('https://provider.example/',302,[['Location','http://2130706433/private']])]);
  await assert.rejects(providerFetch('source-a','https://provider.example/'),/blocked/);
  assert.equal(bridge.calls.length,1);assert.equal(bridge.calls[0].max_redirects,0);
});
test('native redirects reselect cookies and strip credentials across origins', async()=>{
  bridge.reset([response('https://provider.example/',302,[['Location','/auth'],['Set-Cookie','session=owned; Path=/']]),response('https://provider.example/auth',302,[['Location','https://other.example/']]),response('https://other.example/')]);
  assert.equal(await (await providerFetch('source-a','https://provider.example/',{headers:{Authorization:'Bearer owned','X-Api-Key':'owned'}})).text(),'ok');
  assert.equal(bridge.calls[1].headers.Cookie,'session=owned');
  assert.equal(bridge.calls[2].headers.Cookie,undefined);
  assert.equal(bridge.calls[2].headers.Authorization,undefined);
  assert.equal(bridge.calls[2].headers['X-Api-Key'],undefined);
  assert.ok(bridge.calls.every(call=>call.isolated_cookies && call.max_redirects===0));
});
