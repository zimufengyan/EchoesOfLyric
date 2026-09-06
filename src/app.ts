import { countEntries, duplicateIndex, escapeEmbeddedJSON, mergeCollections, moveCategory, parseCollection, renameCategory, serializeCollection, validateCollection } from '../shared/collection';
import { diffCharacters, normalize, rankCandidates } from '../shared/matching';
import { automaticCandidate, searchWeb } from '../shared/search';
import { fetchUsage } from '../shared/usage';
import { guwendaoSource, safeSource, sourceDomain } from '../shared/source';
import { emptyExcerpt, fields, type Candidate, type Collection, type Excerpt, type Snapshot } from '../shared/types';
import { escapeHTML as e, icon, iconButton as ib } from './icons';
import { bindCategoryDrag } from './category-drag';
import { playOpening } from './opening';
import { downloadFile, errorMessage, FileWriter, isCancellation, jsonFileType, readCache, writeCache, type FilePickers, type ManagedFileHandle } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pristine = document.documentElement.cloneNode(true) as HTMLElement;
const seed = JSON.parse($('app-snapshot').textContent!) as Snapshot;
const cacheKey = `echoes.collection.v1:${seed.id}:${location.pathname}`;
interface CachedState { collection: Collection; category: string; draft: Excerpt; dirty: boolean; editing: { category: string; index: number } | null }
interface Settings { apiKey: string; currentCategoryOnly: boolean; searchKey: 'enter' | 'shift-enter'; autoSearch: boolean; openingAnimation: boolean }
let settings: Settings = { apiKey: '', currentCategoryOnly: false, searchKey: 'enter', autoSearch: true, openingAnimation: true, ...readCache<Settings>('echoes.search.v2') };
if (!['enter', 'shift-enter'].includes(settings.searchKey)) settings.searchKey = 'enter';
settings.openingAnimation = settings.openingAnimation !== false;
const searchCache = new Map<string, { at: number; items: Candidate[] }>();
let collection = validateCollection(seed.collection);
let category = seed.category;
let draft = emptyExcerpt();
let editing: { category: string; index: number } | null = null;
let dirty = false;
let revision = 0;
let generation = 0;
let cacheOK = true;
let saveMode: 'seed' | 'dirty' | 'saving' | 'saved' | 'exported' | 'error' = 'seed';
let writer: FileWriter | null = null;
let selectingFile = false;
let candidates: Candidate[] = [];
let candidatesLocal = false;
let selectedCandidate = -1;
let queryTimer: ReturnType<typeof setTimeout> | undefined;
let queryAbort: AbortController | undefined;
let queryVersion = 0;
let composing = false;
let autoMetadata = false;
let paused = false;
let cycleTimer: ReturnType<typeof setInterval> | undefined;
let showcaseTimer: ReturnType<typeof setTimeout> | undefined;
let showcaseEntry: Excerpt | null = null;
let libraryQuery = '';
let libraryCategory = '';
let libraryPage = 1;
const pageSizes = [5, 10, 20, 50];
const storedPageSize = readCache<number>('echoes.library.page-size.v1');
let libraryPageSize = storedPageSize && pageSizes.includes(storedPageSize) ? storedPageSize : 10;
let modalCleanup: (() => void) | undefined;
const cached = readCache<CachedState>(cacheKey);
if (cached) {
  try {
    collection = validateCollection(cached.collection);
    category = cached.category;
    draft = Object.fromEntries(fields.map(field => [field, typeof cached.draft?.[field] === 'string' ? cached.draft[field] : ''])) as unknown as Excerpt;
    editing = cached.editing && collection[cached.editing.category]?.[cached.editing.index] ? cached.editing : null;
    dirty = cached.dirty || serializeCollection(collection) !== serializeCollection(seed.collection);
    saveMode = dirty ? 'dirty' : 'seed';
  } catch { /* A damaged cache must not prevent opening the embedded anthology. */ }
}
if (!Object.hasOwn(collection, category)) category = Object.keys(collection)[0] ?? '';

function persist(): void {
  cacheOK = writeCache(cacheKey, { collection, category, draft, dirty, editing });
  renderSaveState();
}

function renderSaveState(): void {
  const node = $('save-status');
  const labels = { seed: '本地诗集', dirty: cacheOK ? '浏览器暂存 · 待保存' : '待保存', saving: '正在写入…', saved: `已写入 ${writer?.handle.name ?? 'JSON'}`, exported: '已导出副本', error: '写入失败 · 待保存' };
  node.dataset.state = saveMode === 'error' ? 'error' : dirty ? 'dirty' : 'saved';
  node.querySelector('span')!.textContent = labels[saveMode];
  node.title = labels[saveMode];
}

function toast(message: string, error = false, undo?: () => void, actionLabel = '撤销'): void {
  const node = document.createElement('div');
  node.className = 'toast' + (error ? ' error' : '');
  const text = document.createElement('span');
  text.textContent = message;
  node.append(text);
  if (undo) {
    const button = document.createElement('button');
    button.textContent = actionLabel;
    button.onclick = () => { undo(); node.remove(); };
    node.append(button);
  }
  $('toast-region').append(node);
  setTimeout(() => node.remove(), undo ? 8500 : error ? 6500 : 3800);
}

function changeCollection(): void {
  revision++;
  dirty = true;
  saveMode = 'dirty';
  renderCategories();
  renderStats();
  ensureShowcase();
  persist();
  if (writer) void writeBoundFile();
}

async function writeBoundFile(): Promise<void> {
  if (!writer) return;
  const target = writer, version = revision, epoch = generation;
  saveMode = 'saving'; renderSaveState();
  try {
    await target.write(collection);
    if (writer !== target || generation !== epoch) return;
    if (version === revision) { dirty = false; saveMode = 'saved'; persist(); }
  } catch (error) {
    if (writer !== target || generation !== epoch) return;
    dirty = true; saveMode = 'error'; persist(); toast(errorMessage(error), true);
  }
}

