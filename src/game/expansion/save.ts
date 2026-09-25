import { isLocale, type LocaleId } from '../../i18n/messages.ts';
import type { TranslationLevel } from '../../content/languages.ts';
/** Separate additive store: never rewrites campaign/profile/trade/hangar keys. */
export const EXPANSION_KEY = 'vanguard.expansion.v1';
export interface ExpansionSave {
  version: 1; seed: number; selected: string; charted: string[];
  translators: { nacric: TranslationLevel; orunic: TranslationLevel };
  preferences: { ui: LocaleId; subtitles: LocaleId; speech: 'nacric' | 'orunic'; native: boolean };
}
export function newExpansionSave(): ExpansionSave {
  return { version: 1, seed: 1994, selected: 'marches:threshold', charted: [], translators: { nacric: 0, orunic: 0 }, preferences: { ui: 'en-GB', subtitles: 'en-GB', speech: 'nacric', native: true } };
}
export function parseExpansionSave(raw: unknown): ExpansionSave {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid expansion save');
  const r = raw as Partial<ExpansionSave>;
  // Reject future versions instead of silently deleting fields on the next write.
  if (r.version !== 1 || !Number.isSafeInteger(r.seed) || typeof r.selected !== 'string' || r.selected.length > 120) throw new Error('Unsupported expansion save');
  if (!Array.isArray(r.charted) || r.charted.length > 10000 || r.charted.some(id => typeof id !== 'string' || id.length > 120)) throw new Error('Invalid survey records');
  const p = r.preferences, t = r.translators;
  if (!p || !isLocale(p.ui) || !isLocale(p.subtitles) || !['nacric', 'orunic'].includes(p.speech) || typeof p.native !== 'boolean') throw new Error('Invalid language preferences');
  if (!t || ![t.nacric, t.orunic].every(v => Number.isInteger(v) && v >= 0 && v <= 4)) throw new Error('Invalid translator state');
  return { version: 1, seed: r.seed!, selected: r.selected, charted: [...new Set(r.charted)], translators: { ...t }, preferences: { ...p } };
}
export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }
/** Defer the localStorage getter too: privacy modes may throw before getItem is called. */
export const browserExpansionStorage: SaveStorage = {
  getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
};
export function loadExpansion(storage: SaveStorage): { save: ExpansionSave; writable: boolean; error?: string } {
  try {
    const raw = storage.getItem(EXPANSION_KEY);
    return { save: raw ? parseExpansionSave(JSON.parse(raw)) : newExpansionSave(), writable: true };
  } catch (e) { return { save: newExpansionSave(), writable: false, error: String(e) }; }
}
export function saveExpansion(storage: SaveStorage, save: ExpansionSave): boolean {
  try {
    const safe = parseExpansionSave(save);
    const old = storage.getItem(EXPANSION_KEY);
    if (old) { parseExpansionSave(JSON.parse(old)); storage.setItem(`${EXPANSION_KEY}.backup`, old); }
    storage.setItem(EXPANSION_KEY, JSON.stringify(safe));
    return true;
  } catch { return false; }
}
