import type { Ch, Chord, Mood, MoodDef, MoodPlayer, Scale, StepFn } from '../Music';
import type { ScoreId } from './catalog';
import { CLASSIC_PALETTE, type Palette } from './palette';

/**
 * The eight scores. Each re-orchestrates the mood sequencer in Music.ts:
 *
 *   palette   which patch plays pad / brass / arp / bass / bell / lead / kit
 *   moods     per-mood rewrites: tempo, keys, mode, progression, a whole new
 *             groove (Rustwake's city-pop cruise), melody register
 *   extra     score parts layered over every mood: Concord's string
 *             ostinato and timpani, the Choir's tremolo + orchestra hits,
 *             Border Line's Simmons fills and sequencer bass…
 *
 * Only type imports from Music.ts (it imports this file at runtime), so the
 * scales used here are local copies.
 */
const MAJOR: Scale = [0, 2, 4, 5, 7, 9, 11];
const MINOR: Scale = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN: Scale = [0, 2, 4, 6, 7, 9, 11];
const DORIAN: Scale = [0, 2, 3, 5, 7, 9, 10];

export interface MoodPatch {
  bpm?: number;
  keys?: readonly number[];
  scale?: Scale;
  prog?: readonly Chord[];
  levels?: Partial<Record<Ch, number>>;
  sends?: Partial<Record<Ch, number>>;
  /** Replace the mood's melody rule (null = no melody). */
  melody?: MoodDef['melody'] | null;
  /** Replace the mood's step entirely (a different groove). */
  step?: StepFn;
  /** Replace the score's extra parts for this mood (null = none). */
  extra?: StepFn | null;
  swing?: number;
}

export interface ScoreDef {
  id: ScoreId;
  palette: Palette;
  /** Tempo factor on every mood. */
  tempo: number;
  /** Semitones added to every mood's keys. */
  transpose: number;
  /** Added to every mood's melody seed (new tunes). */
  seed: number;
  swing?: number;
  /** false: ignore per-place variants (the original score stays itself). */
  variants?: boolean;
  /** Ensemble-chorus send per channel. */
  chorus: Partial<Record<Ch, number>>;
  levels?: Partial<Record<Ch, number>>;
  sends?: Partial<Record<Ch, number>>;
  /** Reverb room: impulse length (s), brightness 0..1, return level. */
  verb?: { seconds: number; brightness: number; ret: number };
  moods?: Partial<Record<Mood, MoodPatch>>;
  extra?: StepFn;
}

// ════════════════════════════════════════════════════════════════════════
// Shared parts
// ════════════════════════════════════════════════════════════════════════
/** Chord root folded into the timpani range (MIDI 36..47). */
const timpRoot = (p: MoodPlayer, tone = 0): number => {
  const r = p.harm.toneNear(tone, 42);
  return r - 12 * Math.ceil((r - 47) / 12);
};

/** Crescendo timpani roll over the back half of the bar before a phrase. */
function timpaniRoll(p: MoodPlayer, s: number, t: number, from = 8, peak = 0.75): void {
  if (s < from) return;
  const k = (s - from) / (16 - from);
  p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.2 + k * peak, 0.5);
}

/** Spiccato string ostinato on the chord (the mecha-battle engine room). */
const OSTINATO = [0, 0, 2, 0, 1, 0, 2, 3] as const;
function stringOstinato(p: MoodPlayer, s: number, t: number, center: number, vel: number): void {
  if (s % 2 !== 0) return;
  const i = OSTINATO[s / 2] % p.harm.n;
  const m = p.harm.toneNear(i, center) + (s === 12 ? 12 : 0);
  p.rack.strings(p.ch.strings, t, m, p.D * 1.6, vel, 0.012, 0.07, 1.4);
}

/** Choir "aah" on the chord, into the formant bank. */
function choirChord(p: MoodPlayer, t: number, center: number, count: number, dur: number, vel: number, attack = 0.8): void {
  const n = p.harm.voicing(center, count, p.voice);
  for (let i = 0; i < n; i++) p.ins.choir(p.strip.formant, t + i * 0.05, p.voice[i], dur, vel, attack, 1.5);
}

