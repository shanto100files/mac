import {test, expect} from '@playwright/test';

async function execute(page, code, author = 'security-fixture') {
  return page.evaluate(async ({code, author}) => {
    const {providerManager} = await import('/src/lib/services/ProviderManager.ts');
    try {return {result:await providerManager.executeModule({code,author},'security-fixture','probe',{})};}
    catch (error) {return {error:error.message};}
  }, {code, author});
}

test('provider calls share compiled engine code and keep separate VM globals', async ({page}) => {
  await page.addInitScript(() => {
    window.__engineCompiles = 0;
    const compile = WebAssembly.compileStreaming.bind(WebAssembly);
    WebAssembly.compileStreaming = (...args) => { window.__engineCompiles++; return compile(...args); };
  });
  await page.goto('/');
  const code = `exports.probe=()=>{const g=Function('return this')();const previous=g.privateValue;g.privateValue='private';return {previous:previous??null};};`;
  const results = await Promise.all([execute(page,code),execute(page,code),execute(page,code)]);
  expect(results).toEqual(Array.from({length:3},()=>({result:{previous:null}})));
  expect(await page.evaluate(()=>window.__engineCompiles)).toBe(1);
  expect(await execute(page,code,'other-engine-source')).toEqual({result:{previous:null}});
  expect(await page.evaluate(()=>window.__engineCompiles)).toBe(1);
});

test('older WebViews can execute providers when compiled modules cannot be cloned', async ({page}) => {
  await page.addInitScript(() => {
    window.__moduleCloneFallbacks = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message,...args) {
      if (message?.engineModule instanceof WebAssembly.Module) {
        window.__moduleCloneFallbacks++;
        throw new DOMException('Module cloning unavailable', 'DataCloneError');
      }
      return send.call(this,message,...args);
    };
  });
  await page.goto('/');
  expect(await execute(page,'exports.probe=()=>42;')).toEqual({result:42});
  expect(await page.evaluate(()=>window.__moduleCloneFallbacks)).toBe(1);
});

test('cancelling an engine wait does not cancel another provider invocation', async ({page}) => {
  await page.addInitScript(() => {
    window.__engineCompiles = 0;
    const compile = WebAssembly.compileStreaming.bind(WebAssembly);
    WebAssembly.compileStreaming = async (...args) => {
      window.__engineCompiles++;
      await new Promise(resolve=>setTimeout(resolve,200));
      return compile(...args);
    };
  });
  await page.goto('/');
  expect(await page.evaluate(async()=>{
    const {providerManager}=await import('/src/lib/services/ProviderManager.ts');
    const controller=new AbortController();
    const module={code:'exports.probe=()=>42;',author:'engine-wait-fixture'};
    const cancelled=providerManager.executeModule(module,'first','probe',{},controller.signal).catch(error=>error.name);
    const surviving=providerManager.executeModule(module,'second','probe',{});
    setTimeout(()=>controller.abort(),10);
    return {cancelled:await cancelled,surviving:await surviving,compiles:window.__engineCompiles};
  })).toEqual({cancelled:'AbortError',surviving:42,compiles:1});
});

test('provider VM contains the reproduced constructor/prototype escape and remote imports', async ({page}) => {
  await page.goto('/');
  const requests=[]; page.on('request', request => {if (request.url().includes('/security-escape')) requests.push(request.url());});
  const outcome=await execute(page, `exports.probe=async()=>{
    const g=Function('return this')(); let p=g, nativeFetch=false;
    while(p){if(Object.getOwnPropertyDescriptor(p,'fetch')?.value)nativeFetch=true;p=Object.getPrototypeOf(p);}
    let imported=false;try{await import('data:text/javascript,export default 1');imported=true;}catch{}
    const hostGlobal=__hostSend.constructor('return this')();
    return {nativeFetch,imported,hostFetch:typeof hostGlobal.fetch,document:typeof g.document,storage:typeof g.indexedDB,worker:typeof g.Worker,websocket:typeof g.WebSocket,chrome:typeof g.chrome};
  };`);
  expect(outcome).toEqual({result:{nativeFetch:false,imported:false,hostFetch:'undefined',document:'undefined',storage:'undefined',worker:'undefined',websocket:'undefined',chrome:'undefined'}});
  expect(requests).toEqual([]);
});

test('provider SDK retains HTML parsing, URL/base64, hashing, timers and scoped storage', async ({page}) => {
  await page.goto('/');
  const code=`exports.probe=async({providerContext:c})=>{
    const $=c.cheerio.load('<a href="/episode">Episode</a>');
    await c.kvStore.set('fixture','owned'); await new Promise(r=>setTimeout(r,1));
    const u=new URL($('a').attr('href'),'https://provider.example');
    return {title:$('a').text(),url:u.href,b64:atob(btoa('hello')),hash:await c.Crypto.digestStringAsync('SHA-256','hello'),uuid:c.Crypto.randomUUID(),stored:await c.kvStore.get('fixture')};
  };`;
  const outcome=await execute(page,code);
  expect(outcome.error).toBeUndefined();
  expect(outcome.result).toMatchObject({title:'Episode',url:'https://provider.example/episode',b64:'hello',hash:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',stored:'owned'});
  expect(outcome.result.uuid).toMatch(/^[a-f0-9-]{36}$/);
  expect(await execute(page,`exports.probe=async({providerContext:c})=>({stored:await c.kvStore.get('fixture')});`,'other-source')).toEqual({result:{}});
});

test('provider VM interrupts runaway code and rejects direct private destinations', async ({page}) => {
  await page.goto('/');
  expect((await execute(page,`exports.probe=()=>{while(true){}};`)).error).toMatch(/interrupt|time|limit/i);
  expect((await execute(page,`exports.probe=async()=>fetch('http://127.0.0.1:1/security-escape');`)).error).toMatch(/not allowed|blocked|public/i);
});

test('provider VM bounds memory and cancellation terminates pending work', async ({page}) => {
  await page.goto('/');
  expect((await execute(page,`exports.probe=()=>{const chunks=[];while(true)chunks.push(new Uint8Array(1024*1024));};`)).error).toMatch(/memory|interrupt|limit/i);
  expect(await page.evaluate(async () => {
    const {providerManager}=await import('/src/lib/services/ProviderManager.ts');
    const controller=new AbortController();
    const result=providerManager.executeModule({author:'security-fixture',code:'exports.probe=async()=>new Promise(r=>setTimeout(r,30000));'},'fixture','probe',{},controller.signal).then(()=> 'unexpected',error=>error.name);
    setTimeout(()=>controller.abort(),100);return result;
  })).toBe('AbortError');
});
