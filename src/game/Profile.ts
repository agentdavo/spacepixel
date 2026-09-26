import type { Livery } from '@/assets/Blueprint';
import { readCareer, writeCareer } from './CareerStore';

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
    const career = readCareer();
    if (career) return normaliseLedger(career.ledger);
    const raw = localStorage.getItem(LEDGER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normaliseLedger(parsed);
    }
  } catch {
    /* storage unavailable */
  }
  return newLedger();
}

/** Primary career persistence takes precedence over the optional migration backup. */
export function saveLedger(l: TradeLedger): boolean {
  try {
    const career = readCareer();
    if (career) return writeCareer(l, career.hangar);
  } catch { return false; }
  const backupKey = `${LEDGER_KEY}.pre-expansion`;
  let previous: string | null = null;
  try { previous = localStorage.getItem(LEDGER_KEY); } catch { /* still attempt the primary write */ }
  let value: string;
  try { value = JSON.stringify(l); } catch { return false; }
  try {
    localStorage.setItem(LEDGER_KEY, value);
  } catch {
    // Earlier builds could fill the quota with a backup during load. Evict only
    // that optional copy; never remove the primary to make room for a write.
    let backup: string | null = null;
    try {
      backup = localStorage.getItem(backupKey);
      if (backup === null) return false;
      localStorage.removeItem(backupKey);
      localStorage.setItem(LEDGER_KEY, value);
    } catch {
      // Failed setItem is atomic: the previous primary is still intact.
      try { if (backup !== null) localStorage.setItem(backupKey, backup); } catch { /* primary remains intact */ }
      return false;
    }
  }
  // Save a legacy copy only AFTER the new primary is durable and only if it fits.
  try {
    if (previous && !Object.hasOwn(JSON.parse(previous)?.rep ?? {}, 'pelagic') && !localStorage.getItem(backupKey)) localStorage.setItem(backupKey, previous);
  } catch { /* optional backup must never turn a successful primary write into failure */ }
  return true;
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
    const career = readCareer();
    if (career) return normaliseHangar(career.hangar);
    const raw = localStorage.getItem(HANGAR_KEY);
    if (raw) return normaliseHangar(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return newHangar();
}

export function saveHangar(h: Hangar): boolean {
  try {
    const career = readCareer();
    if (career) return writeCareer(career.ledger, h);
    localStorage.setItem(HANGAR_KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

/** Migrate on the first successful shop operation, preserving both legacy keys. */
export function saveCareer(ledger: TradeLedger, hangar: Hangar): boolean {
  return writeCareer(ledger, hangar);
}