async function saveJSON(forceNew = false): Promise<void> {
  if (writer && !forceNew) { await writeBoundFile(); return; }
  if (selectingFile) return;
  const picker = (window as unknown as FilePickers).showSaveFilePicker;
  if (!picker) { exportJSON(); return; }
  selectingFile = true;
  try {
    const handle = await picker.call(window, { suggestedName: 'echoes_of_lyric.json', types: jsonFileType });
    const initialText = await (await handle.getFile()).text();
    writer?.detach(); writer = new FileWriter(handle, initialText); generation++;
    await writeBoundFile();
  } catch (error) {
    if (isCancellation(error)) return;
    toast(errorMessage(error), true);
    openModal('下载保存', `<p>这个浏览器暂时无法直接写入文件。你可以下载 JSON 副本保存当前诗集。</p><div class="modal-actions"><button class="text-button" data-action="close">取消</button><button class="text-button primary" id="fallback-download">${icon('download')}下载 JSON</button></div>`);
    $('fallback-download').onclick = () => { exportJSON(); closeModal(); };
  } finally { selectingFile = false; }
}

function exportJSON(filename = 'echoes_of_lyric.json', markSaved = true): void {
  downloadFile(filename, serializeCollection(collection), 'application/json;charset=utf-8');
  if (markSaved) { dirty = false; saveMode = 'exported'; persist(); toast('已生成 JSON 副本，请确认浏览器下载完成。'); }
}

