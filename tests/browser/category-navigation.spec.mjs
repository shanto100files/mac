import {test,expect} from '@playwright/test';

test('remote can leave icon grid, choose color, reach Cancel and Create',async({page})=>{
  await page.goto('/tests/browser/category-fixture.html');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.categoryTest.focus())).toBe('LIB_DLG_NAME');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox',{name:'Category name'}).fill('Remote category');
  await page.keyboard.press('ArrowDown');
  for(let i=0;i<40;i++){
    if((await page.evaluate(()=>window.categoryTest.focus())).startsWith('LIB_DLG_COLOR_'))break;
    await page.keyboard.press('ArrowDown');
  }
  await expect.poll(()=>page.evaluate(()=>window.categoryTest.focus())).toMatch(/^LIB_DLG_COLOR_/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toHaveClass(/tv-focus/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button',{name:'Create',exact:true})).toHaveClass(/tv-focus/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>window.categoryTest.saved.name)).toBe('Remote category');
  expect(await page.evaluate(()=>window.categoryTest.saved.color)).toBeTruthy();
});
