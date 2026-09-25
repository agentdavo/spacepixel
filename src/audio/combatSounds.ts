/** Authored sound identity, independent of weapon damage/balance. */
export interface WeaponVoice {
  family: 'laser' | 'kinetic' | 'beam';
  pitch: number;
  decay: number;
  body: number;
  crack: number;
  ring: number;
}

export const WEAPON_VOICES: Record<string, WeaponVoice> = {
  laser:      { family: 'laser', pitch: 1650, decay: 0.15, body: 0.15, crack: 0.16, ring: 0.03 },
  heavylaser: { family: 'laser', pitch: 890, decay: 0.28, body: 0.24, crack: 0.2, ring: 0.08 },
  hymn:       { family: 'laser', pitch: 2450, decay: 0.3, body: 0.1, crack: 0.06, ring: 0.16 },
  battery:    { family: 'laser', pitch: 1280, decay: 0.22, body: 0.18, crack: 0.09, ring: 0.12 },
  autocannon: { family: 'kinetic', pitch: 1900, decay: 0.09, body: 0.16, crack: 0.24, ring: 0.02 },
  cannon:     { family: 'kinetic', pitch: 1100, decay: 0.18, body: 0.25, crack: 0.27, ring: 0.04 },
  railgun:    { family: 'kinetic', pitch: 3400, decay: 0.38, body: 0.22, crack: 0.34, ring: 0.13 },
  massdriver: { family: 'kinetic', pitch: 480, decay: 0.52, body: 0.35, crack: 0.22, ring: 0.06 },
  scatter:    { family: 'kinetic', pitch: 820, decay: 0.23, body: 0.24, crack: 0.3, ring: 0.01 },
  flak:       { family: 'kinetic', pitch: 2200, decay: 0.12, body: 0.13, crack: 0.2, ring: 0.025 },
  rustflak:   { family: 'kinetic', pitch: 1200, decay: 0.16, body: 0.16, crack: 0.26, ring: 0.03 },
  flakcannon: { family: 'kinetic', pitch: 650, decay: 0.31, body: 0.28, crack: 0.28, ring: 0.035 },
  lance:      { family: 'beam', pitch: 720, decay: 0.24, body: 0.13, crack: 0.05, ring: 0.1 },
  greatlance: { family: 'beam', pitch: 390, decay: 0.4, body: 0.19, crack: 0.08, ring: 0.13 },
  'capital-lance': { family: 'beam', pitch: 165, decay: 0.65, body: 0.23, crack: 0.11, ring: 0.15 },
};

export interface ImpactVoice {
  type?: 'kinetic' | 'laser' | 'harmonic' | 'explosive';
  amount?: number;
  strength?: number;
  radius?: number;
  faction?: string;
}

export const MISSILE_VOICES = {
  micro: { pitch: 1.25, gain: 0.65, body: 0.07, decay: 0.2 },
  torpedo: { pitch: 0.55, gain: 0.95, body: 0.24, decay: 0.65 },
  harpoon: { pitch: 0.9, gain: 0.7, body: 0.11, decay: 0.35 },
} as const;

export type MissileVoiceId = keyof typeof MISSILE_VOICES;
