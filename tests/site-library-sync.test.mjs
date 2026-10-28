import test, {before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {sourceModule, moduleUrl} from './helpers/platform-modules.mjs';

/**
 * End-to-end check of the desktop library sync against a running Cinepix
 * server. The storage layer, the sync logic and the HTTP client are the app's
 * own code; only the Tauri host, the zustand mirrors and the origin are
 * replaced, so this proves the merge/diff rules and the bulk sync contract.
 *
 * CINEPIX_SYNC_URL defaults to the dev server on loopback.
 * CINEPIX_SYNC_USER + CINEPIX_SYNC_PASS reuse an account; without them a
 * throwaway one is registered.
 */

const ORIGIN = process.env.CINEPIX_SYNC_URL || 'http://127.0.0.1:3000';

const store = new Map();
globalThis.window = {dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {}};
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
  key: index => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};

const storageUrl = await sourceModule('platform/storage.ts');
const watchListStorageUrl = await sourceModule('lib/storage/WatchListStorage.ts', {'./StorageService': storageUrl});
const watchHistoryStorageUrl = await sourceModule('lib/storage/WatchHistoryStorage.ts', {'./StorageService': storageUrl});
const storageIndexUrl = moduleUrl(
  `export * from ${JSON.stringify(watchListStorageUrl)};
   export * from ${JSON.stringify(watchHistoryStorageUrl)};`,
);
const fakeStoreUrl = moduleUrl('export default {setState(){}, getState(){return {};}, subscribe(){return () => {};}};');

const accountStoreUrl = await sourceModule('lib/site/accountStore.ts', {
  '../storage/StorageService': storageUrl,
  '../sync/syncService': moduleUrl('export const getDeviceId = () => "test-device";'),
});
const siteApiUrl = await sourceModule('lib/site/siteApi.ts', {
  '../../platform/network': moduleUrl('export const platformFetch = (url, init) => fetch(url, init);'),
  '../siteConfig': moduleUrl(`export const SITE_ORIGIN = ${JSON.stringify(ORIGIN)};`),
  './accountStore': accountStoreUrl,
});
const librarySyncUrl = await sourceModule('lib/site/librarySync.ts', {
  '../../platform/host': moduleUrl('export const isTauriRuntime = () => true;'),
  '../storage/StorageService': storageUrl,
  '../storage': storageIndexUrl,
  '../storage/WatchListStorage': watchListStorageUrl,
  '../zustand/watchListStore': fakeStoreUrl,
  '../zustand/watchHistrory': fakeStoreUrl,
  './accountStore': accountStoreUrl,
  './siteApi': siteApiUrl,
});

const {mainStorage, cacheStorage} = await import(storageUrl);
const {watchListStorage, watchHistoryStorage} = await import(storageIndexUrl);
const account = await import(accountStoreUrl);
const siteApi = await import(siteApiUrl);
const {syncLibrary, resetLibrarySync} = await import(librarySyncUrl);

/** Independent copy of the seed the site, the app and the server share. */
const expectedKey = (title, type) => {
  const seed = `t:${String(title).toLowerCase().trim()}|${type}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

let session;
const headers = () => ({
  'Content-Type': 'application/json',
  'x-admin-token': account.getSession().token,
  'x-device-id': 'probe-device',
});
const serverGet = async path => (await fetch(`${ORIGIN}${path}`, {headers: headers()})).json();
const serverPost = async (path, body) =>
  (await fetch(`${ORIGIN}${path}`, {method: 'POST', headers: headers(), body: JSON.stringify(body)})).json();

/** A delete the account performs somewhere else, i.e. on the website. */
const siteRemoveWatchlist = key => serverPost('/api/watchlist', {action: 'remove', item: {mediaKey: key}});
const siteRemoveProgress = async key =>
  (await fetch(`${ORIGIN}/api/progress/${key}`, {method: 'DELETE', headers: headers()})).json();

const seedWatchlist = (title, link) =>
  watchListStorage.addToWatchList({
    title,
    poster: `https://img/${title}.jpg`,
    link,
    provider: 'cinebd',
    updatedAt: Date.now(),
  });

