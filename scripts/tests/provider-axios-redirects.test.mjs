import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {getQuickJS} from 'quickjs-emscripten';

const source=readFileSync(new URL('../../src/lib/services/generated/providerSdk.js',import.meta.url),'utf8');

async function invoke() {
  const requests = [];
  const result = await new Promise((resolve, reject) => {
    void getQuickJS().then(engine=>{
    const vm=engine.newContext(); const runtime=vm.runtime;
    const evaluate=code=>{const value=vm.evalCode(code);if(value.error){const error=vm.dump(value.error);value.error.dispose();reject(new Error(error.message));return;}value.value.dispose();while(runtime.hasPendingJob()){const jobs=runtime.executePendingJobs();if(jobs.error){const error=vm.dump(jobs.error);jobs.error.dispose();reject(new Error(error.message));break;}}};
    const send=vm.newFunction('__hostSend',handle=>{const message=JSON.parse(vm.getString(handle));queueMicrotask(()=>{
      requests.push(message.args);
      const manual=message.args.init.redirect==='manual';
      const bytes=new TextEncoder().encode(manual?'':'redirected page');
      evaluate('__providerReply('+JSON.stringify({id:message.id,result:{status:manual?302:200,statusText:manual?'Found':'OK',url:manual?message.args.url:'https://new.example/s/share',headers:manual?[['Location','https://files.example/video.mkv']]:[],data:Array.from(bytes)}})+')');
    });});vm.setProp(vm.global,'__hostSend',send);send.dispose();
    const finish=vm.newFunction('__hostFinish',handle=>{const message=JSON.parse(vm.getString(handle));queueMicrotask(()=>{vm.dispose();message.error?reject(new Error(message.error)):resolve(message.result);});});vm.setProp(vm.global,'__hostFinish',finish);finish.dispose();
    evaluate('const __randomBytes=[];'+source);
    const receive=async ({data})=>evaluate('__providerStart('+JSON.stringify(data)+')');
    void receive({data: {
      type: 'invoke', token: 'redirect-regression', exportName: 'getStream', state: {},
      args: {},
      moduleCode: `exports.getStream = async ({providerContext}) => {
        const page = await providerContext.axios.get('https://old.example/s/share');
        const base = new URL(page.request.res.responseUrl).origin;
        const target = await providerContext.axios.get(base + '/d/share/gofile', {
          maxRedirects: 0, validateStatus: s => s >= 200 && s < 400,
        });
        const fetched = await fetch('https://old.example/s/share');
        return {
          browserURL: page.request.responseURL,
          nodeURL: page.request.res.responseUrl,
          fetchURL: fetched.url,
          location: target.headers.location,
          status: target.status,
        };
      };`,
    }}).catch(reject);
    }).catch(reject);
  });
  return {result, requests};
}

test('preserves final redirect URLs for browser axios, Node axios and fetch', async () => {
  const {result, requests} = await invoke();
  assert.equal(result.browserURL, 'https://new.example/s/share');
  assert.equal(result.nodeURL, result.browserURL);
  assert.equal(result.fetchURL, result.browserURL);
  assert.equal(requests[1].url, 'https://new.example/d/share/gofile');
});

test('keeps manual redirect status and Location available to extractors', async () => {
  const {result, requests} = await invoke();
  assert.equal(requests[1].init.redirect, 'manual');
  assert.equal(result.status, 302);
  assert.equal(result.location, 'https://files.example/video.mkv');
});
