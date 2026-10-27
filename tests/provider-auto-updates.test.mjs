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
    getProviderSources:()=>[source],getManifestCache:()=>[],setManifestCache(){},setAvailableProviders(){},
    isProviderInstalled:(value,author)=>installed.get(value)?.source.author===author,
    installProvider:provider=>installed.set(provider.value,provider),
    cacheProviderModules:module=>cache.set(module.value,module),removeProviderModules:value=>cache.delete(value),
  };
  const environment={Error,console:{log(){},warn(){},error(...args){state.errors.push(args.map(value=>value?.message||String(value)).join(' '));}},URL,setTimeout,clearTimeout,
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
    './StorageService':{mainStorage},'@tauri-apps/api/core':{},'../../platform/host':{},'../../platform/deviceLayout':{},
    '../player/controlStyle':{},'../player/controlLayout':{},'../downloadLocation':{},
  });
  const settingsStorage=settings.settingsStorage;
  const {extensionManager}=load('services/ExtensionManager.ts',{
    axios:{default:{get:async(url)=>{state.downloads++;await state.downloadGate;if(state.request)return state.request(url);return {data:'exports.fixture=true;'};}}},
    '../../platform/network':{platformAxiosAdapter:()=>{}},
    '../storage/extensionStorage':{extensionStorage},'../storage/StorageService':{mainStorage},
    '../storage/sourceTokenStorage':{sourceTokenStorage:{has:()=>false},getSourceAuthHeaders:()=>({})},
    '../utils/helpers':{getProviderFilesUrl:()=>source.url+'/dist/fixture',isValidProviderPath:()=>true},
    './providerVersion':load('services/providerVersion.ts',{}),
    './sourceRequests':{validateSourceTransport(){},getSourceRequestHeaders:()=>({}),throwIfRateLimited(){},throwIfSourceForbidden(){}},
    './providerIntegrity':{verifyProviderModule:async()=>{}},
  });
  const fetchManifest=extensionManager.fetchManifest.bind(extensionManager);
  extensionManager.initialize=async()=>{};
  extensionManager.fetchManifest=async()=>{state.manifests++;await state.manifestGate;return [available];};
  const {updateProvidersService}=load('services/UpdateProviders.ts',{
    '../storage/extensionStorage':{extensionStorage},'./ExtensionManager':{extensionManager},'../storage':{settingsStorage},
    '../zustand/toastStore':{toast(){state.notifications=(state.notifications||0)+1;}},'./Notification':{notificationService:{showUpdateProgress:async()=>{},cancelNotification:async()=>{},displayUpdateNotification:async()=>{state.notifications=(state.notifications||0)+1;}}},
    '../zustand/contentStore':{default:{getState:()=>({setInstalledProviders(){},provider:state.activeProvider,setProvider:provider=>{state.activeProvider=provider;}})}},
  });
  settingsStorage.setNotificationsEnabled(false);
  return {state,settingsStorage,settings,values,installed,cache,extensionStorage,extensionManager,service:updateProvidersService,callbacks,available,fetchManifest};
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

  test(`${app}: optional module timeouts abort without committing`,async()=>{
    const f=fixture(app);
    f.state.request=async url=>{if(url.includes('/episodes.js'))throw new Error('timeout');return {data:'code'};};
    assert.equal(await f.service.updateProvider(f.available),false);
    assert.equal(f.installed.get('fixture').version,'1.0.0');assert.equal(f.cache.get('fixture').version,'1.0.0');
  });
  test(`${app}: missing optional modules are allowed but empty responses are not`,async()=>{
    const f=fixture(app);
    f.state.request=async url=>{if(url.includes('/episodes.js'))throw {response:{status:404}};return {data:'code'};};
    assert.equal(await f.service.updateProvider(f.available),true);
    f.state.request=async url=>({data:url.includes('/settings.js')?'':'code'});
    assert.equal(await f.service.updateProvider({...f.available,version:'3.0.0'}),false);
    assert.equal(f.installed.get('fixture').version,'2.0.0');
  });
  test(`${app}: an older concurrent update cannot overwrite a newer committed version`,async()=>{
    const f=fixture(app);let finish;
    f.extensionManager.downloadProviderModules=async(_url,_author,value,version)=>{
      const result={value,sourceAuthor:f.available.source.author,version,modules:{posts:'code'}};
      if(version==='2.0.0')return new Promise(resolve=>{finish=()=>resolve(result);});
      return result;
    };
    const older=f.extensionManager.updateProvider(f.available);await settle();
    await f.extensionManager.updateProvider({...f.available,version:'3.0.0'});finish();
    assert.equal(await older,false);
    assert.equal(f.installed.get('fixture').version,'3.0.0');assert.equal(f.cache.get('fixture').version,'3.0.0');
  });
  test(`${app}: refreshing updates keeps the active provider source`,async()=>{
    const f=fixture(app),other={...f.available,source:{author:'other',url:'https://other.example'}};
    f.state.activeProvider=f.available;f.extensionStorage.getInstalledProviders=()=>[other,f.available];
    await f.service.updateProviders([f.available],{showNotifications:false});
    assert.equal(f.state.activeProvider.source.author,f.available.source.author);
  });
  test(`${app}: automatic rate-limit alerts obey notification preference`,async()=>{
    const f=fixture(app);f.extensionManager.fetchManifest=async()=>{throw new Error('rate limit');};
    await assert.rejects(f.service.checkForUpdatesAndAutoUpdate(),/rate limit/);
    assert.equal(f.state.notifications||0,0);
  });
  const stamped=(version='2.0.0',id='fixture')=>`// @vega-provider ${id}\n// @vega-version ${version}\nexports.fixture=true;`;
  test(`${app}: manifests without header flags allow legacy installations`,async()=>{
    const f=fixture(app);
    f.state.request=async()=>({data:[{value:'fixture',version:'2.0.0'}]});
    const providers=await f.fetchManifest(f.available.source,true);
    assert.equal(providers[0].version,'2.0.0');
    f.state.request=async()=>({data:'old unstamped code'});
    await f.extensionManager.installProvider(providers[0]);
    assert.equal(f.cache.get('fixture').version,'2.0.0');
  });
  test(`${app}: fresh install rejects mismatched versions without caching or installing`,async()=>{
    const f=fixture(app);f.installed.clear();f.cache.clear();
    f.state.request=async()=>({data:stamped('1.0.0')});
    await assert.rejects(f.extensionManager.installProvider(f.available),/expected fixture v2.0.0/);
    assert.equal(f.cache.size,0);assert.equal(f.installed.size,0);
    assert.equal(f.state.downloads,12,'one retry per file, never an unbounded loop');
  });
  test(`${app}: stale optional file preserves installed code and version`,async()=>{
    const f=fixture(app);
    f.state.request=async url=>({data:stamped(url.includes('/settings.js')?'1.0.0':'2.0.0')});
    assert.equal(await f.service.updateProvider(f.available),false);
    assert.equal(f.cache.get('fixture').version,'1.0.0');assert.equal(f.installed.get('fixture').version,'1.0.0');
    assert.equal(f.state.downloads,7);
  });
  test(`${app}: a wrong provider with the right version is rejected`,async()=>{
    const f=fixture(app);f.state.request=async()=>({data:stamped('2.0.0','other')});
    assert.equal(await f.service.updateProvider(f.available),false);
    assert.equal(f.cache.get('fixture').version,'1.0.0');
  });
  test(`${app}: headerless third-party providers remain updateable`,async()=>{
    const f=fixture(app);f.state.request=async()=>({data:'exports.old=true;'});
    assert.equal(await f.service.updateProvider(f.available),true);
    assert.equal(f.installed.get('fixture').version,'2.0.0');
  });
  test(`${app}: one fresh retry recovers a stale CDN module`,async()=>{
    const f=fixture(app),urls=[];
    f.state.request=async url=>{
      if(url.includes('/stream.js')){urls.push(url);return {data:stamped(urls.length===1?'1.0.0':'2.0.0')};}
      return {data:stamped()};
    };
    assert.equal(await f.service.updateProvider(f.available),true,f.state.errors.join('\n'));
    assert.equal(urls.length,2);assert.notEqual(urls[0],urls[1]);
    assert.equal(f.state.downloads,7);assert.equal(f.cache.get('fixture').version,'2.0.0');
  });
  test(`${app}: genuinely absent optional files are still allowed`,async()=>{
    const f=fixture(app);
    f.state.request=async url=>{if(/\/(episodes|settings)\.js/.test(url))throw {response:{status:404}};return {data:stamped()};};
    assert.equal(await f.service.updateProvider(f.available),true,f.state.errors.join('\n'));
    assert.equal(f.state.downloads,6);
  });
  test(`${app}: legacy sources cannot mix stamped and unstamped modules`,async()=>{
    const f=fixture(app);
    f.state.request=async url=>({data:url.includes('/stream.js')?'exports.old=true;':stamped()});
    assert.equal(await f.service.updateProvider(f.available),false);
    assert.equal(f.cache.get('fixture').version,'1.0.0');
  });
  test(`${app}: malformed headers are rejected without any manifest flag`,async()=>{
    const f=fixture(app);f.state.request=async()=>({data:'// @vega-provider fixture\nexports.old=true;'});
    assert.equal(await f.service.updateProvider(f.available),false);
    assert.equal(f.installed.get('fixture').version,'1.0.0');
  });
  test(`${app}: valid BOM and CRLF headers work`,async()=>{
    const f=fixture(app);f.state.request=async()=>({data:'\uFEFF'+stamped().replaceAll('\n','\r\n')});
    assert.equal(await f.service.updateProvider(f.available),true,f.state.errors.join('\n'));
  });


}
