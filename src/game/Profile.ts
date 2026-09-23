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
