import { bestPassage, normalize, normalizeDynasty, similarity } from './matching';
import type { Candidate } from './types';

export const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
export interface SearchResult { title: string; content: string; url: string; score?: number }
export interface SearchResponse { results: SearchResult[]; answer?: string | null }

const dynastyPattern = '(?:明末清初|五代十国|南北朝|唐代|宋代|元代|明代|清代|汉代|晋代|隋代|北宋|南宋|晚唐|盛唐|中唐|初唐|五代|先秦|魏晋|两汉|西汉|东汉|北朝|南朝|近代|现代|当代|唐|宋|元|明|清|汉|晋|隋)';
const poetPattern = '([\\p{Script=Han}·]{2,10}?)';

export function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|\u00a0/g, ' ').replace(/[\u200b-\u200d]/g, '').replace(/[ \t]+/g, ' ').trim();
}

export function metadataFrom(text: string, pageTitle = ''): { title: string; author: string; dynasty: string } {
  const content = plainText(text);
  const heading = plainText(pageTitle);
  const combined = `${content}\n${heading}`;
  let title = '', author = '', dynasty = '';
  // Keep attribution clauses together: do not attach an unrelated author elsewhere on a page.
  const before = combined.match(new RegExp(`(?:出自|选自|摘自|源自|是)\\s*(?:中国)?(${dynastyPattern})(?:时期|末年|初年)?[ ·]*\\s*(?:诗人|词人|文学家|诗僧|著名诗人)?\\s*${poetPattern}(?:的|所作的|创作的|所著的|所写的)?\\s*《([^》]{1,100})》`, 'u'));
  const after = combined.match(new RegExp(`《([^》]{1,100})》(?:是|为|出自)?\\s*(?:中国)?(${dynastyPattern})(?:时期|末年|初年)?[ ·]*\\s*(?:诗人|词人|文学家|诗僧|著名诗人)?\\s*${poetPattern}(?=创作|所作|写|所写|所著|的|[，。\\s]|$)`, 'u'));
  if (before) { dynasty = before[1]; author = before[2]; title = before[3]; }
  else if (after) { title = after[1]; dynasty = after[2]; author = after[3]; }
  const attribution = combined.match(new RegExp(`(?:出自|选自|摘自|出处[：:]|这是|是)\\s*${poetPattern}(?:的)?《([^》]{1,100})》`, 'u'))
    ?? heading.match(new RegExp(`^${poetPattern}(?:的)?《([^》]{1,100})》`, 'u'));
  if (!author && attribution) { author = attribution[1]; title ||= attribution[2]; }
  if (!title) title = combined.match(/(?:出自|选自|摘自|源自)[^。！？\n]{0,50}《([^》]{1,100})》/u)?.[1] ?? heading.match(/《([^》]{1,100})》/u)?.[1] ?? '';
  if (!title) {
    const matched = heading.match(/^([^，。！？“”"《》]{1,50}?)(?:原文|全文|翻译|译文|赏析|拼音|朗读|注释)/u);
    if (matched) title = matched[1].replace(/[ _·|\-]+$/, '');
  }
  const labeledAuthor = content.slice(0, 450).match(new RegExp(`作者[：:\\s]+${poetPattern}(?=\\s|[〔\\[（(，。:：|_]|朝代|$)`, 'u'));
  const labeledDynasty = combined.match(new RegExp(`(?:朝代|年代)[：:\\s]+(${dynastyPattern})`, 'u'));
  const annotated = combined.match(new RegExp(`${poetPattern}\\s*[〔\\[（(]\\s*(${dynastyPattern})\\s*[〕\\]）)]`, 'u'));
  const dynastyFirst = combined.match(new RegExp(`(?:^|[^\\p{Script=Han}])(${dynastyPattern})[ \t·:：/]+${poetPattern}(?=[ \t]|[《，。|_]|$)`, 'mu'));
  author ||= labeledAuthor?.[1] ?? annotated?.[1] ?? dynastyFirst?.[2] ?? '';
  dynasty ||= labeledDynasty?.[1] ?? annotated?.[2] ?? dynastyFirst?.[1] ?? '';
  if (!title) title = content.match(/(?:作品|诗名|篇名|题目)[：:\s]+[《“"]?([^》”"\n，。]{1,60})/u)?.[1]?.trim() ?? '';
  if (!title && (author || /[_|]/.test(heading))) {
    const workHeading = heading.split(/[_|]/)[0].trim();
    if (workHeading.length <= 35 && !/[，。！？“”"？]/.test(workHeading) && workHeading !== author && !/出自|什么|是谁|作者|诗词|古诗文网|古文岛|详解|名句|含义|解读/.test(workHeading)) title = workHeading;
  }
  if (!title && author) title = content.match(/《([^》]{1,100})》/u)?.[1] ?? '';
  author = author.trim(); title = title.trim(); dynasty = normalizeDynasty(dynasty);
  if (/[，。！？]/.test(title) && !title.includes('·')) title = '';
  if (/出自|作者|时期|朝代|诗人|词人|创作/.test(author)) author = '';
  return { title, author, dynasty };
}

function matchingQuotation(result: SearchResult, query: string): { text: string; supported: boolean } {
  const heading = plainText(result.title);
  const content = plainText(result.content);
  const quotes = [...heading.matchAll(/[“"「『]([^”"」』\n]{4,300})[”"」』]/gu), ...content.matchAll(/[“"「『]([^”"」』\n]{4,300})[”"」』]/gu)].map(match => match[1]);
  // Search result page titles often begin with the quoted verse itself.
  const verseHeading = heading.split(/(?:原文|全诗|赏析|出处|出自|意思|翻译|_)/u)[0].trim();
  if (!quotes.length && /[，。！？]/u.test(verseHeading) && !/[《》]/.test(verseHeading)) quotes.push(verseHeading.replace(/^[“"「『]|[”"」』\s-]+$/g, ''));
  const relevant = quotes.map(text => ({ text, score: similarity(query, text) })).filter(item => item.score >= .45).sort((a, b) => b.score - a.score);
  if (relevant.length) return { text: relevant[0].text, supported: true };
  // Preserve the actual source passage; never present an echo of the query as verified source text.
  const chunks = content.split(/\n|(?<=[。！？；])/u).map(text => text.trim()).filter(Boolean);
  const passage = chunks.map(text => ({ text, score: similarity(query, text) })).filter(item => item.score >= .45).sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0];
  if (passage) {
    const known = normalize(query);
    const raw = passage.text;
    // An exact character run in source content can be isolated without including its commentary.
    const compact = raw.replace(/\s/g, '');
    const original = query.replace(/\s/g, '');
    const at = compact.indexOf(original);
    if (at >= 0 && known.length >= 4) return { text: compact.slice(at, at + original.length), supported: true };
    return { text: bestPassage(raw, query), supported: true };
  }
  return { text: '', supported: false };
}

function evidenceExcerpt(content: string): string {
  const clean = plainText(content);
  const index = clean.search(/出自|选自|【出处】|作者[：:]|朝代[：:]/u);
  return clean.slice(Math.max(0, index), Math.max(0, index) + 240);
}

/** Multiple pages of one work are one attribution; unknown metadata is not a competing work. */
export function automaticCandidate(items: Candidate[]): Candidate | undefined {
  const exact = items.filter(item => item.match === 'exact');
  const known = exact.filter(item => item.autoFill).sort((a, b) => b.title.length - a.title.length);
  const winner = known[0];
  if (!winner) return;
  const conflicts = exact.some(item =>
    (!!item.title && !sameTitle(item.title, winner.title)) ||
    (!!item.author && normalize(item.author) !== normalize(winner.author)) ||
    (!!item.dynasty && item.dynasty !== winner.dynasty));
  return conflicts ? undefined : winner;
}

function sameTitle(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) return true;
  const base = (title: string) => title.replace(/[·•\s（(]*其[一二三四五六七八九十\d]+[）)]?$/, '');
  return (base(a) === a || base(b) === b) && normalize(base(a)) === normalize(base(b));
}

export function parseSearchResponse(payload: unknown, query: string): Candidate[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as SearchResponse).results)) throw new Error('搜索 API 返回的结果格式无法识别。');
  const response = payload as SearchResponse;
  const answer = typeof response.answer === 'string' ? metadataFrom(response.answer) : null;
  const candidates: Candidate[] = [];
  for (const raw of response.results.slice(0, 12)) {
    if (!raw || typeof raw.title !== 'string' || typeof raw.content !== 'string' || typeof raw.url !== 'string') continue;
    let sourceUrl: string;
    try { const url = new URL(raw.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue; sourceUrl = url.href; } catch { continue; }
    const metadata = metadataFrom(raw.content, raw.title);
    const quotation = matchingQuotation(raw, query);
    const completeFromSource = !!metadata.title && !!metadata.author && !!metadata.dynasty;
    // The optional search answer may fill a missing field only for the same named work/author.
    // Such a result still needs explicit selection; a generated summary is never auto-confirmed.
    if (answer && metadata.title && metadata.title === answer.title && (!metadata.author || metadata.author === answer.author)) {
      metadata.author ||= answer.author; metadata.dynasty ||= answer.dynasty;
    }
    const score = quotation.supported ? similarity(query, quotation.text) : .1;
    if (score < .35) continue;
    const exact = quotation.supported && normalize(quotation.text).includes(normalize(query));
    candidates.push({
      ...metadata, text: quotation.text, url: '',
      workKey: metadata.title && metadata.author ? `${metadata.author}|${metadata.title}` : sourceUrl,
      match: exact ? 'exact' : 'similar', score,
      sourceUrl, pageTitle: plainText(raw.title), evidence: evidenceExcerpt(raw.content),
      autoFill: exact && completeFromSource,
    });
  }
  const groups = new Map<string, Candidate>();
  for (const item of candidates) {
    const equivalent = candidates.filter(other => other.author && other.title && sameTitle(other.title, item.title)
      && (!item.author || item.author === other.author) && (!item.dynasty || item.dynasty === other.dynasty));
    const named = new Set(equivalent.map(other => other.author));
    const preferred = named.size === 1 ? equivalent.sort((a, b) => Number(!!b.autoFill) - Number(!!a.autoFill) || b.title.length - a.title.length)[0] : undefined;
    const key = preferred ? `${preferred.author}|${preferred.title}|${preferred.dynasty}` : `${item.workKey}|${item.dynasty}`;
    const previous = groups.get(key);
    if (!previous || item.score > previous.score || (item.score === previous.score && item.autoFill && !previous.autoFill)) groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => b.score - a.score || Number(!!b.autoFill) - Number(!!a.autoFill)).slice(0, 8);
}

