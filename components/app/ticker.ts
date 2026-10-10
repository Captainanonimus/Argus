// Same rule as normalizeSymbol in lib/api.ts, usable in the browser.
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;

export function normalizeTicker(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}