function exportHTML(): void {
  const exported = pristine.cloneNode(true) as HTMLElement;
  const id = globalThis.crypto?.randomUUID?.() ?? `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const snapshot: Snapshot = { version: 1, id, collection, category };
  exported.querySelector('#app-snapshot')!.textContent = escapeEmbeddedJSON(snapshot);
  downloadFile('echoes_of_lyric.html', '<!doctype html>\n' + exported.outerHTML, 'text/html;charset=utf-8');
  dirty = false; saveMode = 'exported'; persist();
  toast('已生成含当前诗集的 HTML，连接密钥不会随文件导出。');
}

function renderStats(): void {
  const total = countEntries(collection);
  $('total-count').textContent = String(total).padStart(2, '0');
  $('category-total').textContent = String(Object.keys(collection).length).padStart(2, '0');
  $('entry-number').textContent = String(editing ? editing.index + 1 : (collection[category]?.length ?? 0) + 1).padStart(2, '0');
  $('editor-category').textContent = category || '选择分类';
  $('editor-heading').textContent = editing ? '编辑摘录' : '摘录';
  $('footer-stats').textContent = `${Object.keys(collection).length} 个分类 · ${total} 则摘录 · 本地保存`;
}

function renderCategories(): void {
  $('category-list').innerHTML = Object.entries(collection).map(([name, entries]) => `<div class="category-row"><button class="category-button" title="长按拖动排序" data-category="${e(name)}" aria-current="${name === category}" aria-label="分类：${e(name)}">${icon('bookmark')}<span class="category-name">${e(name)}</span><span class="category-count">${String(entries.length).padStart(2, '0')}</span></button>${ib('more', `管理分类：${name}`, 'category-menu', `data-category-name="${e(name)}" class-placeholder=""`).replace('class="icon-button"', 'class="icon-button category-options"')}</div>`).join('');
  for (const node of $('category-list').querySelectorAll<HTMLButtonElement>('[data-category]')) node.onclick = () => { category = node.dataset.category!; renderCategories(); renderStats(); persist(); if (settings.currentCategoryOnly) showNext(false); };
}

function categoryOptions(selected = category, exclude?: string): string {
  return Object.keys(collection).filter(name => name !== exclude).map(name => `<option value="${e(name)}" ${name === selected ? 'selected' : ''}>${e(name)}</option>`).join('');
}

function invalidateSearch(): void {
  clearTimeout(queryTimer); queryAbort?.abort(); queryVersion++;
}

function syncDraft(): void {
  for (const field of fields) draft[field] = $<HTMLInputElement | HTMLTextAreaElement>(field).value;
  $<HTMLButtonElement>('collect-button').disabled = !draft.text.trim();
  $('character-count').textContent = `${draft.text.length} / 2000`;
  persist();
}

function populateForm(): void {
  for (const field of fields) $<HTMLInputElement | HTMLTextAreaElement>(field).value = draft[field];
  $<HTMLButtonElement>('collect-button').disabled = !draft.text.trim();
  $('collect-button').innerHTML = icon(editing ? 'check' : 'plus');
  $('collect-button').setAttribute('aria-label', editing ? '保存摘录修改' : '收入诗集');
  $('character-count').textContent = `${draft.text.length} / 2000`;
  renderStats();
}

function clearDraft(): void {
  invalidateSearch(); draft = emptyExcerpt(); editing = null; autoMetadata = false; candidates = []; selectedCandidate = -1;
  populateForm(); renderCandidates(); setSearchStatus('');
  
  $('entry-status').textContent = '保留每一次心有所动。'; $('entry-status').classList.remove('error'); persist();
}

function setSearchStatus(message: string, error = false, loading = false): void {
  $('search-status').textContent = message;
  $('search-status').classList.toggle('error', error);
  if (loading) $('search-status').insertAdjacentHTML('beforeend', '<span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>');
  const searchButton = document.querySelector<HTMLButtonElement>('[data-action="search"]');
  if (searchButton) { searchButton.innerHTML = icon(loading ? 'refresh' : 'search', loading ? 'spinning' : ''); searchButton.setAttribute('aria-busy', String(loading)); }
}

async function searchSources(): Promise<void> {
  invalidateSearch();
  const text = draft.text.trim();
  if (normalize(text).length < 2) { candidates = []; renderCandidates(); setSearchStatus(text ? '至少输入两个字，再查找出处。' : ''); return; }
  const version = queryVersion;
  candidates = []; selectedCandidate = -1;
  if (!settings.apiKey) {
    const local = Object.values(collection).flat().map(entry => ({ ...entry, url: '', sourceUrl: entry.url, workKey: `${entry.author}|${entry.title}`, autoFill: !!entry.title && !!entry.author && !!entry.dynasty, score: 0, match: 'similar' as const }));
    candidates = rankCandidates(local, text);
    candidatesLocal = true;
    setSearchStatus(candidates.length ? `诗集中找到 ${candidates.length} 个候选` : '填写搜索 API Key 后，可联网查找出处。');
    renderCandidates();
    const automatic = automaticCandidate(candidates);
    if (automatic) applyCandidate(candidates.indexOf(automatic));
    return;
  }
  queryAbort = new AbortController();
  const controller = queryAbort;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 40000);
  setSearchStatus('正在联网查找出处', false, true);
  renderCandidates('loading');
  try {
    const cacheID = normalize(text);
    const previous = searchCache.get(cacheID);
    const response = previous && Date.now() - previous.at < 300000 ? previous.items : await searchWeb(text, settings.apiKey, controller.signal);
    if (version !== queryVersion) return;
    if (searchCache.size >= 32) searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(cacheID, { at: Date.now(), items: response });
    candidates = response;
    candidatesLocal = false;
    renderConnection(true);
    setSearchStatus(candidates.length ? `找到 ${candidates.length} 个搜索候选 · 请核对出处` : '暂未找到匹配出处，可以缩短片段重试。');
    renderCandidates();
    const automatic = automaticCandidate(candidates);
    if (automatic) applyCandidate(candidates.indexOf(automatic));
  } catch (error) {
    if (version !== queryVersion || (controller.signal.aborted && !timedOut)) return;
    setSearchStatus(timedOut ? '检索超时，草稿已保留。' : errorMessage(error), true);
    renderCandidates('error');
  } finally { clearTimeout(timeout); if (version === queryVersion) document.querySelector('[data-action="search"]')!.innerHTML = icon('search'); }
}

function renderCandidates(mode = ''): void {
  if (!candidates.length) {
    const loading = mode === 'loading', error = mode === 'error';
    $('candidate-list').innerHTML = `<div class="source-empty"><div class="source-illustration">${icon('bookmark')}</div><p>${loading ? '正在翻阅字句' : error ? '出处可以稍后补上' : '为字句，找到来处'}</p><small>${loading ? '查找原句，核对作者与作品' : error ? '草稿已保留，可点击放大镜重试。' : !settings.apiKey ? '在顶部设置中填写 API Key，即可查找。' : '输入诗句后，匹配结果将在这里显示。'}</small></div>`;
    return;
  }
  $('candidate-list').innerHTML = candidates.map((candidate, index) => {
    const difference = candidate.match !== 'exact';
    const text = difference ? diffCharacters(draft.text, candidate.text).map(char => char.changed ? `<mark>${e(char.text)}</mark>` : e(char.text)).join('') : e(candidate.text);
    return `<article class="candidate-card ${selectedCandidate === index ? 'selected' : ''}"><button type="button" class="candidate-select" data-select-candidate="${index}" aria-label="选择出处：${e(candidate.author || '作者待核对')}《${e(candidate.title || candidate.pageTitle || '作品待核对')}》" aria-pressed="${selectedCandidate === index}"><span class="candidate-top"><span class="match-badge">${candidatesLocal ? '诗集内匹配' : difference ? '相似原句' : '原句匹配'}</span>${selectedCandidate === index ? icon('check') : ''}</span><div class="candidate-text">${text}</div><div class="candidate-source">${e(candidate.author || '作者待核对')}${candidate.dynasty ? `〔${e(candidate.dynasty)}〕` : ''}<br>《${e(candidate.title || '作品待核对')}》</div>${!candidate.autoFill && candidate.evidence ? `<p class="candidate-evidence">${e(candidate.evidence.slice(0, 160))}</p>` : ''}</button><div class="candidate-domain">${e(sourceDomain(candidate.sourceUrl ?? '') || '本地诗集')}</div><div class="candidate-bottom"><span class="candidate-action-label">${difference ? '着色处与输入不同' : '文字保持原样'}</span>${ib('external', '打开搜索来源', 'candidate-source', `data-index="${index}" ${candidate.sourceUrl ? '' : 'disabled'}`)}${ib('copy', '采用原文作为节选', 'adopt-text', `data-index="${index}"`)}</div></article>`;
  }).join('');
  for (const button of $('candidate-list').querySelectorAll<HTMLButtonElement>('[data-select-candidate]')) button.onclick = () => { invalidateSearch(); applyCandidate(Number(button.dataset.selectCandidate)); };
}

function applyCandidate(index: number): void {
  const candidate = candidates[index]; if (!candidate) return;
  selectedCandidate = index;
  for (const field of fields.filter(field => field !== 'text')) draft[field] = candidate[field];
  draft.url = guwendaoSource(candidate.sourceUrl ?? '');
  autoMetadata = true;
  populateForm(); renderCandidates(); persist();
}

function collect(): void {
  syncDraft();
  const text = draft.text.trim(); if (!text) return;
  if (!category) { openCategoryEditor(); return; }
  const duplicate = duplicateIndex(collection[category], text, editing?.category === category ? editing.index : -1);
  if (duplicate !== -1) {
    $('entry-status').textContent = `「${category}」中已有这句摘录。`;
    $('entry-status').classList.add('error');
    toast('这个分类已收录相同诗句。', false, () => editEntry(category, duplicate), '打开已有摘录');
    return;
  }
  if (draft.url.trim() && !safeSource(draft.url.trim())) {
    $('entry-status').textContent = '请输入完整的 http 或 https 来源链接。'; $('entry-status').classList.add('error'); $('url').focus(); return;
  }
  const entry = { ...draft, text, url: draft.url.trim() };
  const wasEditing = !!editing;
  if (editing) {
    if (editing.category === category) collection[category][editing.index] = entry;
    else { collection[editing.category].splice(editing.index, 1); collection[category].push(entry); }
  } else collection[category].push(entry);
  clearDraft(); changeCollection();
  toast(wasEditing ? '摘录已更新。' : `已收入「${category}」。`);
  $('text').focus();
  if (!writer && !selectingFile) {
    if ((window as unknown as FilePickers).showSaveFilePicker) void saveJSON();
    else toast('已暂存；这个浏览器需在更多菜单中导出 JSON 保存。');
  }
}

function openModal(title: string, content: string, wide = false): void {
  modalCleanup?.(); modalCleanup = undefined;
  const modal = $<HTMLDialogElement>('modal');
  modal.classList.toggle('wide', wide);
  modal.classList.remove('library-modal');
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${e(title)}</h2>${ib('close', '关闭面板', 'close')}</div><div class="modal-body">${content}</div>`;
  modal.setAttribute('aria-labelledby', 'modal-title');
  if (!modal.open) modal.showModal();
  hideMenu();
}

