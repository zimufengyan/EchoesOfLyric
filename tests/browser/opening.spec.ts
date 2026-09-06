import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fileURL = pathToFileURL(resolve('dist/echoes_of_lyric.html')).href;
const html = await readFile(resolve('dist/echoes_of_lyric.html'), 'utf8');
const seed = JSON.parse(html.match(/<script type="application\/json" id="app-snapshot">(.*?)<\/script>/s)![1]);
const total = Object.values(seed.collection).flat().length;
async function released(page: Page) {
  await expect(page.locator('#opening')).toHaveCount(0, { timeout: 5500 });
  expect(await page.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect(page.locator('#showcase-copy')).toBeVisible();
}

test('opening runs offline above the ready workspace and lands on the same poem at full desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.context().setOffline(true);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(fileURL);
  await expect(page.getByRole('dialog', { name: '余韵开屏', exact: true })).toBeVisible();
  await expect(page.locator('#total-count')).toHaveText(String(total).padStart(2, '0'));
  expect(await page.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  const text = await page.locator('#showcase-text').textContent();
  await expect(page.locator('.opening-verse')).toHaveText(text!);
  expect(await page.locator('.opening-line').count()).toBeGreaterThan(1);
  expect(await page.locator('.opening-line').count()).toBeLessThanOrEqual(12);
  const depth = () => page.locator('.opening-line').first().evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m43);
  const far = await depth(); await page.waitForTimeout(450); expect(await depth()).toBeGreaterThan(far);
  await page.waitForTimeout(750);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/opening-desktop.png' });
  await page.waitForTimeout(1450);
  await page.screenshot({ path: 'artifacts/opening-landing.png' });
  await released(page);
  await expect(page.locator('#showcase-text')).toHaveText(text!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator('#text').fill('开屏结束后继续摘录');
  await expect(page.locator('#collect-button')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('opening traps focus, skips by Escape or icon and preserves a restored draft', async ({ page }) => {
  await page.goto(fileURL);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '跳过开屏', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await released(page);
  await page.locator('#text').fill('山有木兮木有枝'); await page.locator('#author').fill('佚名');
  await page.reload();
  await expect(page.locator('#text')).toHaveValue('山有木兮木有枝');
  await page.getByRole('button', { name: '跳过开屏', exact: true }).click(); await released(page);
  await expect(page.locator('#author')).toHaveValue('佚名');
  await page.keyboard.press('Tab');
  await expect(page.locator('#title')).toBeFocused();
});

test('opening setting persists, can be reenabled and does not change search settings', async ({ page }) => {
  await page.goto(fileURL);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('播放开屏动画', { exact: true }).uncheck();
  await page.locator('#search-key').selectOption('shift-enter');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload(); await released(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('播放开屏动画', { exact: true })).not.toBeChecked();
  await expect(page.locator('#search-key')).toHaveValue('shift-enter');
  await page.getByLabel('播放开屏动画', { exact: true }).check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload(); await expect(page.locator('#opening')).toBeVisible();
  await page.keyboard.press('Escape'); await released(page);
});

test('mobile opening has fewer lines and never scrolls to an offscreen reading strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fileURL);
  expect(await page.locator('.opening-line').count()).toBeLessThanOrEqual(6);
  await expect(page.locator('.opening-feature-centered')).toBeAttached();
  await page.waitForTimeout(2000);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/opening-mobile.png' });
  await released(page);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ x: 0, y: 0, overflow: false });
  await page.reload(); await expect(page.locator('#opening')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 }); await released(page);
});

test('reduced motion bypasses the opening and changing the preference immediately releases the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fileURL); await released(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload(); await expect(page.locator('#opening')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await released(page);
  await page.locator('#text').fill('减少动画时直接收录');
  await expect(page.locator('#collect-button')).toBeEnabled();
});

for (const failure of ['throw', 'stall'] as const) {
  test(`animation ${failure} cannot leave the workspace blocked`, async ({ page }) => {
    await page.addInitScript(failure => {
      const nativeAnimate = Element.prototype.animate; let count = 0;
      Element.prototype.animate = function (frames, options) {
        if (this.closest('#opening')) {
          if (failure === 'throw' && ++count === 3) throw new Error('Simulated animation failure');
          const animation = nativeAnimate.call(this, frames, options);
          if (failure === 'stall') animation.pause();
          return animation;
        }
        return nativeAnimate.call(this, frames, options);
      };
    }, failure);
    await page.goto(fileURL);
    if (failure === 'stall') await expect(page.locator('#opening')).toBeVisible();
    await released(page);
    await page.locator('#text').fill('动画异常后仍能继续');
    await expect(page.locator('#collect-button')).toBeEnabled();
    expect(await page.evaluate(() => document.getAnimations().some(animation => (animation.effect as KeyframeEffect)?.target?.isConnected === false))).toBe(false);
  });
}

test('empty collections and unavailable browser storage still reach a usable editor', async ({ page }) => {
  await page.addInitScript(({ seed, path }) => {
    localStorage.setItem(`echoes.collection.v1:${seed.id}:${path}`, JSON.stringify({ collection: {}, category: '', draft: { text: '', title: '', author: '', dynasty: '', url: '' }, dirty: true, editing: null }));
  }, { seed, path: new URL(fileURL).pathname });
  await page.goto(fileURL); await expect(page.locator('.opening-verse')).toHaveText('余韵');
  await page.keyboard.press('Escape'); await released(page); await expect(page.locator('#total-count')).toHaveText('00');
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('Unavailable', 'SecurityError'); }; });
  await page.reload(); await page.keyboard.press('Escape'); await released(page);
  await expect(page.locator('#total-count')).toHaveText(String(total).padStart(2, '0'));
});