/** Orchestra hit (ORCH5) on the chord. */
function orchHit(p: MoodPlayer, t: number, center: number, vel: number): void {
  const n = p.harm.voicing(center, 3, p.voice);
  for (let i = 0; i < n; i++) p.rack.orchHit(p.ch.brass, t, p.voice[i], vel);
  p.rack.orchHit(p.ch.brass, t, p.harm.toneNear(0, center - 12), vel * 0.8);
}

const chordLen = (p: MoodPlayer): number => p.chordBars * 16 * p.D;

// ════════════════════════════════════════════════════════════════════════
// Concord: Castellan Fleet March
// ════════════════════════════════════════════════════════════════════════
const concordExtra: StepFn = (p, s, t) => {
  const D = p.D;
  const I = p.I;
  switch (p.mood) {
    case 'combat':
      if (I > 0.3) stringOstinato(p, s, t, 57, 0.2 + 0.25 * I);
      if (I > 0.5 && s === 0 && p.barInCycle % 4 === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.85);
      if (I > 0.5 && p.barInCycle % 8 === 7) timpaniRoll(p, s, t, 10, 0.6);
      break;
    case 'title':
      if (p.bar >= 4 && s === 0 && p.chordBar === 0) p.rack.strings(p.ch.strings, t, p.harm.toneNear(1, 79), chordLen(p), 0.45, 0.6, 1.2, 1.2);
      if (p.barInCycle === 15) timpaniRoll(p, s, t, 8, 0.7);
      if (p.bar >= 16 && s === 0 && p.barInCycle % 4 === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.8);
      break;
    case 'cruise':
      if (s === 0 && p.chordBar === 0 && p.bar >= 2) p.rack.strings(p.ch.strings, t, p.harm.toneNear(2, 84), chordLen(p), 0.22, 1.8, 2.5, 0.8);
      break;
    case 'briefing':
      if (s === 0 || s === 6 || s === 8 || (s === 14 && p.rng.chance(0.5))) p.rack.pizz(p.ch.strings, t, p.harm.toneNear(s === 8 ? 2 : 0, 50), 0.55);
      break;
    case 'victory':
      if (p.bar === 0 && s === 0) for (const n of [0, 4, 7, 12]) p.rack.strings(p.ch.strings, t + 4 * D, p.key + n, 44 * D, 0.5, 0.2, 2);
      break;
  }
};

// ════════════════════════════════════════════════════════════════════════
// Choir: Cathedral Liturgy
// ════════════════════════════════════════════════════════════════════════
const choirExtra: StepFn = (p, s, t) => {
  const D = p.D;
  const I = p.I;
  switch (p.mood) {
    case 'combat':
      if (s === 0 && p.chordBar === 0 && I > 0.2) {
        const n = p.harm.voicing(60, 3, p.voice);
        for (let i = 0; i < n; i++) p.rack.tremolo(p.ch.strings, t, p.voice[i], chordLen(p), 0.35 + 0.3 * I);
      }
      if (s === 0 && p.chordBar === 0 && I > 0.4) choirChord(p, t, 64, 3, chordLen(p), 0.45, 0.25);
      if (I > 0.55 && s === 0 && p.barInCycle % 4 === 0) orchHit(p, t, 72, 0.9);
      if (I > 0.3 && (s === 0 || s === 6)) p.rack.timpani(p.ch.drums, t, timpRoot(p, s === 6 ? 2 : 0), s === 0 ? 0.8 : 0.55, 0.9);
      if (I > 0.4 && p.barInCycle % 8 === 7) timpaniRoll(p, s, t, 8, 0.7);
      break;
    case 'cruise':
      if (p.chordBar === 0 && s % 2 === 0) {
        const n = p.harm.voicing(55, 8, p.voice);
        p.rack.harp(p.ch.arp, t, p.voice[(s / 2) % n], 0.4, 1.6);
      }
      if (s === 0 && p.bar % 4 === 0) {
        p.ins.choir(p.strip.formant, t, p.harm.toneNear(0, 57), 64 * D, 0.4, 3, 3);
        p.ins.choir(p.strip.formant, t + 0.6, p.harm.toneNear(2, 64), 60 * D, 0.35, 3, 3);
      }
      break;
    case 'briefing':
      if (s === 0 && p.bar % 2 === 0) {
        p.strip.vowel(1, t, 1);
        p.ins.choir(p.strip.formant, t, p.harm.toneNear(0, 55), 32 * D, 0.45, 2, 2);
      }
      break;
    case 'title':
      if (s === 0 && p.bar >= 8 && p.bar % 4 === 0) choirChord(p, t, 67, 3, 64 * D, 0.45, 1.5);
      if (p.bar >= 16 && s === 0 && p.barInCycle % 4 === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.8);
      if (p.barInCycle === 15 && p.bar >= 8) timpaniRoll(p, s, t, 8, 0.6);
      break;
    case 'dread':
      if (s === 0 && p.bar % 4 === 0) {
        p.rack.tremolo(p.ch.strings, t, p.harm.key, 64 * D, 0.3, 2.5, 2);
        p.rack.tremolo(p.ch.strings, t + 1, p.harm.key + 1, 60 * D, 0.2, 3, 2);
      }
      break;
    case 'sublime':
      if (s % 4 === 0 && p.rng.chance(0.08)) p.rack.harp(p.ch.arp, t, p.harm.key + 24 + [0, 4, 7, 11, 14][p.rng.int(5)], 0.3, 2.4);
      break;
  }
};

