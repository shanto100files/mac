import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {verifyProvider, validateVerification} from '../browser-extension/verification.mjs';
let state;
const event = () => ({addListener(){},removeListener(){}});
beforeEach(() => {
  globalThis.fetch = async () => new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'1.1.1.1'}]}), {headers:{'Content-Type':'application/json'}});
  state = {allowed:true, preexisting:false, extra:false, tabs:[], windows:[], reads:[], closed:[], created:0, returnCookie:true};
  globalThis.chrome = {
    extension:{isAllowedIncognitoAccess:async()=>state.allowed},
    windows:{getAll:async()=>[...state.windows,...state.preexisting?[{id:99,incognito:true}]:[],...state.extra?[{id:100,incognito:true}]:[]],
      create:async()=>{state.created++;state.windows=[{id:2,incognito:true}];state.tabs=[{id:20,windowId:2,incognito:true,url:'about:blank'}];return {...state.windows[0],tabs:state.tabs};},
      remove:async id=>{state.closed.push(id);state.windows=[];},onCreated:event()},
    tabs:{query:async()=>state.tabs,update:async(id,update)=>Object.assign(state.tabs[0],update)},
    cookies:{getAllCookieStores:async()=>[{id:'normal',tabIds:[1]},{id:'private',tabIds:[20]}],get:async details=>{state.reads.push(details);return state.returnCookie?{name:'cf_clearance',value:'private-clearance',domain:'provider.example',hostOnly:true,path:'/',secure:true,storeId:'private'}:null;}},
    scripting:{executeScript:async()=>[{result:{userAgent:'Real browser',origin:'https://provider.example'}}]},
  };
});
const input = {url:'https://provider.example/challenge',scope:'source-a',waitForCookie:'cf_clearance'};
const owner = {tabId:1};
test('verification returns only clearance from its dedicated incognito cookie store',async()=>{
  const result=await verifyProvider({...input,storeId:'normal'},owner,new AbortController().signal);
  assert.equal(result.cookie.value,'private-clearance');assert.equal(result.data,undefined);
  assert.deepEqual(state.reads,[{url:input.url,name:'cf_clearance',storeId:'private'}]);assert.deepEqual(state.closed,[2]);
});
test('verification refuses missing incognito access and existing incognito windows',async()=>{
  state.allowed=false;await assert.rejects(verifyProvider(input,owner,new AbortController().signal),/Allow in Incognito/);
  state.allowed=true;state.preexisting=true;await assert.rejects(verifyProvider(input,owner,new AbortController().signal),/Close all existing incognito/);
  assert.equal(state.created,0);assert.deepEqual(state.reads,[]);assert.deepEqual(state.closed,[]);
});
test('arbitrary account-cookie names and provider scripts are rejected before opening',()=>{
  assert.throws(()=>validateVerification({...input,waitForCookie:'sessionid'}),/Only the cf_clearance/);
  assert.throws(()=>validateVerification({...input,injectedJavaScript:'stealCookies()'}),/JavaScript is not allowed/);
  assert.equal(state.created,0);
});
test('cancellation closes only the created window without returning any cookie',async()=>{
  state.returnCookie=false;const controller=new AbortController();
  const pending=verifyProvider(input,owner,controller.signal);setTimeout(()=>controller.abort(),10);
  await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(state.closed,[2]);
});
test('a second incognito window appearing during creation stops the solve',async()=>{
  const create=chrome.windows.create;chrome.windows.create=async()=>{const result=await create();state.extra=true;return result;};
  await assert.rejects(verifyProvider(input,owner,new AbortController().signal),/Incognito session changed/);
  assert.deepEqual(state.closed,[2]);assert.deepEqual(state.reads,[]);
});
test('the normal profile store cannot be used even if the browser reports it for the new tab',async()=>{
  chrome.cookies.getAllCookieStores=async()=>[{id:'normal',tabIds:[1,20]}];
  await assert.rejects(verifyProvider(input,owner,new AbortController().signal),/not isolated/);
  assert.deepEqual(state.reads,[]);assert.deepEqual(state.closed,[2]);
});
test('an uncommitted private-tab URL waits without reading another store',async()=>{
  const query=chrome.tabs.query;let waiting=false;
  const update=chrome.tabs.update;chrome.tabs.update=async(...args)=>{const result=await update(...args);waiting=true;return result;};
  chrome.tabs.query=async()=>{const tabs=await query();if(waiting){waiting=false;return[{...tabs[0],url:undefined,pendingUrl:input.url}];}return tabs;};
  const result=await verifyProvider(input,owner,new AbortController().signal);
  assert.equal(result.cookie.value,'private-clearance');assert.equal(state.reads[0].storeId,'private');
});
test('navigation to another website stops before reading cookies',async()=>{
  const update=chrome.tabs.update;chrome.tabs.update=async id=>update(id,{url:'https://instagram.example/'});
  await assert.rejects(verifyProvider(input,owner,new AbortController().signal),/another website/);
  assert.deepEqual(state.reads,[]);assert.deepEqual(state.closed,[2]);
});
