import type { Accent, VoiceProfile } from './plan';

/**
 * Who sounds like what. Every speaking character has a VoiceProfile; the cast
 * are hand-tuned from their writers' notes (docs/LORE.md), everyone else —
 * station people, traffic, enemy Cantors — is derived from a seed and a few
 * traits so the same person always has the same voice.
 */

const v = (f0: number, formant: number, range: number, rate: number, breath: number, jitter: number, rasp: number, accent: Accent, extra: Partial<VoiceProfile> = {}): VoiceProfile => ({
  f0,
  formant,
  range,
  rate,
  breath,
  jitter,
  rasp,
  accent,
  ...extra,
});

/** The prologue narrator: calm, older, unhurried, a little breath in it. */
export const NARRATOR: VoiceProfile = v(92, 0.92, 3.4, 4.8, 0.3, 0.08, 0.12, 'plain', { gain: 1.05 });

export const CAST_VOICES: Record<string, VoiceProfile> = {
  // Vanguard
  kade: v(172, 1.13, 3.2, 5.3, 0.14, 0.1, 0.28, 'directorate'), // dry as a checklist
  jackpot: v(128, 1.0, 7.2, 6.4, 0.12, 0.38, 0.15, 'directorate'), // fastest when afraid
  candle: v(86, 0.86, 2.8, 3.9, 0.26, 0.06, 0.18, 'directorate', { gain: 1.1 }), // big, gentle, unhurried
  sparrow: v(228, 1.2, 7.6, 5.8, 0.2, 0.3, 0.05, 'directorate'), // nineteen
  salt: v(104, 0.95, 2.6, 4.6, 0.32, 0.12, 0.45, 'directorate'), // used to hope
  // The Bastion
  oyelaran: v(96, 0.91, 4.0, 3.8, 0.3, 0.12, 0.3, 'directorate', { gain: 1.05 }),
  control: v(204, 1.16, 4.8, 6.1, 0.1, 0.1, 0.1, 'directorate'),
  rook: v(162, 1.09, 2.4, 4.6, 0.12, 0.05, 0.22, 'directorate'),
  // The Directorate apparatus
  ledger: v(182, 1.12, 2.2, 5.3, 0.08, 0.05, 0.08, 'directorate'), // figures do not flinch
  pryce: v(114, 0.98, 3.0, 4.4, 0.08, 0.04, 0.05, 'directorate'), // reasonable
  // Rustwake
  magpie: v(192, 1.1, 8.2, 6.0, 0.22, 0.45, 0.55, 'rustwake'),
  // The Hegemony
  psalm: v(214, 1.18, 4.4, 4.6, 0.18, 0.08, 0.04, 'choir', { vibrato: 0.12 }),
  zenith: v(100, 0.93, 3.0, 3.5, 0.36, 0.06, 0.16, 'choir', { vibrato: 0.08 }),
  quillon: v(122, 1.0, 5.2, 4.8, 0.14, 0.1, 0.06, 'choir'),
  // Voices without faces
  system: v(112, 1.04, 3, 5.2, 0.02, 0, 0.3, 'machine', { gain: 0.9 }),
  oracle: v(68, 0.9, 1.8, 3.3, 0.12, 0, 0.05, 'oracle', { chorus: [1.5, 2.0], gain: 0.95 }),
  narrator: NARRATOR,
  // Year 212: the first pilot through a relit Lantern ("Lit.").
  'relight-pilot': v(118, 0.98, 5, 4.2, 0.3, 0.2, 0.4, 'rustwake'),
};

export interface VoiceTraits {
  sex: 'f' | 'm';
  age: 'young' | 'adult' | 'old';
  faction: 'concord' | 'choir' | 'rustwake' | 'unknown' | string;
  /** Temperament nudges: nervous speaks faster and jumpier; weary slower and breathier. */
  temper?: 'calm' | 'nervous' | 'weary' | 'loud';
}

function h32(n: number): () => number {
  let a = n >>> 0 || 7;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable voice for anyone not in the cast. */
export function npcVoice(seed: number, t: VoiceTraits): VoiceProfile {
  const r = h32(seed * 2654435761);
  const f = t.sex === 'f';
  let f0 = f ? 178 + r() * 55 : 92 + r() * 42;
  let formant = f ? 1.12 + r() * 0.1 : 0.9 + r() * 0.12;
  let rate = 4.4 + r() * 1.6;
  let breath = 0.08 + r() * 0.2;
  let rasp = r() * 0.35;
  let range = 3 + r() * 4;
  let jitter = 0.05 + r() * 0.25;
  if (t.age === 'old') {
    f0 *= f ? 0.88 : 0.93;
    rate *= 0.85;
    breath += 0.12;
    rasp += 0.15;
    jitter += 0.08;
  } else if (t.age === 'young') {
    f0 *= 1.08;
    formant *= 1.04;
    range += 1.2;
    rate *= 1.05;
  }
  switch (t.temper) {
    case 'nervous':
      rate *= 1.15;
      jitter += 0.2;
      range += 1.5;
      break;
    case 'weary':
      rate *= 0.85;
      breath += 0.12;
      range *= 0.7;
      break;
    case 'loud':
      range += 2;
      rasp += 0.15;
      break;
  }
  const accent: Accent = t.faction === 'choir' ? 'choir' : t.faction === 'rustwake' ? 'rustwake' : t.faction === 'concord' ? 'directorate' : 'plain';
  if (accent === 'rustwake') rasp += 0.15;
  return {
    f0,
    formant,
    range,
    rate,
    breath: Math.min(0.6, breath),
    jitter: Math.min(0.7, jitter),
    rasp: Math.min(0.8, rasp),
    accent,
    vibrato: accent === 'choir' ? 0.08 : 0,
  };
}

const extra = new Map<string, VoiceProfile>();

/** Register a voice for a non-cast speaker id (station people, bark callsigns). */
export function registerVoice(id: string, p: VoiceProfile): void {
  extra.set(id, p);
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The voice for a speaker id; unknown ids get a stable generic voice. */
export function voiceFor(id: string): VoiceProfile {
  const c = CAST_VOICES[id] ?? extra.get(id);
  if (c) return c;
  if (id.startsWith('system')) return CAST_VOICES.system;
  const h = hashStr(id);
  return npcVoice(h, { sex: h & 1 ? 'f' : 'm', age: 'adult', faction: 'unknown' });
}
