/**
 * Small DSP toolkit shared by the SFX and music synths. Everything targets a
 * BaseAudioContext, so the same code drives a live AudioContext or an
 * OfflineAudioContext (headless renders in scripts/audio-render.mjs).
 */

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic PRNG (mulberry32). Seeded so moods sound the same every run. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  reseed(seed: number): void {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % n;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Mono noise buffer. White, or pink (Voss–McCartney-ish, Paul Kellet's filter). */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number, pink = false): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = new Rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r.next() * 2 - 1;
    if (!pink) {
      d[i] = w;
      continue;
    }
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

/**
 * Stereo reverb impulse: exponentially decaying noise, darkening over time
 * (one-pole low-pass whose cutoff falls with t), with a few early reflections.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, seed: number, brightness = 0.6, predelay = 0.012): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, n, sr);
  const r = new Rng(seed);
  const pre = Math.floor(predelay * sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      const env = Math.pow(1 - t, 2.2) * Math.exp(-t * 3.2);
      // Low-pass coefficient drifts from bright to dark.
      const a = brightness * (1 - t * 0.85) + 0.04;
      lp += a * (r.next() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    // Early reflections.
    for (let k = 0; k < 6; k++) {
      const at = pre + Math.floor(sr * (0.008 + r.next() * 0.06));
      if (at < n) d[at] += (r.next() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
    }
    // Normalise energy so different lengths sit at similar loudness.
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const g = 1 / Math.sqrt(Math.max(e, 1e-9));
    for (let i = 0; i < n; i++) d[i] *= g * 2.2;
  }
  return buf;
}

/** Transparent below `knee`, tanh-rounded above; output never exceeds ~0.965. */
export function softClipCurve(n = 2048, knee = 0.85): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const room = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** Asymmetric overdrive for gritty timbres. */
export function driveCurve(amount: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) * (x > 0 ? 1 : 0.85);
  }
  return c;
}

/** Band-limited pulse wave with the given duty cycle. */
export function pulseWave(ctx: BaseAudioContext, duty: number, harmonics = 48): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty) * Math.cos(Math.PI * k * duty);
    imag[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty) * Math.sin(Math.PI * k * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// ── envelope helpers ────────────────────────────────────────────────────
const FLOOR = 0.0001;

/** Percussive envelope: fast linear attack, exponential decay to silence. Returns end time. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
  p.setValueAtTime(0, t + attack + decay + 0.001);
  return t + attack + decay + 0.002;
}

/** ADSR: attack → decay to sustain·peak, hold until t+hold, then release. Returns end time. */
export function adsr(p: AudioParam, t: number, peak: number, a: number, d: number, s: number, hold: number, r: number): number {
  const sus = Math.max(peak * s, FLOOR);
  const hEnd = Math.max(t + a + 0.001, t + hold);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (t + a + d < hEnd) {
    p.exponentialRampToValueAtTime(sus, t + a + d);
    p.setValueAtTime(sus, hEnd);
  } else {
    p.linearRampToValueAtTime(sus, hEnd);
  }
  p.exponentialRampToValueAtTime(FLOOR, hEnd + r);
  p.setValueAtTime(0, hEnd + r + 0.001);
  return hEnd + r + 0.002;
}

/** Exponential frequency sweep (guards against non-positive targets). */
export function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, 0.01), t);
  p.exponentialRampToValueAtTime(Math.max(to, 0.01), t + Math.max(dur, 0.001));
}

/**
 * Smoothed AudioParam writer for per-frame loop control. Only touches the
 * automation timeline when the target actually moves, so a 60 Hz update loop
 * does not pile up events. Allocation-free.
 */
export class Smooth {
  private last = Number.NaN;
  constructor(
    readonly p: AudioParam,
    private eps: number,
  ) {}
  set(v: number, now: number, tc: number): void {
    if (Math.abs(v - this.last) < this.eps) return;
    this.last = v;
    this.p.cancelScheduledValues(now);
    this.p.setTargetAtTime(v, now, tc);
  }
  /** Forget the cached value (after someone else scheduled on the param). */
  invalidate(): void {
    this.last = Number.NaN;
  }
}
