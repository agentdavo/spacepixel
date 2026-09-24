import type { AudioEngine } from './AudioEngine';
import { Rng, makeImpulse } from './dsp';
import { OvaRack } from './score/rack';
import { PatchedIns, type InsLike } from './score/palette';
import { SCORE_INFO, variantShape, type ScoreId } from './score/catalog';
import { SCORES, type ScoreDef } from './score/scores';

/**
 * Generative OVA score.
 *
 * A 16th-note sequencer per mood, scheduled with look-ahead on the
 * AudioContext clock (the "two clocks" pattern: a JS timer wakes up every
 * 50 ms and schedules whatever falls inside the next ~200 ms). Offline renders
 * call `pump()` from OfflineAudioContext.suspend() callbacks instead.
 *
 * Harmony is the anime idiom: I–V–vi–IV, the "royal road" IV–V–iii–vi,
 * bVI–bVII–I fanfares, truck-driver key changes. Melodies are generated from
 * rules (chord tones on strong beats, stepwise passing tones, motif → sequence
 * → variation → cadence) with a seeded RNG, so a mood always sounds like
 * itself but motifs mutate as the cycles roll over.
 *
 * Moods crossfade (each has its own player and output gain); `setIntensity`
 * adds layers inside a mood (e.g. drums and brass in combat as enemies close).
 *
 * Scores (src/audio/score/) sit on top: a score re-orchestrates every mood
 * (palette of patches, key, tempo, swing, reverb) and layers its own parts
 * (string ostinati, timpani, slap-bass grooves…); a variant reseeds the
 * melodies per star system / episode. `setScore` crossfades the running mood
 * into the new orchestration.
 */
export type Mood = 'title' | 'briefing' | 'cruise' | 'combat' | 'sublime' | 'dread' | 'victory' | 'defeat';
export const MOODS: readonly Mood[] = ['title', 'briefing', 'cruise', 'combat', 'sublime', 'dread', 'victory', 'defeat'];
export type StingerKind = 'victory' | 'defeat' | 'lock' | 'jump';

export type Ch = 'pad' | 'brass' | 'arp' | 'bass' | 'bell' | 'drums' | 'choir' | 'drone' | 'strings' | 'lead';
const CHANNELS: readonly Ch[] = ['pad', 'brass', 'arp', 'bass', 'bell', 'drums', 'choir', 'drone', 'strings', 'lead'];

export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
export const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;
export const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;
export const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
export const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10] as const;
export type Scale = readonly number[];

export interface Chord {
  /** Scale degree of the root, 0-based (0 = I). */
  d: number;
  bars?: number;
  q?: 'maj' | 'min' | 'sus' | 'dim';
  /** Add the diatonic 7th, or an added 9th. */
  x?: 7 | 9;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

// ════════════════════════════════════════════════════════════════════════
// Harmony
// ════════════════════════════════════════════════════════════════════════
export class Harmony {
  key = 60;
  scale: Scale = MAJOR;
  rootDeg = 0;
  /** MIDI root of the current chord, in the key's octave. */
  root = 60;
  /** Chord tones as semitones above root. */
  readonly tones = new Int16Array(4);
  n = 3;

  degMidi(deg: number): number {
    const o = Math.floor(deg / 7);
    return this.key + this.scale[deg - o * 7] + 12 * o;
  }

  set(key: number, scale: Scale, c: Chord): void {
    this.key = key;
    this.scale = scale;
    this.rootDeg = c.d;
    const r = this.degMidi(c.d);
    this.root = r;
    const third = c.q === 'maj' ? 4 : c.q === 'min' ? 3 : c.q === 'sus' ? 5 : this.degMidi(c.d + 2) - r;
    const fifth = c.q === 'dim' ? 6 : c.q ? 7 : this.degMidi(c.d + 4) - r;
    this.tones[0] = 0;
    this.tones[1] = third;
    this.tones[2] = fifth;
    this.n = 3;
    if (c.x === 7) {
      this.tones[3] = this.degMidi(c.d + 6) - r;
      this.n = 4;
    } else if (c.x === 9) {
      this.tones[3] = this.degMidi(c.d + 1) - r + 12;
      this.n = 4;
    }
  }

  isTone(m: number): boolean {
    const pc = mod(m - this.root, 12);
    for (let i = 0; i < this.n; i++) if (this.tones[i] % 12 === pc) return true;
    return false;
  }

  /** Close voicing of `count` chord tones starting just below `center`. */
  voicing(center: number, count: number, out: Int16Array): number {
    let k = 0;
    for (let m = center - 6; m < center + 30 && k < count; m++) if (this.isTone(m)) out[k++] = m;
    return k;
  }

  /** Chord tone `i` placed in the octave nearest `target`. */
  toneNear(i: number, target: number): number {
    const m = this.root + this.tones[i % this.n];
    return m + 12 * Math.round((target - m) / 12);
  }

  /** Melody note `off` scale degrees above the chord root (respects chromatic thirds). */
  melodyNote(off: number): number {
    const o = Math.floor(off / 7);
    if (off - o * 7 === 2) return this.root + this.tones[1] + 12 * o;
    if (off - o * 7 === 4) return this.root + this.tones[2] + 12 * o;
    return this.degMidi(this.rootDeg + off);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Melody: motif → sequence → variation → cadence
// ════════════════════════════════════════════════════════════════════════
interface Rhythm {
  s: readonly number[];
  l: readonly number[];
}
const RHYTHMS: readonly (readonly Rhythm[])[] = [
  [
    { s: [0], l: [16] },
    { s: [0, 8], l: [8, 8] },
    { s: [0, 12], l: [12, 4] },
    { s: [0, 6], l: [6, 10] },
  ],
  [
    { s: [0, 4, 8, 12], l: [4, 4, 4, 4] },
    { s: [0, 6, 8, 12], l: [6, 2, 4, 4] },
    { s: [0, 3, 6, 8, 12], l: [3, 3, 2, 4, 4] },
    { s: [0, 8, 10, 12], l: [8, 2, 2, 4] },
    { s: [0, 4, 6, 8], l: [4, 2, 2, 8] },
  ],
  [
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: [2, 2, 2, 2, 2, 2, 2, 2] },
    { s: [0, 3, 6, 8, 10, 12, 14], l: [3, 3, 2, 2, 2, 2, 2] },
    { s: [0, 2, 3, 6, 8, 11, 12, 14], l: [2, 1, 3, 2, 3, 1, 2, 2] },
    { s: [0, 2, 4, 8, 10, 12], l: [2, 2, 4, 2, 2, 4] },
  ],
];
const CHORD_OFFS = [0, 2, 4, 7] as const;

class Melody {
  private mS = new Int8Array(8);
  private mO = new Int8Array(8);
  private mL = new Int8Array(8);
  private mN = 0;
  readonly s = new Int8Array(10);
  readonly m = new Int16Array(10);
  readonly l = new Int8Array(10);
  n = 0;
  private rng = new Rng(1);
  private vr = new Rng(2);

