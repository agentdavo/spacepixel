import type { VoiceProfile } from './plan';

/**
 * Recorded voices: every written line is spoken ahead of time by a neural
 * speech model (Piper, scripts/voice-record.py) and shipped as a clip under
 * public/voice/. This file says which model voice each speaker gets, and the
 * clip key for a line, so the recorder and the game agree. Pure.
 *
 * Machine voices (the station SYSTEM, the Oracle) keep the procedural synth:
 * they are meant to sound built.
 */
export interface NeuralVoice {
  /** Piper model name (public/voice has no models, only clips). */
  model: string;
  /** Speaker index for multi-speaker models. */
  speaker?: number;
  /** Piper length scale: > 1 slower. */
  length: number;
  /** Resample ratio applied after synthesis: > 1 higher and quicker. */
  pitch: number;
}

const nv = (model: string, length = 1, pitch = 1): NeuralVoice => ({ model, length, pitch });

/** Hand-cast from the writers' notes (docs/LORE.md, CAST_VOICES). */
export const NEURAL_CAST: Record<string, NeuralVoice> = {
  kade: nv('en_GB-cori-high', 1.0), // dry as a checklist
  jackpot: nv('en_US-ryan-high', 0.92), // fastest when afraid
  candle: nv('en_GB-northern_english_male-medium', 1.08, 0.97), // big, gentle, unhurried
  sparrow: nv('en_US-amy-medium', 0.9, 1.03), // nineteen
  salt: nv('en_US-joe-medium', 1.05, 0.98), // used to hope
  oyelaran: nv('en_GB-alan-medium', 1.1, 0.94),
  control: nv('en_GB-jenny_dioco-medium', 0.95),
  rook: nv('en_US-lessac-high', 1.0, 0.97),
  ledger: nv('en_US-hfc_female-medium', 0.97),
  pryce: nv('en_US-norman-medium', 1.02),
  magpie: nv('en_GB-alba-medium', 0.93, 1.02),
  psalm: nv('en_GB-cori-high', 1.05, 1.06),
  zenith: nv('en_GB-alan-medium', 1.15, 0.9),
  quillon: nv('en_GB-northern_english_male-medium', 1.0, 1.04),
  narrator: nv('en_GB-alan-medium', 1.12, 0.95),
  'relight-pilot': nv('en_US-joe-medium', 1.0, 0.96),
};

/** No recording: these stay synthetic on purpose. */
export const SYNTH_ONLY = new Set(['system', 'oracle']);

const POOL_F = ['en_GB-alba-medium', 'en_GB-jenny_dioco-medium', 'en_US-amy-medium', 'en_US-hfc_female-medium', 'en_US-lessac-high', 'en_GB-cori-high'];
const POOL_M = ['en_GB-alan-medium', 'en_GB-northern_english_male-medium', 'en_US-ryan-high', 'en_US-joe-medium', 'en_US-norman-medium'];

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Radio speakers whose profile is rolled per ship: voiced from the id alone. */
const byId = (who: string) => who.startsWith('enemy:') || who.startsWith('traffic:') || who.startsWith('station:');

/** The sex a synth profile was built for (npcVoice: women ≥ 1.12 formant, men ≤ 1.06). */
export const profileSex = (p: VoiceProfile): 'f' | 'm' => (p.formant >= 1.08 ? 'f' : 'm');

/**
 * The model voice for a speaker. `sex` comes from the speaker's data (the
 * recorder) or their synth profile (the game); cast and radio ids ignore it.
 */
export function neuralVoiceFor(who: string, sex: 'f' | 'm'): NeuralVoice | null {
  if (SYNTH_ONLY.has(who) || who.startsWith('system')) return null;
  const cast = NEURAL_CAST[who];
  if (cast) return cast;
  const h = hashStr(who);
  const s = byId(who) ? (h & 1 ? 'f' : 'm') : sex;
  const pool = s === 'f' ? POOL_F : POOL_M;
  // Two people on one model still sound apart: a small pitch and pace offset.
  return nv(pool[(h >>> 1) % pool.length], 0.94 + ((h >>> 8) % 13) * 0.01, 0.95 + ((h >>> 16) % 11) * 0.01);
}

/** Stage directions are read as silence: "(sung) Out of the dust" → "Out of the dust". */
export function spokenText(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The clip key for a line in a voice (file public/voice/<key>.mp3). */
export function clipKey(v: NeuralVoice, text: string): string {
  const id = `${v.model}|${v.speaker ?? 0}|${v.length.toFixed(2)}|${v.pitch.toFixed(2)}|${spokenText(text)}`;
  return (hashStr(id).toString(36) + hashStr(`${id}#`).toString(36)).padStart(12, '0');
}
