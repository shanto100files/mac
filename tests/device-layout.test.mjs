import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function layout({native=true,ua='Android 14',television,env={}}={}) {
  const source=readFileSync(new URL('../src/platform/deviceLayout.ts',import.meta.url),'utf8').replaceAll('import.meta.env',JSON.stringify(env));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  const window=television===undefined?{}:{VegaDevice:{isTelevision:()=>television}};
  runInNewContext(`(function(require,module,exports){${code}\n})`,{window,navigator:{userAgent:ua}})(()=>({isTauriRuntime:()=>native}),module,module.exports);
  return {responsive:module.exports.usesResponsiveLayout(),tv:module.exports.isTelevisionDevice()};
}

test('Android phones and tablets use responsive touch UI even with a desktop TV environment flag',()=>{
  for(const ua of ['Android 14 Mobile','Android 14 Tablet'])assert.deepEqual(layout({ua,television:false,env:{VITE_TV_MODE:'true'}}),{responsive:true,tv:false});
});
test('Android TV keeps TV UI even when its WebView uses a generic Android UA',()=>{
  assert.deepEqual(layout({television:true}),{responsive:false,tv:true});
});
test('older Android hosts fall back to TV user-agent detection',()=>{
  assert.deepEqual(layout({ua:'Android 11; Android TV'}),{responsive:false,tv:true});
  assert.deepEqual(layout(),{responsive:true,tv:false});
});
test('desktop stays desktop; browser stays responsive; TV packages stay TV',()=>{
  assert.deepEqual(layout({ua:'Windows NT 10.0'}),{responsive:false,tv:false});
  assert.deepEqual(layout({native:false,ua:'Android 14'}),{responsive:true,tv:false});
  for(const host of ['webos','amazon-vega'])assert.deepEqual(layout({native:false,env:{VITE_TV_HOST:host}}),{responsive:false,tv:true});
});
