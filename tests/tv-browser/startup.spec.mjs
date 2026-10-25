import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import path from 'node:path';
const {startHost}=createRequire(import.meta.url)('../../tv/webos/service/host.cjs');

for(const target of ['webos','amazon-vega']) {
  test(`${target} packaged UI starts with native host, no extension or seeded providers`,async({page})=>{
    const root=path.resolve(`dist-tv/${target}/ui`);let child,host,url;
    if(target==='webos') {host=await startHost({root,port:0,policy:createRequire(import.meta.url)('../../dist-tv/webos/service/networkPolicy.cjs')});url=host.url;}
    else {
      const executable=path.resolve(`tv/native-host/target/debug/vega-tv-host${process.platform==='win32'?'.exe':''}`);
      child=spawn(executable,[root,'0'],{stdio:['ignore','pipe','pipe']});
      url=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',data=>{output+=data;if(output.includes('\n'))resolve(output.trim());});child.once('error',reject);child.once('exit',code=>reject(new Error(`Native host exited ${code}`)));});
    }
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
      // Exercise delayed React commits, as on slower TV hardware/CI runners.
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await page.goto(url);
      await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Extensions',exact:true})).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>window.vegaPlatformHost?.kind)).toBe(target);
      const result=await page.evaluate(async()=>{
        return {chromeExtension:typeof chrome!=='undefined'&&!!chrome.runtime?.id,host:window.vegaPlatformHost.capabilities};
      });
      expect(result.chromeExtension).toBe(false);expect(result.host.publicDestinationChecks).toBe(true);
      await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Extensions',exact:true}).click();
      await expect(page).toHaveURL(/#\/extensions/);
      // The route commits before its effect opens the empty-source dialog.
      // An immediate isVisible() can skip it and leave the page aria-hidden.
      const dialog=page.getByRole('dialog',{name:'Add source',exact:true});
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading',{name:'No providers available'})).toBeVisible();
      await expect(page.getByText('Add a source to begin',{exact:true})).toBeVisible();
      const blocked=await page.evaluate(async()=>{try {await window.vegaPlatformHost.request({url:'http://127.0.0.1/',method:'GET',headers:[],redirect:'follow',credentials:'omit'},new AbortController().signal);return '';}catch(error){return error.message;}});
      expect(blocked).toMatch(/blocked/i);
      await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Settings',exact:true}).click();
      await expect(page).toHaveURL(/#\/settings/);
      await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/#\/extensions/);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      await expect(dialog).toBeHidden();
      await page.reload();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading',{name:'No providers available'})).toBeVisible();
      expect(errors).toEqual([]);
    } finally {if(host)host.close();if(child)child.kill();}
  });
}