  newMotif(seed: number, variantSeed: number, density: number): void {
    const r = this.rng;
    r.reseed(seed);
    this.vr.reseed(variantSeed);
    const set = RHYTHMS[Math.max(0, Math.min(2, density))];
    const rh = set[r.int(set.length)];
    let prev = r.chance(0.5) ? 2 : 4;
    let dir = r.chance(0.6) ? 1 : -1;
    const n = Math.min(8, rh.s.length);
    for (let i = 0; i < n; i++) {
      const st = rh.s[i];
      let off = prev;
      if (i > 0) {
        if (st % 4 === 0) {
          // Strong beat: a chord tone near where the contour is heading.
          const want = prev + dir * 2;
          let best: number = CHORD_OFFS[0];
          let bd = 99;
          for (const c of CHORD_OFFS) {
            const d = Math.abs(c - want) + (r.chance(0.3) ? 1 : 0);
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
          off = best;
          if (off < 7 && r.chance(0.15)) off = off === 0 ? 4 : 7; // the anime leap (to a chord tone)
        } else {
          off = prev + (r.chance(0.75) ? dir : -dir);
        }
        if (r.chance(0.25)) dir = -dir;
      }
      if (off > 9) {
        off = 9;
        dir = -1;
      } else if (off < -3) {
        off = -3;
        dir = 1;
      }
      this.mS[i] = st;
      this.mO[i] = off;
      this.mL[i] = rh.l[i];
      prev = off;
    }
    this.mN = n;
  }

  /** Realise bar `b` (0..3) of a 4-bar phrase against the current chord. */
  realize(b: number, h: Harmony, center: number, finalCadence: boolean): void {
    let n = 0;
    if (b === 3) {
      // Cadence: a long chord tone, sometimes with pickups into the next phrase.
      const target = finalCadence ? 0 : this.vr.chance(0.5) ? 2 : 4;
      this.s[0] = 0;
      this.m[0] = target;
      if (this.vr.chance(0.55)) {
        this.l[0] = 12;
        this.s[1] = 12;
        this.m[1] = target + 1;
        this.l[1] = 2;
        this.s[2] = 14;
        this.m[2] = target + 2;
        this.l[2] = 2;
        n = 3;
      } else {
        this.l[0] = 16;
        n = 1;
      }
    } else {
      for (let i = 0; i < this.mN; i++) {
        this.s[i] = this.mS[i];
        this.m[i] = this.mO[i];
        this.l[i] = this.mL[i];
      }
      n = this.mN;
      if (b === 2 && n > 1) {
        // Variation: nudge a weak note, or lift the first note to the next chord tone.
        const i = 1 + this.vr.int(n - 1);
        if (this.s[i] % 4 !== 0) this.m[i] += this.vr.chance(0.5) ? 1 : -1;
        else this.m[0] = this.m[0] === 4 ? 7 : 4;
      }
    }
    // Offsets → MIDI; octave chosen so the first note sits nearest `center`.
    let shift = 0;
    for (let i = 0; i < n; i++) {
      const midi = h.melodyNote(this.m[i]);
      if (i === 0) shift = 12 * Math.round((center - midi) / 12);
      this.m[i] = midi + shift;
    }
    this.n = n;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Channel strip + mood player
// ════════════════════════════════════════════════════════════════════════
export class Strip {
  readonly out: GainNode;
  readonly ch: Record<Ch, GainNode>;
  /** Input of the choir formant bank (routes into ch.choir). */
  readonly formant: GainNode;
  private f1: BiquadFilterNode;
  private f2: BiquadFilterNode;
  /** Ensemble-chorus LFOs (stopped on dispose). */
  private lfos: OscillatorNode[] = [];

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    verb: AudioNode,
    levels: Partial<Record<Ch, number>>,
    sends: Partial<Record<Ch, number>>,
    chorus: Partial<Record<Ch, number>> = {},
  ) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    // Juno-style stereo ensemble: two modulated delays panned apart, fed per channel.
    let chorusIn: GainNode | null = null;
    for (const c of CHANNELS) if ((chorus[c] ?? 0) > 0) chorusIn = chorusIn ?? ctx.createGain();
    if (chorusIn) {
      for (const [delay, rate, pan] of [
        [0.0115, 0.52, -0.75],
        [0.0165, 0.83, 0.75],
      ] as const) {
        const d = ctx.createDelay(0.05);
        d.delayTime.value = delay;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate;
        const lg = ctx.createGain();
        lg.gain.value = 0.0028;
        lfo.connect(lg).connect(d.delayTime);
        lfo.start();
        this.lfos.push(lfo);
        const pn = ctx.createStereoPanner();
        pn.pan.value = pan;
        chorusIn.connect(d).connect(pn).connect(this.out);
      }
    }
    const ch = {} as Record<Ch, GainNode>;
    for (const c of CHANNELS) {
      const g = ctx.createGain();
      g.gain.value = levels[c] ?? DEFAULT_LEVELS[c];
      g.connect(this.out);
      const s = sends[c] ?? DEFAULT_SENDS[c];
      if (s > 0) {
        const sg = ctx.createGain();
        sg.gain.value = s;
        g.connect(sg).connect(verb);
      }
      const cz = chorus[c] ?? 0;
      if (cz > 0 && chorusIn) {
        const cg = ctx.createGain();
        cg.gain.value = cz;
        g.connect(cg).connect(chorusIn);
      }
      ch[c] = g;
    }
    this.ch = ch;
    // Choir formants ("aah"): two resonant band-passes plus a little body.
    this.formant = ctx.createGain();
    const mk = (f: number, q: number, gain: number) => {
      const b = ctx.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f;
      b.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      this.formant.connect(b).connect(g).connect(ch.choir);
      return b;
    };
    this.f1 = mk(730, 5, 2.2);
    this.f2 = mk(1090, 7, 1.6);
    mk(2440, 10, 0.9);
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 420;
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    this.formant.connect(body).connect(bg).connect(ch.choir);
  }

  /** Glide the choir vowel (0 = "ah", 1 = "oh"). */
  vowel(v: number, t: number, tc: number): void {
    this.f1.frequency.setTargetAtTime(730 - 160 * v, t, tc);
    this.f2.frequency.setTargetAtTime(1090 - 250 * v, t, tc);
  }

  layer(c: Ch, v: number, t: number, tc = 0.4): void {
    this.ch[c].gain.setTargetAtTime(v, t, tc);
  }

  dispose(): void {
    for (const o of this.lfos) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
      o.disconnect();
    }
    this.lfos.length = 0;
    this.out.disconnect();
  }
}

const DEFAULT_LEVELS: Record<Ch, number> = { pad: 0.55, brass: 0.7, arp: 0.5, bass: 0.8, bell: 0.6, drums: 0.8, choir: 0.7, drone: 0.7, strings: 0.75, lead: 0.6 };
const DEFAULT_SENDS: Record<Ch, number> = { pad: 0.35, brass: 0.25, arp: 0.2, bass: 0.02, bell: 0.5, drums: 0.12, choir: 0.6, drone: 0.3, strings: 0.45, lead: 0.35 };

export type StepFn = (p: MoodPlayer, s: number, t: number) => void;

export interface MoodDef {
  bpm: number;
  seed: number;
  scale: Scale;
  /** Tonic per progression cycle (key changes), cycling. */
  keys: readonly number[];
  prog: readonly Chord[];
  levels?: Partial<Record<Ch, number>>;
  sends?: Partial<Record<Ch, number>>;
  /** Melody register centre (MIDI) and density 0..2 as a function of the player. */
  melody?: (p: MoodPlayer) => { on: boolean; center: number; density: number };
  /** Starts at full level with no fade (stings). */
  instant?: boolean;
  step(p: MoodPlayer, s: number, t: number): void;
  /** Score-specific parts layered after `step` (string ostinati, timpani, grooves). */
  extra?: StepFn;
  /** Delay of odd 16ths as a fraction of a 16th (0 = straight, ~0.15 = city-pop shuffle). */
  swing?: number;
}

export class MoodPlayer {
  readonly strip: Strip;
  readonly ins: PatchedIns;
  readonly harm = new Harmony();
  readonly mel = new Melody();
  readonly rng: Rng;
  readonly voice = new Int16Array(8);
  readonly D: number; // seconds per 16th
  /** Bars since the mood started, current bar within cycle, cycle count. */
  bar = -1;
  barInCycle = 0;
  cycle = 0;
  chordIdx = 0;
  chordBar = 0; // bar within current chord
  chordChanged = false;
  chordBars = 1;
  prevBass: number | null = null;
  private stepN = 0;
  private nextTime: number;
  private cycleBars: number;
  endAt = Infinity;
  melOn = false;
  private swingT: number;
  private leadCh: GainNode;

