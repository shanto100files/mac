import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function engineFor(userAgent, native, saved) {
  const source=readFileSync(new URL('../src/lib/storage/SettingsStorage.ts',import.meta.url),'utf8').replaceAll('import.meta.env','({})');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  const mocks={
    '@tauri-apps/api/core':{},
    '../../platform/host':{isTauriRuntime:()=>native},
    '../../platform/deviceLayout':{},
    './StorageService':{mainStorage:{getString:()=>saved}},
  };
  runInNewContext(`(function(require,module,exports){${code}\n})`,{navigator:{userAgent}})(name=>{
    assert.ok(name in mocks,`Unexpected dependency: ${name}`);
    return mocks[name];
  },module,module.exports);
  return module.exports.settingsStorage.getPlayerEngine();
}

test('installed Android uses libmedia, including installations with an old desktop engine preference',()=>{
  for(const saved of [undefined,'builtin','mpv','libmedia'])assert.equal(engineFor('Android 14',true,saved),'libmedia');
});

test('Windows keeps its existing engine defaults and explicit choices',()=>{
  assert.equal(engineFor('Windows NT 10.0',true,undefined),'builtin');
  assert.equal(engineFor('Windows NT 10.0',true,'mpv'),'mpv');
  assert.equal(engineFor('Windows NT 10.0',true,'libmedia'),'libmedia');
});

test('Android browser keeps libmedia regardless of a saved native engine',()=>{
  assert.equal(engineFor('Android 14',false,'builtin'),'libmedia');
});
