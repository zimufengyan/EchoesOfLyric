import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlPath = resolve('test-results/browser-fixtures/余韵.html');
const fileURL = pathToFileURL(htmlPath).href;
const initialCollection = JSON.parse(await readFile('tests/fixtures/anthology.json', 'utf8'));
const builtHTML = await readFile('dist/echoes_of_lyric.html', 'utf8');
const initialHTML = builtHTML.replace(/(<script type="application\/json" id="app-snapshot">).*?(<\/script>)/s,
  (_match, start, end) => start + JSON.stringify({ version: 1, id: 'echoes-browser-test-v1', collection: initialCollection, category: '帅' }) + end);
test.beforeAll(async () => {
  await mkdir('test-results/browser-fixtures', { recursive: true });
  await writeFile(htmlPath, initialHTML);
});
const initialCount = Object.values(initialCollection).flat().length;
const total = (extra = 0) => String(initialCount + extra).padStart(2, '0');
async function enterWorkspace(page: Page) {
  if (await page.locator('#opening').count()) await page.getByRole('button', { name: '跳过开屏', exact: true }).click();
}
async function openFresh(page: Page) {
  await page.addInitScript(() => { localStorage.clear(); const picker = (window as any).showSaveFilePicker; if (picker && picker.toString().includes('[native code]')) (window as any).showSaveFilePicker = undefined; });
  await page.route('https://api.tavily.com/usage', route => route.fulfill({ json: { account: { plan_usage: 23, plan_limit: 1000 } }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto(fileURL);
  await enterWorkspace(page);
}
async function addManual(page: Page, text = '春水碧于天，画船听雨眠') {
  await enterWorkspace(page);
  await page.getByLabel('诗词节选', { exact: true }).fill(text);
  await page.locator('#title').fill('菩萨蛮');
  await page.locator('#author').fill('韦庄');
  await page.locator('#dynasty').fill('唐');
  await page.getByRole('button', { name: '收入诗集', exact: true }).click();
}
async function more(page: Page, name: string) { await page.getByRole('button', { name: '更多操作', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); }
const searchResult = (text: string, title: string, author: string) => ({ title: `${title}原文`, content: `“${text}”出自唐代诗人${author}的《${title}》。`, url: `https://poetry.example/${encodeURIComponent(title)}` });

test('single HTML works offline with a compact showcase and accessible icon controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.context().setOffline(true);
  await openFresh(page);
  await expect(page.locator('#total-count')).toHaveText(total());
  const box = await page.locator('.showcase').boundingBox();
  const workbench = await page.locator('.workbench').boundingBox();
  expect(box!.width).toBe(workbench!.width); expect(box!.height).toBeGreaterThanOrEqual(96); expect(box!.height).toBeLessThanOrEqual(128);
  await expect(page.getByText('偶遇一笺')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的诗集', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '设置', exact: true })).toHaveCount(1);
  await expect(page.locator('#draft-hint, #source-state, .meta-top')).toHaveCount(0);
  await expect(page.locator('.showcase-actions')).toHaveText('');
  await page.getByRole('button', { name: '暂停自动轮换', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续自动轮换', exact: true })).toBeVisible();
  const before = await page.locator('#showcase-text').textContent();
  await page.getByRole('button', { name: '换一句', exact: true }).click();
  await expect(page.locator('#showcase-text')).not.toHaveText(before!);
  await page.waitForTimeout(250);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('add, edit, move, delete and JSON export preserve the anthology', async ({ page }) => {
  await openFresh(page); await addManual(page);
  await expect(page.locator('#total-count')).toHaveText(total(1));
  await expect(page.locator('#save-status')).toContainText('待保存');
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索诗集' }).fill('春水');
  await page.getByRole('button', { name: '编辑摘录', exact: true }).click();
  await page.locator('#title').fill('菩萨蛮·人人尽说江南好');
  await page.getByRole('button', { name: '保存摘录修改', exact: true }).click();
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await page.getByRole('button', { name: '移动到其他分类', exact: true }).click();
  await page.locator('#move-destination').selectOption('痛');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await expect(page.locator('.library-category')).toHaveText('痛');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await more(page, '导出 JSON 副本');
  const download = await downloadPromise;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const moved = data['痛'].find((entry: { text: string }) => entry.text === '春水碧于天，画船听雨眠');
  expect(moved.title).toBe('菩萨蛮·人人尽说江南好');
  expect(moved.url).toBe('');
  expect(Object.keys(moved)).toEqual(['text', 'title', 'author', 'dynasty', 'url']);
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await page.getByRole('button', { name: '删除摘录', exact: true }).click();
  await page.getByRole('button', { name: '删除这则摘录', exact: true }).click();
  await expect(page.locator('#total-count')).toHaveText(total());
});

test('category rename, reordering and migration keep excerpts', async ({ page }) => {
  await openFresh(page);
  await page.getByRole('button', { name: '新建分类', exact: true }).click();
  await page.locator('#category-name').fill('念'); await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: '管理分类：念', exact: true }).click();
  await page.getByRole('button', { name: '编辑分类名称', exact: true }).click();
  await page.locator('#category-name').fill('远'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '管理分类：远', exact: true }).click(); await page.getByRole('button', { name: '上移分类', exact: true }).click();
  const names = await page.locator('.category-name').allTextContents(); expect(names).toEqual(['帅', '痛', '远', '怒']);
  await page.getByRole('button', { name: '管理分类：怒', exact: true }).click(); await page.getByRole('button', { name: '删除分类', exact: true }).click();
  await page.locator('#delete-destination').selectOption('远'); await page.getByRole('button', { name: '迁移并删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '分类：怒', exact: true })).toHaveCount(0); await expect(page.locator('#total-count')).toHaveText(total());
});

test('file writes report permission failure honestly and retain edits', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'denied.json', getFile: async () => new File([''], 'denied.json'), createWritable: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  });
  await openFresh(page); await addManual(page);
  await expect(page.locator('#save-status')).toContainText('等待文件授权'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error'); await expect(page.locator('#total-count')).toHaveText(total(1));
});

test('portable HTML retains latest data at a new Unicode path and excludes secrets', async ({ page, browser }) => {
  await openFresh(page); await addManual(page, '</script><script>window.compromised=true</script> 春水');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#search-api-key').fill('PRIVATE_TEST_KEY_SHOULD_NOT_EXPORT');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await more(page, '导出便携 HTML'); const download = await downloadPromise;
  const exported = await readFile((await download.path())!, 'utf8'); expect(exported).not.toContain('PRIVATE_TEST_KEY_SHOULD_NOT_EXPORT');
  await mkdir('test-results/中文 空格', { recursive: true });
  const target = resolve('test-results/中文 空格/我的诗集.html'); await copyFile((await download.path())!, target);
  const context = await browser.newContext(); const reopened = await context.newPage(); await reopened.goto(pathToFileURL(target).href);
  await expect(reopened.locator('#total-count')).toHaveText(total(1)); expect(await reopened.evaluate(() => (window as any).compromised)).toBeUndefined();
  await context.close();
});

test('network candidates fill metadata, highlight typos and preserve entered text', async ({ page }) => {
  await openFresh(page);
  await page.route('https://api.tavily.com/search', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'content-type,authorization' } });
    await route.fulfill({ json: { results: [searchResult('十四万人齐解甲，更无一个是男儿！', '述国亡诗', '花蕊夫人'), searchResult('十四万人齐解甲，更无一个是男儿。', '述亡国诗', '花蕊夫人')] }, headers: { 'Access-Control-Allow-Origin': 'null' } });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.locator('#search-api-key').fill('test-token'); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#text').fill('十四万人弃卸甲'); await expect(page.locator('.candidate-card')).toHaveCount(2);
  await expect(page.locator('.candidate-card').first().locator('mark')).not.toHaveCount(0);
  await page.getByRole('button', { name: '选择出处：花蕊夫人《述国亡诗》', exact: true }).click();
  await expect(page.locator('#text')).toHaveValue('十四万人弃卸甲'); await expect(page.locator('#author')).toHaveValue('花蕊夫人');
  await expect(page.locator('#url')).toHaveValue('');
  await page.locator('.candidate-card').first().getByRole('button', { name: '采用原文作为节选', exact: true }).click();
  await expect(page.locator('#text')).toHaveValue('十四万人齐解甲，更无一个是男儿！');
  await page.screenshot({ path: 'artifacts/candidates.png', fullPage: true });
});

test('slow previous responses cannot overwrite new text', async ({ page }) => {
  await openFresh(page); let firstStarted = false;
  await page.route('https://api.tavily.com/search', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'content-type,authorization' } });
    const text = route.request().postDataJSON().query.split(' ')[0];
    if (text === '旧的诗句') { firstStarted = true; await new Promise(resolve => setTimeout(resolve, 1200)); }
    try { await route.fulfill({ json: { results: [searchResult(text, text === '旧的诗句' ? '旧作品' : '新作品', '李白')] }, headers: { 'Access-Control-Allow-Origin': 'null' } }); } catch { /* aborted request */ }
  });
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.locator('#search-api-key').fill('test-token'); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#text').fill('旧的诗句'); await expect.poll(() => firstStarted).toBe(true);
  await page.locator('#text').fill('新的诗句'); await expect(page.locator('#title')).toHaveValue('新作品');
  await page.waitForTimeout(1300); await expect(page.locator('#title')).toHaveValue('新作品');
});

