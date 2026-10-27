import test from 'node:test';
import assert from 'node:assert/strict';

let sequence=0;
async function fixture(event='headers') {
  const listeners={},calls=[],rules=[];
  globalThis.chrome={runtime:{getURL:()=> 'https://extension.example/',id:'fixture'},
    webRequest:Object.fromEntries(['onBeforeRequest','onHeadersReceived','onBeforeRedirect'].map(name=>[name,{addListener:callback=>{listeners[name]=callback;}}])),
    declarativeNetRequest:{updateSessionRules:async input=>{rules.push(input);}},
  };
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://cloudflare-dns.com/'))return new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'1.1.1.1'}]}));
    calls.push(url);
    const details={url,initiator:'https://extension.example',requestId:String(calls.length),tabId:-1,type:'xmlhttprequest'};
    listeners.onBeforeRequest?.(details);
    if(url.endsWith('/final'))return new Response('complete');
    if(event==='cookie') {
      listeners.onHeadersReceived({...details,statusCode:302,responseHeaders:[{name:'Location',value:'/final'},{name:'Set-Cookie',value:'login=one; Path=/; Secure'}]});
      listeners.onBeforeRedirect({...details,statusCode:302,redirectUrl:'https://provider.example/final',responseHeaders:[{name:'Location',value:'/final'}]});
    }
    if(event!=='none'&&event!=='cookie')setTimeout(()=>{
      const metadata={...details,statusCode:302,responseHeaders:[{name:'Location',value:'/final'}]};
      if(event==='redirect')listeners.onBeforeRedirect?.({...metadata,responseHeaders:[],redirectUrl:'https://provider.example/final'});
      else listeners.onHeadersReceived({...metadata,...event==='wrong-request'?{requestId:'unrelated'}:{}});
    },20);
    return {status:0,type:'opaqueredirect',headers:new Headers(),body:null};
  };
  const {request}=await import(`../browser-extension/http.mjs?fixture=${++sequence}`);
  return {calls,rules,run:signal=>request({url:'https://provider.example/start?token=private',method:'GET',headers:[],redirect:'follow',credentials:'omit'},signal||new AbortController().signal)};
}

test('manual redirect waits for Chrome response metadata arriving after fetch resolves',async()=>{
  const f=await fixture();const response=await f.run();
  assert.equal(response.status,200);assert.equal(new TextDecoder().decode(Uint8Array.from(response.body)),'complete');
  assert.equal(f.calls.length,2);assert.equal(f.calls[1],'https://provider.example/final');
  assert.deepEqual(f.rules.at(-1),{removeRuleIds:[1]});
});
test('browser redirect events supply the checked redirect destination when response headers are unavailable',async()=>{
  const f=await fixture('redirect');assert.equal((await f.run()).status,200);assert.equal(f.calls.length,2);
});
test('redirect notifications retain the isolated Set-Cookie snapshot needed for the next hop',async()=>{
  const f=await fixture('cookie');const result=await f.run();
  assert.deepEqual(result.cookieUpdates,[{url:'https://provider.example/start?token=private',headers:['login=one; Path=/; Secure']}]);
  assert.ok(f.rules.some(rule=>rule.addRules?.[0].action.requestHeaders.some(header=>header.header==='cookie'&&header.value==='login=one')));
});
test('metadata for another request cannot be used to follow a redirect',async()=>{
  const f=await fixture('wrong-request');
  await assert.rejects(f.run(),error=>/redirect.*provider\.example/.test(error.message)&&!error.message.includes('private'));
  assert.equal(f.calls.length,1);
});
test('cancelling a metadata wait releases its rule and does not expose URL tokens',async()=>{
  const f=await fixture('none'),controller=new AbortController();
  const pending=f.run(controller.signal);setTimeout(()=>controller.abort(),5);
  await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.rules.at(-1),{removeRuleIds:[1]});
});
