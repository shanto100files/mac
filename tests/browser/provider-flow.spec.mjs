import {test, expect} from '@playwright/test';
import {connectTestBrowserExtension} from '../helpers/browser-extension.mjs';
test.beforeEach(async ({page}) => connectTestBrowserExtension(page));
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// This provider exists only inside the test server's intercepted responses.
// Nothing is seeded into app storage: installation uses the normal user flow.
const base = 'https://fixture.vega.example';
const modules = {
  catalog: 'exports.catalog=[{title:"Test series",filter:"series"}];exports.genres=[];',
  posts: `exports.getPosts=async({providerContext})=>(await providerContext.axios.get('${base}/api/posts')).data;exports.getSearchPosts=exports.getPosts;`,
  meta: `exports.getMeta=async({providerContext})=>(await providerContext.axios.get('${base}/api/meta')).data;`,
  episodes: `exports.getEpisodes=async({providerContext})=>(await providerContext.axios.get('${base}/api/episodes')).data;`,
  stream: `exports.getStream=async({providerContext})=>(await providerContext.axios.get('${base}/api/stream')).data;`,
  settings: 'exports.getSettingsSchema=async()=>[];',
};

for (const downloadOnly of [false,true]) {
test(downloadOnly ? 'browser downloads open the selected source in a new tab without queuing native downloads' : 'explicit provider installation reaches posts, metadata, episodes and actual shared-player playback', async ({page}, testInfo) => {
  test.setTimeout(60_000);
  const ffmpeg = fileURLToPath(new URL('../../src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe', import.meta.url));
  test.skip(!existsSync(ffmpeg), 'Existing desktop fixture tool is required to generate a synthetic test video.');
  const videoPath = testInfo.outputPath('synthetic.mp4');
  mkdirSync(path.dirname(videoPath), {recursive: true});
  const fixture = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath], {encoding: 'utf8'});
  expect(fixture.status, fixture.stderr).toBe(0);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const reached = new Set();
  await page.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let value;
    if (path === '/manifest.json') value = [{value: 'fixture', display_name: 'Browser Test Provider', version: '1.0.0', type: 'global'}];
    else if (path.startsWith('/dist/fixture/')) {
      const name = path.split('/').pop().replace('.js', '');
      await route.fulfill({contentType: 'application/javascript', headers: {'Access-Control-Allow-Origin': '*'}, body: modules[name]}); return;
    } else if (path === '/api/posts') value = [{title: 'Browser Test Series', link: `${base}/series`, image: `${base}/poster.svg`}];
    else if (path === '/api/meta') value = {title: 'Browser Test Series', image: '', synopsis: 'Shared browser provider test.', type: 'series', imdbId: '', linkList: [{title: 'Season 1', episodesLink: `${base}/season/1`}]};
    else if (path === '/api/episodes') value = [{title: 'Episode 1: Browser Playback', link: `${base}/episode/1`, type: 'series'}];
    else if (path === '/api/stream') value = [{server: 'Browser fixture', type: 'mp4', link: `${base}/video.mp4`}];
    else if (path === '/video.mp4') {
      await route.fulfill({contentType: 'video/mp4', headers: {'Access-Control-Allow-Origin': '*'}, body: readFileSync(videoPath)}); return;
    } else if (path === '/poster.svg') {
      await route.fulfill({contentType: 'image/svg+xml', headers: {'Access-Control-Allow-Origin': '*'}, body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#456"/></svg>'}); return;
    } else {await route.fulfill({status: 404, headers: {'Access-Control-Allow-Origin': '*'}, body: 'No fixture video'}); return;}
    reached.add(path);
    await route.fulfill({contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(value)});
  });
  await page.goto('/extensions');
  const sourceDialog = page.getByRole('dialog');
  await expect(sourceDialog).toBeVisible();
  await sourceDialog.getByRole('textbox').first().click();
  await sourceDialog.getByRole('textbox').first().fill(`${base}/manifest.json`);
  await sourceDialog.getByRole('button', {name: 'Add source', exact: true}).click();
  await expect(page.getByText('Browser Test Provider', {exact: true})).toBeVisible();
  // Adding a source lists providers but must not install them.
  await expect(page.getByRole('button', {name:'Install', exact:true})).toHaveCount(1);
  await expect(page.getByText('In use', {exact:true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Install', exact: true}).click();
  await expect(page.getByText('In use', {exact: true})).toBeVisible();
  await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name: 'Home', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Open Browser Test Series', exact: true}).first()).toBeVisible({timeout: 15_000});
  await page.getByRole('button', {name: 'Open Browser Test Series', exact: true}).first().click();
  await expect(page).toHaveURL(/\/content\//);
  await expect(page.getByRole('heading', {name: 'Browser Test Series', exact: true, level: 1})).toBeVisible();
  const episode = page.locator('.content-episode-row').filter({hasText: 'Episode 1: Browser Playback'});
  await expect(episode).toBeVisible();
  await expect(episode.locator('.content-episode-download')).toHaveCount(1);
  await page.evaluate(()=>{
    window.originalOpen=window.open;window.openedDownloads=[];
    window.open=(...args)=>{window.openedDownloads.push(args);return null;};
  });
  await episode.getByTitle('Download (Ctrl+Click to choose server)',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'Choose a download source',exact:true})).toBeVisible();
  await page.locator('.download-dialog-content .stream-item').filter({hasText:'Browser fixture'}).click();
  await expect.poll(()=>page.evaluate(()=>window.openedDownloads)).toEqual([[`${base}/video.mp4`,'_blank','noopener,noreferrer']]);
  expect(await page.evaluate(()=>{
    window.open=window.originalOpen;
    const persisted=JSON.parse(localStorage.getItem('vega-downloads-storage')||'null');
    return Object.keys(persisted?.state?.downloads||{});
  })).toEqual([]);
  if(downloadOnly){expect(errors).toEqual([]);return;}
  await episode.locator('.episode-play-area').click();
  await expect(page).toHaveURL(/\/player$/);
  await expect.poll(() => reached.has('/api/stream')).toBe(true);
  await expect(page.locator('.libmedia-surface')).toHaveCount(1);
  await expect(page.locator('.libmedia-surface canvas').first()).toBeVisible();
  await expect.poll(async () => Number((await page.locator('.timeline-time').first().textContent()).split(':').at(-1))).toBeGreaterThan(1);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(page.getByRole('button', {name: 'PIP', exact: true})).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible();
  for (const path of ['/manifest.json', '/api/posts', '/api/meta', '/api/episodes', '/api/stream']) expect(reached.has(path), path).toBe(true);
  expect(errors).toEqual([]);
});

}
