const paths: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  folder: '<path d="M3 8V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v2M3 9h18l-3 11H2z"/>',
  save: '<path d="M5 3h12l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M7 3v6h10V3M7 21v-8h10v8"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  html: '<path d="M14 2H5v20h14V7zM14 2v6h6m-10 4-3 3 3 3m4-6 3 3-3 3"/>',
  settings: '<path d="m9 3-.5 2-2 .9-1.9-.6-2 3.4 1.5 1.4v2.3L2.6 14l2 3.4 1.9-.6 2 .9.5 2.3h4l.5-2.3 2-.9 1.9.6 2-3.4-1.5-1.6v-2.3l1.5-1.4-2-3.4-1.9.6-2-.9L13 3z"/><circle cx="11" cy="11.5" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  skip: '<path d="m5 5 10 7-10 7zM19 5v14"/>',
  link: '<path d="m10 13 4-4M8 15l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 10a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1" transform="translate(0 -1)"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
  move: '<path d="M3 8V4h6l3 3h8v5M3 8v12h8m2-3h9m-4-4 4 4-4 4"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  undo: '<path d="M3 4v6h6M3 10l4-4a8 8 0 1 1-1 11"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  feather: '<path d="M20 3C12 0 6 6 7 15l3 2c9 0 13-8 10-14ZM3 22 17 7M7 17h6M10 14V9"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11M12 11v10m-3-3 3 3 3-3"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v5m0 3v.1"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
};

export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.bookmark}</svg>`;
}

export function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function iconButton(name: string, label: string, action: string, extra = ''): string {
  return `<button type="button" class="icon-button" aria-label="${escapeHTML(label)}" data-tip="${escapeHTML(label)}" data-action="${action}" ${extra}>${icon(name)}</button>`;
}