test('narrow layout and long passages have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await openFresh(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  await addManual(page, '长风破浪会有时，直挂云帆济沧海。'.repeat(15));
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.locator('#show-current-only').check(); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const anonymousIcons = await page.locator('button.icon-button').evaluateAll(buttons => buttons.filter(button => !button.getAttribute('aria-label')).length); expect(anonymousIcons).toBe(0);
});

test('JSON import previews merge, skips duplicates and preserves current draft', async ({ page }) => {
  await openFresh(page);
  await page.locator('#text').fill('尚未收入诗集的草稿');
  const incoming = JSON.stringify({ '念': [{ text: '山中何事，松花酿酒，春水煎茶', title: '人月圆', author: '张可久', dynasty: '元', url: '' }] });
  await page.locator('#file-input').setInputFiles({ name: '诗集.json', mimeType: 'application/json', buffer: Buffer.from(incoming) });
  await expect(page.locator('.form-note')).toContainText('新增 1 则');
  await page.getByRole('button', { name: '打开诗集', exact: true }).click();
  await expect(page.locator('#total-count')).toHaveText(total(1)); await expect(page.locator('#text')).toHaveValue('尚未收入诗集的草稿');
  await page.locator('#file-input').setInputFiles({ name: '诗集.json', mimeType: 'application/json', buffer: Buffer.from(incoming) });
  await expect(page.locator('.form-note')).toContainText('跳过 1 则');
  await page.getByRole('button', { name: '打开诗集', exact: true }).click(); await expect(page.locator('#total-count')).toHaveText(total(1));
});

