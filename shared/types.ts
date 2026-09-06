export interface Excerpt {
  text: string;
  title: string;
  author: string;
  dynasty: string;
  url: string;
}

export type Collection = Record<string, Excerpt[]>;

export interface Candidate extends Excerpt {
  workKey: string;
  match: 'exact' | 'similar';
  score: number;
  sourceUrl?: string;
  pageTitle?: string;
  evidence?: string;
  autoFill?: boolean;
}

export interface Snapshot {
  version: 1;
  id: string;
  collection: Collection;
  category: string;
}

export const fields = ['text', 'title', 'author', 'dynasty', 'url'] as const;

export function emptyExcerpt(): Excerpt {
  return { text: '', title: '', author: '', dynasty: '', url: '' };
}
