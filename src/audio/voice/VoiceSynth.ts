import { driveCurve, makeImpulse, makeNoiseBuffer } from '../dsp';
import type { Track, VoicePlan, VoiceProfile } from './plan';

/**
 * Procedural voice — the synthesiser. Renders a VoicePlan (see plan.ts) onto
 * one small Web Audio graph built from stock nodes, so it runs identically
 * in a live AudioContext and an OfflineAudioContext:
 *
 *   glottal osc(s) ─► voice level ─┐                 ┌─► BP F1 ─┐
 *   noise ─────────► breath level ─┴─► formant in ───┼─► BP F2 ─┼─► mix ─► channel ─► out
 *                                   └─► LP body ─────┘   BP F3 ─┘   ▲
 *   noise ─► BP (noiseHz) ─► frication level ────────────────────────┘
 *
 * Channels: `radio` (band-limited, driven, hiss bed, squelch tail),
 * `intercept` (radio + dropouts + heterodyne whistle), `clean` (in-person:
 * small room) and `narrator` (warm, a longer hall).
 */
export type VoiceChannel = 'radio' | 'intercept' | 'clean' | 'narrator';

export interface VoiceHandle {
  /** Context time the voice falls silent. */
  end: number;
  /** Fade out and stop at context time `at` (default now). */
  stop(at?: number): void;
}

interface Kit {
  noise: AudioBuffer;
  glottal: PeriodicWave;
  room: AudioBuffer;
  hall: AudioBuffer;
  drive: Map<number, Float32Array<ArrayBuffer>>;
}
const kits = new WeakMap<BaseAudioContext, Kit>();

function kit(ctx: BaseAudioContext): Kit {
  let k = kits.get(ctx);
  if (k) return k;
  // Glottal pulse: harmonics fall ~ −12 dB/oct above the 2nd with a slight
  // skew (open/closed phase), so vowels come out round rather than buzzy.
  const N = 64;
  const re = new Float32Array(N + 1);
  const im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    const a = 1 / Math.pow(n, 1.35);
    im[n] = a * Math.cos(n * 0.35);
    re[n] = a * Math.sin(n * 0.35) * 0.5;
  }
  k = {
    noise: makeNoiseBuffer(ctx, 2.5, 0x70c3),
    glottal: ctx.createPeriodicWave(re, im, { disableNormalization: false }),
    room: makeImpulse(ctx, 0.5, 0x51, 0.55, 0.006),
    hall: makeImpulse(ctx, 1.6, 0x52, 0.4, 0.02),
    drive: new Map(),
  };
  kits.set(ctx, k);
  return k;
}

function curve(k: Kit, amount: number): Float32Array<ArrayBuffer> {
  const q = Math.round(amount * 10) / 10;
  let c = k.drive.get(q);
  if (!c) k.drive.set(q, (c = driveCurve(q, 1024)));
  return c;
}

/** Write a breakpoint track onto an AudioParam starting at context time t0. */
function automate(p: AudioParam, tr: Track, t0: number, scale = 1, min = -Infinity, max = Infinity): void {
  if (!tr.length) return;
  const clamp = (v: number) => (v < min ? min : v > max ? max : v);
  p.cancelScheduledValues(t0);
  p.setValueAtTime(clamp(tr[0][1] * scale), t0 + tr[0][0]);
  for (let i = 1; i < tr.length; i++) p.linearRampToValueAtTime(clamp(tr[i][1] * scale), t0 + tr[i][0]);
}