function closeModal(): void { $<HTMLDialogElement>('modal').close(); modalCleanup?.(); modalCleanup = undefined; }

function confirmAction(title: string, message: string, label: string, callback: () => void, danger = false): void {
  openModal(title, `<p>${e(message)}</p><div class="modal-actions"><button class="text-button" data-action="close">取消</button><button class="text-button ${danger ? 'danger' : 'primary'}" id="confirm-action">${e(label)}</button></div>`);
  $('confirm-action').onclick = () => { closeModal(); callback(); };
}

function openCategoryEditor(name?: string): void {
  openModal(name ? '编辑分类' : '新建分类', `<form id="category-form"><label class="field"><span>分类名称</span><input id="category-name" required maxlength="30" value="${e(name ?? '')}" placeholder="如：念、远、自在" autofocus></label><div class="modal-error" id="category-error"></div><div class="modal-actions"><button type="button" class="text-button" data-action="close">取消</button><button type="submit" class="text-button primary">${icon('check')}${name ? '保存' : '创建'}</button></div></form>`);
  $('category-form').onsubmit = event => {
    event.preventDefault(); const value = $<HTMLInputElement>('category-name').value.trim();
    try {
      if (!value || value.length > 30) throw new Error('名称需要为 1–30 个字符。');
      if (name) {
        collection = renameCategory(collection, name, value);
        if (category === name) category = value;
        if (editing?.category === name) editing.category = value;
      } else {
        if (Object.hasOwn(collection, value)) throw new Error('已有同名分类。');
        Object.defineProperty(collection, value, { value: [], enumerable: true, configurable: true, writable: true }); category = value;
      }
      closeModal(); changeCollection();
    } catch (error) { $('category-error').textContent = errorMessage(error); }
  };
}

function deleteCategory(name: string): void {
  const count = collection[name]?.length ?? 0;
  if (!count) { confirmAction('删除分类', `删除空分类「${name}」？`, '删除', () => finishDeleteCategory(name), true); return; }
  const hasOther = Object.keys(collection).some(key => key !== name);
  openModal('删除分类', `<p>「${e(name)}」中有 ${count} 则摘录。${hasOther ? '可先迁移到其他分类，再删除这个分类。' : '这是唯一的分类，可先新建分类再迁移。'}</p>${hasOther ? `<label class="field"><span>迁移至</span><select id="delete-destination">${categoryOptions('', name)}</select></label>` : ''}<div class="modal-actions"><button class="text-button danger" id="delete-with-entries">连同 ${count} 则摘录删除</button>${hasOther ? '<button class="text-button primary" id="migrate-and-delete">迁移并删除</button>' : '<button class="text-button primary" id="create-before-delete">新建分类</button>'}</div>`);
  if (hasOther) $('migrate-and-delete').onclick = () => {
    const destination = $<HTMLSelectElement>('delete-destination').value;
    collection[destination].push(...collection[name]);
    if (editing?.category === name) { editing.index += collection[destination].length - count; editing.category = destination; }
    finishDeleteCategory(name, destination); closeModal(); toast('摘录已迁移，分类已删除。');
  };
  else $('create-before-delete').onclick = () => openCategoryEditor();
  $('delete-with-entries').onclick = () => confirmAction('确认删除摘录', `将删除「${name}」及其中全部 ${count} 则摘录。此操作会写入当前绑定的 JSON。`, `删除 ${count} 则摘录`, () => finishDeleteCategory(name), true);
}

function finishDeleteCategory(name: string, destination?: string): void {
  delete collection[name];
  if (category === name) category = destination ?? Object.keys(collection)[0] ?? '';
  if (editing?.category === name) clearDraft();
  changeCollection();
}

