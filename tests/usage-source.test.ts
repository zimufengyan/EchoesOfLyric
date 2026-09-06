import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsage, parseUsage } from '../shared/usage';
import { guwendaoSource, safeSource, sourceDomain } from '../shared/source';

test('usage distinguishes account quota, key caps and missing values', () => {
  assert.deepEqual(parseUsage({ account: { plan_usage: 83, plan_limit: 1000 }, key: { usage: 12, limit: 20 } }), { used: 83, total: 1000, scope: 'plan' });
  assert.deepEqual(parseUsage({ key: { usage: 0, limit: null } }), { used: 0, total: null, scope: 'key' });
  assert.equal(parseUsage({ account: { plan_usage: 1000, plan_limit: 1000, paygo_usage: 20, paygo_limit: 200 } }).paygo?.used, 20);
  assert.throws(() => parseUsage({}), /格式/);
});
test('usage query authenticates with the entered key and reports errors', async () => {
  const usage = await fetchUsage(' temporary-key ', new AbortController().signal, async (url, init) => {
    assert.equal(url, 'https://api.tavily.com/usage'); assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer temporary-key');
    return Response.json({ account: { plan_usage: 17, plan_limit: 1000 } });
  });
  assert.equal(usage.used, 17);
  await assert.rejects(fetchUsage('key', new AbortController().signal, async () => new Response('', { status: 401 })), { code: 'INVALID_KEY' });
});
test('source attribution recognizes real site domains and rejects lookalikes', () => {
  for (const domain of ['www.gushiwen.cn', 'm.gushiwen.cn', 'guwendao.net', 'www.guwendao.net']) {
    const url = `https://${domain}/poem`;
    assert.equal(guwendaoSource(url), url); assert.equal(sourceDomain(url), domain);
  }
  for (const url of ['https://gushiwen.cn.example.com/poem', 'https://fakegushiwen.cn/poem', 'https://gushiwen.cn@example.com/poem', 'javascript:alert(1)', 'https://example.com/']) assert.equal(guwendaoSource(url), '');
  assert.ok(safeSource('https://example.com/manual')); assert.equal(safeSource('file:///private'), null);
});
