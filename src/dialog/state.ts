import { newDialogState } from './engine';
import type { DialogState, Effect } from './types';

/**
 * Dialog memory (flags, conversations seen, the notebook of rumours and
 * tips, contract / recruit hooks) in localStorage under its own key, plus the
 * hooks other systems register to hear about offers made in conversation.
 */
const KEY = 'vanguard.dialog.v1';

export function loadDialogState(): DialogState {
  const base = newDialogState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const r = JSON.parse(raw) as Partial<DialogState>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return {
      flags: r.flags && typeof r.flags === 'object' ? (r.flags as Record<string, true>) : {},
      seen: r.seen && typeof r.seen === 'object' ? (r.seen as Record<string, number>) : {},
      rumours: arr(r.rumours),
      tips: arr(r.tips),
      codex: arr(r.codex),
      contracts: arr(r.contracts),
      recruits: arr(r.recruits),
    };
  } catch {
    return base;
  }
}

export function saveDialogState(s: DialogState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* session only */
  }
}

/**
 * Hooks for systems that live elsewhere (the contracts board, hiring). A
 * conversation effect `{ contract: id }` calls `onContract(id, stationId)`;
 * `{ recruit: id }` calls `onRecruit(id, stationId)`. Unhooked, the offer is
 * still remembered in DialogState.contracts / .recruits.
 */
export const dialogHooks: {
  onContract: ((id: string, stationId: string) => void) | null;
  onRecruit: ((id: string, stationId: string) => void) | null;
  /** Every applied effect (analytics / debug / other systems). */
  onEffect: ((e: Effect, stationId: string) => void) | null;
} = { onContract: null, onRecruit: null, onEffect: null };
