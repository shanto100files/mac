import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInThisContext} from 'node:vm';
import ts from 'typescript';

function fixture() {
  const queue = [], calls = [], deleted = [], jars = new Map();
  let status = 200;
  const mocks = {
    '../lib/providers/tauriAxiosAdapter': {providerFetch: async (author, url, init) => {
      calls.push({author, url, init, cookies: jars.get(author)});
      return {ok: status === 200, status, url, text: async () => `page ${url}`};
    }},
    '../lib/zustand/wafStore': {useWafStore: {getState: () => ({enqueue: r => queue.push(r)})}},
    '../lib/providers/headers': {headers: {'User-Agent': 'test-ua'}},
    '../lib/providers/providerScope': {providerAuthor: a => a || 'local'},
    '../lib/providers/providerCookieJar': {
      getJarCookieMap: a => jars.get(a) || {},
      deleteJarCookie: (...args) => deleted.push(args),
    },
  };
  const source = readFileSync(new URL('../../src/platform/waf.ts', import.meta.url), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  }});
  const module = {exports: {}};
  runInThisContext(`(function(require,module,exports){${outputText}\n})`)(
    name => {assert.ok(name in mocks, name); return mocks[name];}, module, module.exports,
  );
  return {open: module.exports.openWebView, queue, calls, deleted, jars,
    setStatus: value => {status = value;},
    solve: (index = 0) => {
      const r = queue[index];
      jars.set(r.author, {cf_clearance: 'solved'});
      r.resolve({data: 'solver page', cookies: 'cf_clearance=solved',
        cookieMap: jars.get(r.author), url: r.url, userAgent: 'test-ua'});
    },
  };
}

test('one active or queued solver per author/domain regardless of path or cookie option', async () => {
  const f = fixture();
  const other = f.open('https://other.test/', {}, 'a');
  const first = f.open('https://SITE.test/a', {force: true, waitForCookie: 'cf_clearance'}, 'a');
  const second = f.open('https://site.test/b', {
    force: true, waitForCookie: 'different', headers: {Cookie: 'stale', Referer: 'https://site.test/'}}, 'a');
  assert.equal(f.queue.length, 2);
  assert.equal(f.deleted.length, 1, 'joining must not delete the new cookie');
  f.solve(0); f.solve(1);
  assert.equal((await first).data, 'solver page');
  assert.equal((await second).data, 'page https://site.test/b');
  await other;
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].cookies, {cf_clearance: 'solved'});
  assert.equal(f.calls[0].init.headers.Cookie, undefined);
  assert.equal(f.calls[0].init.headers.Referer, 'https://site.test/');
});

test('different authors and hosts keep separate cookie sessions', async () => {
  const f = fixture();
  const promises = [f.open('https://site.test/a', {}, 'a'),
    f.open('https://site.test/b', {}, 'b'), f.open('https://sub.site.test/', {}, 'a')];
  assert.equal(f.queue.length, 3);
  f.queue.forEach((_, i) => f.solve(i));
  await Promise.all(promises);
});

test('dismissal retries all callers once using saved cookies without another dialog', async () => {
  const f = fixture();
  const a = f.open('https://site.test/a', {}, 'a');
  const b = f.open('https://site.test/b', {}, 'a');
  f.jars.set('a', {cf_clearance: 'saved-before-dismissal'});
  f.queue[0].reject(new Error('WAF_DIALOG_CANCELLED'));
  assert.equal((await a).data, 'page https://site.test/a');
  assert.equal((await b).data, 'page https://site.test/b');
  assert.equal(f.queue.length, 1);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.cookies.cf_clearance === 'saved-before-dismissal'));
});

test('blocked retries retain cancellation and a fresh attempt can open a dialog', async () => {
  const f = fixture(); f.setStatus(403);
  const a = f.open('https://site.test/a', {}, 'a');
  const b = f.open('https://site.test/b', {}, 'a');
  const outcomes = Promise.allSettled([a, b]);
  f.queue[0].reject(new Error('WAF_DIALOG_CANCELLED'));
  for (const outcome of await outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.message, 'WAF_DIALOG_CANCELLED');
  }
  assert.equal(f.queue.length, 1);
  assert.equal(f.calls.length, 2);
  const retry = f.open('https://site.test/a', {force: true}, 'a');
  assert.equal(f.queue.length, 2); f.solve(1); await retry;
});

test('a failed waiter cannot affect the solved request or reopen a dialog', async () => {
  const f = fixture(); f.setStatus(403);
  const a = f.open('https://site.test/a', {}, 'a');
  const b = f.open('https://site.test/b', {}, 'a');
  const rejected = assert.rejects(b, /HTTP 403/);
  f.solve(); await a; await rejected;
  assert.equal(f.queue.length, 1);
});