export class SearchAPIError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function searchWeb(text: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Candidate[]> {
  if (!apiKey.trim()) throw new SearchAPIError('KEY_REQUIRED', '请先在设置中填写 Tavily API Key。');
  let response: Response;
  try {
    response = await fetcher(SEARCH_ENDPOINT, {
      method: 'POST', credentials: 'omit', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ query: `${text.trim().slice(0, 250)} 出处 作者 朝代 原文`, topic: 'general', search_depth: 'basic', auto_parameters: false, max_results: 8, include_answer: 'basic', include_raw_content: false, include_images: false }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SearchAPIError('NETWORK_ERROR', '暂时无法联网搜索，请检查网络或 API Key。');
  }
  if (response.status === 401 || response.status === 403) throw new SearchAPIError('INVALID_KEY', 'API Key 无效或没有访问权限，请检查设置。');
  if ([402, 429, 432, 433].includes(response.status)) throw new SearchAPIError('QUOTA_LIMIT', '搜索额度已用完或请求过于频繁，请在 Tavily 控制台查看，稍后再试。');
  if (!response.ok) throw new SearchAPIError('SEARCH_UNAVAILABLE', '搜索 API 暂时不可用，草稿已保留。');
  let data: unknown;
  try { data = await response.json(); } catch { throw new SearchAPIError('INVALID_RESPONSE', '搜索 API 返回了无法识别的内容。'); }
  return parseSearchResponse(data, text);
}
