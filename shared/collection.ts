import { parseTree, getNodeValue, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { fields, type Collection, type Excerpt } from './types';
import { normalize } from './matching';

export function validateCollection(value: unknown): Collection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('诗集需要是「分类名称 → 摘录数组」格式。');
  const result: Collection = Object.create(null);
  for (const [category, entries] of Object.entries(value)) {
    const name = category.trim();
    if (!name || name.length > 30) throw new Error('分类名称需要为 1–30 个字符。');
    if (Object.hasOwn(result, name)) throw new Error(`分类「${name}」重复。`);
    if (!Array.isArray(entries)) throw new Error(`分类「${name}」的内容需要是数组。`);
    result[name] = entries.map((entry: unknown, i: number) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`「${name}」第 ${i + 1} 条格式不正确。`);
      const excerpt = {} as Excerpt;
      for (const field of fields) {
        const data = (entry as Record<string, unknown>)[field];
        if (data !== undefined && typeof data !== 'string') throw new Error(`「${name}」第 ${i + 1} 条的 ${field} 必须是文字。`);
        excerpt[field] = (data ?? '') as string;
      }
      if (!excerpt.text.trim()) throw new Error(`「${name}」第 ${i + 1} 条缺少诗句。`);
      return excerpt;
    });
  }
  return result;
}

export function parseCollection(input: string): Collection {
  const errors: ParseError[] = [];
  const tree = parseTree(input.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: true });
  if (errors.length) {
    const error = errors[0];
    const line = input.slice(0, error.offset).split('\n').length;
    throw new Error(`JSON 第 ${line} 行格式错误（${printParseErrorCode(error.error)}）。`);
  }
  return validateCollection(tree ? getNodeValue(tree) : undefined);
}

export function serializeCollection(collection: Collection): string {
  return JSON.stringify(validateCollection(collection), null, 2) + '\n';
}

export function countEntries(collection: Collection): number {
  return Object.values(collection).reduce((n, entries) => n + entries.length, 0);
}

export function mergeCollections(current: Collection, incoming: Collection): { collection: Collection; added: number; skipped: number } {
  const collection = validateCollection(current);
  let added = 0;
  let skipped = 0;
  for (const [category, entries] of Object.entries(incoming)) {
    collection[category] ??= [];
    const seen = new Set(collection[category].map(entry => JSON.stringify(fields.map(field => entry[field]))));
    for (const entry of entries) {
      const fingerprint = JSON.stringify(fields.map(field => entry[field]));
      if (seen.has(fingerprint)) { skipped++; continue; }
      seen.add(fingerprint);
      collection[category].push({ ...entry });
      added++;
    }
  }
  return { collection, added, skipped };
}

export function duplicateIndex(entries: Excerpt[], text: string, except = -1): number {
  const key = normalize(text);
  return entries.findIndex((entry, i) => i !== except && normalize(entry.text) === key);
}

export function renameCategory(collection: Collection, from: string, to: string): Collection {
  to = to.trim();
  if (!to || to.length > 30) throw new Error('分类名称需要为 1–30 个字符。');
  if (from !== to && Object.hasOwn(collection, to)) throw new Error('已有同名分类。');
  if (!Object.hasOwn(collection, from)) throw new Error('这个分类已不存在。');
  return Object.fromEntries(Object.entries(collection).map(([key, entries]) => [key === from ? to : key, entries]));
}

export function moveCategory(collection: Collection, category: string, direction: -1 | 1): Collection {
  const entries = Object.entries(collection);
  const index = entries.findIndex(([key]) => key === category);
  const next = index + direction;
  if (index >= 0 && next >= 0 && next < entries.length) [entries[index], entries[next]] = [entries[next], entries[index]];
  return Object.fromEntries(entries);
}

export function escapeEmbeddedJSON(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
