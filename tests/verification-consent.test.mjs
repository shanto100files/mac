import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {sourceModule, moduleUrl, hostUrl, cookieUrl, scopeUrl, networkUrl} from './helpers/platform-modules.mjs';
const zustand=pathToFileURL(fileURLToPath(new URL('../node_modules/zustand/esm/index.mjs',import.meta.url))).href;
const settingsUrl=moduleUrl(`let policy='ask';export const settingsStorage={getVerificationWindowPolicy:()=>policy,setVerificationWindowPolicy:value=>{policy=value;}};`);
const consentUrl=await sourceModule('lib/zustand/verificationConsentStore.ts',{'zustand':zustand,'../storage/SettingsStorage':settingsUrl});
const wafStoreUrl=await sourceModule('lib/zustand/wafStore.ts',{'zustand':zustand});
const wafUrl=await sourceModule('platform/waf.ts',{
  './network':networkUrl,'./host':hostUrl,'../lib/zustand/wafStore':wafStoreUrl,
  '../lib/providers/headers':await sourceModule('lib/providers/headers.ts'),
  '../lib/providers/providerScope':scopeUrl,'../lib/providers/providerCookieJar':cookieUrl,
  '../lib/zustand/verificationConsentStore':consentUrl,
  '../lib/storage/extensionStorage':moduleUrl(`export const extensionStorage={getInstalledProviders:()=>[{value:'test-provider',display_name:'Installed Test provider',source:{author:'source-a'}}]};`),
});
const {settingsStorage}=await import(settingsUrl);
const {useVerificationConsentStore}=await import(consentUrl);
const {useWafStore}=await import(wafStoreUrl);
const {openWebView}=await import(wafUrl);
const {providerFetch}=await import(networkUrl);
beforeEach(()=>{
  const data=new Map();globalThis.window={};globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  settingsStorage.setVerificationWindowPolicy('ask');useVerificationConsentStore.setState({requests:[]});useWafStore.setState({requests:[]});
});
const options={waitForCookie:'cf_clearance',force:true};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('native verification waits for permission; Stop never queues a native window',async()=>{
  window.__TAURI_INTERNALS__={};
  const pending=openWebView('https://provider.example/',options,'source-a','test-provider');
  await flush();assert.equal(useWafStore.getState().requests.length,0);
  const prompt=useVerificationConsentStore.getState().requests[0];assert.equal(prompt.provider,'Installed Test provider');
  prompt.finish(false);await assert.rejects(pending,/stopped/);assert.equal(useWafStore.getState().requests.length,0);
});
test('native Confirm proceeds; remembering Confirm/Stop updates the shared setting',async()=>{
  window.__TAURI_INTERNALS__={};
  const pending=openWebView('https://native.example/',options,'source-a','test-provider');
  await flush();useVerificationConsentStore.getState().requests[0].finish(true,true);await flush();
  assert.equal(settingsStorage.getVerificationWindowPolicy(),'allow');
  const req=useWafStore.getState().requests[0];useWafStore.getState().remove(req.id);
  req.resolve({data:'native',cookies:'',cookieMap:{},url:req.url,userAgent:'native'});assert.equal((await pending).data,'native');
  settingsStorage.setVerificationWindowPolicy('ask');
  const blocked=openWebView('https://stopped.example/',options,'source-a','test-provider');await flush();
  useVerificationConsentStore.getState().requests[0].finish(false,true);await assert.rejects(blocked,/stopped/);
  assert.equal(settingsStorage.getVerificationWindowPolicy(),'block');
});
test('Block prevents both native and browser verification requests',async()=>{
  settingsStorage.setVerificationWindowPolicy('block');window.__TAURI_INTERNALS__={};
  await assert.rejects(openWebView('https://blocked.example/',options,'source-a'),/blocked/);
  delete window.__TAURI_INTERNALS__;window.vegaPlatformHost={version:1,kind:'browser-extension',capabilities:{restrictedHeaders:true,isolatedCookies:true,publicDestinationChecks:true,manualRedirects:true,mediaDelivery:false},verifyProvider:()=>{throw new Error('must not open');}};
  await assert.rejects(openWebView('https://blocked-browser.example/',options,'source-a'),/blocked/);
  assert.equal(useVerificationConsentStore.getState().requests.length,0);assert.equal(useWafStore.getState().requests.length,0);
});
test('cancellation removes pending permission and active native requests',async()=>{
  window.__TAURI_INTERNALS__={};const controller=new AbortController();
  const pending=openWebView('https://cancel.example/',options,'source-a','test-provider',controller.signal);await flush();controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(useVerificationConsentStore.getState().requests.length,0);
  settingsStorage.setVerificationWindowPolicy('allow');const activeController=new AbortController();
  const active=openWebView('https://active-cancel.example/',options,'source-a','test-provider',activeController.signal);await flush();
  assert.equal(useWafStore.getState().requests.length,1);activeController.abort();await assert.rejects(active,{name:'AbortError'});assert.equal(useWafStore.getState().requests.length,0);
});
test('browser verification imports only clearance and reuses the real browser identity for its source',async()=>{
  settingsStorage.setVerificationWindowPolicy('allow');const requests=[];
  window.vegaPlatformHost={version:1,kind:'browser-extension',capabilities:{restrictedHeaders:true,isolatedCookies:true,publicDestinationChecks:true,manualRedirects:true,mediaDelivery:false},
    verifyProvider:async request=>({url:request.url,userAgent:'Real browser',cookie:{name:'cf_clearance',value:'private-clearance',path:'/',secure:true}}),
    request:async request=>{requests.push(request);return{url:request.url,status:200,headers:[],body:[...new TextEncoder().encode('public HTML')]};}};
  const result=await openWebView('https://browser.example/',options,'source-a','test-provider');assert.equal(result.data,'public HTML');assert.equal(result.cookies,'cf_clearance=private-clearance');
  await providerFetch('source-a','https://browser.example/posts',{headers:{'User-Agent':'spoofed','Sec-CH-UA':'spoofed'}});
  assert.equal(new Headers(requests.at(-1).headers).get('user-agent'),'Real browser');assert.equal(new Headers(requests.at(-1).headers).get('sec-ch-ua'),null);
  await providerFetch('source-b','https://browser.example/posts',{headers:{'User-Agent':'source-b'}});
  assert.equal(new Headers(requests.at(-1).headers).get('cookie'),null);assert.equal(new Headers(requests.at(-1).headers).get('user-agent'),'source-b');
});
