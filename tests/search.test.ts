import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automaticCandidate, metadataFrom, parseSearchResponse, SEARCH_ENDPOINT, searchWeb, type SearchResult } from '../shared/search';
const result = (text: string, title = '题菊花', author = '黄巢'): SearchResult => ({ title: `${title}原文及赏析`, content: `“${text}”出自唐代诗人${author}的《${title}》。`, url: `https://poetry.example/${title}` });
const query = '他年我若为青帝';

test('extracts attribution without mistaking era qualifiers or article bylines for poets', () => {
  assert.deepEqual(metadataFrom('出自五代时期花蕊夫人的《述国亡诗》'), { title: '述国亡诗', author: '花蕊夫人', dynasty: '五代' });
  assert.deepEqual(metadataFrom('《题菊花》是唐代诗人黄巢创作的一首诗。'), { title: '题菊花', author: '黄巢', dynasty: '唐' });
  assert.deepEqual(metadataFrom('作品：菩萨蛮\n作者：韦庄\n朝代：唐代'), { title: '菩萨蛮', author: '韦庄', dynasty: '唐' });
  assert.deepEqual(metadataFrom('出处：李白《行路难·其一》\n文章正文\n作者：周剑之'), { title: '行路难·其一', author: '李白', dynasty: '' });
  assert.equal(metadataFrom('一是陶渊明', '我花开后百花杀').author, '');
});

test('exact matches merge across pages, auto-fill safely and always leave saved URL blank', () => {
  const first = result(query);
  const items = parseSearchResponse({ results: [first, { ...first, url: 'https://another.example/poem' }] }, query);
  assert.equal(items.length, 1); assert.equal(items[0].url, ''); assert.equal(items[0].sourceUrl, new URL(first.url).href);
  assert.equal(automaticCandidate(items)?.author, '黄巢'); assert.equal(items[0].text, query);
});

test('typos and conflicting exact attributions require selection', () => {
  const typo = parseSearchResponse({ results: [result('他年我若为青帝')] }, '他年我若为清帝');
  assert.equal(typo[0].match, 'similar'); assert.equal(automaticCandidate(typo), undefined);
  const ambiguous = parseSearchResponse({ results: [result(query), result(query, '另一首诗', '李白')] }, query);
  assert.equal(ambiguous.length, 2); assert.equal(automaticCandidate(ambiguous), undefined);
});

test('missing evidence is not fabricated and generated answers are not auto-confirmed', () => {
  assert.deepEqual(parseSearchResponse({ results: [result('白日依山尽，黄河入海流')] }, query), []);
  const partial = { title: '题菊花原文', content: `“${query}”`, url: 'https://poetry.example/partial' };
  const items = parseSearchResponse({ results: [partial], answer: '出自唐代黄巢的《题菊花》' }, query);
  assert.equal(items[0].author, '黄巢'); assert.equal(items[0].autoFill, false);
  assert.equal(automaticCandidate(items), undefined);
  assert.deepEqual(parseSearchResponse({ results: [{ ...partial, url: 'javascript:alert(1)' }] }, query), []);
  assert.throws(() => parseSearchResponse({ results: null }, query), /格式/);
});

test('real API response samples retain correct metadata and typo alternatives', async () => {
  for (const [id, text, author, title] of [['0', '我花开后百花杀', '黄巢', '不第后赋菊'], ['browser', '长风破浪会有时，直挂云帆济沧海', '李白', '行路难·其一']]) {
    const data = JSON.parse(await readFile(`tests/fixtures/search-${id}.json`, 'utf8'));
    const items = parseSearchResponse(data, text);
    assert.equal(automaticCandidate(items)?.author, author); assert.equal(automaticCandidate(items)?.title, title);
    assert.ok(items.every(item => item.url === ''));
  }
  const data = JSON.parse(await readFile('tests/fixtures/search-1.json', 'utf8'));
  const items = parseSearchResponse(data, '十四万人弃卸甲，更无一个是男儿');
  assert.equal(items[0].author, '花蕊夫人'); assert.equal(items[0].dynasty, '五代');
  assert.match(items[0].text, /齐解甲/); assert.equal(automaticCandidate(items), undefined);
});

test('direct request uses the fixed endpoint and a single basic-credit search', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, SEARCH_ENDPOINT); assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer temporary-test-key');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.search_depth, 'basic'); assert.equal(body.auto_parameters, false);
    assert.equal(body.include_raw_content, false); assert.ok(body.query.startsWith(query));
    assert.ok(!JSON.stringify(body).includes('temporary-test-key'));
    return Response.json({ results: [result(query)] });
  };
  const found = await searchWeb(query, 'temporary-test-key', new AbortController().signal, fetcher);
  assert.equal(found[0].author, '黄巢'); assert.equal(calls, 1);
});

test('API failures distinguish key, quota, invalid responses, network and cancellation', async () => {
  const signal = new AbortController().signal;
  for (const [status, code] of [[401, 'INVALID_KEY'], [403, 'INVALID_KEY'], [429, 'QUOTA_LIMIT'], [432, 'QUOTA_LIMIT'], [503, 'SEARCH_UNAVAILABLE']] as const) {
    await assert.rejects(searchWeb(query, 'key', signal, async () => new Response('', { status })), { code });
  }
  await assert.rejects(searchWeb(query, '', signal), { code: 'KEY_REQUIRED' });
  await assert.rejects(searchWeb(query, 'key', signal, async () => new Response('broken')), { code: 'INVALID_RESPONSE' });
  await assert.rejects(searchWeb(query, 'key', signal, async () => { throw new TypeError('Failed to fetch'); }), { code: 'NETWORK_ERROR' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(searchWeb(query, 'key', abort.signal, async () => { throw abort.signal.reason; }), { name: 'AbortError' });
});