function openSettings(): void {
  openModal('设置', `<form id="settings-form"><label class="field"><span class="settings-label">Tavily API Key <a class="settings-link" href="https://app.tavily.com" target="_blank" rel="noopener noreferrer">获取 Key ↗</a></span><input id="search-api-key" type="password" value="${e(settings.apiKey)}" placeholder="tvly-…" autocomplete="off" spellcheck="false"></label><div class="usage-row"><span id="usage-label">本月额度</span><span id="usage-value" role="status">— / —</span>${ib('refresh', '刷新 API 额度', 'refresh-usage')}<small id="usage-detail"></small></div><div class="settings-save-row"><div><span>自动保存</span><small id="save-file-name">${e(writer?.handle.name ?? '首次收录时选择 JSON 文件')}</small></div>${ib('folder', '选择 JSON 保存位置', 'choose-save-file')}</div><label class="field"><span>搜索快捷键</span><select id="search-key"><option value="enter" ${settings.searchKey === 'enter' ? 'selected' : ''}>Enter 搜索 · Shift + Enter 换行</option><option value="shift-enter" ${settings.searchKey === 'shift-enter' ? 'selected' : ''}>Shift + Enter 搜索 · Enter 换行</option></select></label><label class="checkbox-row"><input type="checkbox" id="auto-search" ${settings.autoSearch ? 'checked' : ''}>输入停顿后自动查找</label><label class="checkbox-row"><input type="checkbox" id="show-current-only" ${settings.currentCategoryOnly ? 'checked' : ''}>展示当前分类</label><label class="checkbox-row"><input type="checkbox" id="opening-animation" ${settings.openingAnimation ? 'checked' : ''}>播放开屏动画</label><div class="modal-actions"><button class="text-button" type="button" data-action="close">取消</button><button type="submit" class="text-button primary">${icon('check')}保存设置</button></div></form>`);
  let usageAbort: AbortController | undefined;
  let usageTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    usageAbort?.abort(); clearTimeout(usageTimer);
    const apiKey = $<HTMLInputElement>('search-api-key').value.trim();
    const value = $('usage-value'), detail = $('usage-detail'), button = document.querySelector<HTMLButtonElement>('[data-action="refresh-usage"]')!;
    value.textContent = '— / —'; detail.textContent = '';
    if (!apiKey) { detail.textContent = '先填写 API Key'; return; }
    const controller = new AbortController(); usageAbort = controller;
    let timedOut = false;
    usageTimer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    button.disabled = true; button.innerHTML = icon('refresh', 'spinning');
    value.textContent = '查询中…';
    try {
      const usage = await fetchUsage(apiKey, controller.signal);
      if (usageAbort !== controller || controller.signal.aborted) return;
      const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
      $('usage-label').textContent = usage.scope === 'plan' ? '本月额度' : 'Key 额度';
      value.textContent = `${number(usage.used)} / ${number(usage.total)}`;
      value.title = usage.used !== null && usage.total !== null ? `已用 / 总额 · 剩余 ${number(Math.max(0, usage.total - usage.used))}` : '已用 / 总额';
      if (usage.paygo) detail.textContent = `按量额度 ${number(usage.paygo.used)} / ${number(usage.paygo.total)}`;
    } catch (error) {
      if (usageAbort !== controller) return;
      value.textContent = '— / —'; detail.textContent = timedOut ? '查询超时，点击刷新重试' : errorMessage(error);
    } finally { if (usageAbort === controller) { clearTimeout(usageTimer); button.disabled = false; button.innerHTML = icon('refresh'); } }
  };
  modalCleanup = () => { usageAbort?.abort(); usageAbort = undefined; clearTimeout(usageTimer); };
  document.querySelector<HTMLButtonElement>('[data-action="refresh-usage"]')!.onclick = () => void refresh();
  document.querySelector<HTMLButtonElement>('[data-action="choose-save-file"]')!.onclick = async () => { await saveJSON(true); if ($('save-file-name')) $('save-file-name').textContent = writer?.handle.name ?? '首次收录时选择 JSON 文件'; };
  $('search-api-key').oninput = () => {
    usageAbort?.abort(); usageAbort = undefined; clearTimeout(usageTimer);
    $('usage-value').textContent = '— / —'; $('usage-detail').textContent = '点击刷新查看额度';
    const button = document.querySelector<HTMLButtonElement>('[data-action="refresh-usage"]')!; button.disabled = false; button.innerHTML = icon('refresh');
  };
  $('settings-form').onsubmit = event => {
    event.preventDefault();
    const apiKey = $<HTMLInputElement>('search-api-key').value.trim();
    const keyChanged = settings.apiKey !== apiKey;
    invalidateSearch();
    if (keyChanged) searchCache.clear();
    settings = { apiKey, currentCategoryOnly: $<HTMLInputElement>('show-current-only').checked, autoSearch: $<HTMLInputElement>('auto-search').checked, searchKey: $<HTMLSelectElement>('search-key').value as Settings['searchKey'], openingAnimation: $<HTMLInputElement>('opening-animation').checked };
    const saved = writeCache('echoes.search.v2', settings);
    closeModal(); renderConnection(); renderSearchShortcut(); showNext(false);
    toast(saved ? '设置已保存。' : '设置已应用；下次打开时需重新填写。');
    if (keyChanged && settings.autoSearch && draft.text.trim()) void searchSources();
  };
  void refresh();
}

function renderSearchShortcut(): void {
  const label = settings.searchKey === 'enter' ? 'Enter' : 'Shift + Enter';
  const button = document.querySelector<HTMLButtonElement>('#editor-actions [data-action="search"]')!;
  button.dataset.tip = `查找出处 · ${label}`;
}

function renderConnection(verified = false): void {
  const configured = !!settings.apiKey;
  $('connection-badge').classList.toggle('connected', configured);
  $('connection-badge').querySelector('span')!.textContent = configured ? verified ? '已连接' : '已配置' : '未连接';
}

