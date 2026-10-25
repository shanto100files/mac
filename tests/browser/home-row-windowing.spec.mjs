import {test,expect} from '@playwright/test';

test('homepage windows offscreen rows, preserves horizontal position, and keeps TV targets mounted',async({page})=>{
 const catalog=Array.from({length:12},(_,row)=>({title:`Row ${row}`,filter:`row-${row}`,Posts:Array.from({length:18},(_,index)=>({title:`Post ${row}-${index}`,link:`https://fixture.vega.example/item-${row}-${index}`,image:'/fixture-poster.svg'}))}));
 await page.route('**/fixture-poster.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#654"/></svg>'}));
 await page.addInitScript(catalog=>{
  const provider={value:'rows',display_name:'Rows fixture',version:'1.0.0',type:'global',installed:true,disabled:false,icon:'',source:{author:'fixture',url:'https://fixture.vega.example'}};
  localStorage.setItem('installedProviders',JSON.stringify([provider]));
  localStorage.setItem('providerModules',JSON.stringify([{value:'rows',sourceAuthor:'fixture',version:'1.0.0',cachedAt:Date.now(),modules:{catalog:'exports.catalog=[];',posts:'exports.getPosts=async()=>[];',meta:'exports.getMeta=async()=>({});'}}]));
  localStorage.setItem('content-storage',JSON.stringify({state:{provider,activeExtensionProvider:provider},version:0}));
  localStorage.setItem('cache_homeDatarows',JSON.stringify(catalog));localStorage.setItem('tvModeEnabled','false');
 },catalog);
 await page.goto('/');
 const rows=page.locator('.slider-container');await expect(rows).toHaveCount(12);
 await expect.poll(()=>page.locator('.post-card').count()).toBeGreaterThan(0);
 expect(await page.locator('.post-card').count()).toBeLessThan(108);
 const last=rows.last();await last.locator('.slider-header').scrollIntoViewIfNeeded();await expect(last.locator('.post-card')).toHaveCount(18);
 await last.locator('.slider-row').evaluate(row=>{row.scrollLeft=320});
 await rows.first().locator('.slider-header').scrollIntoViewIfNeeded();await expect(last.locator('.slider-row-placeholder')).toHaveCount(1);
 await page.setViewportSize({width:950,height:720});
 await expect.poll(()=>last.locator('.slider-row-placeholder').evaluate(node=>Math.round(node.getBoundingClientRect().height))).toBe(285);
 await last.locator('.slider-header').scrollIntoViewIfNeeded();await expect(last.locator('.post-card')).toHaveCount(18);
 await expect.poll(()=>last.locator('.slider-row').evaluate(row=>Math.round(row.scrollLeft))).toBe(320);
 await page.evaluate(()=>{localStorage.setItem('tvModeEnabled','true');window.dispatchEvent(new Event('vega_tv_mode_changed'))});
 await expect(page.locator('.post-card')).toHaveCount(216);
 await expect(page.locator('.slider-row-placeholder')).toHaveCount(0);
});
