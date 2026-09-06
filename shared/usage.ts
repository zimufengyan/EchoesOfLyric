import { SearchAPIError } from './search';
export interface Usage { used: number | null; total: number | null; scope: 'plan' | 'key'; paygo?: { used: number; total: number | null } }
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function parseUsage(payload: unknown): Usage {
  if (!payload || typeof payload !== 'object') throw new Error('额度信息格式无法识别。');
  const data = payload as { account?: Record<string, unknown>; key?: Record<string, unknown> };
  if (data.account && typeof data.account === 'object') {
    const used = amount(data.account.plan_usage), total = amount(data.account.plan_limit);
    if (used !== null || total !== null) {
      const paygo = amount(data.account.paygo_usage);
      return { used, total, scope: 'plan', ...(paygo !== null && paygo > 0 ? { paygo: { used: paygo, total: amount(data.account.paygo_limit) } } : {}) };
    }
  }
  if (data.key && typeof data.key === 'object') return { used: amount(data.key.usage), total: amount(data.key.limit), scope: 'key' };
  throw new Error('额度信息格式无法识别。');
}
export async function fetchUsage(apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Usage> {
  if (!apiKey.trim()) throw new Error('先填写 API Key');
  let response: Response;
  try { response = await fetcher('https://api.tavily.com/usage', { headers: { Authorization: `Bearer ${apiKey.trim()}` }, credentials: 'omit', signal }); }
  catch (error) { if (signal.aborted) throw error; throw new Error('额度暂不可用，请检查网络或 Key'); }
  if (response.status === 401 || response.status === 403) throw new SearchAPIError('INVALID_KEY', 'API Key 无效');
  if (!response.ok) throw new Error('额度暂不可用，稍后重试');
  return parseUsage(await response.json());
}
