import {test,expect} from '@playwright/test';

test('held timeline seeking accumulates while engine time is stale and commits once',async({page})=>{
  await page.clock.install();
  await page.goto('/tests/browser/seek-fixture.html');
  await expect(page.locator('.player-timeline')).toBeVisible();
  await page.clock.runFor(100);
  await page.evaluate(()=>window.seekTest.focus());
  for(let i=0;i<6;i++){
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(80);
  }
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('.timeline-time').first()).toHaveText('2:40');
  expect(await page.evaluate(()=>window.seekTest.calls)).toEqual([]);
  await page.clock.runFor(200);
  expect(await page.evaluate(()=>window.seekTest.calls)).toEqual([160]);
  // A stale non-buffering engine update must not reset the preview to 1:40.
  await page.clock.runFor(2500);
  await expect(page.locator('.timeline-time').first()).toHaveText('2:40');
  await page.keyboard.press('ArrowLeft');
  await page.clock.runFor(200);
  expect(await page.evaluate(()=>window.seekTest.calls)).toEqual([160,150]);
});
