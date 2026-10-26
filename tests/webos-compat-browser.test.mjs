import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {existsSync,statSync,createReadStream} from 'node:fs';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {build} from 'vite';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);
const app=path.resolve('dist-tv/webos/service');
const {startHost}=require('../tv/webos/service/host.cjs');

test('webOS production policy, polyfills, isolated providers and libmedia MKV playback', {timeout:120000},async()=>{
  const parent=path.resolve(process.env.VEGA_TEST_ROOT||os.tmpdir());
  await mkdir(parent,{recursive:true});
  const root=await mkdtemp(path.join(parent,'vega-webos23-'));
  let browser,host,fixture;
  try{
    assert.ok(existsSync(path.join(app,'ui/index.html')),'Run npm run build:webos first');
    const ui=path.join(root,'ui');await cp(path.join(app,'ui'),ui,{recursive:true});
    const probe=path.join(root,'probe');
    await build({mode:'webos',logLevel:'silent',publicDir:false,build:{outDir:probe,emptyOutDir:true,
      rolldownOptions:{input:'tests/browser/webos-legacy-probe.ts',output:{entryFileNames:'webos-probe.js'}}}});
    await cp(probe,ui,{recursive:true});
    const index=await readFile(path.join(ui,'index.html'),'utf8');
    const csp=index.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
    assert.ok(csp,'Production CSP must remain in the playback fixture');
    await writeFile(path.join(ui,'compat-fixture.html'),`<!doctype html><html><head>${csp}<script src="legacy-polyfills.js"></script><title>Vega compatibility fixture</title></head><body><script type="module" src="webos-probe.js"></script></body></html>`);
    const subtitle=path.join(root,'fixture.srt'),movie=path.join(ui,'fixture.mkv');
    await writeFile(subtitle,'1\n00:00:01,000 --> 00:00:11,000\nWebOS compatibility subtitle\n');
    const ffmpeg=process.env.VEGA_TEST_FFMPEG||(process.platform==='win32'?path.resolve('src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe'):'ffmpeg');
    const generated=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-i',subtitle,
      // One-second keyframes make libmedia's default fast-seek deterministic.
      '-map','0:v','-map','1:a','-map','2:a','-map','3:s','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','24','-keyint_min','24','-sc_threshold','0',
      '-c:a','aac','-c:s','srt','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin','-metadata:s:s:0','language=eng',movie],{encoding:'utf8'});
    assert.equal(generated.status,0,generated.error?.message||generated.stderr);
    host=await startHost({root:ui,port:0,policy:require(path.join(app,'networkPolicy.cjs'))});
    const total=statSync(movie).size;
    fixture=http.createServer((request,response)=>{
      // Owned synthetic fixture only; preserve genuine Range/206 semantics.
      if(request.method==='OPTIONS'){
        response.writeHead(204,{'Access-Control-Allow-Origin':new URL(host.url).origin,
          'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'});
        response.end();return;
      }
      const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'');
      const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),total-1):total-1;
      const headers={'Access-Control-Allow-Origin':new URL(host.url).origin,'Access-Control-Expose-Headers':'Content-Range, Accept-Ranges, Content-Length',
        'Content-Type':'video/x-matroska','Accept-Ranges':'bytes','Content-Length':end-start+1};
      if(range)headers['Content-Range']=`bytes ${start}-${end}/${total}`;
      response.writeHead(range?206:200,headers);
      if(request.method==='HEAD')response.end();else createReadStream(movie,{start,end}).pipe(response);
    });
    await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,...(process.env.VEGA_WEBOS_BROWSER?{executablePath:process.env.VEGA_WEBOS_BROWSER}:{})});
    if(process.env.VEGA_WEBOS_CHROME_MAJOR)assert.equal(browser.version().split('.')[0],process.env.VEGA_WEBOS_CHROME_MAJOR);
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(host.url);
    await page.waitForFunction(()=>document.body.innerText.includes('Add a provider source'));
    const api=await page.evaluate(async()=>{
      await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
      const controller=new AbortController();controller.abort('fixture');
      let aborted=false;try{controller.signal.throwIfAborted()}catch(error){aborted=error==='fixture'}
      return {clone:structuredClone({answer:42}).answer,aborted,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.deepEqual(api,{clone:42,aborted:true,overflow:false});
    await page.goto(new URL('compat-fixture.html',host.url).href);
    await page.waitForFunction(()=>!!window.webosLegacyProbe);
    assert.deepEqual(await page.evaluate(()=>window.webosLegacyProbe.provider()),{answer:42,windowType:'undefined'});
    const tracks=await page.evaluate(url=>window.webosLegacyProbe.load(url,'mkv'),`http://127.0.0.1:${fixture.address().port}/fixture.mkv`);
    assert.deepEqual(tracks.audioTracks.map(track=>track.lang),['eng','hin']);
    assert.equal(tracks.subtitleTracks[0].lang,'eng');
    await page.waitForFunction(()=>window.webosLegacyProbe.state().currentTime>1,null,{timeout:20000});
    try{
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ASS-dialogue [data-text]')).some(node=>node.textContent==='WebOS compatibility subtitle'),null,{timeout:10000});
    }catch(error){
      console.log(await page.evaluate(()=>({state:window.webosLegacyProbe.state(),subtitles:Array.from(document.querySelectorAll('.ASS-dialogue')).map(node=>node.textContent)})));
      throw error;
    }
    await page.evaluate(()=>window.webosLegacyProbe.pause());
    for(const position of [6,3,8]){
      await page.evaluate(time=>window.webosLegacyProbe.seek(time),position);
      await page.evaluate(()=>window.webosLegacyProbe.play());
      try{await page.waitForFunction(time=>Math.abs(window.webosLegacyProbe.state().currentTime-time)<1,position,{timeout:5000});}
      catch(error){console.log(await page.evaluate(()=>window.webosLegacyProbe.state()));throw error;}
      await page.evaluate(()=>window.webosLegacyProbe.pause());
    }
    const selected=await page.evaluate(()=>window.webosLegacyProbe.audio(window.webosLegacyProbe.state().audioTracks[1].id));
    assert.equal(selected.audioTracks.find(track=>track.lang==='hin').selected,true);
    assert.equal(await page.evaluate(()=>window.webosLegacyProbe.state().error),null);
    await page.evaluate(()=>window.webosLegacyProbe.dispose());
    assert.equal(await page.locator('canvas,video').count(),0);
    assert.deepEqual(errors,[]);
    console.log(`Validated production libmedia MKV playback in Chromium ${browser.version()}`);
  }finally{
    await browser?.close();host?.close();
    if(fixture)await new Promise(resolve=>fixture.close(resolve));
    if(!root.startsWith(parent+path.sep))throw new Error('Refusing to clean outside the test directory');
    await rm(root,{recursive:true,force:true});
  }
});
