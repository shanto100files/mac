import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {rolldown} from 'rolldown';

const bundle = await rolldown({
  input: fileURLToPath(new URL('../../src/lib/services/providerSandbox.worker.ts', import.meta.url)),
  platform: 'browser',
});
const {output} = await bundle.generate({format: 'iife'});
await bundle.close();
const source = output.find(chunk => chunk.type === 'chunk').code;

async function invoke() {
  const requests = [];
  const result = await new Promise((resolve, reject) => {
    let receive;
    runInNewContext(source, {
      Response, Request, Headers, URL, URLSearchParams, AbortController, atob, btoa,
      TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
      setTimeout, clearTimeout, setInterval, clearInterval, console,
      addEventListener: (_type, handler) => { receive = handler; },
      postMessage: async message => {
        if (message.type === 'result') {
          if (message.error) reject(new Error(message.error));
          else resolve(message.result);
        }
        if (message.type !== 'rpc') return;
        requests.push(message.args);
        const manual = message.args.init.redirect === 'manual';
        const bytes = new TextEncoder().encode(manual ? '' : 'redirected page');
        await receive({data: {
          type: 'rpc-result', token: message.token, id: message.id,
          result: {
            status: manual ? 302 : 200, statusText: manual ? 'Found' : 'OK',
            url: manual ? message.args.url : 'https://new.example/s/share',
            headers: manual ? [['Location', 'https://files.example/video.mkv']] : [],
            data: bytes.buffer,
          },
        }});
      },
    });
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
