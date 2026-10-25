import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {mediaUrl, networkUrl, hostUrl} from './helpers/platform-modules.mjs';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const shared=moduleUrl(`export class LibmediaEngine {
 static latest;
 constructor(){LibmediaEngine.latest=this;this.calls=[];this.subtitleTracks=[];}
 attach(container){this.container=container;}setEventListeners(events){this.events=events;}
 async load(source){this.source=source;this.events.onStateChange({status:'playing',currentTime:12,duration:90,audioTracks:[{id:9,type:'audio',label:'English',language:'eng',selected:true}],subtitleTracks:[],videoTracks:[{id:2,type:'video',width:1920,height:1080,selected:true}]});}
 async resumeAudio(){this.calls.push('resume');}async play(){this.calls.push('play');}async pause(){this.calls.push('pause');}
 async seek(time){this.calls.push(['seek',time]);}setVolume(value){this.calls.push(['volume',value]);}
 setAspectFit(cover){this.calls.push(['cover',cover]);}async selectQuality(id){this.calls.push(['quality',id]);}
 setPlaybackRate(value){this.calls.push(['speed',value]);}setSubtitleDelay(value){this.calls.push(['subtitleDelay',value]);}
 async selectAudioTrack(id){this.calls.push(['audio',id]);}async selectSubtitleTrack(id){this.calls.push(['subtitle',id]);}
 async setSubtitleEnabled(value){this.calls.push(['subtitles',value]);}
 getSubtitleTracks(){return this.subtitleTracks;}
 async loadExternalSubtitle(sub){this.calls.push(['external',sub.source.name,sub.lang]);this.subtitleTracks=[{id:70,type:'subtitle',label:'English',language:sub.lang,selected:true}];return 70;}
 async destroy(){this.destroyed=true;}
}`);
const styles=moduleUrl(`export const config={fontFamily:'Arial',fontSize:40,fontWeight:400,outlineSize:2,bottomPadding:35,textColor:'#FFFFFF',outlineColor:'#000000',shadowColor:'#000000',shadowSize:2,shadowStyle:'drop'};export function getSubtitleStyleConfig(){return config;}`);
const input=await readFile(new URL('../src/lib/player/LibmediaPlayerAdapter.ts',import.meta.url),'utf8');
const js=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
 .replaceAll("'../../platform/mediaDelivery'",JSON.stringify(mediaUrl)).replaceAll("'../../platform/network'",JSON.stringify(networkUrl)).replaceAll("'../../platform/host'",JSON.stringify(hostUrl)).replaceAll("'@vega/libmedia-engine'",JSON.stringify(shared)).replaceAll("'./subUtils'",JSON.stringify(styles)).replace("import './libmedia-subtitles.css';",'');
const {LibmediaPlayerAdapter}=await import(moduleUrl(js));
const {LibmediaEngine}=await import(shared);
globalThis.document={createElement:()=>({style:{setProperty(key,value){this[key]=value;}},remove(){this.removed=true;}})};
globalThis.window={};
const anchor=()=>({hidden:false,before(node){this.surface=node;}});
test('subtitle customization updates existing surface properties without reloading playback',async()=>{
 const {config}=await import(styles);
 const adapter=new LibmediaPlayerAdapter(anchor()),engine=LibmediaEngine.latest;
 try{
  await adapter.load('https://example.invalid/movie.mkv');
  engine.container.clientHeight=540;
  config.fontSize=60;config.fontWeight=700;config.textColor='#00FFFF';config.shadowStyle='none';config.bottomPadding=70;
  adapter.updateSubtitleSettings();
  assert.equal(engine.container.style['--vega-sub-font-size'],'30px');
  assert.equal(engine.container.style['--vega-sub-font-weight'],'700');
  assert.equal(engine.container.style['--vega-sub-color'],'#00FFFF');
  assert.equal(engine.container.style['--vega-sub-shadow'],'none');
  assert.equal(engine.container.style['--vega-sub-padding'],'35px');
  assert.equal(adapter.state.currentTime,12);assert.deepEqual(engine.calls,[]);
 }finally{adapter.destroy();}
});

