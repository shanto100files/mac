import {test,expect} from '@playwright/test';
import {existsSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ffmpeg=fileURLToPath(new URL('../../src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe',import.meta.url));
test('shared libmedia renders MKV with embedded language metadata, seeks and cleans up in desktop adapter',async({page})=>{
 test.skip(!existsSync(ffmpeg),'Run the desktop FFmpeg setup to generate the local test fixture.');
 test.setTimeout(60000);
 const temp=mkdtempSync(path.join(tmpdir(),'vega-libmedia-test-'));
 try{
  const sub=path.join(temp,'test.srt'),movie=path.join(temp,'test.mkv');
  writeFileSync(sub,'1\n00:00:01,000 --> 00:00:11,000\n{\\an8}Shared libmedia subtitle check\n');
  const generated=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-i',sub,'-map','0:v','-map','1:a','-map','2:s','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-c:s','srt','-metadata:s:a:0','language=eng','-metadata:s:s:0','language=eng',movie],{encoding:'utf8'});
  expect(generated.status,generated.stderr).toBe(0);
  await page.route('**/libmedia-test.mkv',route=>route.fulfill({contentType:'video/x-matroska',body:readFileSync(movie)}));
  // Isolate playback from native Tauri APIs used by the desktop app shell.
  await page.route('http://127.0.0.1:1427/',route=>route.fulfill({contentType:'text/html',body:'<div style="position:fixed;inset:0"><video id="anchor"></video></div>'}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const tracks=await page.evaluate(async()=>{
   const {LibmediaPlayerAdapter}=await import('/src/lib/player/LibmediaPlayerAdapter.ts');
   const adapter=window.adapter=new LibmediaPlayerAdapter(document.querySelector('#anchor'));
   await adapter.load(location.origin+'/libmedia-test.mkv',{streamType:'mkv'});
   return {audio:adapter.state.audioTracks,subtitles:adapter.state.subtitleTracks};
  });
  expect(tracks.audio[0].lang).toBe('eng');expect(tracks.subtitles[0].lang).toBe('eng');
  await expect.poll(()=>page.evaluate(()=>window.adapter.state.currentTime)).toBeGreaterThan(1);
  expect(await page.locator('canvas').count()).toBeGreaterThan(0);
  const glyph=page.locator('.libmedia-surface .ASS-dialogue [data-text]').first();
  await expect(glyph).toBeVisible();
  await expect(glyph).toHaveText("Shared libmedia subtitle check");
  await expect(page.locator(".libmedia-surface .ASS-dialogue").first()).toHaveCSS("--ass-align-v","0%");
  await page.evaluate(()=>window.adapter.pause());
  await page.evaluate(async()=>{
   const {settingsStorage}=await import('/src/lib/storage/SettingsStorage.ts');
   settingsStorage.setSubtitleFontFamily('monospace');settingsStorage.setSubtitleFontSize(24);
   settingsStorage.setSubtitleFontWeight(700);settingsStorage.setSubtitleTextColor('#00FFFF');
   settingsStorage.setSubtitleOutlineSize(3);settingsStorage.setSubtitleOutlineColor('#FF0000');
   settingsStorage.setSubtitleShadowStyle('glow');settingsStorage.setSubtitleShadowSize(4);
   settingsStorage.setSubtitleShadowColor('#0000FF');settingsStorage.setSubtitleBottomPadding(20);
   window.adapter.updateSubtitleSettings();
  });
  await expect(glyph).toHaveCSS('color','rgb(0, 255, 255)');
  await expect(glyph).toHaveCSS('font-weight','700');
  await expect(glyph).toHaveCSS('font-family',/monospace/);
  await expect(glyph).toHaveCSS('text-shadow',/rgb\(0, 0, 255\)/);
  await expect.poll(()=>page.evaluate(()=>{
   const surface=document.querySelector('.libmedia-surface'),glyph=surface.querySelector('[data-text]');
   return Math.abs(parseFloat(getComputedStyle(glyph).fontSize)-60*surface.clientHeight/1080);
  })).toBeLessThan(.1);
  await page.screenshot({path:'test-results/libmedia-subtitle-style.png'});
  await page.evaluate(async()=>{
   const {settingsStorage}=await import('/src/lib/storage/SettingsStorage.ts');
   settingsStorage.setSubtitleShadowStyle('none');window.adapter.updateSubtitleSettings();
  });
  await expect(glyph).toHaveCSS('text-shadow','none');
  await page.evaluate(async()=>{const adapter=window.adapter;await adapter.selectTrack('sid',adapter.state.subtitleTracks[0].id);await adapter.seek(3);});
  await expect.poll(()=>page.evaluate(()=>Math.abs(window.adapter.state.currentTime-3))).toBeLessThan(1);
  await page.evaluate(async()=>{await window.adapter.load(location.origin+'/libmedia-test.mkv',{streamType:'mkv'});});
  await expect.poll(()=>page.evaluate(()=>window.adapter.state.currentTime)).toBeGreaterThan(.1);
  expect(await page.evaluate(()=>window.adapter.state.error)).toBeNull();
  await page.evaluate(()=>window.adapter.destroy());
  await expect(page.locator('.libmedia-surface')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