function hash(n: number): () => number {
  let a = n >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Schedule `plan` at context time `t0` into `dest`. Returns a handle to stop it
 * early (a higher-priority transmission cutting in). Never throws.
 */
export function renderVoice(ctx: BaseAudioContext, dest: AudioNode, plan: VoicePlan, prof: VoiceProfile, t0: number, channel: VoiceChannel, level = 1): VoiceHandle {
  const k = kit(ctx);
  const nyq = ctx.sampleRate / 2 - 200;
  const end = t0 + plan.dur;
  const radio = channel === 'radio' || channel === 'intercept';
  const tail = radio ? 0.25 : channel === 'narrator' ? 1.7 : 0.6;
  const stopAt = end + tail;
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const track = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const src = <T extends AudioScheduledSourceNode>(n: T): T => {
    sources.push(n);
    nodes.push(n);
    return n;
  };
  const gain = (v = 0) => {
    const g = track(ctx.createGain());
    g.gain.value = v;
    return g;
  };
  const biquad = (type: BiquadFilterType, f: number, q = 0.707, g = 0) => {
    const b = track(ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = Math.min(f, nyq);
    b.Q.value = q;
    b.gain.value = g;
    return b;
  };
  const noiseSrc = (offset: number) => {
    const s = src(ctx.createBufferSource());
    s.buffer = k.noise;
    s.loop = true;
    s.start(t0, offset % 2.4);
    s.stop(stopAt);
    return s;
  };
  const tr = plan.tracks;
  const machine = prof.accent === 'machine';

  // ── source: glottal pulse (+ chorus), pitch tracks, vibrato + flutter ──
  const voiceLvl = gain();
  automate(voiceLvl.gain, tr.voice, t0, 1, 0, 1.5);
  const ratios = [1, ...(prof.chorus ?? [])];
  const vib = src(ctx.createOscillator());
  vib.frequency.value = plan.sung ? 5.1 : 5.6;
  const flutter = src(ctx.createOscillator());
  flutter.frequency.value = 7.3;
  const vibDepth = (prof.vibrato ?? 0) + (plan.sung ? 0.35 : 0);
  for (let i = 0; i < ratios.length; i++) {
    const o = src(ctx.createOscillator());
    if (machine) o.type = 'square';
    else o.setPeriodicWave(k.glottal);
    automate(o.frequency, tr.f0, t0, ratios[i], 30, 2000);
    const vg = gain(prof.f0 * ratios[i] * (Math.pow(2, vibDepth / 12) - 1));
    vib.connect(vg).connect(o.frequency);
    const fg = gain(machine ? 0 : prof.f0 * ratios[i] * 0.006);
    flutter.connect(fg).connect(o.frequency);
    const og = gain(i === 0 ? 1 : 0.55);
    o.connect(og).connect(voiceLvl);
    o.start(t0);
    o.stop(stopAt);
  }
  vib.start(t0);
  vib.stop(stopAt);
  flutter.start(t0);
  flutter.stop(stopAt);

  // ── aspiration ──
  const breathLvl = gain();
  automate(breathLvl.gain, tr.breath, t0, 0.55, 0, 1);
  const breathSrc = noiseSrc(0.37);
  breathSrc.connect(breathLvl);

  // ── formant bank ──
  const fin = gain(1);
  voiceLvl.connect(fin);
  breathLvl.connect(fin);
  const mix = gain(1);
  const bank: [Track, number, number][] = [
    [tr.f1, 5.5, 1.0],
    [tr.f2, 9, 0.72],
    [tr.f3, 12, 0.42],
  ];
  for (const [ft, q, g] of bank) {
    const bp = biquad('bandpass', 500, q);
    automate(bp.frequency, ft, t0, 1, 60, nyq);
    // Bandpass passes 0 dB at centre; the pulse's harmonics there are small, so make up.
    fin.connect(bp).connect(gain(g * 4.2)).connect(mix);
  }
  const body = biquad('lowpass', machine ? 500 : 340, 0.6);
  voiceLvl.connect(body).connect(gain(0.28)).connect(mix);

  // ── frication / bursts ──
  const fricBp = biquad('bandpass', 4000, 1.4);
  automate(fricBp.frequency, tr.noiseHz, t0, 1, 200, nyq);
  const fricLvl = gain();
  automate(fricLvl.gain, tr.noise, t0, 1.25, 0, 1.5);
  noiseSrc(1.21).connect(fricBp).connect(fricLvl).connect(mix);

  // ── channel ──
  const out = gain(0);
  const lv = level * (prof.gain ?? 1);
  let chainIn: AudioNode = mix;
  if (radio) {
    const hp = biquad('highpass', 340, 0.8);
    const hp2 = biquad('highpass', 300, 0.6);
    const pk = biquad('peaking', 1750, 1.1, 6);
    const lp = biquad('lowpass', 3100, 0.9);
    const lp2 = biquad('lowpass', 3500, 0.7);
    const sh = track(ctx.createWaveShaper());
    sh.curve = curve(k, 0.6 + prof.rasp * 1.6 + (channel === 'intercept' ? 1.2 : 0));
    const pre = gain(1.3);
    mix.connect(hp).connect(pre).connect(sh).connect(hp2).connect(pk).connect(lp).connect(lp2);
    chainIn = lp2;
    // Carrier hiss for the length of the transmission.
    const hiss = gain(0);
    const hb = biquad('bandpass', 2600, 0.5);
    noiseSrc(0.91).connect(hb).connect(hiss).connect(out);
    const hl = channel === 'intercept' ? 0.05 : 0.018;
    hiss.gain.setValueAtTime(0, t0);
    hiss.gain.linearRampToValueAtTime(hl, t0 + 0.03);
    hiss.gain.setValueAtTime(hl, end);
    hiss.gain.linearRampToValueAtTime(0, end + 0.04);
    // Squelch tail: the carrier dropping ("kssh") after the last word.
    const sq = gain(0);
    const sqBp = biquad('bandpass', 3200, 0.9);
    sqBp.frequency.setValueAtTime(3200, end);
    sqBp.frequency.exponentialRampToValueAtTime(900, end + 0.16);
    noiseSrc(1.77).connect(sqBp).connect(sq).connect(out);
    sq.gain.setValueAtTime(0, end);
    sq.gain.linearRampToValueAtTime(0.22, end + 0.006);
    sq.gain.exponentialRampToValueAtTime(0.001, end + 0.17);
    sq.gain.setValueAtTime(0, end + 0.18);
    if (channel === 'intercept') {
      // Heterodyne whistle drifting under the voice.
      const wh = src(ctx.createOscillator());
      wh.frequency.setValueAtTime(1350, t0);
      wh.frequency.linearRampToValueAtTime(1620, end);
      const wg = gain(0.012);
      wh.connect(wg).connect(out);
      wh.start(t0);
      wh.stop(end + 0.05);
    }
  } else {
    const lp = biquad('lowpass', channel === 'narrator' ? 6200 : 7200, 0.7);
    const hp = biquad('highpass', 90, 0.7);
    const shelf = biquad('lowshelf', 200, 0.7, channel === 'narrator' ? 3 : 0);
    mix.connect(hp).connect(shelf).connect(lp);
    chainIn = lp;
    const verb = track(ctx.createConvolver());
    verb.normalize = false;
    verb.buffer = channel === 'narrator' ? k.hall : k.room;
    lp.connect(verb).connect(gain(channel === 'narrator' ? 0.11 : 0.07)).connect(out);
  }
  // Transmission gating: dropouts on intercepts, a mid-word cut available to stop().
  const gate = gain(1);
  if (channel === 'intercept') {
    const r = hash(Math.round(plan.dur * 1000) + plan.syllables * 97);
    let t = t0 + 0.1;
    while (t < end) {
      const len = 0.03 + r() * 0.09;
      if (r() < 0.3) {
        gate.gain.setValueAtTime(1, t);
        gate.gain.linearRampToValueAtTime(0.05, t + 0.006);
        gate.gain.setValueAtTime(0.05, t + len);
        gate.gain.linearRampToValueAtTime(1, t + len + 0.006);
      }
      t += len + 0.08 + r() * 0.3;
    }
  }
  chainIn.connect(gate).connect(out);
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(lv, t0 + 0.012);
  out.connect(dest);

  let stopped = false;
  const cleanup = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* gone */
      }
    }
    try {
      out.disconnect();
    } catch {
      /* gone */
    }
  };
  breathSrc.onended = cleanup;
  return {
    end,
    stop(at?: number) {
      if (stopped) return;
      stopped = true;
      const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
      if (t >= stopAt) return;
      try {
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.02);
        for (const s of sources) s.stop(t + 0.03);
      } catch {
        /* already stopped */
      }
    },
  };
}
