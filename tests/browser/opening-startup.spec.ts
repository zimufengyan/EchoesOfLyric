import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fileURL = pathToFileURL(resolve('dist/echoes_of_lyric.html')).href;

test('a document initially hidden by its browser panel plays on first visibility exactly once', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).testDocumentVisible = false;
    Object.defineProperty(document, 'hidden', { get: () => !(window as any).testDocumentVisible, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => (window as any).testDocumentVisible ? 'visible' : 'hidden', configurable: true });
  });
  await page.goto(fileURL);
  await expect(page.locator('#opening')).toHaveCount(0);
  expect(await page.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await page.evaluate(() => { (window as any).testDocumentVisible = true; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#opening')).toBeVisible({ timeout: 2000 });
  await page.getByRole('button', { name: '跳过开屏', exact: true }).click();
  await page.evaluate(() => {
    (window as any).testDocumentVisible = false; document.dispatchEvent(new Event('visibilitychange'));
    (window as any).testDocumentVisible = true; document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow'));
  });
  await page.waitForTimeout(200);
  await expect(page.locator('#opening')).toHaveCount(0);
});

test('startup resize notifications do not cancel the opening', async ({ page }) => {
  await page.goto(fileURL);
  await expect(page.locator('#opening')).toBeVisible();
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.dispatchEvent(new Event('resize')); });
  await expect(page.locator('#opening')).toBeVisible({ timeout: 1000 });
  await page.waitForTimeout(600);
  await expect(page.locator('.opening-line').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#opening')).toHaveCount(0);
});

test('maximizing and narrowing update the same opening without restarting its timeline', async ({ page }) => {
  await page.goto(fileURL);
  await expect(page.locator('#opening')).toBeVisible();
  await page.evaluate(() => { (window as any).initialOpening = document.getElementById('opening'); });
  const progress = () => page.evaluate(() => Number(document.getAnimations().find(animation => ((animation.effect as KeyframeEffect).target as HTMLElement)?.classList.contains('opening-curtain'))!.currentTime));
  await page.waitForTimeout(300); const before = await progress();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(page.locator('#opening')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    width: parseFloat((document.querySelector('.opening-feature') as HTMLElement).style.width),
    target: document.getElementById('showcase-copy')!.getBoundingClientRect().width,
  })).then(value => Math.abs(value.width - value.target))).toBeLessThan(1);
  expect(await progress()).toBeGreaterThanOrEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.opening-feature-centered')).toBeAttached();
  expect(await page.locator('.opening-line:not([hidden])').count()).toBeLessThanOrEqual(6);
  expect(await page.evaluate(() => (window as any).initialOpening === document.getElementById('opening'))).toBe(true);
  await expect(page.locator('#opening')).toHaveCount(0, { timeout: 5500 });
  expect(await page.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('time spent hidden pauses both the opening and its failure deadline, then resumes', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).testDocumentVisible = true;
    Object.defineProperty(document, 'hidden', { get: () => !(window as any).testDocumentVisible, configurable: true });
  });
  await page.goto(fileURL);
  await page.waitForTimeout(500);
  await page.evaluate(() => { (window as any).testDocumentVisible = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(60);
  const progress = () => page.evaluate(() => Number(document.getAnimations().find(animation => ((animation.effect as KeyframeEffect).target as HTMLElement)?.classList.contains('opening-curtain'))!.currentTime));
  const paused = await progress();
  await page.waitForTimeout(4600);
  await expect(page.locator('#opening')).toBeVisible();
  expect(Math.abs(await progress() - paused)).toBeLessThan(2);
  await page.evaluate(() => { (window as any).testDocumentVisible = true; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(180);
  expect(await progress()).toBeGreaterThan(paused);
  await expect(page.locator('#opening')).toHaveCount(0, { timeout: 5500 });
  await page.locator('#text').fill('回到诗词之间');
  await expect(page.locator('#collect-button')).toBeEnabled();
});

test('repeated refreshes each play one skippable opening despite startup resize events', async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    if (i === 0) await page.goto(fileURL); else await page.reload();
    await expect(page.locator('#opening')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect(page.locator('#opening')).toHaveCount(1);
    await page.getByRole('button', { name: '跳过开屏', exact: true }).click();
    await expect(page.locator('#opening')).toHaveCount(0);
    expect(await page.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  }
});
