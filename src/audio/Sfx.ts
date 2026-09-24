import type { AudioEngine, VoiceSlot } from './AudioEngine';
import { Rng, Smooth, adsr, driveCurve, mtof, perc, sweep } from './dsp';

/**
 * Procedural sound effects, 90s-OVA flavoured: bright FM zaps, crunchy
 * noise bursts through resonant sweeps, sub thumps, and the odd orchestral
 * stab on a big kill. No samples — every sound is built from oscillators and
 * a shared noise buffer at trigger time, inside a pooled voice (see
 * AudioEngine.acquire) so a furball can never allocate unbounded nodes.
 *
 * Spatialisation is deliberately cheap and artistic ("radio-less" space):
 * inverse-distance gain, stereo pan from the camera's right vector, a
 * distance low-pass, a little extra muffling behind the camera. No
 * propagation delay — it's space; what you hear is the cockpit's rendition.
 *
 * Continuous sounds (engine hum, afterburner roar, cruise whine, swarm
 * hiss, lock tone, missile warning, Lantern jump) are persistent loops driven
 * once per frame through `Smooth` param writers — allocation-free.
 */
export type Faction = 'concord' | 'choir' | 'rustwake';
export type SfxKind =
  | 'laser'
  | 'cannon'
  | 'shieldDown'
  | 'hullHit'
  | 'shieldHit'
  | 'beamHit'
  | 'explosionSmall'
  | 'explosionLarge'
  | 'missileLaunch'
  | 'missileHit'
  | 'playerHit'
  | 'afterburnerIgnite'
  | 'cruiseEngage'
  | 'cruiseDisengage'
  | 'lockConfirm'
  | 'jumpEntry'
  | 'jumpExit';
export type UiKind = 'move' | 'confirm' | 'back' | 'error' | 'tick' | 'open';
export type RadioKind = 'open' | 'close' | 'click' | 'static';
export type JumpPhase = 'none' | 'spool' | 'tunnel' | 'exit';
export type CruiseState = 'off' | 'spool' | 'on';

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface QuatLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface PlayOpts {
  /** Linear gain multiplier (default 1). */
  gain?: number;
  /** Stereo pan −1..1 for non-spatial plays. */
  pan?: number;
  /** Laser timbre (default concord). */
  faction?: Faction;
  /** Override pool priority. */
  priority?: number;
}

interface KindSpec {
  dur: number;
  prio: number;
  /** Reference distance (m): full level inside, inverse falloff outside. */
  ref: number;
}

const KIND: Record<SfxKind, KindSpec> = {
  laser: { dur: 0.5, prio: 2, ref: 60 },
  cannon: { dur: 0.3, prio: 2, ref: 60 },
  shieldDown: { dur: 0.9, prio: 5, ref: 300 },
  hullHit: { dur: 0.5, prio: 3, ref: 80 },
  shieldHit: { dur: 0.5, prio: 3, ref: 80 },
  beamHit: { dur: 0.2, prio: 2, ref: 120 },
  explosionSmall: { dur: 1.0, prio: 4, ref: 250 },
  explosionLarge: { dur: 3.6, prio: 6, ref: 1500 },
  missileLaunch: { dur: 0.8, prio: 3, ref: 100 },
  missileHit: { dur: 0.6, prio: 3, ref: 150 },
  playerHit: { dur: 0.7, prio: 7, ref: 50 },
  afterburnerIgnite: { dur: 1.1, prio: 6, ref: 50 },
  cruiseEngage: { dur: 1.8, prio: 6, ref: 50 },
  cruiseDisengage: { dur: 0.8, prio: 5, ref: 50 },
  lockConfirm: { dur: 0.25, prio: 6, ref: 50 },
  jumpEntry: { dur: 1.4, prio: 8, ref: 50 },
  jumpExit: { dur: 2.8, prio: 8, ref: 50 },
};

const UI_DUR: Record<UiKind, number> = { move: 0.06, confirm: 0.2, back: 0.2, error: 0.2, tick: 0.02, open: 0.25 };

/** Output of the last spatialise() call (no allocation). */
interface Spatial {
  gain: number;
  pan: number;
  cutoff: number;
}

const SHEPARD_OCTAVES = 7;
const SHEPARD_FMIN = 38;
const SHEPARD_PERIOD = 0.55; // s per octave of rise
const SHEPARD_SPAN = 8; // s scheduled ahead (phase normally lasts < 1 s)

export class Sfx {
  private rng = new Rng(0x5f3759df);
  private drive: Float32Array<ArrayBuffer> = driveCurve(6);
  // Listener basis (camera right / forward in universe axes).
  private rx = 1;
  private ry = 0;
  private rz = 0;
  private fx = 0;
  private fy = 0;
  private fz = -1;
  private oriented = false;
  readonly sp: Spatial = { gain: 1, pan: 0, cutoff: 20000 };

  // ── persistent loops ──
  private loopsReady = false;
  private humA!: OscillatorNode;
  private humB!: OscillatorNode;
  private humSub!: OscillatorNode;
  private humF = new Array<Smooth>();
  private humCut!: Smooth;
  private humGain!: Smooth;
  private turbF!: Smooth;
  private turbGain!: Smooth;
  private abGain!: Smooth;
  private abCut!: Smooth;
  private cruiseOsc!: OscillatorNode;
  private cruiseOsc2!: OscillatorNode;
  private cruiseGainP!: AudioParam;
  private swarmGain!: Smooth;
  private lockOsc!: OscillatorNode;
  private lockGainP!: AudioParam;
  private warnOsc!: OscillatorNode;
  private warnGain!: Smooth;
  private jumpBus!: GainNode;

  // ── loop state ──
  private boosting = false;
  private cruise: CruiseState = 'off';
  private cruiseT = 0;
  private swarmE = 0;
  private lockMode: 'off' | 'beep' | 'solid' = 'off';
  private lockBeepT = 0;
  private warnT = 0;
  private warnHi = false;
  private jump: JumpPhase = 'none';
  private riser: AudioScheduledSourceNode[] = [];
  private riserGain: GainNode | null = null;
  private drone: AudioScheduledSourceNode[] = [];
  private droneGain: GainNode | null = null;
  private lastRadio = -1;
  private lastUi = -1;

  constructor(private engine: AudioEngine) {
    engine.onReady((ctx) => this.initLoops(ctx));
  }

  // ════════════════════════════════════════════════════════════════════
  // Listener + spatialisation
  // ════════════════════════════════════════════════════════════════════

