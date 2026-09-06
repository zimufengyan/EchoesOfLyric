// Credentials are read from stdin and never stored in the delivery files.
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let key=''; for await (const chunk of process.stdin) { key+=chunk; if (key.includes('\n')) break; }
key=key.trim(); if(!key) throw new Error('Provide a key through stdin.');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({ viewport:{width:1440,height:1080} });
  await page.goto(pathToFileURL(resolve('dist/echoes_of_lyric.html')).href);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#search-api-key').fill(key);
  await page.getByRole('button',{name:'刷新 API 额度',exact:true}).click();
  await expect(page.locator('#usage-value')).toHaveText(/^[\d,]+ \/ [\d,]+$/, {timeout:15000});
  console.log(JSON.stringify({usage:await page.locator('#usage-value').textContent()}));
  await page.locator('#search-api-key').fill('');
  await page.evaluate(()=>localStorage.clear());
} finally { await browser.close(); }
