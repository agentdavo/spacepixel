import type { Livery } from '@/assets/Blueprint';

/**
 * The pilot profile: per-viewer conveniences (custom livery, callsign),
 * kept in localStorage. Every access is guarded — private windows or
 * blocked storage just fall back to defaults.
 */
export interface PilotProfile {
  callsign: string;
  livery: Partial<Livery>;
  liveryName: string;
  /** Next campaign episode to play (1-based). */
  episode: number;
  /** The prologue cold open has played once (it runs before Episode 1 of a new profile). */
  seenPrologue: boolean;
}

const KEY = 'vanguard.profile.v1';

export const LIVERY_PRESETS: { name: string; livery: Partial<Livery> }[] = [
  { name: 'DIRECTORATE STANDARD', livery: {} },
  {
    name: 'SKULL LEADER',
    livery: { primary: '#f2efe6', secondary: '#16151c', accent: '#ffcf1f', dark: '#26252e', glow: '#8fd6ff' },
  },
  {
    name: 'CRIMSON ACE',
    livery: { primary: '#c8263a', secondary: '#f1e9dc', accent: '#1c1b24', dark: '#34151c', glow: '#ff8a6b', plumeCore: '#fff0e6' },
  },
  {
    name: 'LOW-VIS GREY',
    livery: { primary: '#9aa1ab', secondary: '#6c737e', accent: '#c7ccd2', dark: '#3a3f47', glow: '#a9e3ff' },
  },
  {
    name: 'ENGINE-WARDEN',
    livery: { primary: '#e4d6b4', secondary: '#6b4a2c', accent: '#d14b1f', dark: '#2c231c', glass: '#ffb347', glow: '#ffc56b' },
  },
  {
    name: 'EBON BLACK-LIGHT',
    livery: { primary: '#1d1a26', secondary: '#3b2f5a', accent: '#b56bff', dark: '#0e0c14', glass: '#c98bff', glow: '#9b5cff', plumeCore: '#f3e6ff' },
  },
];

export function loadProfile(): PilotProfile {
  const base: PilotProfile = { callsign: 'VANGUARD 1', livery: {}, liveryName: LIVERY_PRESETS[0].name, episode: 1, seenPrologue: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<PilotProfile>) };
  } catch {
    /* storage unavailable */
  }
  return base;
}

export function saveProfile(p: PilotProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the change lasts for this session only */
  }
}

// ── Trade ledger (docking & trade): shares, cargo, standing, missile rails ──
// Kept under its own key so the pilot profile above stays untouched.
import { newLedger, normaliseLedger, type TradeLedger } from './economy';

const LEDGER_KEY = 'vanguard.trade.v1';

export function loadLedger(): TradeLedger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (raw) return normaliseLedger(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return newLedger();
}

export function saveLedger(l: TradeLedger): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* storage unavailable — trades last for this session only */
  }
}

// ── Contracts (free-roam career): active jobs, board clock, receipts ──
// Own key, like the ledger: the campaign loop holds a PilotProfile object for
// a whole episode, and saving it must never roll contracts back.
import { newBook, normaliseBook, type ContractBook } from './contracts/contracts';

const CONTRACTS_KEY = 'vanguard.contracts.v1';

export function loadContracts(): ContractBook {
  try {
    const raw = localStorage.getItem(CONTRACTS_KEY);
    if (raw) return normaliseBook(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return newBook();
}

export function saveContracts(b: ContractBook): void {
  try {
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable — contracts last for this session only */
  }
}

// ── Hangar (shipyard & outfitting): owned ships, their fits, the active one ──
// Own key again; an old save without one starts in a stock Kestrel.
import { newHangar, normaliseHangar, type Hangar } from './outfitting/hangar';

const HANGAR_KEY = 'vanguard.hangar.v1';

export function loadHangar(): Hangar {
  try {
    const raw = localStorage.getItem(HANGAR_KEY);
    if (raw) return normaliseHangar(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return newHangar();
}

export function saveHangar(h: Hangar): void {
  try {
    localStorage.setItem(HANGAR_KEY, JSON.stringify(h));
  } catch {
    /* storage unavailable — the hangar lasts for this session only */
  }
}
