export function safeSource(value: string): URL | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}
export function sourceDomain(value: string): string { return safeSource(value)?.hostname ?? ''; }
export function guwendaoSource(value: string): string {
  const url = safeSource(value); if (!url) return '';
  return ['gushiwen.cn', 'guwendao.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : '';
}