// ════════════════════════════════════════════════════════════════════════
// Rustwake: Rustwake Nights (city-pop noir)
// ════════════════════════════════════════════════════════════════════════
/** Slap line: step → [chord tone, octave up (pop), length in 16ths, velocity]. */
const SLAP: readonly (readonly [number, number, number, number] | null)[] = [
  [0, 0, 3, 0.95], null, null, [0, 0, 1, 0.55], null, null, [0, 12, 1, 0.8], null,
  [0, 0, 2, 0.85], null, [2, 0, 1, 0.65], [3, 0, 1, 0.55], null, null, [0, 12, 1, 0.8], null,
];

/** i7 – IV7 Dorian vamp: Juno chords, e-piano offbeat comp, slap bass, LinnDrum + clap. */
const rustCruise: StepFn = (p, s, t) => {
  const D = p.D;
  const I = p.I;
  if (s === 0) {
    p.strip.layer('drums', 0.5 + 0.3 * I, t, 0.5);
    if (p.chordBar === 0) p.chord('pad', t, 60, 4, chordLen(p), 0.5, 0.3, 1.2, 1600);
  }
  if (s === 3 || s === 6 || s === 11 || (s === 14 && p.rng.chance(0.5))) {
    const n = p.harm.voicing(64, 4, p.voice);
    for (let i = 0; i < n; i++) p.rack.epiano(p.ch.arp, t, p.voice[i], 1.6 * D, 0.4);
  }
  const b = SLAP[s];
  if (b && p.bar >= 1) {
    const m = p.harm.toneNear(b[0] % p.harm.n, 40) + b[1];
    p.rack.slap(p.ch.bass, t, m, b[2] * D, b[3], b[1] > 0);
  } else if (!b && s % 2 === 1 && p.rng.chance(0.12)) p.rack.slap(p.ch.bass, t, p.harm.toneNear(0, 40), 0.5 * D, 0.3);
  if (p.bar >= 2) {
    if (s === 0 || s === 10 || (s === 7 && p.rng.chance(0.4))) p.ins.kick(p.ch.drums, t, s === 0 ? 0.9 : 0.75);
    if (s === 4 || s === 12) p.ins.snare(p.ch.drums, t, 0.75);
    p.ins.hat(p.ch.drums, t, s % 4 === 2 ? 0.42 : s % 2 === 0 ? 0.28 : 0.15, s === 14 && p.bar % 2 === 1);
  }
};

const rustExtra: StepFn = (p, s, t) => {
  const I = p.I;
  if (p.mood === 'combat') {
    if (I > 0.6 && s % 4 === 2) p.rack.cowbell(p.ch.drums, t, 0.6);
    if (I > 0.35 && (s === 3 || s === 11)) {
      const n = p.harm.voicing(64, 3, p.voice);
      for (let i = 0; i < n; i++) p.rack.epiano(p.ch.arp, t, p.voice[i], 1.4 * p.D, 0.4);
    }
  } else if (p.mood === 'briefing') {
    if (s === 0 && p.chordBar === 0) {
      const n = p.harm.voicing(62, 4, p.voice);
      for (let i = 0; i < n; i++) p.rack.epiano(p.ch.arp, t, p.voice[i], chordLen(p) * 0.6, 0.35);
    }
  }
};

