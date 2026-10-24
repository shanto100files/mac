import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const desktop=fileURLToPath(new URL('../',import.meta.url));
const source=process.argv[2]?path.resolve(process.argv[2]):path.resolve(desktop,'../vega-site/packages/libmedia-engine');
const manifest=JSON.parse(readFileSync(path.join(source,'package.json'),'utf8'));
if(manifest.name!=='@vega/libmedia-engine')throw new Error('Expected the shared @vega/libmedia-engine source package');
const vendor=path.join(desktop,'vendor');mkdirSync(vendor,{recursive:true});
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this command through npm run sync:libmedia');
function run(args,cwd){
 const result=spawnSync(process.execPath,[npm,...args],{cwd,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
run(['pack','--ignore-scripts','--pack-destination',vendor],source);
run(['install','--ignore-scripts',`./vendor/vega-libmedia-engine-${manifest.version}.tgz`],desktop);
