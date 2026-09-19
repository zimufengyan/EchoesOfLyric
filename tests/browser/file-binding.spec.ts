import { test as base, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Native OPFS handles in IndexedDB require a normal profile on Chromium 153;
// reading them in its incognito test context terminates the browser process.
const test = base.extend({
  context: async ({ playwright }, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'echoes-bindings-'));
    const context = await playwright.chromium.launchPersistentContext(profile, { channel: process.env.ECHOES_BROWSER_CHANNEL || 'msedge', headless: true });
    try { await use(context); }
    finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  },
});

const html = await readFile('dist/echoes_of_lyric.html', 'utf8');
const seed = JSON.parse(html.match(/<script type="application\/json" id="app-snapshot">(.*?)<\/script>/s)![1]);
const count = Object.values(seed.collection).flat().length;
let server: Server, origin: string;

test.beforeAll(async () => {
  server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('echoes.search.v2', JSON.stringify({ openingAnimation: false, autoSearch: false }));
    (window as any).showSaveFilePicker = async () => {
      localStorage.setItem('test-picker-count', String(Number(localStorage.getItem('test-picker-count') || 0) + 1));
      const dir = await navigator.storage.getDirectory();
      return dir.getFileHandle(localStorage.getItem('test-next-file') || 'remembered.json', { create: true });
    };
    const prototype = (window as any).FileSystemHandle.prototype;
    const query = prototype.queryPermission;
    prototype.queryPermission = function(options: unknown) {
      const override = localStorage.getItem('test-permission');
      return override ? Promise.resolve(override) : query.call(this, options);
    };
    prototype.requestPermission = function() {
      localStorage.setItem('test-request-active', String(navigator.userActivation.isActive));
      const result = localStorage.getItem('test-request-result') || 'granted';
      localStorage.setItem('test-permission', result);
      return Promise.resolve(result);
    };
  });
});

async function ready(page: Page, path = '/') {
  await page.goto(origin + path);
  await expect(page.locator('#save-status')).not.toContainText('正在恢复');
}
async function add(page: Page, text: string) {
  await page.locator('#text').fill(text);
  await page.getByRole('button', { name: '收入诗集', exact: true }).click();
}
async function disk(page: Page, name = 'remembered.json'): Promise<string> {
  return page.evaluate(async name => (await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile()).text(), name);
}
async function checkpoint(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('echoes-file-bindings', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const snapshot = JSON.parse(document.getElementById('app-snapshot')!.textContent!);
    try { return await new Promise<string | null>((resolve, reject) => {
      const q = db.transaction('files').objectStore('files').get(`echoes.collection.v1:${snapshot.id}:${location.pathname}`);
      q.onsuccess = () => resolve(q.result?.expectedText ?? null); q.onerror = () => reject(q.error);
    }); } finally { db.close(); }
  });
}
async function bound(page: Page) {
  await ready(page); await add(page, '首次收录，记住此笺');
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  await expect.poll(() => checkpoint(page)).toContain('首次收录');
}
async function externalAppend(page: Page, text: string) {
  await page.evaluate(async text => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('remembered.json');
    const data = JSON.parse(await (await file.getFile()).text());
    data[Object.keys(data)[0]].push({ text, title: '', author: '', dynasty: '', url: '' });
    const stream = await file.createWritable(); await stream.write(JSON.stringify(data)); await stream.close();
  }, text);
}
async function settings(page: Page) { await page.getByRole('button', { name: '设置', exact: true }).click(); }

test('native handles survive reload and closing the tab without a second picker', async ({ page, context }) => {
  await bound(page); await page.reload();
  await expect(page.locator('#save-status')).toContainText('已连接 remembered.json');
  await add(page, '重开之后，继续收录');
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  await expect.poll(() => checkpoint(page)).toContain('重开之后');
  await page.close(); const reopened = await context.newPage(); await ready(reopened);
  await expect(reopened.locator('#save-status')).toContainText('已连接 remembered.json');
  expect(await reopened.evaluate(() => localStorage.getItem('test-picker-count'))).toBe('1');
  expect(await disk(reopened)).toContain('重开之后');
});