test('binding a JSON file saves subsequent changes automatically', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).savedJSON = '';
    (window as any).showSaveFilePicker = async () => ({ name: 'poems.json', getFile: async () => new File([(window as any).savedJSON], 'poems.json'), createWritable: async () => {
      let next = '';
      return { write: async (content: string) => { next = content; }, close: async () => { (window as any).savedJSON = next; } };
    } });
  });
  await openFresh(page);
  await addManual(page);
  await expect(page.locator('#save-status')).toContainText('已写入 poems.json');
  await expect.poll(() => page.evaluate(() => Object.values(JSON.parse((window as any).savedJSON)).flat().length)).toBe(initialCount + 1);
});

test('draft restores after reload and an empty anthology remains usable', async ({ page }) => {
  await page.goto(fileURL); await enterWorkspace(page);
  await page.locator('#text').fill('江南无所有，聊赠一枝春'); await page.locator('#author').fill('陆凯');
  await page.reload(); await enterWorkspace(page); await expect(page.locator('#text')).toHaveValue('江南无所有，聊赠一枝春'); await expect(page.locator('#author')).toHaveValue('陆凯');
  await page.locator('#file-input').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByLabel('替换当前诗集').check(); await page.locator('#backup-current').uncheck();
  await page.getByRole('button', { name: '打开诗集', exact: true }).click();
  await expect(page.locator('#total-count')).toHaveText('00'); await expect(page.locator('#showcase-text')).toContainText('还没有摘录');
  await page.getByRole('button', { name: '收入诗集', exact: true }).click(); await expect(page.locator('#modal-title')).toHaveText('新建分类');
});