  constructor(
    readonly music: Music,
    readonly mood: Mood,
    readonly def: MoodDef,
    ctx: BaseAudioContext,
    start: number,
    fade: number,
    readonly score: ScoreDef,
    verb: AudioNode,
  ) {
    this.strip = new Strip(ctx, music.moodBus!, verb, def.levels ?? {}, def.sends ?? {}, score.chorus);
    this.ins = new PatchedIns(music.rack!, score.palette, this.strip.ch, () => this.harm.root);
    this.D = 60 / def.bpm / 4;
    this.swingT = (def.swing ?? 0) * this.D;
    // Bell melodies keep the bell channel's mix (the original score is unchanged).
    this.leadCh = score.palette.lead === 'bell' ? this.strip.ch.bell : this.strip.ch.lead;
    this.rng = new Rng(def.seed);
    this.nextTime = start;
    let bars = 0;
    for (const c of def.prog) bars += c.bars ?? 1;
    this.cycleBars = Math.max(1, bars);
    const g = this.strip.out.gain;
    if (def.instant || fade <= 0.05) g.setValueAtTime(1, start);
    else {
      g.setValueAtTime(0, ctx.currentTime);
      g.linearRampToValueAtTime(1, start + fade);
    }
  }

  /** The raw rack, for score parts that ask for a specific patch. */
  get rack(): OvaRack {
    return this.music.rack!;
  }
  get ch(): Record<Ch, GainNode> {
    return this.strip.ch;
  }
  /** Smoothed global intensity 0..1. */
  get I(): number {
    return this.music.level;
  }
  get key(): number {
    return this.harm.key;
  }

  fadeOut(now: number, fade: number): void {
    const g = this.strip.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
    this.endAt = now + Math.max(0.05, fade);
  }

  schedule(until: number, now: number): void {
    // Fell behind (tab suspended, context interrupted): skip ahead, don't burst.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
    while (this.nextTime < until && this.nextTime < this.endAt) {
      const s = this.stepN % 16;
      const t = s % 2 === 1 ? this.nextTime + this.swingT : this.nextTime;
      if (s === 0) this.newBar();
      this.def.step(this, s, t);
      this.def.extra?.(this, s, t);
      this.playMelody(s, t);
      this.stepN++;
      this.nextTime += this.D;
    }
  }

