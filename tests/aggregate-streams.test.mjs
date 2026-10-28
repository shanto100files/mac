import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {moduleUrl} from './helpers/platform-modules.mjs';

/**
 * The desktop app merges its opened provider's files with everything the site's
 * aggregation engine resolves for the same title. These tests drive the client
 * with a fake site so the source picking, dedupe and fallback rules stay honest
 * without a running server or provider network.
 */

let instances = 0;

/* Each test needs a fresh module because the client caches resolved titles;
   identical data URLs would otherwise be served from the ESM cache. */
async function freshSourceModule(relative, imports = {}) {
  const source = await readFile(new URL(`../src/${relative}`, import.meta.url), 'utf8');
  let js = ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  }).outputText;
  js += `\n// test instance ${++instances}`;
  for (const [name, value] of Object.entries(imports)) {
    js = js.replaceAll(`'${name}'`, JSON.stringify(value)).replaceAll(`"${name}"`, JSON.stringify(value));
  }
  return moduleUrl(js);
}

const response = data => ({ok: true, status: 200, json: async () => data});

async function loadModule({enabled = true} = {}) {
  const state = {calls: [], handler: null};
  globalThis.__aggregate = state;

  const networkUrl = moduleUrl(`
    export const platformFetch = (url, init) => {
      globalThis.__aggregate.calls.push({url: String(url), init: init || {}});
      return globalThis.__aggregate.handler(String(url), init || {});
    };
  `);

  const url = await freshSourceModule('lib/site/aggregateStreams.ts', {
    '../../platform/network': networkUrl,
    '../siteConfig': moduleUrl('export const SITE_ORIGIN = "https://site.test";'),
    '../storage': moduleUrl(
      `export const settingsStorage = {isMergeProviderStreamsEnabled: () => ${enabled}};`,
    ),
    './accountStore': moduleUrl(
      'export const authHeaders = () => ({"x-admin-token": "test-token"});',
    ),
  });

  return {module: await import(url), state};
}

const movieEnrich = {
  matched: true,
  merged: {
    title: 'Some Movie',
    type: 'movie',
    sources: [
      {provider: 'provA', link: 'https://a.test/movie', title: 'Some Movie 2024'},
      {provider: 'provB', link: 'https://b.test/movie?x=1', title: 'Some Movie'},
      {provider: 'provB', link: 'https://b.test/movie?x=1', title: 'Some Movie'},
    ],
  },
};

const siteStreams = [
  {provider: 'provB', providerName: 'Prov B', server: 'Server A', link: 'https://cdn.test/a.m3u8', quality: '1080'},
  {provider: 'provB', providerName: 'Prov B', server: 'Server A', link: 'https://cdn.test/a.m3u8', quality: '1080'},
  {provider: 'provC', providerName: 'Prov C', server: 'Prov C · Direct', link: 'https://cdn.test/b.mp4', quality: '720'},
  {provider: 'provD', server: 'File', link: 'magnet:?xt=urn:btih:abc'},
  {provider: 'provD', server: 'Broken', link: 'not-a-url'},
];

test('movie: expands the opened link and dedupes both sources and files', async () => {
  const {module, state} = await loadModule();
  state.handler = (url, init) => {
    if (url.includes('/api/unified/enrich')) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('provider'), 'provA');
      assert.equal(parsed.searchParams.get('t'), 'Some Movie');
      assert.equal(init.headers['x-admin-token'], 'test-token');
      return response(movieEnrich);
    }
    const body = JSON.parse(init.body);
    assert.equal(body.type, 'movie');
    assert.equal(body.isDownload, false);
    assert.deepEqual(
      body.sources.map(s => s.link),
      ['https://a.test/movie', 'https://b.test/movie?x=1'],
    );
    return response(siteStreams);
  };

  const streams = await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Some Movie',
    type: 'movie',
  });

  assert.deepEqual(
    streams.map(s => s.link),
    ['https://cdn.test/a.m3u8', 'https://cdn.test/b.mp4'],
  );
  assert.equal(streams[0].server, 'Prov B · Server A');
  assert.equal(streams[0].type, 'm3u8');
  assert.equal(streams[0].quality, '1080');
  assert.equal(streams[1].server, 'Prov C · Direct');
  assert.equal(streams[1].type, 'mp4');
});

