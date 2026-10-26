import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {legacyCss,legacySandboxWasm} from '../scripts/legacy-webos.mjs';
import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import ts from 'typescript';

test('Node 8 service compatibility preserves cancellation and safe header keys',async()=>{
  const fs={stat:(_name,callback)=>callback(null,{size:42})};
  const dns={lookup:(_name,_options,callback)=>callback(null,[{address:'93.184.216.34',family:4}])};
  const context=vm.createContext({require:name=>name==='fs'?fs:name==='dns'?dns:createRequire(import.meta.url)(name)});
  vm.runInContext('global=this;Object.fromEntries=undefined;String.prototype.trimStart=undefined;',context);
  vm.runInContext(await readFile(new URL('../tv/webos/legacy/node8-compat.cjs',import.meta.url),'utf8'),context);
  assert.equal(await vm.runInContext('require("fs").promises.stat("fixture").then(value=>value.size)',context),42);
  assert.equal(await vm.runInContext('require("dns").promises.lookup("example.com",{all:true}).then(value=>value[0].family)',context),4);
  assert.equal(vm.runInContext(`(function(){const c=new AbortController();let count=0;const reason=new Error('stop');c.signal.addEventListener('abort',()=>count++,{once:true});c.abort(reason);c.abort();try{c.signal.throwIfAborted()}catch(e){return count===1&&e===reason}})()`,context),true);
  assert.equal(vm.runInContext(`Object.prototype.hasOwnProperty.call(Object.fromEntries([['__proto__','safe']]),'__proto__')`,context),true);
  assert.equal(vm.runInContext('new URL("https://example.com/path").hostname',context),'example.com');
});

test('legacy stylesheet removes unsupported layers, colors and sizing syntax',async()=>{
  const css=await legacyCss('@layer controls{.panel{display:flex;gap:12px;inset:0;background:color-mix(in srgb,var(--primary) 50%,transparent);width:clamp(10px,50vw,100px);aspect-ratio:16 / 9}}');
  assert.doesNotMatch(css,/@layer|color-mix\(|clamp\(/);
  assert.match(css,/top:\s*0/);
  assert.match(css,/--legacy-aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css,/--fgp-gap-column:\s*12px/);
  assert.match(css,/\.tv-focus[^\{]*\{outline:none!important/);
});

test('lowered current QuickJS retains execution and memory limits',async()=>{
  const require=createRequire(import.meta.url);
  const bytes=await legacySandboxWasm(await readFile(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')));
  const compiled=await WebAssembly.compile(bytes);
  const engine=await newQuickJSWASMModuleFromVariant(newVariant(variant,{wasmModule:compiled}));
  const runtime=engine.newRuntime();runtime.setMemoryLimit(16*1024*1024);
  const context=runtime.newContext();
  try{
    const result=context.evalCode('21 * 2');
    const value=context.unwrapResult(result);
    try{assert.equal(context.getNumber(value),42);}finally{value.dispose();}
    context.unwrapResult(context.evalCode('typeof window')).dispose();
  }finally{context.dispose();runtime.dispose();}
});

test('legacy subtitle replacement, delay and cleanup handle disabled Chromium tracks',async()=>{
  const source=await readFile(new URL('../src/platform/legacy/LegacyTextSubtitles.ts',import.meta.url),'utf8');
  const {LegacyTextSubtitles}=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')}`);
  const previous=globalThis.VTTCue;
  globalThis.VTTCue=class{constructor(start,end,text){this.startTime=start;this.endTime=end;this.text=text;}};
  const stored=[];
  const track={mode:'disabled',get cues(){return this.mode==='disabled'?null:stored;},addCue(cue){stored.push(cue);},removeCue(cue){stored.splice(stored.indexOf(cue),1);}};
  try{
    const subtitles=new LegacyTextSubtitles({addTextTrack:()=>track});
    subtitles.setContent('1\n00:00:01,000 --> 00:00:04,000\n{\\an8}Text');
    subtitles.setDelay(2000);subtitles.setDelay(2000);
    assert.deepEqual(stored.map(cue=>[cue.startTime,cue.endTime,cue.text]),[[3,6,'Text']]);
    subtitles.setContent('WEBVTT\n\n00:05.000 --> 00:07.000\nReplacement');
    assert.equal(stored.length,1);assert.equal(stored[0].startTime,7);
    assert.throws(()=>subtitles.setContent('[Script Info]\nDialogue: unsupported'),/Choose SRT/);
    assert.equal(stored.length,0);
    subtitles.destroy();assert.equal(stored.length,0);assert.equal(track.mode,'disabled');
  }finally{globalThis.VTTCue=previous;}
});