test('automatic rotation honors pause and reduced motion', async ({ page }) => {
  await page.clock.install(); await page.emulateMedia({ reducedMotion: 'reduce' }); await openFresh(page);
  const initial = await page.locator('#showcase-text').textContent();
  await page.clock.fastForward(61000); await expect(page.locator('#showcase-text')).not.toHaveText(initial!);
  await page.getByRole('button', { name: '暂停自动轮换', exact: true }).click(); const paused = await page.locator('#showcase-text').textContent();
  await page.clock.fastForward(61000); await expect(page.locator('#showcase-text')).toHaveText(paused!);
  await page.getByRole('button', { name: '继续自动轮换', exact: true }).click(); await page.clock.fastForward(61000); await expect(page.locator('#showcase-text')).not.toHaveText(paused!);
});

test('settings show live usage and retain no stale quota on errors', async ({ page }) => {
  await openFresh(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#modal-title')).toHaveText('设置');
  await expect(page.getByText('每月 1,000 个免费额度', { exact: false })).toHaveCount(0);
  await page.locator('#search-api-key').fill('quota-test');
  await page.getByRole('button', { name: '刷新 API 额度', exact: true }).click();
  await expect(page.locator('#usage-value')).toHaveText('23 / 1,000');
  await page.screenshot({ path: 'artifacts/settings.png', fullPage: true });
  await page.route('https://api.tavily.com/usage', route => route.fulfill({ status: 401 }));
  await page.getByRole('button', { name: '刷新 API 额度', exact: true }).click();
  await expect(page.locator('#usage-value')).toHaveText('— / —');
  await expect(page.locator('#usage-detail')).toHaveText('API Key 无效');
});

test('Enter searches, Shift Enter inserts a line and source domains determine automatic URLs', async ({ page }) => {
  await openFresh(page); let requests = 0;
  const source = 'https://m.gushiwen.cn/mingju/juv_test.aspx';
  await page.route('https://api.tavily.com/search', route => {
    requests++;
    const text = route.request().postDataJSON().query.split(' ')[0];
    return route.fulfill({ json: { results: [{ ...searchResult(text, '绝句', '杜甫'), url: source }] } });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#search-api-key').fill('test-key'); await page.locator('#auto-search').uncheck();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#text').fill('窗含西岭千秋雪'); await page.waitForTimeout(800); expect(requests).toBe(0);
  await page.locator('#text').press('Enter');
  await expect(page.locator('#url')).toHaveValue(source); await expect(page.locator('.candidate-domain')).toHaveText('m.gushiwen.cn');
  await expect(page.locator('#text')).toHaveValue('窗含西岭千秋雪');
  await page.locator('#text').press('Shift+Enter'); await page.locator('#text').pressSequentially('门泊东吴万里船');
  await expect(page.locator('#text')).toHaveValue('窗含西岭千秋雪\n门泊东吴万里船'); expect(requests).toBe(1);
  await page.locator('#text').evaluate(node => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await page.waitForTimeout(100); expect(requests).toBe(1);
  await page.locator('#url').fill('https://example.com/manual-poem');
  await page.getByRole('button', { name: '收入诗集', exact: true }).click();
  const downloading = page.waitForEvent('download'); await more(page, '导出 JSON 副本');
  const downloaded = await downloading;
  const data = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(data['帅'].at(-1).url).toBe('https://example.com/manual-poem');
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索诗集' }).fill('窗含西岭');
  await page.getByRole('button', { name: '编辑摘录', exact: true }).click();
  await expect(page.locator('#url')).toHaveValue('https://example.com/manual-poem');
});

test('both Enter shortcut modes survive reload and preserve their newline behavior', async ({ page }) => {
  await page.goto(fileURL); await enterWorkspace(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#search-key option')).toHaveCount(2);
  await page.locator('#search-key').selectOption('shift-enter'); await page.locator('#auto-search').uncheck();
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.reload(); await enterWorkspace(page);
  await page.locator('#text').fill('他年我若为青帝');
  await page.locator('#text').press('Enter'); await expect(page.locator('#text')).toHaveValue('他年我若为青帝\n');
  await expect(page.locator('#author')).toHaveValue('');
  await page.locator('#text').press('Shift+Enter'); await expect(page.locator('#author')).toHaveValue('黄巢');
  await expect(page.locator('#text')).toHaveValue('他年我若为青帝\n');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#search-key')).toHaveValue('shift-enter');
  await page.locator('#search-key').selectOption('enter'); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#text').fill('他年我若为青帝'); await page.locator('#text').press('Shift+Enter');
  await expect(page.locator('#text')).toHaveValue('他年我若为青帝\n');
  await page.locator('#text').press('Enter'); await expect(page.locator('#author')).toHaveValue('黄巢');
  await expect(page.locator('#text')).toHaveValue('他年我若为青帝\n');
});

test('collecting continues while file writes wait and only one file picker is needed', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as any; state.savedJSON = ''; state.writes = []; state.pickCount = 0; state.activeWrites = 0; state.maxWrites = 0;
    let release: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); state.releaseWrite = () => release();
    state.showSaveFilePicker = async () => { state.pickCount++; return { name: 'queued.json', getFile: async () => new File([state.savedJSON], 'queued.json'), createWritable: async () => {
      state.activeWrites++; state.maxWrites = Math.max(state.maxWrites, state.activeWrites); let content = '';
      return { write: async (text: string) => { content = text; }, close: async () => { await wait; state.savedJSON = content; state.writes.push(content); state.activeWrites--; } };
    } }; };
  });
  await openFresh(page); await addManual(page, '第一则追加诗句');
  await expect.poll(() => page.evaluate(() => (window as any).activeWrites)).toBe(1);
  await addManual(page, '第二则追加诗句'); await expect(page.locator('#total-count')).toHaveText(total(2));
  await expect(page.locator('#text')).toHaveValue(''); await expect(page.locator('#save-status')).toContainText('正在写入');
  await page.evaluate(() => (window as any).releaseWrite());
  await expect(page.locator('#save-status')).toContainText('已写入 queued.json');
  const data = await page.evaluate(() => ({ picks: (window as any).pickCount, max: (window as any).maxWrites, writes: (window as any).writes.map((text: string) => Object.values(JSON.parse(text)).flat().length) }));
  expect(data).toEqual({ picks: 1, max: 1, writes: [initialCount + 1, initialCount + 2] });
});

test('the embedded worker writes native file handles and serializes the latest anthology', async ({ page }) => {
  const { createServer } = await import('node:http');
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(initialHTML); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number }; let workers = 0; page.on('worker', () => workers++);
  try {
    await page.addInitScript(() => {
      const NativeWorker = Worker; (window as any).workerReplies = [];
      (window as any).Worker = class extends NativeWorker { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.addEventListener('message', event => { if (typeof event.data.content === 'string') (window as any).workerReplies.push(event.data.content); }); } };
      (window as any).showSaveFilePicker = async () => {
        const directory = await navigator.storage.getDirectory();
        return directory.getFileHandle('worker-poems.json', { create: true });
      };
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await addManual(page, '后台线程保存第一句'); await addManual(page, '后台线程保存第二句');
    await expect(page.locator('#save-status')).toContainText('已写入 worker-poems.json');
    const entries = await page.evaluate(async () => {
      const directory = await navigator.storage.getDirectory();
      const file = await (await directory.getFileHandle('worker-poems.json')).getFile();
      return Object.values(JSON.parse(await file.text())).flat() as { text: string }[];
    });
    expect(workers).toBe(1); expect(entries).toHaveLength(initialCount + 2);
    const workerSavedCount = await page.evaluate(() => Object.values(JSON.parse((window as any).workerReplies.at(-1))).flat().length);
    expect(workerSavedCount).toBe(initialCount + 2);
    expect(entries.some(entry => entry.text === '后台线程保存第二句')).toBe(true);
  } finally { await page.goto('about:blank'); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('long press reorders categories on release, with click selection and cancellation intact', async ({ page }) => {
  await openFresh(page);
  const initial = await page.locator('.category-name').allTextContents();
  await page.getByRole('button', { name: '分类：痛', exact: true }).click();
  await expect(page.locator('#editor-category')).toHaveText('痛');
  expect(await page.locator('.category-name').allTextContents()).toEqual(initial);
  const source = await page.getByRole('button', { name: '分类：帅', exact: true }).boundingBox();
  const target = await page.getByRole('button', { name: '分类：怒', exact: true }).boundingBox();
  await page.mouse.move(source!.x + 35, source!.y + source!.height / 2); await page.mouse.down();
  await page.waitForTimeout(410); await expect(page.locator('.category-drag-ghost')).toHaveCount(1);
  await page.mouse.move(target!.x + 35, target!.y + target!.height + 8, { steps: 12 });
  await page.mouse.up();
  expect(await page.locator('#category-list .category-name').allTextContents()).toEqual(['痛', '怒', '帅']);
  await expect(page.locator('#editor-category')).toHaveText('痛');
  await expect(page.locator('.category-drag-ghost')).toHaveCount(0);
  const download = page.waitForEvent('download'); await more(page, '导出 JSON 副本');
  const data = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(Object.keys(data)).toEqual(['痛', '怒', '帅']); expect(Object.values(data).flat()).toHaveLength(initialCount);
  const last = await page.getByRole('button', { name: '分类：帅', exact: true }).boundingBox();
  const first = await page.getByRole('button', { name: '分类：痛', exact: true }).boundingBox();
  await page.mouse.move(last!.x + 35, last!.y + 20); await page.mouse.down(); await page.waitForTimeout(410);
  await page.mouse.move(first!.x + 35, first!.y - 5, { steps: 10 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.locator('#category-list .category-name').allTextContents()).toEqual(['痛', '怒', '帅']);
  await page.getByRole('button', { name: '分类：帅', exact: true }).click();
  await expect(page.locator('#editor-category')).toHaveText('帅');
});

test('library pagination keeps item identity after filtering, editing and deleting the last page', async ({ page }) => {
  await openFresh(page);
  const collection = { '分页': Array.from({ length: 11 }, (_, index) => ({ text: `分页诗句第${String(index + 1).padStart(2, '0')}则，清风拂过松间月`, title: `作品${index + 1}`, author: index < 6 ? '甲作者' : '乙作者', dynasty: '唐', url: '' })) };
  await page.locator('#file-input').setInputFiles({ name: 'pages.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(collection)) });
  await page.getByLabel('替换当前诗集').check(); await page.locator('#backup-current').uncheck();
  await page.getByRole('button', { name: '打开诗集', exact: true }).click();
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await page.locator('#library-page-size').selectOption('5');
  await expect(page.locator('.library-entry')).toHaveCount(5); await expect(page.locator('#library-page-info')).toHaveText('1 / 3');
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  const typography = await page.locator('.library-entry').first().evaluate(node => ({ text: parseFloat(getComputedStyle(node.querySelector('.library-text')!).fontSize), source: parseFloat(getComputedStyle(node.querySelector('.library-source')!).fontSize) }));
  expect(typography.text).toBeGreaterThanOrEqual(16); expect(typography.source).toBeLessThan(typography.text / 1.6);
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.locator('.library-text').first()).toContainText('第06则');
  await page.locator('.library-entry').first().getByRole('button', { name: '编辑摘录', exact: true }).click();
  await page.locator('#title').fill('第六则已编辑'); await page.getByRole('button', { name: '保存摘录修改', exact: true }).click();
  await page.getByRole('button', { name: '我的诗集', exact: true }).click();
  await expect(page.locator('#library-page-info')).toHaveText('2 / 3'); await expect(page.locator('.library-source').first()).toContainText('第六则已编辑');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.library-text')).toContainText('第11则'); await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除摘录', exact: true }).click(); await page.getByRole('button', { name: '删除这则摘录', exact: true }).click();
  await expect(page.locator('#library-page-info')).toHaveText('2 / 2'); await expect(page.locator('.library-entry')).toHaveCount(5);
  await page.getByRole('textbox', { name: '搜索诗集' }).fill('甲作者');
  await expect(page.locator('#library-page-info')).toHaveText('1 / 2');
  await page.getByRole('textbox', { name: '搜索诗集' }).fill('没有结果');
  await expect(page.locator('#library-page-info')).toHaveText('0 / 0'); await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '搜索诗集' }).fill(''); await page.locator('#library-page-size').selectOption('10');
  await expect(page.locator('.library-entry')).toHaveCount(10); await expect(page.locator('#library-page-info')).toHaveText('1 / 1');
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 12000 });
  await page.screenshot({ path: 'artifacts/library.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  const pagination = await page.locator('.library-pagination').boundingBox();
  expect(pagination!.x + pagination!.width).toBeLessThanOrEqual(390); expect(pagination!.y + pagination!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'artifacts/library-mobile.png', fullPage: true, animations: 'disabled' });
});