// ════════════════════════════════════════════════════════════════════════
// Contested: Border Line
// ════════════════════════════════════════════════════════════════════════
const SIMMONS = [52, 48, 45, 41] as const;
const contestedExtra: StepFn = (p, s, t) => {
  const I = p.I;
  if (p.mood === 'combat') {
    if (I > 0.35 && p.barInCycle % 4 === 3 && s >= 8 && s % 2 === 0) p.ins.tom(p.ch.drums, t, SIMMONS[(s - 8) / 2], 0.75);
    if (I > 0.6 && s === 0 && p.barInCycle % 8 === 0) orchHit(p, t, 70, 0.85);
  } else if (p.mood === 'cruise' || p.mood === 'briefing') {
    // Sequencer bass: straight 8ths, octave kick on the last of each half-bar.
    if (p.bar >= 2 && s % 2 === 0) p.rack.synthBass(p.ch.bass, t, p.harm.toneNear(0, 40) + (s % 8 === 6 ? 12 : 0), 1.2 * p.D, 0.35 + (s % 4 === 0 ? 0.15 : 0));
    if (p.mood === 'cruise' && s === 0 && p.bar % 8 === 7) p.ins.tom(p.ch.drums, t + 8 * p.D, 45, 0.5);
  }
};

// ════════════════════════════════════════════════════════════════════════
// Dead Zone: The Long Dark
// ════════════════════════════════════════════════════════════════════════
const deadzoneExtra: StepFn = (p, s, t) => {
  const D = p.D;
  if (p.mood === 'cruise' || p.mood === 'briefing') {
    if (s === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.32, 0.9);
    else if (s === 3) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.2, 0.7);
  }
  if (p.mood !== 'combat' && s === 0 && p.bar % 4 === 0) p.rack.tremolo(p.ch.strings, t, p.harm.key - 12 * Math.ceil((p.harm.key - 50) / 12), 64 * D, 0.28, 3, 2.5);
  if (p.mood === 'combat' && (s === 0 || s === 8) && p.I > 0.3) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.7, 1);
};

// ════════════════════════════════════════════════════════════════════════
// The Anchor
// ════════════════════════════════════════════════════════════════════════
const monolithExtra: StepFn = (p, s, t) => {
  const D = p.D;
  if (p.bar % 8 === 7 && s === 4) p.rack.susCymbal(p.ch.drums, t, 0.7, 12 * D);
  if (s % 4 === 0 && p.rng.chance(0.12)) p.rack.celesta(p.ch.bell, t, p.harm.toneNear(p.rng.int(p.harm.n), 88), 0.35, 2);
  if (p.mood !== 'combat' && p.mood !== 'sublime' && s === 0 && p.bar % 4 === 0) choirChord(p, t, 62, 3, 64 * D, 0.35, 3);
  if (p.mood === 'combat' && p.I > 0.3 && (s === 0 || s === 10)) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.75, 1.1);
};

// ════════════════════════════════════════════════════════════════════════
// Nexus: Symphony of Gates
// ════════════════════════════════════════════════════════════════════════
const nexusExtra: StepFn = (p, s, t) => {
  const D = p.D;
  const I = p.I;
  switch (p.mood) {
    case 'combat':
      if (I > 0.25) stringOstinato(p, s, t, 60, 0.22 + 0.25 * I);
      if (I > 0.5 && s === 0 && p.chordBar === 0) choirChord(p, t, 67, 3, chordLen(p), 0.4, 0.3);
      if (I > 0.4 && s === 0 && p.barInCycle % 2 === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.85);
      if (I > 0.4 && p.barInCycle % 8 === 7) timpaniRoll(p, s, t, 8, 0.7);
      if (I > 0.7 && s === 0 && p.barInCycle % 8 === 0) orchHit(p, t, 72, 0.8);
      break;
    case 'title':
      if (s === 0 && p.bar >= 4 && p.bar % 4 === 0) choirChord(p, t, 67, 4, 64 * D, 0.4, 2);
      if (p.bar >= 16 && s === 0 && p.barInCycle % 4 === 0) p.rack.timpani(p.ch.drums, t, timpRoot(p), 0.85);
      if (p.barInCycle === 15) timpaniRoll(p, s, t, 8, 0.75);
      break;
    case 'cruise':
      if (s === 0 && p.bar % 4 === 0) choirChord(p, t, 62, 3, 64 * D, 0.3, 3);
      break;
    case 'victory':
      if (p.bar === 0 && s === 0) choirChord(p, t + 4 * D, 67, 4, 44 * D, 0.5, 0.2);
      break;
  }
};

