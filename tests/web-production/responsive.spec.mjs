import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';

async function fitsViewport(locator, page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const {width, height} = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

for (const width of [320, 390, 768, 1280]) {
  test(`web navigation and settings fit a ${width}px viewport`, async ({browser, baseURL}, testInfo) => {
    const context = await browser.newContext({viewport:{width,height:844}, userAgent:androidUA, hasTouch:true});
    const page = await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
      await page.goto(baseURL);
      await expect(page.getByRole('heading',{name:'Welcome to Vega'})).toBeVisible();
      const navigation=page.getByRole('navigation',{name:'Main navigation'});
      for (const name of ['Home','Search','Library','Extensions','Settings']) {
        await fitsViewport(navigation.getByRole('button',{name,exact:true}),page);
      }
      if(width<=640)expect((await page.locator('.layout-main').boundingBox()).x).toBe(0);
      // Stored sidebar expansion must not take the content width away on phones/tablets.
      await page.evaluate(()=>localStorage.setItem('vegaSidebarCollapsed','false'));
      await page.reload();
      if(width<=640)expect((await page.locator('.layout-main').boundingBox()).x).toBe(0);
      if(width<=640)expect((await page.locator('.sidebar').boundingBox()).width).toBe(width);
      if(width>640&&width<=1024)expect((await page.locator('.sidebar').boundingBox()).width).toBe(76);
      await navigation.getByRole('button',{name:'Search',exact:true}).tap();
      const search=page.locator('.search-page-input');
      await expect(search).toBeEditable();
      await search.fill('Example');
      await expect(search).toHaveValue('Example');
      await navigation.getByRole('button',{name:'Settings',exact:true}).tap();
      await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
      expect(await page.locator('.settings-row').evaluateAll(rows=>rows.filter(row=>row.scrollWidth>row.clientWidth+1).length)).toBe(0);
      const scale=page.getByRole('button',{name:'100% (Default)',exact:true});
      await scale.tap();
      await fitsViewport(page.getByRole('listbox'),page);
      await page.getByRole('option',{name:'125%',exact:true}).tap();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.style.zoom)).toBe('1.25');
      await fitsViewport(navigation,page);
      await page.getByRole('button',{name:'125%',exact:true}).tap();
      await page.getByRole('option',{name:'100% (Default)',exact:true}).tap();
      await page.screenshot({path:testInfo.outputPath('settings.png')});
      await navigation.getByRole('button',{name:'Extensions',exact:true}).tap();
      await page.getByTitle('Add provider source',{exact:true}).tap();
      const dialog=page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await fitsViewport(dialog,page);
      await page.screenshot({path:testInfo.outputPath('source-dialog.png')});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}

test('Android web playback keeps touch controls and menus reachable in portrait and landscape',async({browser,baseURL},testInfo)=>{
  test.setTimeout(90000);
  const video=testInfo.outputPath('touch-seek.mp4');mkdirSync(path.dirname(video),{recursive:true});
  const ffmpeg=process.platform==='win32'?path.resolve('src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe'):'ffmpeg';
  const generated=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=12','-t','60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','12','-movflags','+faststart',video],{encoding:'utf8'});
  expect(generated.status,generated.stderr).toBe(0);
  const context=await browser.newContext({viewport:{width:390,height:844},userAgent:androidUA,hasTouch:true,isMobile:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    // Explicit playback descriptor only; no provider/source is installed or seeded.
    await page.addInitScript(()=>{
      if(location.pathname==='/player')history.replaceState({usr:{episodeList:[{title:'Touch playback',link:'https://responsive.vega.example/video.mp4',localFile:true}],linkIndex:0,primaryTitle:'Responsive player test with a long title',type:'movie',providerValue:'',infoUrl:'touch-fixture',localContent:true,doNotTrack:true},key:'touch-test',idx:0},'');
    });
    await page.route('https://responsive.vega.example/video.mp4',route=>route.fulfill({contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:readFileSync(video)}));
    await page.goto(`${baseURL}/player`);
    await expect(page.locator('.libmedia-surface canvas').first()).toBeVisible();
    await expect.poll(async()=>Number((await page.locator('.timeline-time').first().textContent()).split(':').at(-1))).toBeGreaterThan(1);
    for(const viewport of [{width:320,height:760},{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(viewport);
      if(!await page.locator('.player-controls-wrapper.visible').count())await page.locator('.player-video-wrapper').tap();
      await expect(page.locator('.player-controls-wrapper.visible')).toBeVisible();
      for(const button of await page.locator('.player-actions-row [role="button"]').all())await fitsViewport(button,page);
      const speed=page.getByRole('button',{name:'1.0x',exact:true});
      await speed.tap();
      await fitsViewport(page.locator('.inline-menu'),page);
      await page.screenshot({path:testInfo.outputPath(`player-${viewport.width}.png`)});
      await page.locator('.inline-menu').getByRole('button',{name:'1x',exact:true}).tap();
    }
    await page.setViewportSize({width:390,height:844});
    if(!await page.locator('.player-controls-wrapper.visible').count())await page.locator('.player-video-wrapper').tap();
    const track=await page.locator('.timeline-track').boundingBox();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:track.x+track.width*.25,y:track.y+track.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:track.x+track.width*.75,y:track.y+track.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(async()=>Number((await page.locator('.timeline-time').first().textContent()).split(':').at(-1))).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