function showMenu(anchor: HTMLElement, items: { icon?: string; label?: string; action?: () => void; danger?: boolean }[]): void {
  const menu = $('more-menu');
  menu.innerHTML = items.map((item, index) => item.action ? `<button data-menu-index="${index}" ${item.danger ? 'class="menu-danger"' : ''}>${icon(item.icon ?? 'more')}${e(item.label)}</button>` : '<hr>').join('');
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 7, innerHeight - menu.offsetHeight - 8))}px`;
  for (const button of menu.querySelectorAll<HTMLButtonElement>('button')) button.onclick = () => { hideMenu(); items[Number(button.dataset.menuIndex)].action!(); };
  menu.querySelector('button')?.focus();
}

function hideMenu(): void { $('more-menu').hidden = true; }

function openLibrary(): void {
  if (!Object.hasOwn(collection, libraryCategory)) libraryCategory = '';
  openModal('我的诗集', `<div class="library-controls"><label class="library-search">${icon('search')}<input id="library-query" placeholder="搜索诗句、作者或作品" aria-label="搜索诗集" value="${e(libraryQuery)}"></label><select id="library-category" aria-label="筛选诗集分类"><option value="">全部分类</option>${categoryOptions(libraryCategory)}</select></div><div class="library-list" id="library-list"></div><div class="library-pagination"><span id="library-result-count"></span><label class="page-size-label">每页<select id="library-page-size" aria-label="每页条目数量">${pageSizes.map(size => `<option value="${size}" ${size === libraryPageSize ? 'selected' : ''}>${size} 则</option>`).join('')}</select></label><nav class="page-navigation" aria-label="诗集分页">${ib('left', '上一页', 'library-prev')}<span id="library-page-info" role="status"></span>${ib('right', '下一页', 'library-next')}</nav></div>`, true);
  $('modal').classList.add('library-modal');
  $<HTMLSelectElement>('library-category').value = Object.hasOwn(collection, libraryCategory) ? libraryCategory : '';
  $('library-query').oninput = () => { libraryQuery = $<HTMLInputElement>('library-query').value; libraryPage = 1; renderLibrary(); };
  $('library-category').onchange = () => { libraryCategory = $<HTMLSelectElement>('library-category').value; libraryPage = 1; renderLibrary(); };
  $('library-page-size').onchange = () => {
    libraryPageSize = Number($<HTMLSelectElement>('library-page-size').value); libraryPage = 1;
    writeCache('echoes.library.page-size.v1', libraryPageSize); renderLibrary();
  };
  document.querySelector<HTMLButtonElement>('[data-action="library-prev"]')!.onclick = () => { libraryPage--; renderLibrary(); };
  document.querySelector<HTMLButtonElement>('[data-action="library-next"]')!.onclick = () => { libraryPage++; renderLibrary(); };
  renderLibrary();
}

function renderLibrary(): void {
  const query = normalize(libraryQuery);
  const entries = Object.entries(collection).filter(([name]) => !libraryCategory || libraryCategory === name)
    .flatMap(([name, items]) => items.map((entry, index) => ({ name, entry, index })))
    .filter(({ entry }) => !query || normalize(`${entry.text}${entry.title}${entry.author}`).includes(query));
  const pages = Math.ceil(entries.length / libraryPageSize);
  libraryPage = Math.max(1, Math.min(libraryPage, pages));
  const html = entries.slice((libraryPage - 1) * libraryPageSize, libraryPage * libraryPageSize).map(({ name, entry, index }) => {
    const attrs = `data-entry-category="${e(name)}" data-entry-index="${index}"`;
    return `<article class="library-entry"><div class="library-entry-top"><span class="library-category">${e(name)}</span><div class="library-entry-actions">${ib('edit', '编辑摘录', 'entry-edit', attrs)}${ib('move', '移动到其他分类', 'entry-move', attrs)}${ib('external', '打开来源网页', 'entry-source', attrs + (safeURL(entry.url) ? '' : ' disabled'))}${ib('trash', '删除摘录', 'entry-delete', attrs)}</div></div><p class="library-text">${e(entry.text)}</p><p class="library-source">${e(sourceLabel(entry))}${entry.dynasty ? ` · ${e(entry.dynasty)}` : ''}</p></article>`;
  }).join('');
  $('library-list').innerHTML = entries.length ? html : '<div class="empty-library">这里还没有符合条件的摘录。</div>';
  $('library-list').scrollTop = 0;
  $('library-result-count').textContent = `${entries.length} 则`;
  $('library-page-info').textContent = `${pages ? libraryPage : 0} / ${pages}`;
  document.querySelector<HTMLButtonElement>('[data-action="library-prev"]')!.disabled = libraryPage <= 1;
  document.querySelector<HTMLButtonElement>('[data-action="library-next"]')!.disabled = libraryPage >= pages;
}

function editEntry(name: string, index: number): void {
  const apply = () => {
    const entry = collection[name]?.[index]; if (!entry) return;
    invalidateSearch(); draft = { ...entry }; editing = { category: name, index }; category = name; autoMetadata = false;
    closeModal(); populateForm(); renderCategories(); candidates = []; renderCandidates(); setSearchStatus(''); persist(); $('text').focus();
  };
  if (draft.text.trim() && !(editing?.category === name && editing.index === index)) confirmAction('切换编辑内容', '当前输入尚未收入诗集，切换将替换这份草稿。', '切换到此摘录', apply);
  else apply();
}

function moveEntry(name: string, index: number): void {
  if (Object.keys(collection).length < 2) { toast('先创建另一个分类，再移动摘录。'); return; }
  openModal('移动摘录', `<p>${e(collection[name][index].text)}</p><label class="field"><span>移至分类</span><select id="move-destination">${categoryOptions('', name)}</select></label><div class="modal-actions"><button class="text-button" data-action="library">返回诗集</button><button class="text-button primary" id="move-confirm">${icon('move')}移动</button></div>`);
  $('move-confirm').onclick = () => {
    const destination = $<HTMLSelectElement>('move-destination').value;
    const entry = collection[name][index];
    if (duplicateIndex(collection[destination], entry.text) !== -1) { toast('目标分类已有相同诗句，未移动。', true); return; }
    collection[name].splice(index, 1); collection[destination].push(entry);
    if (editing?.category === name) {
      if (editing.index === index) { editing = { category: destination, index: collection[destination].length - 1 }; category = destination; }
      else if (editing.index > index) editing.index--;
    }
    changeCollection(); openLibrary(); toast('摘录已移动。');
  };
}

function removeEntry(name: string, index: number): void {
  const entry = collection[name]?.[index]; if (!entry) return;
  confirmAction('删除摘录', entry.text, '删除这则摘录', () => {
    collection[name].splice(index, 1);
    if (editing?.category === name) {
      if (editing.index === index) clearDraft(); else if (editing.index > index) editing.index--;
    }
    changeCollection(); openLibrary();
    toast('摘录已删除。', false, () => {
      if (!Object.hasOwn(collection, name)) Object.defineProperty(collection, name, { value: [], enumerable: true, writable: true, configurable: true });
      collection[name].splice(Math.min(index, collection[name].length), 0, entry); changeCollection(); if ($('library-list')) renderLibrary();
    });
  }, true);
}

async function openJSON(): Promise<void> {
  const picker = (window as unknown as FilePickers).showOpenFilePicker;
  if (!picker) { $<HTMLInputElement>('file-input').click(); return; }
  try {
    const [handle] = await picker.call(window, { types: jsonFileType, multiple: false });
    const file = await handle.getFile();
    if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请先拆分诗集再导入。');
    const text = await file.text();
    previewImport(text, handle.name, handle);
  } catch (error) {
    if (isCancellation(error)) return;
    if (error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name)) { $<HTMLInputElement>('file-input').click(); return; }
    toast(errorMessage(error), true);
  }
}

function previewImport(text: string, filename: string, handle?: ManagedFileHandle): void {
  let incoming: Collection;
  try { incoming = parseCollection(text); } catch (error) { toast(errorMessage(error), true); return; }
  const preview = mergeCollections(collection, incoming);
  openModal('打开诗集', `<p>${e(filename)}</p><div class="form-note">${Object.keys(incoming).length} 个分类，${countEntries(incoming)} 则摘录。<br>合并后新增 ${preview.added} 则，跳过 ${preview.skipped} 则完全重复的摘录。</div><div class="choice-row"><label class="choice"><input type="radio" name="import-mode" value="merge" checked>合并到当前诗集</label><label class="choice"><input type="radio" name="import-mode" value="replace">替换当前诗集</label></div>${handle ? '<label class="checkbox-row"><input id="bind-import" type="checkbox">以此文件作为保存位置，后续修改自动写回</label>' : ''}<label class="checkbox-row" id="backup-option" hidden><input id="backup-current" type="checkbox" checked>替换前下载当前诗集备份</label><div class="modal-error" id="import-error"></div><div class="modal-actions"><button class="text-button" data-action="close">取消</button><button class="text-button primary" id="import-confirm">${icon('folder')}打开诗集</button></div>`);
  for (const radio of document.querySelectorAll<HTMLInputElement>('[name="import-mode"]')) radio.onchange = () => {
    const replace = (document.querySelector('[name="import-mode"]:checked') as HTMLInputElement).value === 'replace';
    $('backup-option').hidden = !replace;
    if (handle) $<HTMLInputElement>('bind-import').checked = replace;
  };
  $('import-confirm').onclick = async () => {
    const replace = (document.querySelector('[name="import-mode"]:checked') as HTMLInputElement).value === 'replace';
    if (replace && $<HTMLInputElement>('backup-current').checked && countEntries(collection)) exportJSON(`echoes_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, false);
    let bind = !!handle && $<HTMLInputElement>('bind-import').checked;
    if (bind && handle?.requestPermission) {
      try { if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') { bind = false; toast('未获得写入权限；诗集可以导入，收录时再选择保存位置。', true); } }
      catch { bind = false; toast('未获得写入权限；收录时再选择保存位置。', true); }
    }
    writer?.detach(); writer = bind ? new FileWriter(handle!, text) : null; generation++;
    collection = replace ? incoming : preview.collection;
    if (!Object.hasOwn(collection, category)) category = Object.keys(collection)[0] ?? '';
    invalidateSearch(); editing = null; candidates = []; selectedCandidate = -1; autoMetadata = false;
    populateForm(); renderCandidates(); setSearchStatus(''); closeModal(); changeCollection();
    toast(replace ? '已打开新诗集。' : `已合并 ${preview.added} 则摘录。`);
  };
}

