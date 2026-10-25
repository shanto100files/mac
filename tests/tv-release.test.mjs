import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const script=await readFile(new URL('../scripts/upload-tv-release.sh',import.meta.url),'utf8');
const mock=`
sleep() { :; }
gh() {
  printf '%s\\n' "$*" >> calls.log
  case "$1 $2" in
    'release view') [ "$CASE" = existing ] || [ -f release-ready ] ;;
    'release create') touch release-ready; [ "$CASE" != concurrent ] ;;
    'release upload')
      if [ "$CASE" = upload-failure ]; then return 1; fi
      if [ "$CASE" = retry ] && [ ! -f retried ]; then touch retried; return 1; fi
      return 0 ;;
    *) return 1 ;;
  esac
}
`;

for(const target of ['webos','amazon-vega']) {
  for(const scenario of ['existing','new','concurrent','retry','upload-failure','missing-package']) {
    test(`${target} release upload: ${scenario}`,async()=>{
      const root=await mkdtemp(path.join(tmpdir(),'vega-tv-release-'));
      try {
        await writeFile(path.join(root,'package.json'),JSON.stringify({version:'2.3.0'}));
        const packages=target==='webos'?['dist-tv/webos/vega.ipk']:[
          'dist-tv/amazon-vega/app/build/release/arm64/vega.vpkg',
          'dist-tv/amazon-vega/app/build/vega-root.vpkg',
        ];
        if(scenario!=='missing-package') for(const file of packages) {
          await mkdir(path.dirname(path.join(root,file)),{recursive:true});
          await writeFile(path.join(root,file),'package fixture');
        }
        const result=spawnSync(bash,['-e','-o','pipefail','-s','--',target],{
          cwd:root,env:{...process.env,CASE:scenario,GITHUB_SHA:'source-commit'},
          input:mock+script,encoding:'utf8',timeout:15_000,
        });
        assert.ifError(result.error);
        const fails=['upload-failure','missing-package'].includes(scenario);
        assert.equal(result.status,fails?1:0,result.stdout+result.stderr);
        const calls=await readFile(path.join(root,'calls.log'),'utf8').catch(error=>{
          if(error.code==='ENOENT') return ''; throw error;
        });
        if(!fails) {
          assert.ok(calls.includes('release upload app-v2.3.0 '));
          for(const file of packages) assert.ok(calls.includes(file));
          assert.ok(calls.includes('--clobber'));
        }
        if(scenario==='concurrent') assert.equal(calls.split('release view app-v2.3.0').length-1,2);
        if(scenario==='new') assert.ok(calls.includes('--target source-commit'));
        if(scenario==='retry') assert.equal(calls.split('release upload').length-1,2);
        if(scenario==='upload-failure') assert.equal(calls.split('release upload').length-1,6);
        if(scenario==='missing-package') assert.equal(calls,'');
      } finally {await rm(root,{recursive:true,force:true});}
    });
  }
}