  /** Camera orientation for panning (three.js camera quaternion; camera looks down −Z). */
  setListener(q: QuatLike | null | undefined): void {
    if (!q) {
      this.oriented = false;
      return;
    }
    const { x, y, z, w } = q;
    this.rx = 1 - 2 * (y * y + z * z);
    this.ry = 2 * (x * y + w * z);
    this.rz = 2 * (x * z - w * y);
    this.fx = -(2 * (x * z + w * y));
    this.fy = -(2 * (y * z - w * x));
    this.fz = -(1 - 2 * (x * x + y * y));
    this.oriented = true;
  }

  /** Fill `this.sp` for a universe position heard from `eye`. Returns the gain. */
  spatialize(pos: Vec3Like, eye: Vec3Like, ref: number): number {
    const dx = pos.x - eye.x;
    const dy = pos.y - eye.y;
    const dz = pos.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const g = d <= ref ? 1 : ref / (ref + (d - ref) * 1.15);
    let pan = 0;
    let cutoff = 700 + 19300 * Math.pow(g, 0.7);
    if (this.oriented && d > 1e-3) {
      const inv = 1 / d;
      const near = Math.min(1, d / 6);
      pan = (dx * this.rx + dy * this.ry + dz * this.rz) * inv * 0.85 * near;
      const front = (dx * this.fx + dy * this.fy + dz * this.fz) * inv;
      if (front < -0.2) cutoff *= 0.65;
    }
    const sp = this.sp;
    sp.gain = g;
    sp.pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    sp.cutoff = cutoff;
    return g;
  }

  /** Estimated audible gain of `kind` at `pos` (for choosing the loudest events). */
  audibility(kind: SfxKind, pos: Vec3Like, eye: Vec3Like): number {
    return this.spatialize(pos, eye, KIND[kind].ref);
  }

  // ════════════════════════════════════════════════════════════════════
  // One-shots
  // ════════════════════════════════════════════════════════════════════

  /** Non-spatial one-shot (player's own guns, cockpit sounds). */
  play(kind: SfxKind, opts?: PlayOpts): void {
    this.trigger(kind, opts?.gain ?? 1, opts?.pan ?? 0, 20000, opts?.faction ?? 'concord', opts?.priority);
  }

  /** Spatial one-shot at a universe position, heard from `eye` (world.eye). */
  playAt(kind: SfxKind, pos: Vec3Like, eye: Vec3Like, opts?: PlayOpts): void {
    const g = this.spatialize(pos, eye, KIND[kind].ref);
    if (g < 0.012) return;
    const sp = this.sp;
    this.trigger(kind, (opts?.gain ?? 1) * g, sp.pan, sp.cutoff, opts?.faction ?? 'concord', opts?.priority);
  }

  /** `play` without an options object (per-frame event path). */
  playRaw(kind: SfxKind, gain: number, pan: number, faction: Faction = 'concord', priority?: number): void {
    this.trigger(kind, gain, pan, 20000, faction, priority);
  }

  /** `playAt` without an options object (per-frame event path). */
  playAtRaw(kind: SfxKind, pos: Vec3Like, eye: Vec3Like, gain: number, faction: Faction = 'concord', priority?: number): void {
    const g = this.spatialize(pos, eye, KIND[kind].ref);
    if (g < 0.012) return;
    this.trigger(kind, gain * g, this.sp.pan, this.sp.cutoff, faction, priority);
  }

  private trigger(kind: SfxKind, gain: number, pan: number, cutoff: number, faction: Faction, priority?: number): void {
    const e = this.engine;
    if (!e.running || gain <= 0) return;
    const spec = KIND[kind];
    const slot = e.acquire(priority ?? spec.prio, Math.min(1, gain), spec.dur, pan, cutoff);
    if (!slot) return;
    const t = slot.t0;
    const v = this.rng.range(0.94, 1.06);
    switch (kind) {
      case 'laser':
        this.laser(slot, t, gain, faction, v);
        break;
      case 'cannon':
        this.cannon(slot, t, gain, faction, v);
        break;
      case 'shieldDown':
        this.shieldDown(slot, t, gain, v);
        break;
      case 'hullHit':
        this.hullHit(slot, t, gain, v, false);
        break;
      case 'playerHit':
        this.hullHit(slot, t, gain, v * 0.8, true);
        break;
      case 'shieldHit':
        this.shieldHit(slot, t, gain, v);
        break;
      case 'beamHit':
        this.beamHit(slot, t, gain, v);
        break;
      case 'explosionSmall':
        this.explosionSmall(slot, t, gain, v);
        break;
      case 'explosionLarge':
        this.explosionLarge(slot, t, gain, v);
        break;
      case 'missileLaunch':
        this.missileLaunch(slot, t, gain, v);
        break;
      case 'missileHit':
        this.missileHit(slot, t, gain, v);
        break;
      case 'afterburnerIgnite':
        this.afterburnerIgnite(slot, t, gain);
        break;
      case 'cruiseEngage':
        this.cruiseEngage(slot, t, gain);
        break;
      case 'cruiseDisengage':
        this.cruiseDisengage(slot, t, gain);
        break;
      case 'lockConfirm':
        this.lockConfirm(slot, t, gain);
        break;
      case 'jumpEntry':
        this.jumpEntry(slot, t, gain);
        break;
      case 'jumpExit':
        this.jumpExit(slot, t, gain);
        break;
    }
  }

  // ── node helpers ─────────────────────────────────────────────────────
  private ctx(): BaseAudioContext {
    return this.engine.ctx!;
  }

  private osc(slot: VoiceSlot | null, type: OscillatorType, f: number, t: number, end: number): OscillatorNode {
    const o = this.ctx().createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(end);
    if (slot) slot.track(o);
    return o;
  }

  private noise(slot: VoiceSlot | null, t: number, end: number, pink = false, rate = 1): AudioBufferSourceNode {
    const e = this.engine;
    const s = this.ctx().createBufferSource();
    s.buffer = pink ? e.pink : e.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, this.rng.next() * 2.5);
    s.stop(end);
    if (slot) slot.track(s);
    return s;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx().createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx().createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private send(node: AudioNode, amount: number): void {
    const v = this.engine.sfxVerb;
    if (!v || amount <= 0) return;
    const g = this.gain(amount);
    node.connect(g).connect(v);
  }