function sourceLabel(entry: Excerpt): string {
  return [entry.author, entry.title ? `《${entry.title}》` : ''].filter(Boolean).join(' · ') || '出处待补';
}

function showPool(): Excerpt[] { return settings.currentCategoryOnly ? collection[category] ?? [] : Object.values(collection).flat(); }

function ensureShowcase(): void {
  const pool = showPool();
  if (!showcaseEntry || !pool.includes(showcaseEntry)) showNext(false);
}

function showNext(animate = true): void {
  clearTimeout(showcaseTimer);
  const pool = showPool();
  const alternatives = pool.filter(entry => entry !== showcaseEntry && entry.text !== showcaseEntry?.text);
  const choices = alternatives.length ? alternatives : pool;
  const next = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
  const update = () => {
    showcaseEntry = next;
    $('showcase-text').textContent = next?.text ?? '还没有摘录，写下第一句吧。';
    $('showcase-source').textContent = next ? sourceLabel(next) : '';
    $('showcase-copy').classList.remove('changing');
    for (const button of $('showcase-actions').querySelectorAll<HTMLButtonElement>('button')) button.disabled = !pool.length;
  };
  if (animate && next !== showcaseEntry && !matchMedia('(prefers-reduced-motion: reduce)').matches) { $('showcase-copy').classList.add('changing'); showcaseTimer = setTimeout(update, 225); }
  else update();
}

function startCycle(): void {
  clearInterval(cycleTimer);
  if (!paused && !document.hidden) cycleTimer = setInterval(() => showNext(), 60000);
}

function togglePause(): void {
  paused = !paused;
  const button = document.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
  button.innerHTML = icon(paused ? 'play' : 'pause');
  button.setAttribute('aria-label', paused ? '继续自动轮换' : '暂停自动轮换');
  button.dataset.tip = paused ? '继续自动轮换' : '暂停自动轮换';
  button.setAttribute('aria-pressed', String(paused)); startCycle();
}

function safeURL(value: string): string | null { return safeSource(value)?.href ?? null; }

function openSource(value: string): void { const url = safeURL(value); if (url) window.open(url, '_blank', 'noopener,noreferrer'); else toast('这条摘录还没有可打开的来源链接。'); }