test('permission renewal uses a user gesture and keeps denied edits without repicking', async ({ page }) => {
  await bound(page);
  await page.evaluate(() => { localStorage.setItem('test-permission', 'prompt'); localStorage.setItem('test-request-result', 'denied'); });
  await page.reload(); await expect(page.locator('#save-status')).toContainText('等待文件授权');
  await page.setViewportSize({ width: 390, height: 844 });
  await settings(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await add(page, '授权之前，也可继续摘录');
  await expect(page.locator('#save-status')).toContainText('等待文件授权');
  expect(await disk(page)).not.toContain('授权之前');
  await page.evaluate(() => localStorage.setItem('test-request-result', 'granted'));
  await page.getByRole('button', { name: '恢复文件访问', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  expect(await disk(page)).toContain('授权之前');
  expect(await page.evaluate(() => [localStorage.getItem('test-picker-count'), localStorage.getItem('test-request-active')])).toEqual(['1', 'true']);
});

test('disk changes reload without losing a draft or using a stale edit index', async ({ page }) => {
  await bound(page); await page.locator('#text').fill('尚未收录的草稿');
  await externalAppend(page, '文件里的新句'); await page.reload();
  await expect(page.locator('#save-status')).toContainText('已连接 remembered.json');
  await expect(page.locator('#total-count')).toHaveText(String(count + 2).padStart(2, '0'));
  await expect(page.locator('#text')).toHaveValue('尚未收录的草稿');
  expect(await disk(page)).toContain('文件里的新句');
});

test('divergent edits require review and merge preserves both sides', async ({ page }) => {
  await bound(page);
  await page.evaluate(() => { localStorage.setItem('test-permission', 'prompt'); localStorage.setItem('test-request-result', 'denied'); });
  await page.reload(); await expect(page.locator('#save-status')).toContainText('等待文件授权');
  await add(page, '浏览器中尚未写出的句子');
  await externalAppend(page, '另一处写入的句子');
  const before = await disk(page);
  await page.evaluate(() => { localStorage.setItem('test-permission', 'granted'); localStorage.setItem('test-request-result', 'granted'); });
  await page.reload(); await expect(page.locator('#save-status')).toContainText('待核对');
  expect(await disk(page)).toBe(before);
  await page.getByRole('button', { name: '核对文件变更', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对文件变更' })).toBeVisible();
  await page.getByRole('button', { name: '合并并保存', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  const content = await disk(page); expect(content).toContain('浏览器中尚未写出'); expect(content).toContain('另一处写入');
  expect(Object.values(JSON.parse(content)).flat()).toHaveLength(count + 3);
});

test('missing files keep edits and permit explicitly choosing a replacement', async ({ page }) => {
  await bound(page);
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('remembered.json'));
  await page.reload(); await expect(page.locator('#save-status')).toContainText('暂不可用');
  await add(page, '原文件不在，仍保留此句');
  expect(await page.evaluate(() => localStorage.getItem('test-picker-count'))).toBe('1');
  await page.evaluate(() => localStorage.setItem('test-next-file', 'replacement.json'));
  await settings(page); await page.getByRole('button', { name: '选择 JSON 保存位置', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('已写入 replacement.json');
  expect(await disk(page, 'replacement.json')).toContain('原文件不在');
});

test('an unavailable binding database does not prevent saving or editing', async ({ context, page }) => {
  await context.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await ready(page); await add(page, '本次仍可写入');
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  expect(await disk(page)).toContain('本次仍可写入');
  await settings(page); await expect(page.locator('#save-file-name')).toContainText('仅本次打开有效');
});

test('importing with a denied write permission remembers the selected file for renewal', async ({ page }) => {
  await bound(page);
  await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle('imported.json', { create: true });
    const stream = await handle.createWritable();
    await stream.write(JSON.stringify({ '新集': [{ text: '另一本诗集', title: '', author: '', dynasty: '', url: '' }] }));
    await stream.close();
    (window as any).showOpenFilePicker = async () => [handle];
    localStorage.setItem('test-request-result', 'denied');
  });
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON 诗集', exact: true }).click();
  await page.getByLabel('替换当前诗集').check(); await page.locator('#backup-current').uncheck();
  await page.getByRole('button', { name: '打开诗集', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('等待文件授权');
  await expect.poll(() => checkpoint(page)).toContain('另一本诗集');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('等待文件授权');
  await page.evaluate(() => localStorage.setItem('test-request-result', 'granted'));
  await page.getByRole('button', { name: '恢复文件访问', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('已连接 imported.json');
  await add(page, '导入后继续写入');
  await expect(page.locator('#save-status')).toContainText('已写入 imported.json');
  expect(await disk(page, 'imported.json')).toContain('导入后继续写入');
  expect(await disk(page)).not.toContain('导入后继续写入');
});

test('forgetting the binding and opening another HTML do not reconnect the old file', async ({ page }) => {
  await bound(page); const before = await disk(page);
  await ready(page, '/another-copy.html');
  await expect(page.locator('#save-status')).toContainText('本地诗集');
  await expect(page.locator('#total-count')).toHaveText(String(count).padStart(2, '0'));
  await ready(page); await settings(page);
  await page.getByRole('button', { name: '取消记住保存文件', exact: true }).click();
  await expect.poll(() => checkpoint(page)).toBeNull();
  await page.reload(); await expect(page.locator('#save-status')).not.toContainText('正在恢复');
  await settings(page); await expect(page.locator('#save-file-name')).toContainText('首次收录');
  expect(await disk(page)).toBe(before);
});

test('edits made while a saved handle is being restored are not lost', async ({ page, context }) => {
  await bound(page);
  await context.addInitScript(() => {
    const proto = FileSystemFileHandle.prototype, original = proto.getFile;
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    (window as any).releaseRestore = release;
    proto.getFile = async function() { (window as any).restoreReading = true; await blocked; return original.call(this); };
  });
  await page.reload(); await expect.poll(() => page.evaluate(() => (window as any).restoreReading)).toBe(true);
  await add(page, '恢复连接期间的新句');
  await page.evaluate(() => (window as any).releaseRestore());
  await expect(page.locator('#save-status')).toContainText('已写入 remembered.json');
  expect(await disk(page)).toContain('恢复连接期间的新句');
  expect(await page.evaluate(() => localStorage.getItem('test-picker-count'))).toBe('1');
});

test('file URLs restore a real external file handle after the browser process restarts', async ({ playwright }) => {
  const dir = await mkdtemp(join(tmpdir(), 'echoes-native-file-'));
  const pagePath = join(dir, '余韵 测试.html'), filePath = join(dir, '诗集 测试.json');
  const data = JSON.stringify(seed.collection);
  await writeFile(pagePath, html); await writeFile(filePath, data);
  const options = { channel: process.env.ECHOES_BROWSER_CHANNEL || 'msedge', headless: true };
  let context = await playwright.chromium.launchPersistentContext(join(dir, 'profile'), options);
  try {
    const page = await context.newPage(); await page.goto(pathToFileURL(pagePath).href);
    await expect(page.locator('#save-status')).not.toContainText('正在恢复');
    // A native drag gives the test a real disk handle without clicking an OS
    // permission prompt. Seed a previous binding to exercise browser restoration.
    await page.evaluate(() => {
      localStorage.setItem('echoes.search.v2', JSON.stringify({ openingAnimation: false, autoSearch: false }));
      window.addEventListener('dragover', event => event.preventDefault());
      window.addEventListener('drop', async event => {
        event.preventDefault();
        (window as any).nativeTestHandle = await (event.dataTransfer!.items[0] as any).getAsFileSystemHandle();
      });
    });
    const cdp = await context.newCDPSession(page);
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', {
      type, x: 100, y: 150, data: { items: [], files: [filePath], dragOperationsMask: 1 },
    });
    await page.waitForFunction(() => (window as any).nativeTestHandle);
    await page.evaluate(async expectedText => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('echoes-file-bindings', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
      const snapshot = JSON.parse(document.getElementById('app-snapshot')!.textContent!);
      try { await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite');
        transaction.objectStore('files').put({ handle: (window as any).nativeTestHandle, expectedText }, `echoes.collection.v1:${snapshot.id}:${location.pathname}`);
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      }); } finally { db.close(); }
    }, data);
    await context.close();
    context = await playwright.chromium.launchPersistentContext(join(dir, 'profile'), options);
    const reopened = await context.newPage(); let pickers = 0;
    await reopened.exposeFunction('unexpectedPicker', () => { pickers++; });
    await reopened.addInitScript(() => { (window as any).showSaveFilePicker = () => { void (window as any).unexpectedPicker(); throw new Error('Must reuse the stored handle'); }; });
    await reopened.goto(pathToFileURL(pagePath).href);
    await expect(reopened.locator('#save-status')).toContainText('等待文件授权');
    await expect(reopened.getByRole('button', { name: '恢复文件访问', exact: true })).toBeVisible();
    await settings(reopened); await expect(reopened.locator('#save-file-name')).toHaveText('诗集 测试.json');
    expect(pickers).toBe(0); expect(await readFile(filePath, 'utf8')).toBe(data);
  } finally { await context.close(); await rm(dir, { recursive: true, force: true }); }
});