  private newBar(): void {
    this.bar++;
    const def = this.def;
    this.barInCycle = this.bar % this.cycleBars;
    this.cycle = Math.floor(this.bar / this.cycleBars);
    let b = this.barInCycle;
    let idx = 0;
    while (idx < def.prog.length - 1 && b >= (def.prog[idx].bars ?? 1)) {
      b -= def.prog[idx].bars ?? 1;
      idx++;
    }
    const key = def.keys[this.cycle % def.keys.length];
    this.chordChanged = b === 0 || idx !== this.chordIdx || key !== this.harm.key;
    this.chordIdx = idx;
    this.chordBar = b;
    this.chordBars = def.prog[idx].bars ?? 1;
    this.harm.set(key, def.scale, def.prog[idx]);

    const m = def.melody?.(this);
    this.melOn = !!m && m.on;
    if (m && m.on) {
      const phrase = Math.floor(this.bar / 4);
      const barInPhrase = this.bar % 4;
      if (barInPhrase === 0 && phrase % 2 === 0) {
        // New motif every 8 bars; 3 recurring motifs per mood, variations drift with the cycle.
        const which = (phrase / 2) % 3;
        this.mel.newMotif(def.seed * 31 + which * 977 + m.density * 13, def.seed + phrase * 7919, m.density);
      }
      this.mel.realize(barInPhrase, this.harm, m.center, phrase % 2 === 1);
    }
  }

  private playMelody(s: number, t: number): void {
    if (!this.melOn) return;
    const mel = this.mel;
    for (let i = 0; i < mel.n; i++) {
      if (mel.s[i] !== s) continue;
      const len = mel.l[i] * this.D;
      this.ins.lead(this.leadCh, t, mel.m[i], 0.55 + (s % 4 === 0 ? 0.25 : 0), len);
    }
  }

  // ── helpers for mood scripts ─────────────────────────────────────────
  /** Chord voiced around `center` on `inst`. */
  chord(inst: 'pad' | 'brass', t: number, center: number, count: number, dur: number, vel: number, a?: number, b?: number, c?: number): void {
    const n = this.harm.voicing(center, count, this.voice);
    for (let i = 0; i < n; i++) {
      if (inst === 'pad') this.ins.pad(this.ch.pad, t, this.voice[i], dur, vel, a, b, c);
      else this.ins.brass(this.ch.brass, t, this.voice[i], dur, vel, a, b);
    }
  }

