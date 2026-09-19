import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countEntries, duplicateIndex, escapeEmbeddedJSON, mergeCollections, moveCategory, parseCollection, renameCategory, serializeCollection } from '../shared/collection';
import { diffCharacters, normalizeDynasty, rankCandidates, similarity, supplementalQueries } from '../shared/matching';

const seedText = await readFile('echoes_of_lyric.json', 'utf8');
const collection = parseCollection(await readFile('tests/fixtures/anthology.json', 'utf8'));
test('seed is strict JSON and preserves the current anthology', () => {
  const seed = parseCollection(seedText);
  assert.deepEqual({ ...seed }, JSON.parse(seedText));
  assert.deepEqual(parseCollection(serializeCollection(seed)), seed);
});
test('trailing commas are accepted without touching commas inside strings', () => {
  const parsed = parseCollection('{"念":[{"text":"逗号 ,} 也不是语法",},],}');
  assert.equal(parsed['念'][0].text, '逗号 ,} 也不是语法');
  assert.deepEqual(Object.keys(parsed['念'][0]), ['text', 'title', 'author', 'dynasty', 'url']);
  assert.throws(() => parseCollection('{"念":[{"text": 1}]}'), /必须是文字/);
  assert.throws(() => parseCollection('{"念":[{"text":""}]}'), /缺少诗句/);
});
test('category names are data, including prototype-related names', () => {
  const parsed = parseCollection('{"__proto__":[{"text":"秋水共长天一色"}]}');
  assert.equal(countEntries(parsed), 1);
  const renamed = renameCategory(parsed, '__proto__', 'constructor');
  assert.equal(renamed['constructor'][0].text, '秋水共长天一色');
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
test('rename, reorder, merge and duplicates preserve all five fields', () => {
  const renamed = renameCategory(collection, '帅', '风骨');
  assert.deepEqual(Object.keys(renamed), ['风骨', '痛', '怒']);
  assert.throws(() => renameCategory(renamed, '风骨', '痛'), /同名/);
  assert.deepEqual(Object.keys(moveCategory(renamed, '怒', -1)), ['风骨', '怒', '痛']);
  const merged = mergeCollections(collection, collection);
  assert.equal(merged.added, 0); assert.equal(merged.skipped, countEntries(collection));
  assert.equal(duplicateIndex(collection['帅'], ' 他年我若为青帝，报与桃花一处开。'), 0);
});
test('HTML snapshot JSON cannot terminate a script element', () => {
  const text = '</script><script>globalThis.bad=true</script>';
  const escaped = escapeEmbeddedJSON({ text });
  assert.equal(escaped.includes('<'), false);
  assert.equal(JSON.parse(escaped).text, text);
});
test('fuzzy ranking, highlighted changes and dynasty normalization', () => {
  assert.equal(normalizeDynasty('〔唐代〕'), '唐');
  assert.equal(normalizeDynasty('五代'), '五代');
  const query = '十四万人弃卸甲';
  const correct = { ...collection['怒'][0], text: '十四万人齐解甲，更无一个是男儿！', workKey: 'poem-a', match: 'similar' as const, score: 0 };
  const unrelated = { ...correct, text: '山形如醉翁，佝偻欲颠仆。', workKey: 'poem-b' };
  assert.equal(rankCandidates([unrelated, correct], query)[0].text, correct.text);
  assert.ok(similarity(query, correct.text) > .65);
  const marked = diffCharacters(query, correct.text).filter(char => char.changed).map(char => char.text).join('');
  assert.ok(marked.includes('齐解'));
  assert.ok(!marked.includes('十四万人'));
  assert.equal(supplementalQueries(query).length, 2);
});
