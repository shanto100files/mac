import {build} from 'vite';
import {spawnSync} from 'node:child_process';
import {cp, mkdir, readFile, writeFile, access, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2], packaging = process.argv.includes('--package');
if (!['webos','amazon-vega'].includes(target)) throw new Error('Choose webos or amazon-vega');
const out = path.join(root,'dist-tv',target);
async function resetGenerated(directory) {
  const resolved=path.resolve(directory);
  if (!resolved.startsWith(path.resolve(out)+path.sep)) throw new Error('Refusing to clean outside the generated TV build');
  await rm(resolved,{recursive:true,force:true});
}
function run(command,args,cwd=root,env={}) {
  const result = spawnSync(command,args,{cwd,env:{...process.env,...env},stdio:'inherit',shell:process.platform==='win32'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run(process.execPath,['scripts/setup-libmedia.mjs']);
run(process.execPath,['scripts/setup-provider-sandbox.mjs']);
run(process.platform==='win32'?'npx.cmd':'npx',['tsc','--noEmit']);
await build({root,mode:target});
if (target === 'webos') {
  await resetGenerated(path.join(out,'app'));
  await resetGenerated(path.join(out,'service'));
  await cp(path.join(root,'tv/webos/app'),path.join(out,'app'),{recursive:true});
  const service = path.join(out,'service');
  await cp(path.join(root,'tv/webos/service'),service,{recursive:true});
  await cp(path.join(out,'ui'),path.join(service,'ui'),{recursive:true});
  await build({root,configFile:false,publicDir:false,logLevel:'warn',build:{target:'node16',outDir:service,emptyOutDir:false,
    lib:{entry:path.join(root,'src/platform/publicNetworkPolicy.ts'),formats:['cjs'],fileName:()=> 'networkPolicy.cjs'}}});
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const info=JSON.parse(await readFile(path.join(out,'app/appinfo.json'),'utf8'));info.version=pkg.version;
  await writeFile(path.join(out,'app/appinfo.json'),JSON.stringify(info,null,2));
  if (packaging) run('ares-package',[path.join(out,'app'),service,'-o',out,'--no-minify']);
} else {
  // SDK template versions are owned by the installed Amazon SDK, not guessed npm versions.
  const app=path.join(out,'app'), module=path.join(out,'VegaTransport');
  if (packaging) {
    if (process.platform==='win32') throw new Error('Amazon Vega packaging requires its supported Linux/macOS SDK host. Run the Amazon CI job or these commands there.');
    process.env.VEGA_TV_NATIVE_SOURCE=path.join(root,'tv/native-host');
    try {await access(path.join(app,'package.json'));} catch {run('vega',['project','generate','--template','vegaWebview','--name','VegaTv','--packageId','in.vegaapp.tv','--outputDir',app]);}
    try {await access(path.join(module,'package.json'));} catch {run('vega',['project','generate','--template','basic-turbo-module','--name','VegaTransport','--outputDir',module]);}
    await mkdir(path.join(module,'src/turbo-modules'),{recursive:true});
    await cp(path.join(root,'tv/amazon-vega/NativeVegaTransport.ts'),path.join(module,'src/turbo-modules/NativeVegaTransport.ts'));
    run('npm',['install'],module);
    // The SDK template already contains a sample implementation. Regenerate it
    // from our interface on every build, then reapply our native host methods.
    run('npx',['keplerscript-turbomodule-api','codegen','src/turbo-modules/NativeVegaTransport.ts','-o','kepler/turbo-modules/','--new','--namespace','VegaTransportModule'],module);
    const cppPath=path.join(module,'kepler/turbo-modules/VegaTransport.cpp');
    let cpp=await readFile(cppPath,'utf8');
    const start=/((?:std::)?string\s+VegaTransport::start\([^)]*\)\s*)\{[^}]*\}/;
    const stop=/(void\s+VegaTransport::stop\([^)]*\)\s*)\{[^}]*\}/;
    if (!start.test(cpp)||!stop.test(cpp)) throw new Error(`Amazon codegen signatures changed. Generated VegaTransport.cpp:\n${cpp}`);
    cpp=cpp.replace(start,'$1{ const char* url = vega_tv_start(); if (!url) throw std::runtime_error("Native host failed to start"); return std::string(url); }')
      .replace(stop,'$1{ vega_tv_stop(); }');
    if (!cpp.includes('extern "C" const char* vega_tv_start')) cpp='#include <stdexcept>\n#include <string>\nextern "C" const char* vega_tv_start();\nextern "C" void vega_tv_stop();\n'+cpp;
    await writeFile(cppPath,cpp);
    await cp(path.join(root,'tv/amazon-vega/CMakeLists.txt'),path.join(module,'CMakeLists.txt'));
    await cp(path.join(root,'tv/amazon-vega/AutoLinkInit.cpp'),path.join(module,'kepler/AutoLinkInit.cpp'));
    await writeFile(path.join(module,'react-native.config.js'),`module.exports={dependency:{platforms:{kepler:{autolink:{'in.vegaapp.tv.transport':{libraryName:'libVegaTransport.so',provider:'application',linkDynamic:true,turbomodules:['VegaTransport']}}}}}};\n`);
    await cp(path.join(root,'tv/amazon-vega/App.tsx'),path.join(app,'src/App.tsx'));
    await mkdir(path.join(app,'src/turbo-modules'),{recursive:true});
    await cp(path.join(root,'tv/amazon-vega/NativeVegaTransport.ts'),path.join(app,'src/turbo-modules/NativeVegaTransport.ts'));
    await resetGenerated(path.join(app,'assets/ui'));
    await mkdir(path.join(app,'assets/ui'),{recursive:true});
    await cp(path.join(out,'ui'),path.join(app,'assets/ui'),{recursive:true});
    const manifest=path.join(app,'manifest.toml');let toml=await readFile(manifest,'utf8');
    if (!toml.includes('[network-traffic-policy.cleartext]')) toml+='\n[network-traffic-policy.cleartext]\nallowed-domains = ["127.0.0.1"]\n';
    await writeFile(manifest,toml);
    run('vega',['project','update-manifest','--os-min','1.2','--os-version','1.2'],app);
    run('npm',['install','--include=dev','--save',module],app);
    const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
    run('npx',['--no-install','react-native','build-vega','--build-type','Release','--build-version',version],app,{VEGA_TV_NATIVE_SOURCE:path.join(root,'tv/native-host')});
  } else {
    await mkdir(path.join(out,'wrapper'),{recursive:true});
    await cp(path.join(root,'tv/amazon-vega'),path.join(out,'wrapper'),{recursive:true});
  }
}
console.log(`Built ${target} UI/native project at ${out}${packaging?' (packaging requested)':''}`);
