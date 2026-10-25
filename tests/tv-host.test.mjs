import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publicNetworkUrl, sourceModule, cookieRulesUrl} from './helpers/platform-modules.mjs';
const {startHost,createTransport,headersFor}=createRequire(import.meta.url)('../tv/webos/service/host.cjs');
const policy=await import(publicNetworkUrl);
test('native TV HTTP, protected HLS/ranges, lease revocation and local origin isolation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vega-tv-'));
  await writeFile(path.join(root,'index.html'),'<html>packaged app</html>');
  const seen=[];
  const fixture=http.createServer((req,res)=>{
    seen.push({url:req.url,headers:req.headers});
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/post','Set-Cookie':'fixture=one; Path=/'});res.end();}
    else if(req.url==='/post'){res.setHeader('Set-Cookie',['a=1; Path=/','b=2; Path=/']);res.end('post metadata');}
    else if(req.url==='/index.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST\n');}
    else if(req.url==='/segment.ts'){assert.equal(req.headers['x-provider'],'test');res.writeHead(206,{'Content-Range':'bytes 0-2/10','Content-Type':'video/mp2t'});res.end('abc');}
    else res.end('key');
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.address().port}`;
  // Only the isolated test fixture is exempted. Production has no exemption.
  const fixturePolicy={...policy,publicHttpUrl(value){if(new URL(value).origin===origin)return new URL(value);return policy.publicHttpUrl(value);},isPublicAddress(value){return value==='127.0.0.1'||policy.isPublicAddress(value);}};
  const host=await startHost({root,port:0,policy:fixturePolicy});
  const url=new URL(host.url),session=url.pathname.split('/')[2];
  const call=(method,body,extra={})=>fetch(`${url.origin}/api/${method}`,{method:'POST',headers:{'content-type':'application/json','x-vega-session':session,...extra},body:JSON.stringify(body)});
  try {
    assert.match(await (await fetch(host.url)).text(),/packaged app/);
    assert.equal((await fetch(`${url.origin}/api/heartbeat`,{method:'POST',body:'{}'})).status,400);
    assert.equal((await call('heartbeat',{}, {Origin:'https://evil.example'})).status,400);
    assert.equal((await call('request',{url:'http://169.254.169.254/',method:'GET',headers:[],credentials:'omit'})).status,400);
    const input={url:`${origin}/redirect`,method:'GET',headers:[['Referer','https://provider.example/'],['sec-ch-ua','test']],credentials:'omit',redirect:'manual'};
    const result=await (await call('request',input)).json();assert.equal(result.status,302);assert.ok(result.headers.some(([k,v])=>k.toLowerCase()==='location'&&v==='/post'));
    assert.equal(seen[0].headers.referer,'https://provider.example/');assert.equal(seen[0].headers['sec-ch-ua'],'test');assert.equal(seen[0].headers.cookie,undefined);
    const multiple=await (await call('request',{...input,url:`${origin}/post`})).json();assert.equal(multiple.headers.filter(([k])=>k.toLowerCase()==='set-cookie').length,2);
    const source=await (await call('prepare',{id:'movie',source:`${origin}/index.m3u8`,headers:{'X-Provider':'test'},kind:'hls'})).json();
    assert.equal(source.headers,undefined);const playlist=await(await fetch(source.source)).text();assert.match(playlist,/\/media\/[a-f0-9]{64}\//);assert.ok(!playlist.includes(origin));
    const segment=playlist.split('\n').find(line=>line.startsWith('http:'));const response=await fetch(segment,{headers:{Range:'bytes=0-2'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-2/10');assert.equal(await response.text(),'abc');
    await call('release',{id:'movie'});assert.equal((await fetch(segment)).status,400);
    assert.deepEqual(headersFor([['Cookie','secret'],['Authorization','secret'],['X-Secret','secret'],['Range','bytes=0-1']],origin,'https://cdn.example/'),[['Range','bytes=0-1']]);
    await assert.rejects(createTransport(policy)({url:'http://127.0.0.1/',headers:[]},new AbortController().signal),/blocked/);
  } finally {host.close();await new Promise(resolve=>fixture.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('TV adapter installs without Chrome and follows source-isolated redirect cookies', async()=>{
  const previous={window:global.window,location:global.location,document:global.document,fetch:global.fetch};
  const {cookieHeader}=await import(cookieRulesUrl);assert.equal(typeof cookieHeader,'function');
  const calls=[];global.location={protocol:'http:',hostname:'127.0.0.1',pathname:`/app/${'a'.repeat(64)}/index.html`};
  const listeners={};global.window={addEventListener(name,fn){listeners[name]=fn;}};global.document={addEventListener(){}};
  global.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));const first=calls.length===1;return new Response(JSON.stringify({url:calls.at(-1).url,status:first?302:200,headers:first?[['location','https://two.example/post'],['set-cookie','private=one; Path=/']]:[],body:[]}));};
  try {
    let source=await sourceModule('platform/tvHost.ts',{'../lib/providers/cookieRules':cookieRulesUrl});
    const decoded=Buffer.from(source.split(',')[1],'base64').toString().replace('import.meta.env.VITE_TV_HOST',"'webos'");
    const {installTvHost}=await import(`data:text/javascript;base64,${Buffer.from(decoded).toString('base64')}`);installTvHost();
    assert.equal(window.vegaPlatformHost.kind,'webos');
    const result=await window.vegaPlatformHost.request({url:'https://one.example/',method:'GET',headers:[['authorization','secret'],['x-secret','secret']],credentials:'omit',redirect:'follow'},new AbortController().signal);
    assert.equal(result.status,200);assert.equal(calls[1].headers.some(([k])=>/cookie|authorization|x-secret/.test(k)),false);assert.equal(result.cookieUpdates.length,1);
    listeners.pagehide();
  } finally {Object.assign(global,previous);}
});
