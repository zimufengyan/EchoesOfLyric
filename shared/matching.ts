import type { Candidate } from './types';

export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}\s]/gu, '').toLowerCase();
}

export function normalizeDynasty(text: string): string {
  const clean = text.replace(/[〔〕\[\]（）()\s]/g, '');
  const names: Record<string, string> = { 唐代: '唐', 宋代: '宋', 元代: '元', 明代: '明', 清代: '清', 汉代: '汉', 两汉: '汉', 隋代: '隋', 晋代: '晋' };
  return names[clean] ?? clean;
}

export function similarity(input: string, other: string): number {
  const a = normalize(input), b = normalize(other);
  if (!a || !b) return 0;
  if (a === b || b.includes(a)) return 1;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  // Find the best substring alignment; leading/trailing context is not a typo.
  let previous = new Array(long.length + 1).fill(0) as number[];
  for (let i = 1; i <= short.length; i++) {
    const row = [i];
    for (let j = 1; j <= long.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (short[i - 1] === long[j - 1] ? 0 : 1));
    previous = row;
  }
  const distance = Math.min(...previous.slice(1));
  const coverage = Math.min(1, b.length / a.length);
  return Math.max(0, (1 - distance / short.length) * coverage);
}

/** Show a matching passage from a long work, not thousands of unrelated words. */
export function bestPassage(text: string, query: string): string {
  if (text.length <= Math.max(80, query.length * 2)) return text;
  const sentences = text.match(/[^。！？；\n]+[。！？；\n]*/gu) ?? [text];
  const normalizedQuery = normalize(query);
  let best = sentences[0], bestScore = -1;
  for (let index = 0; index < sentences.length; index++) {
    let passage = sentences[index].trim();
    for (let following = index + 1; normalize(passage).length < normalizedQuery.length && following < Math.min(index + 4, sentences.length); following++) passage += sentences[following].trim();
    const score = similarity(query, passage);
    if (score > bestScore || (score === bestScore && passage.length < best.length)) { best = passage; bestScore = score; }
    if (normalize(passage).includes(normalizedQuery)) return passage;
  }
  return best;
}

export function rankCandidates(candidates: Candidate[], query: string): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const item of candidates) {
    const passage = bestPassage(item.text, query);
    const score = similarity(query, passage);
    const candidate: Candidate = { ...item, text: passage, score, match: normalize(passage).includes(normalize(query)) ? 'exact' : 'similar' };
    const key = item.workKey || `${item.author}|${item.title}`;
    const existing = map.get(key);
    if (!existing || score > existing.score || (score === existing.score && candidate.autoFill && !existing.autoFill)) map.set(key, candidate);
  }
  return [...map.values()].filter(item => item.score >= 0.35).sort((a, b) => b.score - a.score).slice(0, 12);
}

export function supplementalQueries(text: string): string[] {
  const parts = text.split(/[，。！？；、\n,.!?;]/u).map(normalize).filter(part => part.length >= 4);
  if (parts.length === 1 && parts[0].length >= 6) {
    const part = parts[0];
    parts.push(part.slice(0, Math.max(4, Math.floor(part.length / 2))), part.slice(-Math.max(4, Math.floor(part.length / 2))));
  }
  return [...new Set(parts)].filter(part => part !== normalize(text)).slice(0, 2);
}

export function diffCharacters(original: string, candidate: string): { text: string; changed: boolean }[] {
  const a = [...normalize(original)].slice(0, 600), b = [...candidate].slice(0, 1200);
  const characters = b.map(char => normalize(char));
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === characters[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const matched = new Set<number>();
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === characters[j]) { matched.add(j); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return b.map((char, index) => ({ text: char, changed: !!characters[index] && !matched.has(index) }));
}
