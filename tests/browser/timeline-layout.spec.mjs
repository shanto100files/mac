import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const css = ['../../src/pages/PlayerPage.css', '../../src/styles/index.css']
  .map(file => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/@import[^;]+;/g, ''))
  .join('\n');

test('timeline focus stays inside the viewport at every UI scale', async ({page}) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({width, height: 1080});
    await page.setContent(`<style>${css}</style><div class="player-timeline"><span class="timeline-time">0:00</span><div class="timeline-track"><div class="timeline-progress" style="width:0%"><div class="timeline-thumb"></div></div></div><span class="timeline-time right">48:22</span></div>`);
    for (const scale of [.75, 1, 1.25, 2]) {
      const result = await page.evaluate(scale => {
        document.documentElement.style.zoom=String(scale);
        const row=document.querySelector('.player-timeline');
        row.classList.remove('tv-focus');
        const before=row.getBoundingClientRect();
        row.classList.add('tv-focus');
        const after=row.getBoundingClientRect();
        const thumb=document.querySelector('.timeline-thumb').getBoundingClientRect();
        const track=document.querySelector('.timeline-track').getBoundingClientRect();
        return {left:after.left,right:after.right,width:innerWidth,shift:after.width-before.width,
          centerError:Math.abs(thumb.y+thumb.height/2-track.y-track.height/2),
          outlineOffset:parseFloat(getComputedStyle(row).outlineOffset)};
      }, scale);
      expect(result.left).toBeGreaterThanOrEqual(0);
      expect(result.right).toBeLessThanOrEqual(result.width+.1);
      expect(Math.abs(result.shift)).toBeLessThan(.1);
      expect(result.centerError).toBeLessThan(.1);
      expect(result.outlineOffset).toBeLessThan(0);
    }
  }
});