test('adapter preserves desktop units, track IDs, embedded languages and existing control contract',async()=>{
 const video=anchor(),adapter=new LibmediaPlayerAdapter(video);let last;
 const unsubscribe=adapter.subscribe(state=>last=state);
 await adapter.load('https://example.invalid/movie.mkv',{autoPlay:false});
 const engine=LibmediaEngine.latest;
 assert.equal(last.audioTracks[0].id,9);assert.equal(last.audioTracks[0].lang,'eng');
 assert.equal(last.videoHeight,1080);assert.equal(last.currentTime,12);assert.equal(last.duration,90);
 adapter.setVolume(35);adapter.setSubtitleDelay(1500);adapter.setSpeed(1.5);await adapter.seek(45);await adapter.selectTrack('aid',9);await adapter.selectTrack('sid','no');await adapter.play();
 assert.deepEqual(engine.calls,[ 'pause',['volume',.35],['subtitleDelay',1.5],['speed',1.5],['seek',45],['audio',9],['subtitles',false],'resume','play']);
 assert.equal(video.hidden,true);unsubscribe();adapter.destroy();await Promise.resolve();
 assert.equal(engine.destroyed,true);assert.equal(engine.container.removed,true);assert.equal(video.hidden,false);
});
test('native networking feeds original MKV bytes, rewritten HLS playlists and local files without remux',async()=>{
 window.__TAURI_INTERNALS__={};
 const adapter=new LibmediaPlayerAdapter(anchor());
 try{
  await adapter.load('https://example.invalid/movie.mkv',{headers:{Referer:'https://example.invalid/'}});
  let source=LibmediaEngine.latest.source;let url=new URL(source.source);
  assert.equal(url.pathname,'/source');assert.equal(url.searchParams.get('url'),'https://example.invalid/movie.mkv');assert.equal(JSON.parse(url.searchParams.get('headers')).Referer,'https://example.invalid/');assert.equal(source.headers,undefined);
  await adapter.load('https://example.invalid/master.m3u8',{streamType:'hls'});
  assert.equal(new URL(LibmediaEngine.latest.source.source).pathname,'/playlist.m3u8');
  await adapter.load('C:\\Videos\\movie.mkv');
  url=new URL(LibmediaEngine.latest.source.source);assert.equal(url.pathname,'/file');assert.equal(url.searchParams.get('path'),'C:\\Videos\\movie.mkv');
  await adapter.load('local://saved-token');assert.equal(new URL(LibmediaEngine.latest.source.source).pathname,'/local/saved-token/media');
 }finally{adapter.destroy();delete window.__TAURI_INTERNALS__;}
});
test('external subtitle metadata is listed without downloading every language; selected file loads once',async()=>{
 const adapter=new LibmediaPlayerAdapter(anchor());const original=globalThis.fetch;let reads=0;
 globalThis.fetch=async()=>{reads++;return new Response('1\n00:00:01,000 --> 00:00:02,000\nHello');};
 try{
  await adapter.load('https://example.invalid/movie.mkv',{subtitles:[{url:'https://example.invalid/en.srt',language:'en'},{url:'https://example.invalid/fr.srt',language:'fr'}]});
  assert.equal(reads,0);assert.equal(adapter.state.subtitleTracks.length,2);
  await adapter.selectTrack('sid',-1000);assert.equal(reads,1);
  assert.equal(adapter.state.subtitleTracks.find(track=>track.id===70).external,true);
  await adapter.selectTrack('sid',70);assert.equal(reads,1);
 }finally{globalThis.fetch=original;adapter.destroy();}
});

test('browser-selected subtitle keeps its filename format when loaded from a blob URL',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('WEBVTT\n\n00:00.000 --> 00:03.000\nBrowser subtitle');
 const adapter=new LibmediaPlayerAdapter(anchor());
 try{
  await adapter.load('https://example.invalid/movie.mkv');
  await adapter.addSubtitleFile('blob:https://example.invalid/selected-file','captions.vtt');
  assert.deepEqual(LibmediaEngine.latest.calls.at(-1),['external','subtitle.vtt',undefined]);
 }finally{globalThis.fetch=original;adapter.destroy();}
});
test('HLS quality alternatives use the existing desktop video selection interface',async()=>{
 const adapter=new LibmediaPlayerAdapter(anchor());
 try{
  await adapter.load('https://example.invalid/master.m3u8',{streamType:'hls'});
  const engine=LibmediaEngine.latest;
  engine.events.onStateChange({qualities:[{id:0,label:'720p',width:1280,height:720},{id:1,label:'1080p',width:1920,height:1080}],selectedQualityId:1});
  assert.equal(adapter.state.videoTracks.length,2);assert.equal(adapter.state.videoTracks[1].selected,true);
  await adapter.selectTrack('vid',0);adapter.setProperty('panscan',1);
  assert.deepEqual(engine.calls.slice(-2),[['quality',0],['cover',true]]);
 }finally{adapter.destroy();}
});
test('blocked audio reuses the desktop Play action and clears when the audio context resumes',async()=>{
 const adapter=new LibmediaPlayerAdapter(anchor());
 try{
  await adapter.load('https://example.invalid/movie.mkv');
  const engine=LibmediaEngine.latest;
  engine.events.onStateChange({status:'playing',audioNeedsUserGesture:true});
  assert.equal(adapter.state.isPaused,true);
  await adapter.play();assert.deepEqual(engine.calls.slice(-2),['resume','play']);
  engine.events.onStateChange({audioNeedsUserGesture:false});
  assert.equal(adapter.state.isPaused,false);
 }finally{adapter.destroy();}
});