before(async () => {
  let identity = process.env.CINEPIX_SYNC_USER;
  let password = process.env.CINEPIX_SYNC_PASS;
  if (!identity) {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    identity = `synctest${suffix}`;
    password = `Sync-test-${suffix}!`;
    const created = await (
      await fetch(`${ORIGIN}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-device-id': 'probe-device'},
        body: JSON.stringify({username: identity, email: `${identity}@example.test`, password}),
      })
    ).json();
    assert.ok(created.token, `account setup failed: ${JSON.stringify(created)}`);
  }
  // The app's own sign-in path, so every case runs on a real session.
  session = await siteApi.login(identity, password);
});

beforeEach(async () => {
  store.clear();
  account.saveSession(session);
  resetLibrarySync();

  for (const item of (await serverGet('/api/watchlist')).items) await siteRemoveWatchlist(item.mediaKey);
  for (const item of (await serverGet('/api/progress')).items) await siteRemoveProgress(item.mediaKey);
});

test('pushes the local library and pulls rows created elsewhere', async () => {
  seedWatchlist('Test Show', 'https://site/movie/test-show');
  seedWatchlist('Second Film', 'https://site/movie/second-film');
  watchHistoryStorage.addToWatchHistory({
    id: 'https://site/series/ep-1',
    title: 'Third Series',
    link: 'https://site/series/ep-1',
    provider: 'cinebd',
    poster: 'https://img/third.jpg',
    type: 'series',
    isSeries: true,
    episodeTitle: 'S01E01',
    progress: 320,
    duration: 1400,
    timestamp: Date.now(),
  });

  await syncLibrary();

  const remote = await serverGet('/api/watchlist');
  assert.deepEqual(remote.items.map(item => item.title).sort(), ['Second Film', 'Test Show']);
  assert.equal(
    remote.items.find(item => item.title === 'Test Show').mediaKey,
    expectedKey('Test Show', 'movie'),
    'the server key must match the seed the app derives',
  );
  assert.equal(remote.items.find(item => item.title === 'Test Show').link, 'https://site/movie/test-show');

  const progress = await serverGet('/api/progress');
  assert.equal(progress.items.length, 1);
  assert.equal(progress.items[0].mediaKey, expectedKey('Third Series', 'series'));
  assert.equal(progress.items[0].position, 320);

  // A title saved from another device has to arrive on the next sync.
  await serverPost('/api/watchlist/sync', {
    items: [
      {
        mediaKey: expectedKey('Remote Save', 'movie'),
        title: 'Remote Save',
        image: 'https://img/remote.jpg',
        type: 'movie',
        provider: 'cinebd',
        link: 'https://site/movie/remote-save',
      },
    ],
    removed: [],
  });
  await syncLibrary();
  assert.ok(
    watchListStorage.getWatchList().some(item => item.title === 'Remote Save'),
    'remote title was not merged into the local watchlist',
  );

  // Re-syncing must neither duplicate nor drop anything.
  await syncLibrary();
  assert.equal((await serverGet('/api/watchlist')).items.length, 3);
  assert.equal(watchListStorage.getWatchList().length, 3);
});

test('resume position from another device is cached for the player', async () => {
  await serverPost('/api/progress/sync', {
    items: [
      {
        mediaKey: expectedKey('Pulled Episode', 'series'),
        title: 'Pulled Episode',
        image: 'https://img/pulled.jpg',
        type: 'series',
        provider: 'cinebd',
        link: 'https://site/series/pulled-ep',
        epTitle: 'S02E04',
        position: 900,
        duration: 1800,
      },
    ],
    removed: [],
  });

  await syncLibrary();

  const history = watchHistoryStorage.getWatchHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].episodeTitle, 'S02E04');
  assert.equal(history[0].progress, 900);
  assert.deepEqual(
    JSON.parse(cacheStorage.getString('https://site/series/pulled-ep')),
    {position: 900, duration: 1800},
    'the player reads the resume point out of the cache',
  );
});

test('a position watched further here updates the account row', async () => {
  const watch = progress =>
    watchHistoryStorage.addToWatchHistory({
      id: 'https://site/movie/positioned',
      title: 'Positioned Film',
      link: 'https://site/movie/positioned',
      provider: 'cinebd',
      type: 'movie',
      progress,
      duration: 1000,
      timestamp: Date.now(),
    });

  watch(200);
  await syncLibrary();
  assert.equal((await serverGet('/api/progress')).items[0].position, 200);

  watch(640);
  await syncLibrary();
  const afterLocalEdit = await serverGet('/api/progress');
  assert.equal(afterLocalEdit.items.length, 1, 'the row was duplicated instead of updated');
  assert.equal(afterLocalEdit.items[0].position, 640);

  // Watching on another device has to win over the older local position.
  await serverPost('/api/progress/sync', {
    items: [
      {
        mediaKey: expectedKey('Positioned Film', 'movie'),
        title: 'Positioned Film',
        image: '',
        type: 'movie',
        provider: 'cinebd',
        link: 'https://site/movie/positioned',
        position: 900,
        duration: 1000,
        updatedAt: Date.now() + 60000,
      },
    ],
    removed: [],
  });
  await syncLibrary();
  assert.equal(watchHistoryStorage.getWatchHistory()[0].progress, 900);
});

test('deletes travel both ways, but only for rows this device synced', async () => {
  seedWatchlist('Local Keep', 'https://site/movie/local-keep');
  seedWatchlist('Local Drop', 'https://site/movie/local-drop');
  await syncLibrary();
  assert.equal((await serverGet('/api/watchlist')).items.length, 2);

  watchListStorage.removeFromWatchList('https://site/movie/local-drop');
  await syncLibrary();
  assert.deepEqual((await serverGet('/api/watchlist')).items.map(item => item.title), ['Local Keep']);

  await siteRemoveWatchlist(expectedKey('Local Keep', 'movie'));
  await syncLibrary();
  assert.deepEqual(watchListStorage.getWatchList().map(item => item.title), []);
});

test('a title never pushed stays local when signed out', async () => {
  seedWatchlist('Offline Title', 'https://site/movie/offline-title');
  account.clearSession();
  await syncLibrary();
  assert.equal(watchListStorage.getWatchList().length, 1);
  assert.equal(mainStorage.getObject('cinepix-sync-journal')?.watchlist?.[expectedKey('Offline Title', 'movie')], undefined);
});