function bindActions(): void {
  document.addEventListener('click', event => {
    const target = event.target as Element;
    const button = target.closest<HTMLButtonElement>('[data-action]');
    if (!button || button.disabled) { if (!target.closest('.popover')) hideMenu(); return; }
    const name = button.dataset.entryCategory!, index = Number(button.dataset.entryIndex);
    switch (button.dataset.action) {
      case 'close': closeModal(); break;
      case 'library': openLibrary(); break;
      case 'settings': openSettings(); break;
      case 'open': void openJSON(); break;
      case 'save': void saveJSON(); break;
      case 'new-category': openCategoryEditor(); break;
      case 'search': void searchSources(); break;
      case 'refresh': showNext(); startCycle(); break;
      case 'pause': togglePause(); break;
      case 'clear': if (draft.text.trim()) confirmAction('清空草稿', '清空当前未收录的输入？已有诗集不会改变。', '清空', clearDraft); break;
      case 'entry-edit': editEntry(name, index); break;
      case 'entry-move': moveEntry(name, index); break;
      case 'entry-delete': removeEntry(name, index); break;
      case 'entry-source': openSource(collection[name][index].url); break;
      case 'candidate-source': openSource(candidates[Number(button.dataset.index)].sourceUrl ?? ''); break;
      case 'adopt-text': {
        invalidateSearch(); const candidateIndex = Number(button.dataset.index); applyCandidate(candidateIndex);
        draft.text = candidates[candidateIndex].text; populateForm(); renderCandidates(); persist();  break;
      }
      case 'more': showMenu(button, [
        { icon: 'folder', label: '导入 JSON 诗集', action: () => void openJSON() },
        { icon: 'download', label: '导出 JSON 副本', action: () => exportJSON() },
        { icon: 'html', label: '导出便携 HTML', action: exportHTML },
      ]); break;
      case 'category-menu': {
        const categoryName = button.dataset.categoryName!;
        showMenu(button, [
          { icon: 'edit', label: '编辑分类名称', action: () => openCategoryEditor(categoryName) },
          { icon: 'up', label: '上移分类', action: () => { collection = moveCategory(collection, categoryName, -1); changeCollection(); } },
          { icon: 'down', label: '下移分类', action: () => { collection = moveCategory(collection, categoryName, 1); changeCollection(); } },
          {}, { icon: 'trash', label: '删除分类', danger: true, action: () => deleteCategory(categoryName) },
        ]); break;
      }
    }
  });
  $('excerpt-form').onsubmit = event => { event.preventDefault(); collect(); };
  for (const field of fields) $(field).addEventListener('input', () => {
    if (field === 'text') {
      invalidateSearch();
      if (autoMetadata) { for (const key of fields.filter(key => key !== 'text')) $<HTMLInputElement>(key).value = ''; autoMetadata = false;  }
      selectedCandidate = -1; candidates = []; setSearchStatus(''); renderCandidates();
      if (!composing && settings.autoSearch) queryTimer = setTimeout(() => void searchSources(), 700);
    } else { invalidateSearch(); autoMetadata = false; setSearchStatus(''); }
    $('entry-status').classList.remove('error'); $('entry-status').textContent = editing ? '保存后更新这则摘录。' : '保留每一次心有所动。'; syncDraft();
  });
  $('text').addEventListener('compositionstart', () => { composing = true; invalidateSearch(); });
  $('text').addEventListener('compositionend', () => { composing = false; syncDraft(); clearTimeout(queryTimer); if (settings.autoSearch) queryTimer = setTimeout(() => void searchSources(), 700); });
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) { const rect = $('modal').getBoundingClientRect(); const mouse = event as MouseEvent; if (mouse.clientX < rect.left || mouse.clientX > rect.right || mouse.clientY < rect.top || mouse.clientY > rect.bottom) closeModal(); } });
  $('modal').addEventListener('close', () => { modalCleanup?.(); modalCleanup = undefined; });
  $<HTMLInputElement>('file-input').onchange = async () => {
    const file = $<HTMLInputElement>('file-input').files?.[0];
    if (file) {
      try { if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请先拆分诗集。'); previewImport(await file.text(), file.name); } catch (error) { toast(errorMessage(error), true); }
    }
    $<HTMLInputElement>('file-input').value = '';
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideMenu();
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveJSON(); }
    if (!$('more-menu').hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const items = [...$('more-menu').querySelectorAll<HTMLButtonElement>('button')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener('visibilitychange', startCycle);
  window.addEventListener('resize', hideMenu);
  window.addEventListener('beforeunload', event => { persist(); if (dirty || saveMode === 'saving' || (draft.text.trim() && !cacheOK)) { event.preventDefault(); event.returnValue = ''; } });
}

function bindSearchKeyboard(): void {
  const textarea = $<HTMLTextAreaElement>('text');
  textarea.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229 || event.key !== 'Enter') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const search = settings.searchKey === 'enter' ? !event.shiftKey : event.shiftKey;
    if (search) { event.preventDefault(); if (!event.repeat) { syncDraft(); void searchSources(); } }
  });
}

function boot(): void {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon!); });
  $('header-actions').innerHTML = ib('settings', '设置', 'settings') + ib('more', '更多操作', 'more');
  $('add-category-button').innerHTML = ib('plus', '新建分类', 'new-category');
  $('editor-actions').innerHTML = ib('undo', '清空当前草稿', 'clear') + ib('search', '查找出处', 'search');
  $('showcase-actions').innerHTML = ib('refresh', '换一句', 'refresh') + ib('pause', '暂停自动轮换', 'pause', 'aria-pressed="false"');
  populateForm(); renderCategories(); renderConnection(); renderCandidates(); renderSaveState(); showNext(false); bindActions(); bindSearchKeyboard(); renderSearchShortcut(); startCycle();
  bindCategoryDrag($('category-list'), names => {
    if (names.length !== Object.keys(collection).length || new Set(names).size !== names.length || names.some(name => !Object.hasOwn(collection, name))) return;
    collection = Object.fromEntries(names.map(name => [name, collection[name]]));
    changeCollection();
  });
  playOpening({ enabled: settings.openingAnimation, collection, app: $('app'), landing: $('showcase-copy') });
}

boot();