  bassNote(t: number, center: number, dur: number, vel: number, degreeTone = 0, slide = false): void {
    const m = this.harm.toneNear(degreeTone, center);
    this.ins.bass(this.ch.bass, t, m, dur, vel, slide ? this.prevBass : null);
    this.prevBass = m;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Mood scripts
// ════════════════════════════════════════════════════════════════════════
const ARP_PATTERN = [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 3] as const;
const STAB_PATTERNS: readonly (readonly number[])[] = [
  [0, 3, 6],
  [0, 6, 10],
  [0, 3, 6, 12, 14],
  [0, 10],
  [0, 6, 8, 14],
];
const KICK_PATTERNS: readonly (readonly number[])[] = [
  [0, 8],
  [0, 6, 8],
  [0, 8, 10],
  [0, 3, 8, 11],
];
const SUBLIME_SETS: readonly (readonly number[])[] = [
  [0, 7, 14, 16, 18, 21, 23],
  [-2, 5, 12, 14, 17, 19, 24],
  [3, 10, 15, 17, 19, 22, 26],
  [0, 7, 12, 14, 16, 19, 21],
];

function inPattern(p: readonly number[], s: number): boolean {
  for (let i = 0; i < p.length; i++) if (p[i] === s) return true;
  return false;
}

export const DEFS: Record<Mood, MoodDef> = {
  // Heroic, slow build: pad → bells → bass/arp → brass + drums, then a whole-step key change.
  title: {
    bpm: 88,
    seed: 1994,
    scale: MAJOR,
    keys: [62, 62, 64, 64],
    prog: [{ d: 0, x: 9 }, { d: 4 }, { d: 5 }, { d: 3, x: 9 }, { d: 0 }, { d: 4 }, { d: 5 }, { d: 3 }, { d: 3 }, { d: 4 }, { d: 2 }, { d: 5 }, { d: 3 }, { d: 4 }, { d: 4, q: 'sus' }, { d: 0 }],
    melody: (p) => ({ on: p.bar >= 4, center: 79, density: p.bar >= 16 ? 1 : 0 }),
    step(p, s, t) {
      const D = p.D;
      const b = p.bar;
      const full = b >= 16;
      if (s === 0) p.chord('pad', t, 62, 4, 16 * D + 0.1, full ? 0.7 : 0.9, b < 8 ? 1.4 : 0.3, 1.2, full ? 2200 : 1500);
      if (b >= 8) {
        if (s === 0) p.bassNote(t, 38, 6 * D, 0.85, 0, true);
        else if (s === 6) p.bassNote(t, 38, 2 * D, 0.7, 0);
        else if (s === 8) p.bassNote(t, 38, 7 * D, 0.8, p.rng.chance(0.5) ? 2 : 0, true);
        if (s % 2 === 0) {
          p.harm.voicing(64, 6, p.voice);
          p.ins.arp(p.ch.arp, t, p.voice[ARP_PATTERN[(s / 2) % 8] % 6], 1.5 * D, full ? 0.6 : 0.4, full ? 1.1 : 0.7);
        }
      }
      if (full) {
        if (s === 0) p.chord('brass', t, 62, 3, 5 * D, 0.8, 1.1);
        else if (s === 6) p.chord('brass', t, 62, 3, 1.5 * D, 0.65, 1);
        else if (s === 8 && p.barInCycle % 2 === 1) p.chord('brass', t, 62, 3, 3 * D, 0.7, 1);
        if (s === 0 || s === 8 || (s === 10 && p.rng.chance(0.4))) p.ins.kick(p.ch.drums, t, 0.9);
        if (s === 4 || s === 12) p.ins.snare(p.ch.drums, t, 0.8);
        if (s % 2 === 0) p.ins.hat(p.ch.drums, t, s % 4 === 2 ? 0.55 : 0.35);
        if (s === 0 && p.barInCycle % 8 === 0) p.ins.crash(p.ch.drums, t, 0.9);
      }
      // Fill into the next cycle (and into the drums' first entry).
      if (p.barInCycle === 15 && b >= 15 && s >= 8) {
        if (s % 2 === 0 || s >= 12) p.ins.snare(p.ch.drums, t, 0.35 + (s - 8) * 0.08, false);
        if (s === 8) p.ins.tom(p.ch.drums, t, 50, 0.7);
        if (s === 10) p.ins.tom(p.ch.drums, t, 45, 0.7);
      }
    },
  },

  // Tense, sparse: muted pulse, clock ticks, a lonely bell.
  briefing: {
    bpm: 84,
    seed: 83,
    scale: MINOR,
    keys: [57],
    prog: [{ d: 0, bars: 2 }, { d: 5 }, { d: 6 }, { d: 0, bars: 2 }, { d: 3 }, { d: 4, q: 'maj' }],
    levels: { arp: 0.55, drums: 0.6 },
    step(p, s, t) {
      const D = p.D;
      const I = p.I;
      if (s === 0 && p.chordChanged && p.chordBar === 0) {
        p.chord('pad', t, 55, 3, p.chordBars * 16 * D, 0.8, 1.5, 2, 800);
        if (I > 0.6) p.chord('brass', t, 50, 3, p.chordBars * 16 * D * 0.8, 0.45, 0.35, 1.5);
      }
      if (s === 0 && p.bar % 4 === 0) p.ins.drone(p.ch.drone, t, p.harm.key - 12, 64 * D, 0.5, 2, 3);
      if (s % 2 === 0) p.ins.arp(p.ch.arp, t, p.harm.toneNear(0, 45), D, s % 4 === 0 ? 0.65 : 0.4, 0.3);
      if (s % 4 === 2) p.ins.hat(p.ch.drums, t, 0.18);
      if ((s === 0 && p.rng.chance(0.35)) || (s === 8 && p.rng.chance(0.2))) p.ins.bell(p.ch.bell, t, p.harm.toneNear(p.rng.int(3), 76), 0.5, 2.5);
      if (I > 0.3 && (s === 0 || (s === 10 && p.rng.chance(0.4)))) p.ins.kick(p.ch.drums, t, 0.5);
    },
  },

  // Calm, spacious: lydian maj7 pads, fretless bass, sparkle arps. No drums unless pressed.
  cruise: {
    bpm: 72,
    seed: 7,
    scale: LYDIAN,
    keys: [53, 53, 55, 50],
    prog: [{ d: 0, x: 7, bars: 2 }, { d: 1, bars: 2 }, { d: 5, x: 7, bars: 2 }, { d: 4, q: 'sus', bars: 1 }, { d: 4, bars: 1 }],
    melody: (p) => ({ on: p.bar >= 4 && Math.floor(p.bar / 8) % 2 === 0, center: 81, density: 0 }),
    levels: { bell: 0.5, drums: 0.5 },
    sends: { bell: 0.7, pad: 0.5 },
    step(p, s, t) {
      const D = p.D;
      const I = p.I;
      if (s === 0 && p.chordBar === 0) {
        p.chord('pad', t, 62, 5, p.chordBars * 16 * D + 0.4, 0.8, 1.8, 3, 1800);
        p.bassNote(t, 38, p.chordBars * 16 * D * 0.95, 0.6, 0, true);
      }
      if (s === 12 && p.chordBar === p.chordBars - 1 && p.chordBars > 1 && p.rng.chance(0.45)) p.bassNote(t, 38, 4 * D, 0.45, 2, true);
      if (s % 2 === 0 && p.rng.chance(0.28 + I * 0.3)) {
        const n = p.harm.voicing(76, 5, p.voice);
        p.ins.bell(p.ch.bell, t, p.voice[(s / 2) % n], 0.25, 1.6);
      }
      if (I > 0.35 && s % 2 === 0) p.ins.hat(p.ch.drums, t, s % 4 === 2 ? 0.15 : 0.08);
      if (I > 0.5 && (s === 0 || s === 10)) p.ins.kick(p.ch.drums, t, 0.45);
    },
  },

  // Driving 156 bpm royal-road battle theme; intensity adds drums, brass, lead.
  combat: {
    bpm: 156,
    seed: 156,
    scale: MAJOR,
    keys: [55, 55, 57, 58],
    prog: [{ d: 3 }, { d: 4 }, { d: 2 }, { d: 5 }, { d: 3 }, { d: 4 }, { d: 2 }, { d: 5 }, { d: 5 }, { d: 3 }, { d: 4 }, { d: 0 }, { d: 5 }, { d: 3 }, { d: 4, q: 'sus' }, { d: 4 }],
    melody: (p) => ({ on: p.I > 0.62, center: 79, density: p.I > 0.82 ? 2 : 1 }),
    levels: { pad: 0.35, arp: 0.45, bell: 0.55 },
    step(p, s, t) {
      const D = p.D;
      const I = p.I;
      const bic = p.barInCycle;
      if (s === 0) {
        const st = p.strip;
        st.layer('drums', I > 0.18 ? 0.85 : 0.35, t, 0.3);
        st.layer('brass', I > 0.45 ? 0.75 : 0, t, 0.3);
        p.chord('pad', t, 60, 3, 16 * D, 0.45, 0.08, 0.3, 1100);
      }
      // Bass: pumping 8ths with octave pops.
      if (s % 2 === 0) {
        const up = s === 6 || s === 14;
        const fifth = s === 10 && p.rng.chance(0.35);
        const m = p.harm.toneNear(fifth ? 2 : 0, 40) + (up ? 12 : 0);
        p.ins.bass(p.ch.bass, t, m, 1.5 * D, s % 4 === 0 ? 0.9 : 0.7, s === 0 && p.chordChanged ? p.prevBass : null);
        p.prevBass = m;
      }
      // 16th arpeggio.
      if (s === 0) p.harm.voicing(67, 6, p.voice);
      p.ins.arp(p.ch.arp, t, p.voice[ARP_PATTERN[s] % 6], D, 0.45 + I * 0.25, 0.6 + I * 0.6);
      // Hats always; 16ths once it heats up.
      if (s % 2 === 0) p.ins.hat(p.ch.drums, t, s % 4 === 2 ? 0.5 : 0.32, s === 14 && p.rng.chance(0.3));
      else if (I > 0.5) p.ins.hat(p.ch.drums, t, 0.16);
      if (I > 0.18) {
        const kp = KICK_PATTERNS[(p.bar * 7 + p.def.seed) % KICK_PATTERNS.length];
        if (inPattern(kp, s)) p.ins.kick(p.ch.drums, t, s === 0 ? 1 : 0.85);
        if (s === 4 || s === 12) p.ins.snare(p.ch.drums, t, 0.8);
        else if (s === 15 && p.rng.chance(0.2)) p.ins.snare(p.ch.drums, t, 0.25, false);
        if (s === 0 && bic % 8 === 0 && I > 0.3) p.ins.crash(p.ch.drums, t, 0.85);
        if (bic % 8 === 7 && I > 0.3) {
          if (s >= 12) p.ins.snare(p.ch.drums, t, 0.4 + (s - 12) * 0.15, false);
          if (s === 8) p.ins.tom(p.ch.drums, t, 52, 0.8);
          if (s === 10) p.ins.tom(p.ch.drums, t, 47, 0.8);
        }
      }
      if (I > 0.45) {
        if (bic % 8 === 0) {
          if (s === 0) p.chord('brass', t, 64, 3, 6 * D, 0.85, 1.2);
        } else {
          const sp = STAB_PATTERNS[(p.bar * 3 + 1) % STAB_PATTERNS.length];
          if (inPattern(sp, s)) p.chord('brass', t, 64, 3, 1.6 * D, s === 0 ? 0.8 : 0.65, 1);
        }
      }
    },
  },

  // 2001 / Clarke: sustained clusters, slow swells, choir, no drums.
  sublime: {
    bpm: 40,
    seed: 2001,
    scale: LYDIAN,
    keys: [50],
    prog: [{ d: 0, bars: 8 }],
    levels: { choir: 0.8, pad: 0.6, drone: 0.6, bell: 0.35 },
    sends: { choir: 0.8, pad: 0.7, bell: 0.9, drone: 0.4 },
    step(p, s, t) {
      const D = p.D;
      const key = p.harm.key;
      if (s === 0 && p.bar % 2 === 0) {
        const set = SUBLIME_SETS[(p.bar / 2) % SUBLIME_SETS.length];
        const dur = 32 * D + 1.5;
        p.ins.drone(p.ch.drone, t, key - 12 + set[0], dur, 0.55, 4, 5);
        // Choir: 4 notes of the set, staggered entries.
        for (let i = 0; i < 4; i++) {
          const idx = i === 0 ? 1 : 2 + ((i * 3 + p.bar) % (set.length - 2));
          p.ins.choir(p.strip.formant, t + i * 0.45, key + set[idx], dur - i * 0.45, 0.55, 3.5, 5);
        }
        // Shimmering sine cluster, slowly detuning.
        for (let i = 0; i < 3; i++) {
          const m = key + set[set.length - 1 - i] + 12;
          p.ins.sine(p.ch.pad, t + 1 + i * 0.7, m, dur - 2, 0.4, 4, 5, (i - 1) * 14);
        }
        p.strip.vowel(p.rng.next(), t, 3);
      }
      // "Sunrise" swell every 8 bars; intensity makes it bigger.
      if (s === 0 && p.bar % 8 === 4) {
        const sw = [0, 7, 12, 16, 19];
        for (let i = 0; i < sw.length; i++) p.ins.brass(p.ch.brass, t, key - 12 + sw[i], 20 * D, 0.35 + p.I * 0.4, 0.5, 5);
      }
      if (p.rng.chance(0.07)) {
        const set = SUBLIME_SETS[Math.floor(p.bar / 2) % SUBLIME_SETS.length];
        p.ins.bell(p.ch.bell, t, key + 24 + set[p.rng.int(set.length)], 0.18, 3);
      }
    },
  },

  // Low drones, phrygian dread, distant metal groans, a heartbeat under pressure.
  dread: {
    bpm: 56,
    seed: 666,
    scale: PHRYGIAN,
    keys: [38],
    prog: [{ d: 0, bars: 2 }, { d: 1, bars: 2 }, { d: 0, bars: 2 }, { d: 6, q: 'dim', bars: 2 }],
    levels: { drone: 0.9, bass: 0.7, bell: 0.5, pad: 0.45 },
    sends: { bell: 0.9, drone: 0.4 },
    step(p, s, t) {
      const D = p.D;
      const key = p.harm.key;
      const I = p.I;
      if (s === 0 && p.bar % 4 === 0) {
        p.ins.drone(p.ch.drone, t, key, 64 * D + 1, 0.6, 3, 3);
        p.ins.drone(p.ch.drone, t + 2, key + 13, 56 * D, 0.2, 4, 3);
      }
      if (s === 0 && p.chordBar === 0) {
        p.bassNote(t, 31, p.chordBars * 16 * D * 0.9, 0.55);
        if (I > 0.6) p.chord('brass', t, 45, 3, p.chordBars * 16 * D * 0.7, 0.4, 0.3, 1.5);
      }
      if (s === 0 && p.bar % 4 === 2) {
        p.ins.pad(p.ch.pad, t, key + 18, 32 * D, 0.4, 2, 3, 600);
        p.ins.pad(p.ch.pad, t, key + 24, 32 * D, 0.35, 2.5, 3, 600);
      }
      if (s === p.rng.int(16) && p.rng.chance(0.3)) p.ins.bell(p.ch.bell, t, 38 + p.rng.int(6), 0.35, 4, 1.41);
      if (I > 0.25 && (s === 0 || s === 3)) p.ins.kick(p.ch.drums, t, s === 0 ? 0.6 : 0.4);
      if (s === 0 && p.bar % 8 === 6) {
        p.ins.sine(p.ch.pad, t, key + 49, 32 * D, 0.14, 3, 3, 20);
        p.ins.sine(p.ch.pad, t + 0.5, key + 50, 30 * D, 0.12, 3, 3, -20);
      }
    },
  },

  // Fanfare sting, then a warm held tail.
  victory: {
    bpm: 126,
    seed: 11,
    scale: MAJOR,
    keys: [60],
    prog: [{ d: 0, x: 9, bars: 4 }],
    instant: true,
    step(p, s, t) {
      if (p.bar === 0 && s === 0) victoryFanfare(p.ins, p.strip, t, p.D, p.key);
      if (p.bar >= 3 && p.bar % 4 === 3 && s === 0) p.chord('pad', t, 64, 5, 64 * p.D, 0.55, 2, 3, 1600);
      if (p.bar >= 4 && s % 4 === 0 && p.rng.chance(0.12)) p.ins.bell(p.ch.bell, t, p.harm.toneNear(p.rng.int(4), 84), 0.2, 2);
    },
  },

  defeat: {
    bpm: 66,
    seed: 13,
    scale: MINOR,
    keys: [48],
    prog: [{ d: 0, bars: 4 }],
    instant: true,
    step(p, s, t) {
      if (p.bar === 0 && s === 0) defeatSting(p.ins, p.strip, t, p.D, p.key);
      if (p.bar >= 2 && p.bar % 4 === 2 && s === 0) {
        p.chord('pad', t, 55, 3, 64 * p.D, 0.45, 3, 4, 700);
        p.ins.drone(p.ch.drone, t, p.key - 12, 64 * p.D, 0.35, 4, 4);
      }
    },
  },
};

// ── stings ─────────────────────────────────────────────────────────────
function victoryFanfare(ins: InsLike, st: Strip, t: number, D: number, key: number): void {
  const br = st.ch.brass;
  const dr = st.ch.drums;
  const chord = (at: number, notes: readonly number[], dur: number, vel: number, bright = 1.2) => {
    for (const n of notes) ins.brass(br, at, key + n, dur, vel, bright);
  };
  // Pickup: three quick dominants.
  for (let i = 0; i < 3; i++) chord(t + i * D, [7, -5], 0.8 * D, 0.8);
  ins.snare(dr, t, 0.35, false);
  ins.snare(dr, t + D, 0.45, false);
  ins.snare(dr, t + 2 * D, 0.55, false);
  const t1 = t + 4 * D;
  chord(t1, [0, 4, 7, 12], 11 * D, 0.95, 1.3);
  ins.bass(st.ch.bass, t1, key - 24, 11 * D, 0.9);
  ins.kick(dr, t1, 1);
  ins.crash(dr, t1, 0.9);
  const arp = [12, 16, 19, 24, 28];
  for (let i = 0; i < arp.length; i++) ins.bell(st.ch.bell, t1 + i * D, key + arp[i], 0.6, 1.4);
  const t2 = t + 16 * D;
  chord(t2, [-4, 0, 3, 8], 6 * D, 0.85);
  ins.bass(st.ch.bass, t2, key - 28, 6 * D, 0.85);
  ins.tom(dr, t2 + 6 * D, 47, 0.6);
  chord(t2 + 8 * D, [-2, 2, 5, 10], 6 * D, 0.9);
  ins.bass(st.ch.bass, t2 + 8 * D, key - 26, 6 * D, 0.85);
  for (let i = 0; i < 4; i++) ins.snare(dr, t2 + (12 + i) * D, 0.35 + i * 0.15, false);
  const t3 = t + 32 * D;
  chord(t3, [-12, 0, 4, 7, 12, 16], 22 * D, 1, 1.4);
  ins.bass(st.ch.bass, t3, key - 24, 20 * D, 1);
  ins.kick(dr, t3, 1);
  ins.crash(dr, t3, 1);
  ins.bell(st.ch.bell, t3, key + 24, 0.8, 2.5);
  ins.bell(st.ch.bell, t3 + D, key + 31, 0.6, 2.5);
}

function defeatSting(ins: InsLike, st: Strip, t: number, D: number, key: number): void {
  const br = st.ch.brass;
  const chord = (at: number, notes: readonly number[], dur: number, vel: number) => {
    for (const n of notes) ins.brass(br, at, key + n, dur, vel, 0.45, 0.15);
  };
  chord(t, [-4, 0, 3], 8 * D, 0.55);
  ins.bass(st.ch.bass, t, key - 16, 8 * D, 0.6);
  const lead = [19, 17, 15, 14];
  for (let i = 0; i < lead.length; i++) ins.bell(st.ch.bell, t + i * 4 * D, key + lead[i], 0.4, 1.8, 1);
  chord(t + 8 * D, [-7, -4, 0], 8 * D, 0.55);
  ins.bass(st.ch.bass, t + 8 * D, key - 19, 8 * D, 0.6);
  const t2 = t + 16 * D;
  chord(t2, [-12, -5, 0, 3], 24 * D, 0.5);
  ins.bass(st.ch.bass, t2, key - 24, 24 * D, 0.65);
  ins.bell(st.ch.bell, t2, key + 12, 0.35, 3, 1);
  ins.tom(st.ch.drums, t2, 36, 0.6);
}

// ════════════════════════════════════════════════════════════════════════
// Music
// ════════════════════════════════════════════════════════════════════════
export class Music {
  rack: OvaRack | null = null;
  /** Mixes all mood players (and stings) into the engine's music bus. */
  moodBus: GainNode | null = null;
  private players: MoodPlayer[] = [];
  private current: MoodPlayer | null = null;
  private sting: Strip | null = null;
  private stingIns: PatchedIns | null = null;
  private stingScore: ScoreDef | null = null;
  /** One convolver per score room, built on first use. */
  private verbs = new Map<string, ConvolverNode>();
  private wanted: Mood | null = null;
  private wantedFade = 0;
  private scoreDef: ScoreDef = SCORES.classic;
  private scoreVariant = 0;
  private target = 0;
  /** Smoothed intensity, 0..1. */
  level = 0;
  private lastPump = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Look-ahead window (s). */
  lookahead = 0.2;

  constructor(private engine: AudioEngine) {
    engine.onReady((ctx) => this.init(ctx));
  }

  private init(ctx: BaseAudioContext): void {
    const e = this.engine;
    this.rack = new OvaRack(ctx, e.noise!, e.pink!);
    this.moodBus = ctx.createGain();
    // Clean up sub-rumble and leave room for SFX bass.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 32;
    this.moodBus.connect(hp).connect(e.music!);
    if (e.live && typeof setInterval !== 'undefined') this.timer = setInterval(() => this.pump(), 50);
    if (this.wanted) {
      const m = this.wanted;
      this.wanted = null;
      this.setMood(m, this.wantedFade);
    }
  }

  /** The reverb room for a score (the original 3.4 s hall unless the score books another). */
  private verbFor(sc: ScoreDef): ConvolverNode {
    const ctx = this.engine.ctx!;
    const room = sc.verb ?? { seconds: 3.4, brightness: 0.55, ret: 0.32 };
    const key = `${room.seconds}/${room.brightness}/${room.ret}`;
    let v = this.verbs.get(key);
    if (!v) {
      v = ctx.createConvolver();
      v.normalize = false;
      v.buffer = makeImpulse(ctx, room.seconds, 0x0a5, room.brightness, 0.03);
      const ret = ctx.createGain();
      ret.gain.value = room.ret;
      v.connect(ret).connect(this.moodBus!);
      this.verbs.set(key, v);
    }
    return v;
  }

  get mood(): Mood | null {
    return this.wanted ?? this.current?.mood ?? null;
  }

  /** The score now orchestrating the music. */
  get score(): ScoreId {
    return this.scoreDef.id;
  }

  get variant(): number {
    return this.scoreVariant;
  }

  /** Human title of the current score. */
  get scoreTitle(): string {
    return SCORE_INFO[this.scoreDef.id].title;
  }

  /**
   * Re-orchestrate: switch score (and per-place variant). The running mood
   * crossfades over `fade` seconds into the same mood in the new score;
   * stings (victory/defeat) finish in the score they started in.
   */
  setScore(id: ScoreId, variant = 0, fade = 3): void {
    const sc = SCORES[id] ?? SCORES.classic;
    const v = sc.variants === false ? 0 : variant;
    if (sc === this.scoreDef && v === this.scoreVariant) return;
    this.scoreDef = sc;
    this.scoreVariant = v;
    const cur = this.current;
    if (!cur || cur.def.instant || !this.engine.ctx || !this.rack) return;
    cur.fadeOut(this.engine.ctx.currentTime, fade);
    this.current = null;
    this.setMood(cur.mood, fade);
  }

  /** The mood's definition as this score + variant orchestrates it. */
  private resolve(mood: Mood): MoodDef {
    const base = DEFS[mood];
    const sc = this.scoreDef;
    const patch = sc.moods?.[mood] ?? {};
    const vs = variantShape(this.scoreVariant);
    const tr = sc.transpose + vs.transpose;
    const extra = patch.extra === null ? undefined : (patch.extra ?? sc.extra);
    return {
      ...base,
      bpm: (patch.bpm ?? base.bpm) * sc.tempo * vs.tempo,
      seed: base.seed + sc.seed + vs.seed,
      keys: (patch.keys ?? base.keys).map((k) => k + tr),
      scale: patch.scale ?? base.scale,
      prog: patch.prog ?? base.prog,
      levels: { ...sc.levels, ...base.levels, ...patch.levels },
      sends: { ...sc.sends, ...base.sends, ...patch.sends },
      melody: patch.melody === null ? undefined : (patch.melody ?? base.melody),
      step: patch.step ?? base.step,
      extra,
      swing: patch.swing ?? sc.swing,
    };
  }

  /** Crossfade to `mood` over `fade` seconds (null = fade to silence). */
  setMood(mood: Mood | null, fade = 2.5): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.rack) {
      this.wanted = mood;
      this.wantedFade = fade;
      return;
    }
    if (this.current && this.current.mood === mood) return;
    const now = ctx.currentTime;
    if (this.current) this.current.fadeOut(now, fade);
    this.current = null;
    if (!mood) return;
    const def = this.resolve(mood);
    const p = new MoodPlayer(this, mood, def, ctx, now + 0.06, def.instant ? 0 : fade, this.scoreDef, this.verbFor(this.scoreDef));
    this.players.push(p);
    this.current = p;
    this.pump();
  }