test('series: picks the episode that actually holds the opened link', async () => {
  const {module, state} = await loadModule();
  state.handler = (url, init) => {
    if (url.includes('/api/unified/enrich')) {
      return response({
        matched: true,
        merged: {
          title: 'Some Show',
          type: 'series',
          sources: [{provider: 'provA', link: 'https://a.test/show'}],
          seasons: [
            {
              number: 2,
              episodes: [
                {number: 1, sources: [{provider: 'provA', link: 'https://a.test/s2e1'}]},
                {
                  number: 5,
                  sources: [
                    {provider: 'provA', link: 'https://a.test/s2e5'},
                    {provider: 'provB', link: 'https://b.test/s2e5'},
                  ],
                },
              ],
            },
          ],
        },
      });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.type, 'series');
    assert.deepEqual(
      body.sources.map(s => s.link),
      ['https://a.test/s2e5', 'https://b.test/s2e5'],
    );
    return response([]);
  };

  await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/s2e5',
    title: 'Some Show',
    type: 'series',
    season: 2,
    episode: 1,
  });

  assert.equal(state.calls.length, 2);
});

test('series: falls back to the season/episode numbers when the link is absent', async () => {
  const {module, state} = await loadModule();
  let requested = null;
  state.handler = (url, init) => {
    if (url.includes('/api/unified/enrich')) {
      return response({
        matched: true,
        merged: {
          type: 'series',
          seasons: [
            {
              number: 1,
              episodes: [
                {number: 1, sources: [{provider: 'provA', link: 'https://a.test/s1e1'}]},
                {number: 2, sources: [{provider: 'provB', link: 'https://b.test/s1e2'}]},
              ],
            },
          ],
        },
      });
    }
    requested = JSON.parse(init.body).sources.map(s => s.link);
    return response([]);
  };

  await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/unknown-episode',
    title: 'Some Show',
    type: 'series',
    season: 1,
    episode: 2,
  });

  assert.deepEqual(requested, ['https://b.test/s1e2']);
});

test('a title the site cannot expand falls back silently', async () => {
  const {module, state} = await loadModule();
  state.handler = () => response({matched: false, sourceCount: 0});

  const streams = await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Unreachable Movie',
    type: 'movie',
  });

  assert.deepEqual(streams, []);
  assert.equal(state.calls.length, 1);
});

test('HTTP failures never throw into playback', async () => {
  const {module, state} = await loadModule();
  state.handler = () => ({ok: false, status: 503, json: async () => ({})});

  const streams = await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Some Movie',
    type: 'movie',
  });

  assert.deepEqual(streams, []);
});

test('the settings toggle disables every request', async () => {
  const {module, state} = await loadModule({enabled: false});

  const streams = await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Some Movie',
    type: 'movie',
  });

  assert.deepEqual(streams, []);
  assert.equal(state.calls.length, 0);
});

test('a resolved title is cached and shares one in-flight request', async () => {
  const {module, state} = await loadModule();
  state.handler = url =>
    url.includes('/api/unified/enrich')
      ? response(movieEnrich)
      : response(siteStreams.slice(0, 1));

  const request = {
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Some Movie',
    type: 'movie',
  };
  const [first, second] = await Promise.all([
    module.fetchAggregatedStreams(request),
    module.fetchAggregatedStreams(request),
  ]);
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assert.equal(state.calls.length, 2);

  const cached = await module.fetchAggregatedStreams(request);
  assert.deepEqual(cached, first);
  assert.equal(state.calls.length, 2);
});

/* The engine answers as soon as 20 files are in hand, so the client asks once
   more and publishes both the fast list and the complete one. */
test('a cut-off engine answer is filled in by a second call', async () => {
  const {module, state} = await loadModule();
  const file = index => ({
    provider: 'provB',
    providerName: 'Prov B',
    server: `Server ${index}`,
    link: `https://cdn.test/file-${index}.mkv`,
    quality: '480p',
  });
  const fast = Array.from({length: 20}, (_, index) => file(index));
  const full = [...fast, ...Array.from({length: 5}, (_, index) => file(20 + index))];
  let streamCalls = 0;
  state.handler = url => {
    if (url.includes('/api/unified/enrich')) return response(movieEnrich);
    streamCalls += 1;
    return response(streamCalls === 1 ? fast : full);
  };

  const updates = [];
  const streams = await module.fetchAggregatedStreams(
    {provider: 'provA', link: 'https://a.test/movie', title: 'Some Movie', type: 'movie'},
    list => updates.push(list.length),
  );

  assert.equal(streamCalls, 2);
  assert.deepEqual(updates, [20, 25]);
  assert.equal(streams.length, 25);
  assert.equal(streams[24].link, 'https://cdn.test/file-24.mkv');
});

test('download requests ask the site for download-optimised files', async () => {
  const {module, state} = await loadModule();
  let body = null;
  state.handler = (url, init) => {
    if (url.includes('/api/unified/enrich')) return response(movieEnrich);
    body = JSON.parse(init.body);
    return response(siteStreams.slice(0, 1));
  };

  await module.fetchAggregatedStreams({
    provider: 'provA',
    link: 'https://a.test/movie',
    title: 'Some Movie',
    type: 'movie',
    isDownload: true,
  });

  assert.equal(body.isDownload, true);
});