// ════════════════════════════════════════════════════════════════════════
// Catalog
// ════════════════════════════════════════════════════════════════════════
export const SCORES: Record<ScoreId, ScoreDef> = {
  classic: { id: 'classic', palette: CLASSIC_PALETTE, tempo: 1, transpose: 0, seed: 0, variants: false, chorus: {} },

  concord: {
    id: 'concord',
    palette: { pad: 'juno', brass: 'hybrid', arp: 'classic', bass: 'classic', bell: 'classic', lead: 'synth', drone: 'strings', kit: '909', strings: 0.75 },
    tempo: 1,
    transpose: 0,
    seed: 83,
    chorus: { pad: 0.5, lead: 0.25, strings: 0.3 },
    levels: { strings: 0.7, lead: 0.55 },
    moods: {
      combat: { bpm: 160 },
      cruise: { melody: (p) => ({ on: p.bar >= 4 && Math.floor(p.bar / 8) % 2 === 0, center: 79, density: 1 }) },
    },
    extra: concordExtra,
  },

  choir: {
    id: 'choir',
    palette: { pad: 'glass', brass: 'horns', arp: 'harp', bass: 'cello', bell: 'celesta', lead: 'violin', drone: 'strings', kit: 'orch', strings: 0.85 },
    tempo: 0.95,
    transpose: -1,
    seed: 331,
    chorus: { pad: 0.3, strings: 0.2 },
    levels: { strings: 0.7, drums: 0.9, choir: 0.8 },
    sends: { strings: 0.55, lead: 0.45 },
    verb: { seconds: 4.6, brightness: 0.5, ret: 0.36 },
    moods: {
      combat: {
        bpm: 138,
        scale: MINOR,
        keys: [51, 51, 53, 54],
        prog: [{ d: 0 }, { d: 5 }, { d: 6 }, { d: 0 }, { d: 3 }, { d: 5 }, { d: 4, q: 'maj' }, { d: 4, q: 'maj' }, { d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }, { d: 3 }, { d: 6 }, { d: 4, q: 'sus' }, { d: 4, q: 'maj' }],
        melody: (p) => ({ on: p.I > 0.55, center: 76, density: p.I > 0.8 ? 1 : 0 }),
      },
      cruise: { bpm: 64 },
    },
    extra: choirExtra,
  },

  rustwake: {
    id: 'rustwake',
    palette: { pad: 'juno', brass: 'classic', arp: 'epiano', bass: 'slap', bell: 'epiano', lead: 'sax', drone: 'classic', kit: 'linn', strings: 0 },
    tempo: 1,
    transpose: 0,
    seed: 427,
    swing: 0.14,
    chorus: { pad: 0.7, arp: 0.5, lead: 0.2 },
    levels: { lead: 0.62 },
    sends: { lead: 0.3, arp: 0.3 },
    verb: { seconds: 2.2, brightness: 0.6, ret: 0.28 },
    moods: {
      cruise: {
        bpm: 98,
        scale: DORIAN,
        keys: [57, 57, 55, 57],
        prog: [{ d: 0, x: 7, bars: 2 }, { d: 3, x: 7, bars: 2 }, { d: 0, x: 7, bars: 2 }, { d: 6, bars: 1 }, { d: 4, q: 'min', x: 7, bars: 1 }],
        melody: (p) => ({ on: p.bar >= 4 && Math.floor(p.bar / 8) % 2 === 0, center: 72, density: 1 }),
        levels: { drums: 0.6, arp: 0.5, bass: 0.75, pad: 0.45 },
        step: rustCruise,
      },
      combat: { bpm: 136, melody: (p) => ({ on: p.I > 0.55, center: 74, density: p.I > 0.8 ? 2 : 1 }) },
    },
    extra: rustExtra,
  },

  contested: {
    id: 'contested',
    palette: { pad: 'solina', brass: 'orchHit', arp: 'classic', bass: 'synth', bell: 'classic', lead: 'synth', drone: 'classic', kit: 'linn', strings: 0.3 },
    tempo: 1,
    transpose: -2,
    seed: 606,
    chorus: { pad: 0.8, strings: 0.4, lead: 0.2 },
    moods: {
      combat: {
        bpm: 148,
        scale: MINOR,
        keys: [54, 54, 56, 52],
        prog: [{ d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }, { d: 0 }, { d: 5 }, { d: 3 }, { d: 4, q: 'maj' }, { d: 5 }, { d: 6 }, { d: 0 }, { d: 0 }, { d: 3 }, { d: 5 }, { d: 4, q: 'sus' }, { d: 4, q: 'maj' }],
      },
      cruise: {
        bpm: 84,
        scale: MINOR,
        keys: [54, 54, 52, 57],
        prog: [{ d: 0, bars: 2 }, { d: 5, bars: 2 }, { d: 3, bars: 2 }, { d: 4, q: 'maj', bars: 2 }],
        melody: (p) => ({ on: p.bar >= 8 && Math.floor(p.bar / 8) % 2 === 1, center: 76, density: 0 }),
        levels: { bass: 0.55 },
      },
    },
    extra: contestedExtra,
  },

  deadzone: {
    id: 'deadzone',
    palette: { pad: 'glass', brass: 'horns', arp: 'celesta', bass: 'cello', bell: 'celesta', lead: 'flute', drone: 'strings', kit: 'orch', strings: 0.5 },
    tempo: 0.85,
    transpose: -2,
    seed: 1111,
    chorus: { pad: 0.3, strings: 0.3 },
    levels: { drums: 0.7, lead: 0.5 },
    sends: { lead: 0.6, strings: 0.6 },
    verb: { seconds: 5.2, brightness: 0.35, ret: 0.42 },
    moods: {
      cruise: {
        scale: MINOR,
        keys: [52, 52, 50, 52],
        prog: [{ d: 0, bars: 4 }, { d: 5, bars: 2 }, { d: 3, bars: 2 }],
        melody: (p) => ({ on: p.bar % 8 >= 4, center: 74, density: 0 }),
      },
    },
    extra: deadzoneExtra,
  },

  monolith: {
    id: 'monolith',
    palette: { pad: 'strings', brass: 'horns', arp: 'harp', bass: 'cello', bell: 'celesta', lead: 'strings', drone: 'strings', kit: 'orch', strings: 0 },
    tempo: 0.9,
    transpose: 0,
    seed: 1212,
    chorus: { strings: 0.25 },
    levels: { strings: 0.8, choir: 0.75 },
    sends: { strings: 0.6, lead: 0.55 },
    verb: { seconds: 5.5, brightness: 0.5, ret: 0.38 },
    moods: {
      cruise: {
        bpm: 60,
        scale: LYDIAN,
        keys: [50, 52],
        prog: [{ d: 0, x: 9, bars: 4 }, { d: 1, bars: 4 }, { d: 5, bars: 2 }, { d: 4, q: 'sus', bars: 2 }],
        melody: (p) => ({ on: p.bar >= 8 && Math.floor(p.bar / 8) % 2 === 1, center: 79, density: 0 }),
      },
    },
    extra: monolithExtra,
  },

  nexus: {
    id: 'nexus',
    palette: { pad: 'juno', brass: 'hybrid', arp: 'classic', bass: 'synth', bell: 'classic', lead: 'synth', drone: 'strings', kit: '909', strings: 0.9 },
    tempo: 1.04,
    transpose: 1,
    seed: 1919,
    chorus: { pad: 0.5, lead: 0.3, strings: 0.3 },
    levels: { strings: 0.75, choir: 0.75 },
    verb: { seconds: 3.8, brightness: 0.6, ret: 0.34 },
    moods: {
      title: { scale: MAJOR },
    },
    extra: nexusExtra,
  },
};
