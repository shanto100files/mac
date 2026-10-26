import {test,expect} from '@playwright/test';

test('player controls fade both ways, finish hiding, and survive a rapid reopen',async({page})=>{
 await page.goto('/tests/browser/player-motion-fixture.html');
 const controls=page.locator('.player-controls-wrapper');
 await expect(controls).toHaveClass(/visible/);
 await expect(controls).toHaveCSS('animation-name','player-controls-enter');
 await page.evaluate(()=>window.playerMotion.setVisible(false));
 await expect(controls).toHaveClass(/exiting/);
 await expect(controls).toHaveCSS('display','flex');
 await expect(controls).toHaveAttribute('inert','');
 await expect(controls).toHaveCSS('display','none');
 await page.evaluate(()=>window.playerMotion.setVisible(true));
 await expect(controls).toHaveCSS('animation-name','player-controls-enter');
 await page.evaluate(()=>window.playerMotion.setVisible(false));
 await expect(controls).toHaveClass(/exiting/);
 await page.evaluate(()=>window.playerMotion.setVisible(true));
 await page.waitForTimeout(350);
 await expect(controls).toHaveCSS('display','flex');
 await expect(controls).toHaveCSS('opacity','1');
 await expect(controls).not.toHaveAttribute('inert','');
});

test('episode drawer slides and backdrop fades before their closed layers disappear',async({page})=>{
 await page.goto('/tests/browser/player-motion-fixture.html');
 const sidebar=page.locator('.player-episode-sidebar'),backdrop=page.locator('.player-episode-sidebar-backdrop');
 await expect(sidebar).toHaveCSS('display','none');
 await page.evaluate(()=>window.playerMotion.setOpen(true));
 await expect(sidebar).toHaveCSS('animation-name','player-sidebar-enter');
 await expect(backdrop).toHaveCSS('animation-name','player-controls-enter');
 await page.waitForTimeout(350);
 await page.evaluate(()=>window.playerMotion.setOpen(false));
 await expect(sidebar).toHaveClass(/exiting/);
 await expect(sidebar).toHaveCSS('display','flex');
 await expect(sidebar).toHaveCSS('display','none');
 await expect(backdrop).toHaveCSS('display','none');
});

test('reduced motion skips overlay transitions',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/tests/browser/player-motion-fixture.html');
 const controls=page.locator('.player-controls-wrapper');
 await expect(controls).toHaveCSS('animation-name','none');
 await page.evaluate(()=>window.playerMotion.setVisible(false));
 await expect(controls).toHaveCSS('display','none');
});
