import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function fixture(app) {
  const root=app==='desktop'?new URL('../src/lib/',import.meta.url):new URL('../../vega-mobile/src/lib/',import.meta.url);
  const values=new Map(), callbacks=new Map();
  const mainStorage={getBool:(key,fallback=false)=>values.has(key)?values.get(key):fallback,setBool:(key,value)=>values.set(key,value)};
  const state={downloads:0,manifests:0,downloadGate:undefined,manifestGate:undefined,errors:[]};
  const source={author:'manual-fixture',url:'https://source.example'};
  const original={value:'fixture',display_name:'Fixture',source,version:'1.0.0',installed:true};
  const available={...original,version:'2.0.0'};
  const installed=new Map([[original.value,original]]), cache=new Map([[original.value,{version:'1.0.0'}]]);
  const extensionStorage={
    getInstalledProviders:()=>[...installed.values()],getProviderSource:()=>source,
    isProviderInstalled:(value,author)=>installed.get(value)?.source.author===author,
    installProvider:provider=>installed.set(provider.value,provider),
    cacheProviderModules:module=>cache.set(module.value,module),removeProviderModules:value=>cache.delete(value),
  };
  const environment={console:{log(){},warn(){},error(...args){state.errors.push(args.map(value=>value?.message||String(value)).join(' '));}},URL,setTimeout,clearTimeout,
    setInterval:callback=>{callbacks.set('interval',callback);return 1;},clearInterval:()=>callbacks.delete('interval'),
    window:{addEventListener:(name,callback)=>callbacks.set(name,callback),removeEventListener:name=>callbacks.delete(name)},
    document:{visibilityState:'visible',addEventListener:(name,callback)=>callbacks.set(name,callback),removeEventListener:name=>callbacks.delete(name)},
  };
  function load(relative,mocks) {
    const code=ts.transpileModule(readFileSync(new URL(relative,root),'utf8').replaceAll('import.meta.env','({})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:false}}).outputText;
    const module={exports:{}};
    runInNewContext(`(function(require,module,exports){${code}\n})`,environment) (
      name=>{if (!(name in mocks)) throw new Error(`Unexpected ${app} import: ${name}`);return mocks[name];},module,module.exports);
    return module.exports;
  }
  const settings=load('storage/SettingsStorage.ts',{
    './StorageService':{mainStorage},'@tauri-apps/api/core':{},'../../platform/host':{},
    '../player/controlStyle':{},'../player/controlLayout':{},'../downloadLocation':{},
  });
  const settingsStorage=settings.settingsStorage;
  const {extensionManager}=load('services/ExtensionManager.ts',{
    axios:{default:{get:async()=>{state.downloads++;await state.downloadGate;return {data:'exports.fixture=true;'};}}},
    '../../platform/network':{platformAxiosAdapter:()=>{}},
    '../storage/extensionStorage':{extensionStorage},'../storage/StorageService':{mainStorage},
    '../storage/sourceTokenStorage':{sourceTokenStorage:{has:()=>false},getSourceAuthHeaders:()=>({})},
    '../utils/helpers':{getProviderFilesUrl:()=>source.url+'/dist/fixture'},
    './sourceRequests':{validateSourceTransport(){},getSourceRequestHeaders:()=>({}),throwIfRateLimited(){},throwIfSourceForbidden(){}},
    './providerIntegrity':{verifyProviderModule:async()=>{}},
  });
  extensionManager.initialize=async()=>{};
  extensionManager.fetchManifest=async()=>{state.manifests++;await state.manifestGate;return [available];};
  const {updateProvidersService}=load('services/UpdateProviders.ts',{
    '../storage/extensionStorage':{extensionStorage},'./ExtensionManager':{extensionManager},'../storage':{settingsStorage},
    '../zustand/toastStore':{toast(){}},'./Notification':{notificationService:{showUpdateProgress:async()=>{},cancelNotification:async()=>{},displayUpdateNotification:async()=>{}}},
    '../zustand/contentStore':{default:{getState:()=>({setInstalledProviders(){},provider:undefined})}},
  });
  settingsStorage.setNotificationsEnabled(false);
  return {state,settingsStorage,settings,values,installed,cache,extensionManager,service:updateProvidersService,callbacks,available};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

for(const app of ['desktop','mobile']) {
  if (app==='mobile' && !existsSync(new URL('../../vega-mobile/src/lib/services/UpdateProviders.ts',import.meta.url))) {
    test('mobile counterpart tests require its checkout alongside Desktop',{skip:true},()=>{});continue;
  }
  test(`${app}: provider update preference persists independently of app updates`,()=>{
    const f=fixture(app);
    assert.equal(f.settingsStorage.isProviderAutoUpdateEnabled(),true);
    f.settingsStorage.setProviderAutoUpdateEnabled(false);
    assert.equal(new f.settings.SettingsStorage().isProviderAutoUpdateEnabled(),false);
    assert.equal(f.settingsStorage.isAutoCheckUpdateEnabled(),true);
    assert.equal(f.values.get('autoUpdateProviders'),false);
  });
  test(`${app}: disabled automatic triggers do no update work; manual checks and updates work`,async()=>{
    const f=fixture(app);f.settingsStorage.setProviderAutoUpdateEnabled(false);
    f.service.startAutomaticUpdateCheck();
    for(const callback of f.callbacks.values()) callback();
    await f.service.checkForUpdatesAndAutoUpdate(true); await settle();
    assert.equal(f.state.manifests,0);assert.equal(f.state.downloads,0);
    assert.equal((await f.service.checkForUpdatesManual(true))[0].hasUpdate,true);
    assert.equal(await f.service.updateProvider(f.available),true,f.state.errors.join('\n'));
    assert.equal(f.installed.get('fixture').version,'2.0.0',f.state.errors.join('\n'));
    f.service.stopAutomaticUpdateCheck();
  });
  test(`${app}: enabled automatic checks update existing providers`,async()=>{
    const f=fixture(app);await f.service.checkForUpdatesAndAutoUpdate(true);
    assert.equal(f.installed.get('fixture').version,'2.0.0',f.state.errors.join('\n'));
    assert.equal(f.cache.get('fixture').version,'2.0.0');
  });
  test(`${app}: disabling while checking prevents downloads`,async()=>{
    const f=fixture(app);let finish;f.state.manifestGate=new Promise(resolve=>{finish=resolve;});
    const updating=f.service.checkForUpdatesAndAutoUpdate(true);await settle();
    f.settingsStorage.setProviderAutoUpdateEnabled(false);finish();await updating;
    assert.equal(f.state.downloads,0);assert.equal(f.installed.get('fixture').version,'1.0.0');
  });
  test(`${app}: disabling during downloads preserves both executable code and installed version`,async()=>{
    const f=fixture(app);let finish;f.state.downloadGate=new Promise(resolve=>{finish=resolve;});
    const updating=f.service.checkForUpdatesAndAutoUpdate(true);await settle();
    assert.ok(f.state.downloads>0,f.state.errors.join('\n'));
    f.settingsStorage.setProviderAutoUpdateEnabled(false);finish();await updating;
    assert.equal(f.cache.get('fixture').version,'1.0.0');assert.equal(f.installed.get('fixture').version,'1.0.0');
  });
  test(`${app}: disabled automatic batches cannot download or install providers`,async()=>{
    const f=fixture(app);f.settingsStorage.setProviderAutoUpdateEnabled(false);
    const result=await f.service.updateProviders([f.available],{automatic:true,showNotifications:false});
    assert.equal(result.updated.length,0);assert.equal(result.failed.length,0);assert.equal(f.state.downloads,0);
  });
  test(`${app}: uninstall during an update is preserved`,async()=>{
    const f=fixture(app);let finish;f.state.downloadGate=new Promise(resolve=>{finish=resolve;});
    const updating=f.service.checkForUpdatesAndAutoUpdate(true);await settle();
    f.installed.delete('fixture');finish();await updating;
    assert.equal(f.installed.size,0);assert.equal(f.cache.has('fixture'),false);
  });
}