  /** 0..1: layers inside the current mood (combat drums/brass/lead, dread heartbeat…). */
  setIntensity(v: number): void {
    this.target = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** The sting strip, re-orchestrated when the score changes. */
  private stingRig(): { st: Strip; ins: PatchedIns } | null {
    const ctx = this.engine.ctx;
    if (!ctx || !this.rack || !this.moodBus) return null;
    if (!this.sting || this.stingScore !== this.scoreDef) {
      // The previous sting strip may still be ringing out: leave it connected a while.
      const old = this.sting;
      if (old) setTimeout(() => old.dispose(), 6000);
      const sc = this.scoreDef;
      this.sting = new Strip(ctx, this.moodBus, this.verbFor(sc), sc.levels ?? {}, sc.sends ?? {}, sc.chorus);
      const st = this.sting;
      this.stingIns = new PatchedIns(this.rack, sc.palette, st.ch, () => (this.current ? this.current.harm.root : 50));
      this.stingScore = sc;
    }
    return { st: this.sting, ins: this.stingIns! };
  }

  /** One-shot musical sting over the current mood, in its key. */
  stinger(kind: StingerKind): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.engine.running) return;
    const rig = this.stingRig();
    if (!rig) return;
    const { st, ins } = rig;
    const t = ctx.currentTime + 0.03;
    const key = this.current ? this.current.key : 62;
    const k = key + 12 * Math.round((62 - key) / 12);
    const tr = this.scoreDef.transpose;
    switch (kind) {
      case 'victory':
        victoryFanfare(ins, st, t, 60 / 126 / 4, 60 + tr);
        break;
      case 'defeat':
        defeatSting(ins, st, t, 60 / 66 / 4, 48 + tr);
        break;
      case 'lock':
        ins.bell(st.ch.bell, t, k + 19, 0.6, 0.8);
        ins.bell(st.ch.bell, t + 0.07, k + 24, 0.7, 1.2);
        break;
      case 'jump':
        ins.swell(st.ch.drums, t, 1.1, 0.9);
        for (const n of [0, 7, 12, 16, 19]) ins.brass(st.ch.brass, t, k + n - 12, 1.2, 0.6, 0.9, 1.0);
        break;
    }
  }

  /** Schedule notes up to now + lookahead. Called per frame and by a 50 ms timer. */
  pump(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.rack) return;
    const now = ctx.currentTime;
    const dt = this.lastPump < 0 ? 0 : Math.max(0, now - this.lastPump);
    this.lastPump = now;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / 1.2));
    const hidden = typeof document !== 'undefined' && document.hidden;
    const until = now + (hidden ? 1.2 : this.lookahead);
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (now > p.endAt + 8) {
        p.strip.dispose();
        this.players.splice(i, 1);
        continue;
      }
      p.schedule(until, now);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
