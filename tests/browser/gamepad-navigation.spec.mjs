import {test,expect} from '@playwright/test';

test('controller polling sleeps when off, disconnected or hidden and wakes for input',async({page})=>{
 await page.addInitScript(()=>{
  window.padTest={calls:0,pads:[],activity:0,hidden:false};
  Object.defineProperty(navigator,'getGamepads',{value:()=>{window.padTest.calls++;return window.padTest.pads}});
  Object.defineProperty(document,'visibilityState',{get:()=>window.padTest.hidden?'hidden':'visible'});
  window.addEventListener('vega:remote-activity',()=>window.padTest.activity++);
 });
 await page.goto('/settings');await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 const mode=page.getByRole('switch',{name:'Enable TV mode',exact:true});
 await mode.setChecked(false);await page.waitForTimeout(150);const off=await page.evaluate(()=>window.padTest.calls);await page.waitForTimeout(150);expect(await page.evaluate(()=>window.padTest.calls)).toBe(off);
 await mode.setChecked(true);await page.waitForTimeout(150);const idle=await page.evaluate(()=>window.padTest.calls);expect(idle).toBeGreaterThan(0);await page.waitForTimeout(150);expect(await page.evaluate(()=>window.padTest.calls)).toBe(idle);
 await page.evaluate(()=>{window.padTest.pads=[{connected:true,buttons:Array.from({length:16},()=>({pressed:false})),axes:[0,0]}];window.dispatchEvent(new Event('gamepadconnected'))});
 await expect.poll(()=>page.evaluate(()=>window.padTest.calls)).toBeGreaterThan(idle+2);
 await page.evaluate(()=>{window.padTest.pads[0].buttons[12].pressed=true});await expect.poll(()=>page.evaluate(()=>window.padTest.activity)).toBeGreaterThan(0);
 await page.evaluate(()=>{window.padTest.hidden=true;document.dispatchEvent(new Event('visibilitychange'))});const hidden=await page.evaluate(()=>window.padTest.calls);await page.waitForTimeout(150);expect(await page.evaluate(()=>window.padTest.calls)).toBe(hidden);
 await page.evaluate(()=>{window.padTest.hidden=false;document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>page.evaluate(()=>window.padTest.calls)).toBeGreaterThan(hidden+2);
 await page.evaluate(()=>{window.padTest.pads=[];window.dispatchEvent(new Event('gamepaddisconnected'))});const disconnected=await page.evaluate(()=>window.padTest.calls);await page.waitForTimeout(150);expect(await page.evaluate(()=>window.padTest.calls)).toBe(disconnected);
 await mode.setChecked(false);await page.evaluate(()=>{window.padTest.pads=[{connected:true,buttons:Array.from({length:16},()=>({pressed:false})),axes:[0,0]}];window.dispatchEvent(new Event('gamepadconnected'))});const disabled=await page.evaluate(()=>window.padTest.calls);await page.waitForTimeout(150);expect(await page.evaluate(()=>window.padTest.calls)).toBe(disabled);
});
