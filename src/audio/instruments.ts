import { Rng, adsr, mtof, perc, pulseWave, sweep } from './dsp';

/**
 * The OVA-score synth rack: FM / subtractive voices in the spirit of an
 * early-90s studio (DX7 bells and fretless bass, JP-8 brass, 909-ish gated
 * drums). Each call builds a short-lived node chain into `out` scheduled at
 * `t` on the context clock, so it works identically on an OfflineAudioContext.
 *
 * Velocities are 0..1; levels are balanced so a full combat arrangement sits
 * around −18 dBFS RMS before the music bus.
 */
export class Instruments {
  protected rng = new Rng(0xbe11);
  protected pulse: PeriodicWave;

  constructor(
    protected ctx: BaseAudioContext,
    private noiseBuf: AudioBuffer,
    private pinkBuf: AudioBuffer,
  ) {
    this.pulse = pulseWave(ctx, 0.25);
  }

  protected osc(type: OscillatorType, f: number, t: number, end: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(end);
    return o;
  }

  protected noise(t: number, end: number, pink = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = pink ? this.pinkBuf : this.noiseBuf;
    s.loop = true;
    s.start(t, this.rng.next() * 2.5);
    s.stop(end);
    return s;
  }

  protected gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  protected filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** Brass stab / section: detuned saws, scooped attack, "blat" filter envelope. */
  brass(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright = 1, attack = 0.02): void {
    const f = mtof(midi);
    const release = 0.18;
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', f, 1.6);
    const peak = Math.min(14000, f * (3 + 7 * vel * bright) + 500);
    const settle = Math.min(9000, f * 2.2 + 700 * bright);
    lp.frequency.setValueAtTime(f * 1.1 + 150, t);
    lp.frequency.exponentialRampToValueAtTime(peak, t + attack + 0.05);
    lp.frequency.exponentialRampToValueAtTime(settle, t + attack + 0.4);
    const g = this.gain();
    adsr(g.gain, t, 0.075 * vel, attack, 0.25, 0.7, dur, release);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      const det = i ? 8 : -8;
      o.detune.setValueAtTime(det - 40, t);
      o.detune.linearRampToValueAtTime(det, t + 0.05);
      o.connect(lp);
    }
    lp.connect(g).connect(out);
  }

  /** Warm poly pad: detuned saws under a slowly opening low-pass. */
  pad(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.8, release = 1.5, cutoff = 1500): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', cutoff * 0.5, 0.6);
    lp.frequency.setValueAtTime(cutoff * 0.45, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + attack * 1.2);
    const g = this.gain();
    adsr(g.gain, t, 0.045 * vel, attack, 0.5, 0.85, dur, release);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = i ? 7 : -7;
      o.connect(lp);
    }
    lp.connect(g).connect(out);
  }

  /** Choir "aah" source: two detuned saws with delayed vibrato. Route into a formant bank. */
  choir(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 2, release = 3): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const g = this.gain();
    adsr(g.gain, t, 0.06 * vel, attack, 0.5, 0.9, dur, release);
    const vib = this.osc('sine', 4.6 + this.rng.next() * 0.8, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(8, t + attack);
    vib.connect(vg);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = i ? 5 : -5;
      vg.connect(o.detune);
      o.connect(g);
    }
    g.connect(out);
  }

  /** Pulse-wave arpeggio pluck. */
  arp(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright = 1): void {
    const f = mtof(midi);
    const decay = Math.min(Math.max(dur * 1.5, 0.08), 0.3);
    const end = t + decay + 0.05;
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.pulse);
    o.frequency.value = f;
    o.start(t);
    o.stop(end);
    const lp = this.filter('lowpass', 2000, 3);
    sweep(lp.frequency, t, Math.min(12000, f * 5 * bright + 900), f * 1.5 + 300, 0.12);
    const g = this.gain();
    perc(g.gain, t, 0.06 * vel, 0.002, decay);
    o.connect(lp).connect(g).connect(out);
  }

  /** Fretless-ish FM bass: woody "mwah" index envelope, optional slide from the previous note. */
  bass(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const end = t + dur + 0.12;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f, t, end);
    const tri = this.osc('triangle', f, t, end);
    if (slideFrom !== null && slideFrom !== midi) {
      const fs = mtof(slideFrom);
      for (const o of [car, mod, tri]) {
        o.frequency.setValueAtTime(fs, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      }
    }
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 2.4 * (0.4 + vel * 0.6), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.45, t + 0.2);
    mod.connect(mg).connect(car.frequency);
    const lp = this.filter('lowpass', 1300, 0.8);
    const tg = this.gain(0.45);
    car.connect(lp);
    tri.connect(tg).connect(lp);
    const g = this.gain();
    adsr(g.gain, t, 0.2 * vel, 0.008, 0.25, 0.7, dur, 0.07);
    lp.connect(g).connect(out);
  }

  /** DX-style FM bell / sparkle lead. */
  bell(out: AudioNode, t: number, midi: number, vel: number, decay = 1.2, ratio = 3.5): void {
    const f = mtof(midi);
    const end = t + decay + 0.1;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f * ratio, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 3 * vel + f * 0.5, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.12, t + decay * 0.8);
    mod.connect(mg).connect(car.frequency);
    const g = this.gain();
    perc(g.gain, t, 0.07 * vel, 0.002, decay);
    car.connect(g);
    // Tine partial an octave up for sparkle.
    const tine = this.osc('sine', f * 2, t, end);
    const tg = this.gain();
    perc(tg.gain, t, 0.018 * vel, 0.001, decay * 0.35);
    tine.connect(tg).connect(out);
    g.connect(out);
  }

  kick(out: AudioNode, t: number, vel: number): void {
    const end = t + 0.45;
    const o = this.osc('sine', 160, t, end);
    sweep(o.frequency, t, 165, 44, 0.11);
    const g = this.gain();
    perc(g.gain, t, 0.55 * vel, 0.001, 0.38);
    o.connect(g).connect(out);
    const n = this.noise(t, t + 0.02);
    const hp = this.filter('highpass', 3000);
    const ng = this.gain();
    perc(ng.gain, t, 0.14 * vel, 0.0005, 0.007);
    n.connect(hp).connect(ng).connect(out);
  }

  /** Gated snare: noise body held flat then chopped — the 80s/90s gated-reverb crack. */
  snare(out: AudioNode, t: number, vel: number, gated = true): void {
    const hold = gated ? 0.16 : 0.0;
    const end = t + hold + 0.2;
    const n = this.noise(t, end);
    const hp = this.filter('highpass', 380);
    const bp = this.filter('peaking', 2200, 0.8);
    bp.gain.value = 5;
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.26 * vel, t + 0.001);
    if (gated) {
      g.gain.exponentialRampToValueAtTime(0.1 * vel, t + 0.05);
      g.gain.linearRampToValueAtTime(0.075 * vel, t + hold);
      g.gain.linearRampToValueAtTime(0, t + hold + 0.015);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    }
    n.connect(hp).connect(bp).connect(g).connect(out);
    const o = this.osc('triangle', 200, t, t + 0.15);
    sweep(o.frequency, t, 205, 165, 0.06);
    const og = this.gain();
    perc(og.gain, t, 0.22 * vel, 0.001, 0.08);
    o.connect(og).connect(out);
  }

  hat(out: AudioNode, t: number, vel: number, open = false): void {
    const decay = open ? 0.22 : 0.035;
    const n = this.noise(t, t + decay + 0.02);
    const hp = this.filter('highpass', 7500);
    const g = this.gain();
    perc(g.gain, t, 0.09 * vel, 0.0008, decay);
    n.connect(hp).connect(g).connect(out);
  }

  crash(out: AudioNode, t: number, vel: number): void {
    const end = t + 2.2;
    const n = this.noise(t, end);
    const hp = this.filter('highpass', 4200);
    const g = this.gain();
    perc(g.gain, t, 0.11 * vel, 0.002, 1.9);
    n.connect(hp).connect(g).connect(out);
    const mg = this.gain();
    perc(mg.gain, t, 0.018 * vel, 0.002, 1.2);
    const mh = this.filter('highpass', 5000);
    for (const f of [3150, 4270, 5590]) this.osc('square', f, t, end).connect(mh);
    mh.connect(mg).connect(out);
  }

  tom(out: AudioNode, t: number, midi: number, vel: number): void {
    const f = mtof(midi);
    const o = this.osc('sine', f * 1.6, t, t + 0.45);
    sweep(o.frequency, t, f * 1.6, f, 0.09);
    const g = this.gain();
    perc(g.gain, t, 0.4 * vel, 0.001, 0.36);
    o.connect(g).connect(out);
  }

  /** Low drone: detuned saws + sine sub under a slowly breathing low-pass. */
  drone(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 3, release = 3): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', 320, 1.5);
    const lfo = this.osc('sine', 0.06 + this.rng.next() * 0.05, t, end);
    const lg = this.gain(180);
    lfo.connect(lg).connect(lp.frequency);
    const g = this.gain();
    adsr(g.gain, t, 0.09 * vel, attack, 1, 1, dur, release);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = i ? 11 : -11;
      o.connect(lp);
    }
    const sub = this.osc('sine', f * 0.5, t, end);
    const sg = this.gain(0.8);
    sub.connect(sg).connect(g);
    lp.connect(g).connect(out);
  }

  /** Pure sine partial with slow detune drift (Ligeti-style shimmering clusters). */
  sine(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 3, release = 4, driftCents = 0): void {
    const end = t + Math.max(dur, attack) + release + 0.05;
    const o = this.osc('sine', mtof(midi), t, end);
    o.detune.setValueAtTime(0, t);
    o.detune.linearRampToValueAtTime(driftCents, end);
    const g = this.gain();
    adsr(g.gain, t, 0.05 * vel, attack, 0.5, 1, dur, release);
    o.connect(g).connect(out);
  }

  /** Reverse-cymbal swell ending at t + dur. */
  swell(out: AudioNode, t: number, dur: number, vel: number): void {
    const n = this.noise(t, t + dur + 0.03, false);
    const hp = this.filter('highpass', 2500);
    sweep(hp.frequency, t, 1500, 6000, dur);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    n.connect(hp).connect(g).connect(out);
  }
}
