// Reads a temporary key from stdin; never saves it in project files.
import { searchWeb } from '../shared/search.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let key = '';
for await (const chunk of process.stdin) { key += chunk; if (key.includes('\n')) break; }
key = key.trim();
if (!key) throw new Error('Provide a key through stdin.');
await mkdir('artifacts', { recursive: true });
const cases = ['我花开后百花杀', '十四万人弃卸甲，更无一个是男儿'];
for (const query of process.argv.includes('--browser-only') ? [] : cases) {
  const results = await searchWeb(query, key, AbortSignal.timeout(40000), async (url, init) => {
    const response = await fetch(url, init);
    if (response.ok) { const data = await response.clone().json(); await writeFile(`artifacts/search-raw-${cases.indexOf(query)}.json`, JSON.stringify({ results: data.results, answer: data.answer }, null, 2)); }
    return response;
  });
  console.log(JSON.stringify({ query, candidates: results.map(({ evidence, ...rest }) => rest) }, null, 2));
  await writeFile(`artifacts/search-${cases.indexOf(query)}.json`, JSON.stringify({ query, candidates: results }, null, 2));
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('response', async response => { if (response.url() === 'https://api.tavily.com/search' && response.status() === 200) { const data = await response.json(); await writeFile('artifacts/search-raw-browser.json', JSON.stringify({ results: data.results, answer: data.answer }, null, 2)); } });
await page.goto(pathToFileURL(resolve('dist/echoes_of_lyric.html')).href);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.locator('#search-api-key').fill(key);
await page.getByRole('button', { name: '保存设置', exact: true }).click();
await page.locator('#text').fill('长风破浪会有时，直挂云帆济沧海');
await page.waitForFunction(() => { const s = document.querySelector('#search-status')!; return s.classList.contains('error') || s.textContent!.startsWith('找到') || s.textContent!.startsWith('暂未找到'); }, undefined, { timeout: 45000 });
console.log(JSON.stringify(await page.evaluate(() => ({ status: document.querySelector('#search-status')!.textContent, author: (document.querySelector('#author') as HTMLInputElement).value, title: (document.querySelector('#title') as HTMLInputElement).value, url: (document.querySelector('#url') as HTMLInputElement).value }))));
await expect(page.locator('#author')).toHaveValue('李白');
await expect(page.locator('#title')).toHaveValue('行路难·其一');
await expect(page.locator('#url')).toHaveValue(/^https:\/\/.*(?:gushiwen\.cn|guwendao\.net)\//);
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/live-search.png', fullPage: true });
await page.evaluate(() => localStorage.clear());
await browser.close();