  /** FM operator pair: modulator → carrier.frequency. Returns the carrier. */
  private fm(slot: VoiceSlot | null, f: number, ratio: number, index: number, t: number, end: number, indexDecay: number): OscillatorNode {
    const car = this.osc(slot, 'sine', f, t, end);
    const mod = this.osc(slot, 'sine', f * ratio, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * index * 0.08), t + indexDecay);
    mod.connect(mg).connect(car.frequency);
    return car;
  }

  // ── lasers ───────────────────────────────────────────────────────────
  private laser(slot: VoiceSlot, t: number, g: number, faction: Faction, v: number): void {
    const out = slot.input;
    if (faction === 'choir') {
      // Zenith: crystalline, glassy — inharmonic FM with a ringing partial tail.
      const end = t + 0.5;
      const env = this.gain();
      perc(env.gain, t, 0.3 * g, 0.002, 0.2);
      const car = this.fm(slot, 2500 * v, 1.414, 1.6, t, end, 0.18);
      sweep(car.frequency, t, 2500 * v, 1450 * v, 0.16);
      car.connect(env).connect(out);
      const ring = this.gain();
      perc(ring.gain, t, 0.1 * g, 0.003, 0.42);
      this.osc(slot, 'sine', 3040 * v, t, end).connect(ring);
      const ring2 = this.gain();
      perc(ring2.gain, t, 0.05 * g, 0.003, 0.3);
      this.osc(slot, 'sine', 5950 * v, t, end).connect(ring2);
      ring.connect(out);
      ring2.connect(out);
      this.send(ring, 0.3);
    } else if (faction === 'rustwake') {
      // Rustwake: gritty — overdriven saw/square dive with crackling AM noise.
      const end = t + 0.24;
      const pre = this.gain(1);
      const a = this.osc(slot, 'sawtooth', 1000 * v, t, end);
      sweep(a.frequency, t, 1000 * v, 110 * v, 0.16);
      const b = this.osc(slot, 'square', 505 * v, t, end);
      sweep(b.frequency, t, 505 * v, 58 * v, 0.17);
      const bg = this.gain(0.5);
      a.connect(pre);
      b.connect(bg).connect(pre);
      const ws = this.ctx().createWaveShaper();
      ws.curve = this.drive;
      const bp = this.filter('bandpass', 2200, 0.8);
      sweep(bp.frequency, t, 2600, 600, 0.16);
      const env = this.gain();
      perc(env.gain, t, 0.3 * g, 0.002, 0.17);
      pre.connect(ws).connect(bp).connect(env).connect(out);
      // Crackle: noise chopped by a 55 Hz square.
      const n = this.noise(slot, t, end);
      const nb = this.filter('bandpass', 3000, 1.2);
      const chop = this.gain(0.5);
      const lfo = this.osc(slot, 'square', 55, t, end);
      const lg = this.gain(0.5);
      lfo.connect(lg).connect(chop.gain);
      const ne = this.gain();
      perc(ne.gain, t, 0.18 * g, 0.001, 0.12);
      n.connect(nb).connect(chop).connect(ne).connect(out);
    } else {
      // Directorate: clean square/saw "pew" through a resonant low-pass zap.
      const end = t + 0.2;
      const lp = this.filter('lowpass', 9000, 5);
      sweep(lp.frequency, t, 9500, 1400, 0.12);
      const sq = this.osc(slot, 'square', 1650 * v, t, end);
      sweep(sq.frequency, t, 1650 * v, 200 * v, 0.13);
      const sw = this.osc(slot, 'sawtooth', 1110 * v, t, end);
      sweep(sw.frequency, t, 1110 * v, 150 * v, 0.14);
      const swg = this.gain(0.55);
      const env = this.gain();
      perc(env.gain, t, 0.26 * g, 0.002, 0.15);
      sq.connect(lp);
      sw.connect(swg).connect(lp);
      lp.connect(env).connect(out);
      const n = this.noise(slot, t, t + 0.03);
      const hp = this.filter('highpass', 3200);
      const ne = this.gain();
      perc(ne.gain, t, 0.16 * g, 0.001, 0.02);
      n.connect(hp).connect(ne).connect(out);
    }
  }

  // ── kinetic guns ─────────────────────────────────────────────────────
  /**
   * Autocannon / scattergun / flak: a dry mechanical thump — short bandpassed
   * noise crack over a pitched-down sine kick. Rustwake: lower, dirtier, with
   * a rattle; Directorate: tight and clean.
   */
  private cannon(slot: VoiceSlot, t: number, g: number, faction: Faction, v: number): void {
    const out = slot.input;
    const rust = faction === 'rustwake';
    const end = t + (rust ? 0.28 : 0.18);
    const n = this.noise(slot, t, end);
    const bp = this.filter('bandpass', (rust ? 900 : 1700) * v, rust ? 0.9 : 1.4);
    sweep(bp.frequency, t, (rust ? 1300 : 2600) * v, (rust ? 380 : 700) * v, 0.08);
    const ne = this.gain();
    perc(ne.gain, t, (rust ? 0.34 : 0.28) * g, 0.001, rust ? 0.12 : 0.06);
    n.connect(bp).connect(ne).connect(out);
    const kick = this.osc(slot, 'sine', (rust ? 160 : 220) * v, t, end);
    sweep(kick.frequency, t, (rust ? 160 : 220) * v, 55, rust ? 0.1 : 0.06);
    const ke = this.gain();
    perc(ke.gain, t, 0.4 * g, 0.001, rust ? 0.14 : 0.07);
    kick.connect(ke).connect(out);
    if (rust) {
      // Loose bolts: a rattle chopped at 70 Hz through the waveshaper.
      const r = this.osc(slot, 'square', 70, t, end);
      const ws = this.ctx().createWaveShaper();
      ws.curve = this.drive;
      const re = this.gain();
      perc(re.gain, t, 0.06 * g, 0.002, 0.16);
      r.connect(ws).connect(re).connect(out);
    }
  }

  /** A shield facing collapsing: glassy descending chord that breaks into noise. */
  private shieldDown(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.85;
    const env = this.gain();
    perc(env.gain, t, 0.22 * g, 0.004, 0.7);
    for (const f of [2385, 1590, 1190]) {
      const o = this.osc(slot, 'triangle', f * v, t, end);
      sweep(o.frequency, t, f * v, f * v * 0.35, 0.7);
      o.connect(env);
    }
    env.connect(out);
    this.send(env, 0.6);
    const n = this.noise(slot, t + 0.05, end);
    const hp = this.filter('highpass', 3000);
    const ne = this.gain();
    perc(ne.gain, t + 0.05, 0.2 * g, 0.004, 0.45);
    n.connect(hp).connect(ne).connect(out);
  }

  // ── impacts ──────────────────────────────────────────────────────────
  private hullHit(slot: VoiceSlot, t: number, g: number, v: number, heavy: boolean): void {
    const out = slot.input;
    const end = t + (heavy ? 0.65 : 0.45);
    const f0 = 300 * v;
    const ratios = [1, 2.76, 5.4, 8.93];
    const amps = [0.3, 0.22, 0.14, 0.09];
    const decays = [0.28, 0.2, 0.12, 0.08];
    const k = heavy ? 1.5 : 1;
    for (let i = 0; i < 4; i++) {
      const e = this.gain();
      perc(e.gain, t, amps[i] * g * 0.6, 0.001, decays[i] * k);
      this.osc(slot, 'sine', f0 * ratios[i], t, end).connect(e).connect(out);
    }
    const n = this.noise(slot, t, t + 0.08);
    const bp = this.filter('bandpass', 2200, 1.2);
    const ne = this.gain();
    perc(ne.gain, t, 0.3 * g, 0.001, 0.045);
    n.connect(bp).connect(ne).connect(out);
    const th = this.osc(slot, 'sine', 140, t, end);
    sweep(th.frequency, t, 150, 52, 0.1);
    const te = this.gain();
    perc(te.gain, t, 0.45 * g, 0.002, heavy ? 0.3 : 0.18);
    th.connect(te).connect(out);
    if (heavy) {
      // Cockpit crunch: overdriven low noise + a short alarm-ish grind.
      const c = this.noise(slot, t, end, true);
      const ws = this.ctx().createWaveShaper();
      ws.curve = this.drive;
      const lp = this.filter('lowpass', 1400, 2);
      sweep(lp.frequency, t, 2600, 300, 0.35);
      const ce = this.gain();
      perc(ce.gain, t, 0.45 * g, 0.002, 0.35);
      c.connect(ws).connect(lp).connect(ce).connect(out);
      this.send(ce, 0.3);
    }
  }

  private shieldHit(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.48;
    const trem = this.gain(0.55);
    const lfo = this.osc(slot, 'square', 31, t, end);
    const lg = this.gain(0.45);
    lfo.connect(lg).connect(trem.gain);
    const env = this.gain();
    perc(env.gain, t, 0.13 * g, 0.003, 0.4);
    const fs = [1180, 1770, 2385, 3570];
    for (let i = 0; i < 4; i++) {
      const o = this.osc(slot, i % 2 ? 'triangle' : 'sine', fs[i] * v, t, end);
      sweep(o.frequency, t, fs[i] * v, fs[i] * v * 0.82, 0.4);
      o.connect(trem);
    }
    trem.connect(env).connect(out);
    this.send(env, 0.5);
    const n = this.noise(slot, t, t + 0.08);
    const hp = this.filter('highpass', 5200);
    const ne = this.gain();
    perc(ne.gain, t, 0.12 * g, 0.001, 0.05);
    n.connect(hp).connect(ne).connect(out);
  }

  private beamHit(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.16;
    const n = this.noise(slot, t, end);
    const bp = this.filter('bandpass', 2800 * v, 3);
    const ne = this.gain();
    perc(ne.gain, t, 0.2 * g, 0.004, 0.11);
    n.connect(bp).connect(ne).connect(out);
    const buzz = this.osc(slot, 'sawtooth', 92 * v, t, end);
    const hp = this.filter('highpass', 700);
    const be = this.gain();
    perc(be.gain, t, 0.08 * g, 0.004, 0.12);
    buzz.connect(hp).connect(be).connect(out);
  }

  // ── explosions ───────────────────────────────────────────────────────
  private explosionSmall(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.95;
    const n = this.noise(slot, t, end);
    const lp = this.filter('lowpass', 5000, 7);
    sweep(lp.frequency, t, 5200 * v, 160, 0.55);
    const ne = this.gain();
    perc(ne.gain, t, 0.5 * g, 0.004, 0.78);
    n.connect(lp).connect(ne).connect(out);
    this.send(ne, 0.35);
    const sub = this.osc(slot, 'sine', 110, t, end);
    sweep(sub.frequency, t, 115 * v, 36, 0.3);
    const se = this.gain();
    perc(se.gain, t, 0.65 * g, 0.002, 0.45);
    sub.connect(se).connect(out);
    const c = this.noise(slot, t, t + 0.15);
    const bp = this.filter('bandpass', 1600, 0.9);
    const ce = this.gain();
    perc(ce.gain, t, 0.35 * g, 0.001, 0.09);
    c.connect(bp).connect(ce).connect(out);
  }

  private explosionLarge(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 3.5;
    // Resonant noise sweep.
    const n = this.noise(slot, t, end);
    const lp = this.filter('lowpass', 3000, 9);
    sweep(lp.frequency, t, 3200 * v, 70, 2.0);
    const ne = this.gain();
    perc(ne.gain, t, 0.42 * g, 0.006, 2.6);
    n.connect(lp).connect(ne).connect(out);
    this.send(ne, 0.45);
    // Rolling rumble.
    const r = this.noise(slot, t, end, true);
    const rl = this.filter('lowpass', 260, 0.8);
    const re = this.gain();
    adsr(re.gain, t, 0.55 * g, 0.15, 0.6, 0.55, 0.9, 2.2);
    r.connect(rl).connect(re).connect(out);
    // Sub thump.
    const sub = this.osc(slot, 'sine', 80, t, end);
    sweep(sub.frequency, t, 82 * v, 24, 1.1);
    const se = this.gain();
    perc(se.gain, t, 0.8 * g, 0.003, 1.4);
    sub.connect(se).connect(out);
    // Orchestral hit — the anime-battle stab on a capital kill.
    const hit = this.filter('lowpass', 3500, 2);
    sweep(hit.frequency, t, 4200, 280, 0.4);
    const he = this.gain();
    perc(he.gain, t, 0.09 * g, 0.004, 0.55);
    const notes = [36, 43, 48, 55];
    for (let i = 0; i < notes.length; i++) {
      const o = this.osc(slot, 'sawtooth', mtof(notes[i]) * v, t, t + 0.7);
      o.detune.value = (i - 1.5) * 7;
      o.connect(hit);
    }
    hit.connect(he).connect(out);
    this.send(he, 0.5);
    // Debris crackle: one noise source gated into irregular pops.
    const d = this.noise(slot, t, end);
    const db = this.filter('bandpass', 2300, 1.1);
    const dg = this.gain(0);
    let tp = t + 0.08;
    for (let i = 0; i < 9; i++) {
      tp += this.rng.range(0.05, 0.28);
      dg.gain.setValueAtTime(this.rng.range(0.08, 0.2) * g, tp);
      dg.gain.setTargetAtTime(0, tp + 0.004, 0.018);
    }
    d.connect(db).connect(dg).connect(out);
  }

  private missileHit(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.55;
    const n = this.noise(slot, t, end);
    const lp = this.filter('lowpass', 7000, 5);
    sweep(lp.frequency, t, 7500 * v, 380, 0.3);
    const ne = this.gain();
    perc(ne.gain, t, 0.38 * g, 0.002, 0.38);
    n.connect(lp).connect(ne).connect(out);
    this.send(ne, 0.25);
    const sub = this.osc(slot, 'sine', 150, t, end);
    sweep(sub.frequency, t, 160 * v, 48, 0.18);
    const se = this.gain();
    perc(se.gain, t, 0.35 * g, 0.002, 0.22);
    sub.connect(se).connect(out);
  }

  // ── missiles ─────────────────────────────────────────────────────────
  private missileLaunch(slot: VoiceSlot, t: number, g: number, v: number): void {
    const out = slot.input;
    const end = t + 0.75;
    // Ignition pop.
    const p = this.noise(slot, t, t + 0.08);
    const pb = this.filter('bandpass', 900 * v, 1.5);
    const pe = this.gain();
    perc(pe.gain, t, 0.35 * g, 0.001, 0.05);
    p.connect(pb).connect(pe).connect(out);
    const th = this.osc(slot, 'sine', 180, t, t + 0.12);
    sweep(th.frequency, t, 190 * v, 60, 0.08);
    const te = this.gain();
    perc(te.gain, t, 0.28 * g, 0.001, 0.08);
    th.connect(te).connect(out);
    // Whoosh.
    const w = this.noise(slot, t, end);
    const wb = this.filter('bandpass', 600, 1.2);
    sweep(wb.frequency, t, 520 * v, 4200 * v, 0.4);
    const we = this.gain();
    adsr(we.gain, t, 0.3 * g, 0.03, 0.2, 0.4, 0.15, 0.4);
    w.connect(wb).connect(we).connect(out);
    // Hiss tail.
    const h = this.noise(slot, t, end);
    const hh = this.filter('highpass', 5200);
    const he = this.gain();
    perc(he.gain, t, 0.07 * g, 0.05, 0.5);
    h.connect(hh).connect(he).connect(out);
  }

  // ── cockpit events ───────────────────────────────────────────────────
  private afterburnerIgnite(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const end = t + 1.05;
    const n = this.noise(slot, t, end, true);
    const lp = this.filter('lowpass', 150, 3);
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    const ne = this.gain();
    adsr(ne.gain, t, 0.75 * g, 0.03, 0.3, 0.4, 0.2, 0.6);
    n.connect(lp).connect(ne).connect(out);
    const k = this.osc(slot, 'sine', 90, t, end);
    sweep(k.frequency, t, 95, 34, 0.25);
    const ke = this.gain();
    perc(ke.gain, t, 0.55 * g, 0.002, 0.35);
    k.connect(ke).connect(out);
    for (let i = 0; i < 2; i++) {
      const ct = t + i * 0.05;
      const c = this.noise(slot, ct, ct + 0.04);
      const cb = this.filter('bandpass', 3400 - i * 900, 2);
      const ce = this.gain();
      perc(ce.gain, ct, 0.18 * g, 0.001, 0.02);
      c.connect(cb).connect(ce).connect(out);
    }
  }

  private cruiseEngage(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const end = t + 1.7;
    const s = this.osc(slot, 'sine', 60, t, end);
    sweep(s.frequency, t, 64, 30, 1.0);
    const se = this.gain();
    perc(se.gain, t, 0.6 * g, 0.004, 1.2);
    s.connect(se).connect(out);
    const n = this.noise(slot, t, end);
    const lp = this.filter('lowpass', 4000, 3);
    sweep(lp.frequency, t, 4200, 180, 1.0);
    const ne = this.gain();
    perc(ne.gain, t, 0.3 * g, 0.004, 1.0);
    n.connect(lp).connect(ne).connect(out);
    const bell = this.fm(slot, 1318.5, 3.5, 2.5, t, end, 1.2);
    const be = this.gain();
    perc(be.gain, t, 0.06 * g, 0.002, 1.5);
    bell.connect(be).connect(out);
    this.send(be, 0.8);
  }

  private cruiseDisengage(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const end = t + 0.75;
    const o = this.osc(slot, 'sawtooth', 1400, t, end);
    sweep(o.frequency, t, 1400, 140, 0.55);
    const lp = this.filter('lowpass', 2000, 2);
    const e = this.gain();
    perc(e.gain, t, 0.09 * g, 0.004, 0.6);
    o.connect(lp).connect(e).connect(out);
    const n = this.noise(slot, t, end, true);
    const nl = this.filter('lowpass', 900);
    const ne = this.gain();
    perc(ne.gain, t, 0.25 * g, 0.01, 0.5);
    n.connect(nl).connect(ne).connect(out);
  }

  private lockConfirm(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const lp = this.filter('lowpass', 5000);
    lp.connect(out);
    const f = [1760, 2349];
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.065;
      const o = this.osc(slot, 'square', f[i], tt, tt + 0.09);
      const e = this.gain();
      adsr(e.gain, tt, 0.07 * g, 0.003, 0.02, 0.8, 0.05, 0.02);
      o.connect(e).connect(lp);
    }
  }

  private jumpEntry(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const end = t + 1.35;
    const n = this.noise(slot, t, end);
    const hp = this.filter('highpass', 1500);
    sweep(hp.frequency, t, 3000, 400, 1.0);
    const ne = this.gain();
    perc(ne.gain, t, 0.35 * g, 0.01, 1.0);
    n.connect(hp).connect(ne).connect(out);
    this.send(ne, 0.6);
    const s = this.osc(slot, 'sine', 48, t, end);
    sweep(s.frequency, t, 70, 36, 0.9);
    const se = this.gain();
    perc(se.gain, t, 0.6 * g, 0.005, 1.1);
    s.connect(se).connect(out);
  }

  private jumpExit(slot: VoiceSlot, t: number, g: number): void {
    const out = slot.input;
    const end = t + 2.6;
    const s = this.osc(slot, 'sine', 55, t, end);
    sweep(s.frequency, t, 58, 26, 1.4);
    const se = this.gain();
    perc(se.gain, t, 0.8 * g, 0.004, 1.7);
    s.connect(se).connect(out);
    const n = this.noise(slot, t, end);
    const lp = this.filter('lowpass', 6000, 4);
    sweep(lp.frequency, t, 6500, 150, 1.6);
    const ne = this.gain();
    perc(ne.gain, t, 0.45 * g, 0.004, 1.9);
    n.connect(lp).connect(ne).connect(out);
    this.send(ne, 0.4);
    // Arrival chime: bright major chord of FM bells.
    const chime = this.gain();
    perc(chime.gain, t, 0.05 * g, 0.004, 2.2);
    const notes = [72, 76, 79, 84];
    for (let i = 0; i < 4; i++) this.fm(slot, mtof(notes[i]), 3.5, 1.8, t + i * 0.03, end, 1.4).connect(chime);
    chime.connect(out);
    this.send(chime, 1);
  }

  // ════════════════════════════════════════════════════════════════════
  // UI + radio
  // ════════════════════════════════════════════════════════════════════

  ui(kind: UiKind): void {
    const e = this.engine;
    if (!e.running) return;
    const now = e.now;
    if (kind === 'tick' && now - this.lastUi < 0.025) return;
    this.lastUi = now;
    const slot = e.acquire(9, 0.5, UI_DUR[kind] + 0.05, 0, 20000);
    if (!slot) return;
    const t = slot.t0;
    const out = slot.input;
    const blip = (f: number, at: number, dur: number, peak: number, type: OscillatorType = 'square') => {
      const o = this.osc(slot, type, f, at, at + dur + 0.02);
      const g = this.gain();
      adsr(g.gain, at, peak, 0.002, dur * 0.4, 0.6, dur, 0.015);
      o.connect(g).connect(out);
    };
    switch (kind) {
      case 'move':
        blip(1568, t, 0.028, 0.06);
        blip(3136, t, 0.018, 0.03, 'triangle');
        break;
      case 'confirm':
        blip(1046.5, t, 0.05, 0.07);
        blip(1568, t + 0.06, 0.09, 0.07);
        blip(3136, t + 0.06, 0.09, 0.03, 'sine');
        break;
      case 'back':
        blip(1568, t, 0.05, 0.06);
        blip(1046.5, t + 0.06, 0.08, 0.06);
        break;
      case 'error':
        blip(220, t, 0.14, 0.08);
        blip(233, t, 0.14, 0.08);
        break;
      case 'tick': {
        const n = this.noise(slot, t, t + 0.012);
        const hp = this.filter('highpass', 4000);
        const g = this.gain();
        perc(g.gain, t, 0.12, 0.0005, 0.008);
        n.connect(hp).connect(g).connect(out);
        break;
      }
      case 'open':
        blip(880, t, 0.035, 0.05);
        blip(1318.5, t + 0.045, 0.035, 0.05);
        blip(1760, t + 0.09, 0.08, 0.05);
        break;
    }
  }

  /** Radio transmission sounds on the voice bus (squelch, chirps, static). Ducks the music. */
  radio(kind: RadioKind): void {
    const e = this.engine;
    const ctx = e.ctx;
    const out = e.voice;
    if (!ctx || !out || !e.running) return;
    const t = ctx.currentTime + 0.005;
    if (t - this.lastRadio < 0.05) return;
    this.lastRadio = t;
    // Everything through a radio-band filter.
    const band = this.filter('bandpass', 1900, 0.6);
    band.connect(out);
    const click = (at: number, peak: number) => {
      const n = this.noise(null, at, at + 0.012);
      const hp = this.filter('highpass', 2000);
      const g = this.gain();
      perc(g.gain, at, peak, 0.0005, 0.007);
      n.connect(hp).connect(g).connect(out);
    };
    const staticBurst = (at: number, dur: number, peak: number) => {
      const n = this.noise(null, at, at + dur + 0.02);
      const g = this.gain(0);
      let tp = at;
      g.gain.setValueAtTime(0, at);
      while (tp < at + dur) {
        g.gain.setValueAtTime(this.rng.range(0.25, 1) * peak, tp);
        tp += this.rng.range(0.008, 0.03);
      }
      g.gain.setTargetAtTime(0, at + dur, 0.01);
      n.connect(g).connect(band);
    };
    const tone = (f: number, at: number, dur: number, peak: number, type: OscillatorType) => {
      const o = this.osc(null, type, f, at, at + dur + 0.02);
      const g = this.gain();
      adsr(g.gain, at, peak, 0.002, 0.01, 0.9, dur, 0.01);
      o.connect(g).connect(band);
    };
    switch (kind) {
      case 'click':
        click(t, 0.3);
        break;
      case 'static':
        staticBurst(t, 0.38, 0.22);
        e.duckMusic(-4, 0.5);
        break;
      case 'open':
        click(t, 0.3);
        staticBurst(t + 0.01, 0.1, 0.18);
        tone(1800, t + 0.11, 0.035, 0.1, 'square');
        tone(2400, t + 0.15, 0.04, 0.1, 'square');
        e.duckMusic(-6, 4, 0.8);
        break;
      case 'close':
        staticBurst(t, 0.08, 0.15);
        click(t + 0.08, 0.25);
        tone(1100, t + 0.1, 0.09, 0.1, 'sine');
        e.duckMusic(-6, 0.3, 0.9);
        break;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Persistent loops (player ship, lock, warnings, jump)
  // ════════════════════════════════════════════════════════════════════

  private initLoops(ctx: BaseAudioContext): void {
    const sfx = this.engine.sfx!;
    const t = ctx.currentTime;
    const loopOsc = (type: OscillatorType, f: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.start(t);
      return o;
    };
    const loopNoise = (pink: boolean) => {
      const s = ctx.createBufferSource();
      s.buffer = pink ? this.engine.pink : this.engine.noise;
      s.loop = true;
      s.start(t, pink ? 0.7 : 1.3);
      return s;
    };
    const g0 = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      return g;
    };

    // Engine hum: detuned saws + square sub through a throttle-driven low-pass.
    this.humA = loopOsc('sawtooth', 50);
    this.humB = loopOsc('sawtooth', 50.4);
    this.humSub = loopOsc('square', 25);
    const humLp = this.filter('lowpass', 400, 1.1);
    const humG = g0();
    const subG = ctx.createGain();
    subG.gain.value = 0.6;
    this.humA.connect(humLp);
    this.humB.connect(humLp);
    this.humSub.connect(subG).connect(humLp);
    humLp.connect(humG).connect(sfx);
    this.humF = [new Smooth(this.humA.frequency, 0.05), new Smooth(this.humB.frequency, 0.05), new Smooth(this.humSub.frequency, 0.03)];
    this.humCut = new Smooth(humLp.frequency, 5);
    this.humGain = new Smooth(humG.gain, 0.001);
    // Turbine whine riding on top.
    const turb = loopOsc('sine', 600);
    const turbG = g0();
    turb.connect(turbG).connect(sfx);
    this.turbF = new Smooth(turb.frequency, 1);
    this.turbGain = new Smooth(turbG.gain, 0.0005);

    // Afterburner roar: pink noise + low saw rumble.
    const abN = loopNoise(true);
    const abLp = this.filter('lowpass', 800, 1.2);
    const abRum = loopOsc('sawtooth', 38);
    const abRumLp = this.filter('lowpass', 170);
    const abG = g0();
    abN.connect(abLp).connect(abG);
    abRum.connect(abRumLp).connect(abG);
    abG.connect(sfx);
    this.abGain = new Smooth(abG.gain, 0.002);
    this.abCut = new Smooth(abLp.frequency, 10);

    // Cruise-drive whine: sine + triangle an octave up, with vibrato.
    this.cruiseOsc = loopOsc('sine', 300);
    this.cruiseOsc2 = loopOsc('triangle', 600);
    const vib = loopOsc('sine', 5.5);
    const vibG = ctx.createGain();
    vibG.gain.value = 9;
    vib.connect(vibG);
    vibG.connect(this.cruiseOsc.detune);
    vibG.connect(this.cruiseOsc2.detune);
    const crG = g0();
    const cr2 = ctx.createGain();
    cr2.gain.value = 0.35;
    this.cruiseOsc.connect(crG);
    this.cruiseOsc2.connect(cr2).connect(crG);
    crG.connect(sfx);
    this.cruiseGainP = crG.gain;

    // Missile swarm hiss: fluttering band-passed noise.
    const sw = loopNoise(false);
    const swBp = this.filter('bandpass', 2600, 0.8);
    const swTrem = ctx.createGain();
    swTrem.gain.value = 0.7;
    const swLfo = loopOsc('sine', 11);
    const swLg = ctx.createGain();
    swLg.gain.value = 0.3;
    swLfo.connect(swLg).connect(swTrem.gain);
    const swG = g0();
    sw.connect(swBp).connect(swTrem).connect(swG).connect(sfx);
    this.swarmGain = new Smooth(swG.gain, 0.001);

    // Lock tone + missile warning.
    this.lockOsc = loopOsc('square', 1250);
    const lockLp = this.filter('lowpass', 3500);
    const lockG = g0();
    this.lockOsc.connect(lockLp).connect(lockG).connect(sfx);
    this.lockGainP = lockG.gain;
    this.warnOsc = loopOsc('square', 880);
    const warnLp = this.filter('lowpass', 2400);
    const warnG = g0();
    this.warnOsc.connect(warnLp).connect(warnG).connect(sfx);
    this.warnGain = new Smooth(warnG.gain, 0.001);

    this.jumpBus = ctx.createGain();
    this.jumpBus.connect(sfx);
    this.loopsReady = true;
  }

  /**
   * Player-ship loops. `speed` in m/s. Call once per frame.
   * Allocation-free except the one-shots fired on state edges.
   */
  updateShip(speed: number, throttle: number, boosting: boolean, cruise: CruiseState, alive: boolean, dt: number): void {
    if (!this.loopsReady || !this.engine.running) return;
    const now = this.engine.now;
    const inTunnel = this.jump === 'tunnel' ? 0.35 : 1;
    const on = alive ? inTunnel : 0;
    // Speed normalised: 0..1 up to boost speed, then log-compressed up to cruise (≈1.6).
    const norm = speed <= 460 ? speed / 460 : 1 + (0.6 * Math.log(speed / 460)) / Math.log(3000 / 460);
    const f = 38 + 30 * Math.min(norm, 1.7) + 9 * throttle;
    this.humF[0].set(f, now, 0.12);
    this.humF[1].set(f * 1.008, now, 0.12);
    this.humF[2].set(f * 0.5, now, 0.12);
    this.humCut.set(220 + 650 * throttle + 700 * Math.min(norm, 1.6) + (boosting ? 700 : 0), now, 0.1);
    this.humGain.set(on * (0.008 + 0.012 * throttle + 0.007 * Math.min(norm, 1)), now, 0.15);
    this.turbF.set(f * 14, now, 0.15);
    this.turbGain.set(on * (0.0015 + 0.003 * throttle), now, 0.15);

    // Afterburner.
    const boost = boosting && alive;
    if (boost && !this.boosting) this.playRaw('afterburnerIgnite', 0.9, 0);
    this.boosting = boost;
    this.abGain.set(boost ? 0.13 * on : 0, now, boost ? 0.06 : 0.3);
    this.abCut.set(boost ? 2600 : 600, now, boost ? 0.15 : 0.4);

    // Cruise drive.
    const p = this.cruiseGainP;
    const o1 = this.cruiseOsc.frequency;
    const o2 = this.cruiseOsc2.frequency;
    if (cruise !== this.cruise) {
      p.cancelScheduledValues(now);
      o1.cancelScheduledValues(now);
      o2.cancelScheduledValues(now);
      if (cruise === 'spool') {
        this.cruiseT = 0;
        p.setTargetAtTime(0.055, now, 0.1);
      } else if (cruise === 'on') {
        this.playRaw('cruiseEngage', 0.9, 0);
        o1.setTargetAtTime(880, now, 0.25);
        o2.setTargetAtTime(1760, now, 0.25);
        p.setTargetAtTime(0.028, now, 0.4);
      } else {
        if (this.cruise === 'on') this.playRaw('cruiseDisengage', 0.9, 0);
        o1.setTargetAtTime(140, now, 0.18);
        o2.setTargetAtTime(280, now, 0.18);
        p.setTargetAtTime(0, now, 0.15);
      }
      this.cruise = cruise;
    }
    if (cruise === 'spool') {
      // Rising whine: ~2.6 octaves over the 1.4 s spool, keeps creeping if it lasts longer.
      this.cruiseT += dt;
      const k = Math.min(this.cruiseT / 1.4, 1.15);
      const wf = 260 * Math.pow(2, k * 2.6);
      o1.cancelScheduledValues(now);
      o2.cancelScheduledValues(now);
      o1.setTargetAtTime(wf, now, 0.03);
      o2.setTargetAtTime(wf * 2, now, 0.03);
    }
  }

  /** A missile left a rail: feeds the swarm-hiss layer (loudness 0..1). */
  swarmPulse(amount: number): void {
    this.swarmE = Math.min(4, this.swarmE + amount);
  }

  /** Lock tone: beeps accelerate with progress; solid tone when locked. Missile warning warble. */
  updateAlerts(lockProgress: number, locked: boolean, incoming: boolean, dt: number): void {
    if (!this.loopsReady || !this.engine.running) return;
    const now = this.engine.now;
    // Swarm hiss decays.
    this.swarmE *= Math.exp(-dt / 1.1);
    this.swarmGain.set(0.14 * (1 - Math.exp(-this.swarmE)), now, 0.05);

    const lp = this.lockGainP;
    const lf = this.lockOsc.frequency;
    if (locked) {
      if (this.lockMode !== 'solid') {
        this.playRaw('lockConfirm', 1, 0);
        lp.cancelScheduledValues(now);
        lp.setTargetAtTime(0.028, now + 0.14, 0.02);
        lf.setValueAtTime(1680, now + 0.14);
        this.lockMode = 'solid';
      }
    } else if (lockProgress > 0.02) {
      if (this.lockMode !== 'beep') {
        lp.cancelScheduledValues(now);
        lp.setTargetAtTime(0, now, 0.01);
        lf.setValueAtTime(1250, now);
        this.lockMode = 'beep';
        this.lockBeepT = 0;
      }
      this.lockBeepT -= dt;
      if (this.lockBeepT <= 0) {
        const interval = 0.34 - 0.27 * Math.pow(Math.min(lockProgress, 1), 1.2);
        this.lockBeepT = Math.max(this.lockBeepT + interval, interval * 0.5);
        const len = Math.min(0.05, interval * 0.45);
        lp.cancelScheduledValues(now);
        lp.setTargetAtTime(0.045, now, 0.002);
        lp.setTargetAtTime(0, now + len, 0.006);
      }
    } else if (this.lockMode !== 'off') {
      lp.cancelScheduledValues(now);
      lp.setTargetAtTime(0, now, 0.02);
      this.lockMode = 'off';
    }

    // Incoming missile: two-tone warble.
    if (incoming) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.warnT += 0.11;
        if (this.warnT < 0) this.warnT = 0.11;
        this.warnHi = !this.warnHi;
        this.warnOsc.frequency.setValueAtTime(this.warnHi ? 1175 : 880, now);
      }
    }
    this.warnGain.set(incoming ? 0.05 : 0, now, 0.015);
  }

  /** Lantern jump sequence, driven by phase edges: spool riser → tunnel drone → exit boom. */
  setJumpPhase(phase: JumpPhase): void {
    if (phase === this.jump || !this.loopsReady || !this.engine.running) {
      this.jump = phase;
      return;
    }
    const ctx = this.ctx();
    const now = ctx.currentTime;
    const prev = this.jump;
    this.jump = phase;
    if (prev === 'spool') this.stopGroup(this.riser, this.riserGain, now, 0.12);
    if (prev === 'tunnel') this.stopGroup(this.drone, this.droneGain, now, 0.35);
    if (phase === 'spool') this.startRiser(ctx, now);
    else if (phase === 'tunnel') {
      this.playRaw('jumpEntry', 1, 0);
      this.startDrone(ctx, now);
      this.engine.duckMusic(-10, 2.4, 1.2);
    } else if (phase === 'exit') this.playRaw('jumpExit', 1, 0);
  }

  private stopGroup(nodes: AudioScheduledSourceNode[], g: GainNode | null, now: number, fade: number): void {
    if (g) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + fade);
    }
    for (let i = 0; i < nodes.length; i++) {
      try {
        nodes[i].stop(now + fade + 0.02);
      } catch {
        /* already stopped */
      }
    }
    nodes.length = 0;
  }

  /** Shepard–Risset glissando: octave-spaced sines rising forever under a fixed bell curve. */
  private startRiser(ctx: BaseAudioContext, now: number): void {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(0.2, now + 0.9);
    bus.gain.setTargetAtTime(0.26, now + 0.9, 1);
    bus.connect(this.jumpBus);
    this.riserGain = bus;
    const end = now + SHEPARD_SPAN;
    const pts = 96;
    const curve = new Float32Array(pts);
    for (let k = 0; k < SHEPARD_OCTAVES; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      // Frequency: exponential glide up to the top, jump to the bottom (silent there), repeat.
      let p = k;
      let t = now;
      o.frequency.setValueAtTime(SHEPARD_FMIN * Math.pow(2, p), t);
      while (t < end) {
        const tWrap = t + (SHEPARD_OCTAVES - p) * SHEPARD_PERIOD;
        o.frequency.exponentialRampToValueAtTime(SHEPARD_FMIN * Math.pow(2, SHEPARD_OCTAVES), Math.min(tWrap, end + 1));
        if (tWrap >= end) break;
        o.frequency.setValueAtTime(SHEPARD_FMIN, tWrap);
        p = 0;
        t = tWrap;
      }
      for (let i = 0; i < pts; i++) {
        const tt = (i / (pts - 1)) * SHEPARD_SPAN;
        const pos = (k + tt / SHEPARD_PERIOD) % SHEPARD_OCTAVES;
        const x = (pos - SHEPARD_OCTAVES / 2) / (SHEPARD_OCTAVES / 4.5);
        curve[i] = Math.exp(-x * x) * 0.3;
      }
      g.gain.setValueCurveAtTime(curve, now, SHEPARD_SPAN);
      o.connect(g).connect(bus);
      o.start(now);
      o.stop(end);
      this.riser.push(o);
    }
    // Rising air.
    const n = this.noise(null, now, end);
    const bp = this.filter('bandpass', 300, 1.4);
    sweep(bp.frequency, now, 300, 7000, 1.6);
    const ng = this.gain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.5, now + 1.2);
    n.connect(bp).connect(ng).connect(bus);
    this.riser.push(n);
  }

  /** Lattice-tunnel drone: low fifth cluster, breathing filter, wind. */
  private startDrone(ctx: BaseAudioContext, now: number): void {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(0.32, now + 0.5);
    bus.connect(this.jumpBus);
    this.droneGain = bus;
    const end = now + 30;
    const lp = this.filter('lowpass', 500, 2.5);
    const lfo = this.osc(null, 'sine', 0.35, now, end);
    const lg = this.gain(320);
    lfo.connect(lg).connect(lp.frequency);
    lp.connect(bus);
    const fs = [55, 82.5, 110.4, 164.4];
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'triangle', 'sawtooth'];
    for (let i = 0; i < fs.length; i++) {
      const o = this.osc(null, types[i], fs[i], now, end);
      o.detune.value = (i - 1.5) * 6;
      const g = this.gain(0.22 - i * 0.03);
      o.connect(g).connect(lp);
      this.drone.push(o);
    }
    const n = this.noise(null, now, end, true);
    const bp = this.filter('bandpass', 700, 0.7);
    const wl = this.osc(null, 'sine', 0.5, now, end);
    const wg = this.gain(400);
    wl.connect(wg).connect(bp.frequency);
    const ng = this.gain(0.35);
    n.connect(bp).connect(ng).connect(bus);
    this.drone.push(n, lfo, wl);
  }
}
