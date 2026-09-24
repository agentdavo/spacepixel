import { Instruments } from '../instruments';
import { adsr, mtof, perc, sweep } from '../dsp';

/**
 * The extended OVA studio rack: everything a 1988–1996 OVA soundtrack date
 * had in the room, built from Web Audio nodes.
 *
 *   strings   — a section (three detuned bowed saws + body + bow filter),
 *               tremolo, pizzicato, harp, cello; a Solina string machine
 *   keys      — DX7 tine e-piano, FM "glass" pad, Juno pulse pad
 *   brass     — orchestral horns, the Fairlight orchestra hit
 *   leads     — FM alto sax, portamento synth lead, flute, solo violin
 *   bass      — FM slap bass (thumb + pop), resonant analog synth bass
 *   drums     — 909, 707 and LinnDrum-style kits, Simmons toms,
 *               orchestral timpani / snare / suspended cymbal, clap,
 *               cowbell, shaker, tambourine
 *
 * Like the base rack, each call builds a short-lived node chain scheduled at
 * `t`, so it renders the same live and on an OfflineAudioContext. Levels are
 * matched to the base Instruments so palettes can swap patches freely.
 */
export class OvaRack extends Instruments {
  // ── strings ──────────────────────────────────────────────────────────
  /** String section: three detuned saws, bow filter opening on the attack, delayed vibrato, wooden body. */
  strings(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.35, release = 0.7, bright = 1): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const hp = this.filter('highpass', 140, 0.6);
    const body = this.filter('peaking', 1150, 1.1);
    body.gain.value = 4;
    const lp = this.filter('lowpass', f * 1.5 + 300, 0.5);
    lp.frequency.setValueAtTime(f * 1.5 + 300, t);
    lp.frequency.linearRampToValueAtTime(Math.min(9000, f * (3 + 2.5 * bright) + 1400 * bright), t + attack);
    const g = this.gain();
    adsr(g.gain, t, 0.034 * vel, attack, 0.4, 0.85, dur, release);
    const vib = this.osc('sine', 5 + this.rng.next() * 0.9, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(10, t + attack + 0.35);
    vib.connect(vg);
    const det = [-10, 1, 9];
    for (let i = 0; i < 3; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = det[i] + (this.rng.next() - 0.5) * 3;
      vg.connect(o.detune);
      o.connect(hp);
    }
    hp.connect(body).connect(lp).connect(g).connect(out);
  }

  /** Bowed tremolo: the section re-articulating at ~11 Hz (Macross battle underscore). */
  tremolo(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.15, release = 0.4): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', Math.min(8000, f * 5 + 1500), 0.6);
    const body = this.filter('peaking', 1300, 1);
    body.gain.value = 3;
    const g = this.gain();
    adsr(g.gain, t, 0.03 * vel, attack, 0.2, 0.9, dur, release);
    const tg = this.gain(0.6);
    const lfo = this.osc('triangle', 10.5 + this.rng.next() * 1.5, t, end);
    const lg = this.gain(0.4);
    lfo.connect(lg).connect(tg.gain);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = i ? 8 : -8;
      o.connect(body);
    }
    body.connect(lp).connect(g).connect(tg).connect(out);
  }

  /** Pizzicato: plucked saw through a fast-closing filter. */
  pizz(out: AudioNode, t: number, midi: number, vel: number, decay = 0.32): void {
    const f = mtof(midi);
    const end = t + decay + 0.05;
    const o = this.osc('sawtooth', f, t, end);
    const tri = this.osc('triangle', f, t, end);
    const lp = this.filter('lowpass', 2000, 1.2);
    sweep(lp.frequency, t, Math.min(9000, f * 6 + 900), f * 1.3 + 150, decay * 0.5);
    const body = this.filter('peaking', 900, 1);
    body.gain.value = 5;
    const g = this.gain();
    perc(g.gain, t, 0.07 * vel, 0.002, decay);
    o.connect(lp);
    tri.connect(lp);
    lp.connect(body).connect(g).connect(out);
  }

  /** Concert harp: triangle + octave sine, long ring. */
  harp(out: AudioNode, t: number, midi: number, vel: number, decay = 1.6): void {
    const f = mtof(midi);
    const end = t + decay + 0.05;
    const o = this.osc('triangle', f, t, end);
    const s = this.osc('sine', f * 2, t, end);
    const lp = this.filter('lowpass', 3000, 0.8);
    sweep(lp.frequency, t, Math.min(10000, f * 8), f * 2 + 400, decay * 0.4);
    const g = this.gain();
    perc(g.gain, t, 0.08 * vel, 0.002, decay);
    const sg = this.gain();
    perc(sg.gain, t, 0.025 * vel, 0.001, decay * 0.4);
    o.connect(lp).connect(g).connect(out);
    s.connect(sg).connect(out);
  }

  /** Cello / basses: two bowed saws, low body resonance, slow bow. */
  cello(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const attack = 0.09;
    const end = t + dur + 0.35;
    const body = this.filter('peaking', 260, 1.2);
    body.gain.value = 5;
    const lp = this.filter('lowpass', f * 2 + 200, 0.6);
    lp.frequency.setValueAtTime(f * 2 + 200, t);
    lp.frequency.linearRampToValueAtTime(Math.min(5000, f * 7 + 700), t + attack);
    const g = this.gain();
    adsr(g.gain, t, 0.11 * vel, attack, 0.3, 0.8, dur, 0.25);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      o.detune.value = i ? 6 : -6;
      if (slideFrom !== null && slideFrom !== midi) {
        o.frequency.setValueAtTime(mtof(slideFrom), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.1);
      }
      o.connect(body);
    }
    const sub = this.osc('sine', f, t, end);
    const sg = this.gain(0.5);
    sub.connect(sg).connect(g);
    body.connect(lp).connect(g).connect(out);
  }

  /** Solina / string machine: bright divide-down saws; the channel's ensemble chorus does the rest. */
  solina(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.25, release = 0.9): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', Math.min(7000, 1800 + f * 2), 0.5);
    const hp = this.filter('highpass', 220, 0.5);
    const g = this.gain();
    adsr(g.gain, t, 0.03 * vel, attack, 0.3, 0.9, dur, release);
    const a = this.osc('sawtooth', f, t, end);
    const b = this.osc('sawtooth', f * 2, t, end);
    b.detune.value = 4;
    const bg = this.gain(0.45);
    a.connect(hp);
    b.connect(bg).connect(hp);
    hp.connect(lp).connect(g).connect(out);
  }

  // ── keys & pads ──────────────────────────────────────────────────────
  /** Juno-style pad: pulse + sub square under an enveloped low-pass. */
  juno(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.5, release = 1.2, cutoff = 1800): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const p = this.ctx.createOscillator();
    p.setPeriodicWave(this.pulse);
    p.frequency.value = f;
    p.start(t);
    p.stop(end);
    const saw = this.osc('sawtooth', f, t, end);
    saw.detune.value = 5;
    const sub = this.osc('square', f / 2, t, end);
    const sg = this.gain(0.35);
    const lp = this.filter('lowpass', cutoff * 0.4, 1.4);
    lp.frequency.setValueAtTime(cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + attack);
    lp.frequency.setTargetAtTime(cutoff * 0.75, t + attack, 1.2);
    const g = this.gain();
    adsr(g.gain, t, 0.04 * vel, attack, 0.6, 0.8, dur, release);
    p.connect(lp);
    saw.connect(lp);
    sub.connect(sg).connect(lp);
    lp.connect(g).connect(out);
  }

  /** DX "glass" pad: high-ratio FM shimmer over a pure carrier, slow bloom. */
  glass(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.9, release = 2): void {
    const f = mtof(midi);
    const end = t + Math.max(dur, attack) + release + 0.05;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f * 7.001, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 0.1, t);
    mg.gain.linearRampToValueAtTime(f * 1.3 * vel, t + attack);
    mg.gain.setTargetAtTime(f * 0.35, t + attack, 1.5);
    mod.connect(mg).connect(car.frequency);
    const car2 = this.osc('sine', f * 2, t, end);
    car2.detune.value = 6;
    const c2 = this.gain(0.3);
    const g = this.gain();
    adsr(g.gain, t, 0.05 * vel, attack, 0.8, 0.8, dur, release);
    car.connect(g);
    car2.connect(c2).connect(g);
    g.connect(out);
  }

  /** DX7 "E.PIANO 1": a ratio-1 body pair plus a ratio-14 tine that flashes on the attack. */
  epiano(out: AudioNode, t: number, midi: number, dur: number, vel: number): void {
    const f = mtof(midi);
    const decay = Math.min(3.2, Math.max(0.5, dur + 0.9));
    const end = t + decay + 0.1;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * (0.6 + vel * 1.1), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.12, t + decay * 0.6);
    mod.connect(mg).connect(car.frequency);
    const tine = this.osc('sine', f, t, end);
    const tmod = this.osc('sine', f * 14, t, end);
    const tg = this.gain(0);
    tg.gain.setValueAtTime(f * 2.2 * vel, t);
    tg.gain.exponentialRampToValueAtTime(f * 0.01, t + 0.09);
    tmod.connect(tg).connect(tine.frequency);
    const g = this.gain();
    // Held keys ring; released keys damp quickly.
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.075 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.03 * vel, t + Math.min(dur, decay) + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur + 0.25, decay));
    g.gain.setValueAtTime(0, t + Math.min(dur + 0.25, decay) + 0.001);
    const ti = this.gain(0.35);
    car.connect(g);
    tine.connect(ti).connect(g);
    g.connect(out);
  }

  /** Celesta / music box: sine with a soft ratio-4 bell partial. */
  celesta(out: AudioNode, t: number, midi: number, vel: number, decay = 1.4): void {
    const f = mtof(midi);
    const end = t + decay + 0.05;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f * 4, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 1.2 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.02, t + decay * 0.3);
    mod.connect(mg).connect(car.frequency);
    const g = this.gain();
    perc(g.gain, t, 0.07 * vel, 0.001, decay);
    car.connect(g).connect(out);
  }

  // ── brass ────────────────────────────────────────────────────────────
  /** Orchestral horn section: darker saws + triangle, slower tongue, gentle scoop. */
  horns(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright = 1, attack = 0.07): void {
    const f = mtof(midi);
    const release = 0.3;
    const end = t + Math.max(dur, attack) + release + 0.05;
    const lp = this.filter('lowpass', f + 200, 0.9);
    lp.frequency.setValueAtTime(f + 200, t);
    lp.frequency.linearRampToValueAtTime(Math.min(6000, f * (2 + 2.5 * vel * bright) + 400), t + attack + 0.08);
    lp.frequency.setTargetAtTime(Math.min(4000, f * 2 + 400 * bright), t + attack + 0.1, 0.4);
    const g = this.gain();
    adsr(g.gain, t, 0.07 * vel, attack, 0.3, 0.8, dur, release);
    for (let i = 0; i < 2; i++) {
      const o = this.osc('sawtooth', f, t, end);
      const d = i ? 5 : -5;
      o.detune.setValueAtTime(d - 25, t);
      o.detune.linearRampToValueAtTime(d, t + attack + 0.04);
      o.connect(lp);
    }
    const tri = this.osc('triangle', f, t, end);
    const tg = this.gain(0.8);
    tri.connect(tg).connect(lp);
    lp.connect(g).connect(out);
  }

  /** The Fairlight ORCH5 hit: strings + brass + a noise bite, falling filter, gone in half a second. */
  orchHit(out: AudioNode, t: number, midi: number, vel: number, decay = 0.5): void {
    const f = mtof(midi);
    const end = t + decay + 0.05;
    const lp = this.filter('lowpass', 8000, 1);
    sweep(lp.frequency, t, Math.min(12000, f * 12 + 2000), f * 2 + 300, decay);
    const g = this.gain();
    perc(g.gain, t, 0.085 * vel, 0.003, decay);
    for (const [type, mul, d] of [
      ['sawtooth', 1, -12],
      ['sawtooth', 1, 12],
      ['square', 0.5, 0],
    ] as const) {
      const o = this.osc(type, f * mul, t, end);
      o.detune.value = d;
      o.connect(lp);
    }
    lp.connect(g).connect(out);
    const n = this.noise(t, t + 0.12);
    const bp = this.filter('bandpass', Math.min(8000, f * 4), 1.2);
    const ng = this.gain();
    perc(ng.gain, t, 0.05 * vel, 0.001, 0.08);
    n.connect(bp).connect(ng).connect(out);
  }

  // ── leads ────────────────────────────────────────────────────────────
  /** FM alto sax: bright index envelope, formant, breath, scoop, delayed vibrato (Bubblegum Crisis nights). */
  sax(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const end = t + dur + 0.25;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f, t, end);
    const mod2 = this.osc('sine', f * 3, t, end);
    if (slideFrom !== null && slideFrom !== midi) {
      const fs = mtof(slideFrom);
      for (const [o, m] of [
        [car, 1],
        [mod, 1],
        [mod2, 3],
      ] as const) {
        o.frequency.setValueAtTime(fs * m, t);
        o.frequency.exponentialRampToValueAtTime(f * m, t + 0.06);
      }
    } else {
      car.detune.setValueAtTime(-70, t);
      car.detune.linearRampToValueAtTime(0, t + 0.07);
    }
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * 0.4, t);
    mg.gain.linearRampToValueAtTime(f * (1.6 + vel * 1.8), t + 0.05);
    mg.gain.setTargetAtTime(f * (1 + vel), t + 0.08, 0.3);
    mod.connect(mg).connect(car.frequency);
    const mg2 = this.gain(f * 0.35 * vel);
    mod2.connect(mg2).connect(car.frequency);
    const vib = this.osc('sine', 5.4, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.setValueAtTime(0, t + Math.min(0.25, dur * 0.5));
    vg.gain.linearRampToValueAtTime(14, t + Math.min(0.7, dur));
    vib.connect(vg).connect(car.detune);
    const form = this.filter('peaking', 1500, 1.2);
    form.gain.value = 6;
    const lp = this.filter('lowpass', 4200, 0.7);
    const g = this.gain();
    adsr(g.gain, t, 0.07 * vel, 0.03, 0.2, 0.75, dur, 0.1);
    car.connect(form).connect(lp).connect(g).connect(out);
    const n = this.noise(t, end);
    const bp = this.filter('bandpass', f * 2, 3);
    const ng = this.gain();
    adsr(ng.gain, t, 0.012 * vel, 0.02, 0.1, 0.4, dur, 0.08);
    n.connect(bp).connect(ng).connect(out);
  }

  /** Two-oscillator synth lead with portamento and delayed vibrato (JP-8 / Minimoog solo). */
  synthLead(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const end = t + dur + 0.2;
    const lp = this.filter('lowpass', f * 2, 3.5);
    lp.frequency.setValueAtTime(f * 2 + 300, t);
    lp.frequency.linearRampToValueAtTime(Math.min(10000, f * (4 + 4 * vel) + 800), t + 0.03);
    lp.frequency.setTargetAtTime(Math.min(7000, f * 3 + 600), t + 0.04, 0.25);
    const vib = this.osc('sine', 5.8, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t + Math.min(0.2, dur * 0.4));
    vg.gain.linearRampToValueAtTime(18, t + Math.min(0.6, dur));
    vib.connect(vg);
    const g = this.gain();
    adsr(g.gain, t, 0.05 * vel, 0.01, 0.2, 0.8, dur, 0.12);
    for (const [type, d] of [
      ['sawtooth', -7],
      ['square', 7],
    ] as const) {
      const o = this.osc(type, f, t, end);
      o.detune.value = d;
      if (slideFrom !== null && slideFrom !== midi) {
        o.frequency.setValueAtTime(mtof(slideFrom), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      }
      vg.connect(o.detune);
      o.connect(lp);
    }
    lp.connect(g).connect(out);
  }

  /** Flute: sine + a little triangle, breath chiff on the attack, gentle vibrato. */
  flute(out: AudioNode, t: number, midi: number, dur: number, vel: number): void {
    const f = mtof(midi);
    const end = t + dur + 0.25;
    const o = this.osc('sine', f, t, end);
    const tri = this.osc('triangle', f, t, end);
    const tg = this.gain(0.25);
    const vib = this.osc('sine', 4.9, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t + 0.15);
    vg.gain.linearRampToValueAtTime(12, t + Math.min(0.6, dur));
    vib.connect(vg);
    vg.connect(o.detune);
    vg.connect(tri.detune);
    const g = this.gain();
    adsr(g.gain, t, 0.07 * vel, 0.07, 0.2, 0.85, dur, 0.18);
    o.connect(g);
    tri.connect(tg).connect(g);
    g.connect(out);
    const n = this.noise(t, t + dur + 0.1);
    const bp = this.filter('bandpass', f * 2, 6);
    const ng = this.gain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.03 * vel, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.006 * vel, t + 0.12);
    ng.gain.setValueAtTime(0.006 * vel, t + dur);
    ng.gain.linearRampToValueAtTime(0, t + dur + 0.08);
    n.connect(bp).connect(ng).connect(out);
  }

  /** Solo violin: one saw, bright body formants, expressive vibrato. */
  violin(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const end = t + dur + 0.3;
    const o = this.osc('sawtooth', f, t, end);
    if (slideFrom !== null && slideFrom !== midi) {
      o.frequency.setValueAtTime(mtof(slideFrom), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    }
    const vib = this.osc('sine', 6.1, t, end);
    const vg = this.gain(0);
    vg.gain.setValueAtTime(0, t + 0.12);
    vg.gain.linearRampToValueAtTime(20, t + Math.min(0.5, dur));
    vib.connect(vg).connect(o.detune);
    const b1 = this.filter('peaking', 480, 1.5);
    b1.gain.value = 5;
    const b2 = this.filter('peaking', 2900, 1.8);
    b2.gain.value = 6;
    const lp = this.filter('lowpass', 7000, 0.6);
    const g = this.gain();
    adsr(g.gain, t, 0.05 * vel, 0.08, 0.25, 0.85, dur, 0.22);
    o.connect(b1).connect(b2).connect(lp).connect(g).connect(out);
  }

  // ── bass ─────────────────────────────────────────────────────────────
  /** FM slap bass: a thumb "thwack" index spike and a click, or a brighter octave "pop". */
  slap(out: AudioNode, t: number, midi: number, dur: number, vel: number, pop = false): void {
    const f = mtof(midi);
    const end = t + dur + 0.1;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f, t, end);
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * (pop ? 9 : 6) * (0.5 + vel * 0.5), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.5, t + (pop ? 0.07 : 0.12));
    mod.connect(mg).connect(car.frequency);
    const tri = this.osc('triangle', f, t, end);
    const tg = this.gain(0.5);
    const lp = this.filter('lowpass', pop ? 5000 : 3200, 0.9);
    sweep(lp.frequency, t, pop ? 5000 : 3200, 900, 0.2);
    const g = this.gain();
    adsr(g.gain, t, 0.19 * vel, 0.003, 0.15, 0.55, dur, 0.05);
    car.connect(lp);
    tri.connect(tg).connect(lp);
    lp.connect(g).connect(out);
    const n = this.noise(t, t + 0.02);
    const hp = this.filter('highpass', pop ? 3000 : 1800);
    const ng = this.gain();
    perc(ng.gain, t, (pop ? 0.07 : 0.05) * vel, 0.0005, 0.012);
    n.connect(hp).connect(ng).connect(out);
  }

  /** Analog synth bass: saw + sub square through a resonant, snapping low-pass. */
  synthBass(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const f = mtof(midi);
    const end = t + dur + 0.1;
    const saw = this.osc('sawtooth', f, t, end);
    const sq = this.osc('square', f / 2, t, end);
    if (slideFrom !== null && slideFrom !== midi) {
      saw.frequency.setValueAtTime(mtof(slideFrom), t);
      saw.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      sq.frequency.setValueAtTime(mtof(slideFrom) / 2, t);
      sq.frequency.exponentialRampToValueAtTime(f / 2, t + 0.06);
    }
    const sg = this.gain(0.5);
    const lp = this.filter('lowpass', 600, 7);
    sweep(lp.frequency, t, Math.min(6000, f * (6 + 6 * vel)), f * 1.6 + 60, 0.16);
    const g = this.gain();
    adsr(g.gain, t, 0.12 * vel, 0.004, 0.15, 0.7, dur, 0.05);
    saw.connect(lp);
    sq.connect(sg).connect(lp);
    lp.connect(g).connect(out);
  }

  // ── drums ────────────────────────────────────────────────────────────
  /** 909 kick: long pitch sweep, punchy click. */
  kick909(out: AudioNode, t: number, vel: number): void {
    const o = this.osc('sine', 220, t, t + 0.6);
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.3);
    const g = this.gain();
    perc(g.gain, t, 0.6 * vel, 0.001, 0.5);
    o.connect(g).connect(out);
    const n = this.noise(t, t + 0.02);
    const bp = this.filter('bandpass', 3500, 0.8);
    const ng = this.gain();
    perc(ng.gain, t, 0.2 * vel, 0.0003, 0.01);
    n.connect(bp).connect(ng).connect(out);
  }

  /** 707 kick: short, tight, dry. */
  kick707(out: AudioNode, t: number, vel: number): void {
    const o = this.osc('sine', 150, t, t + 0.3);
    sweep(o.frequency, t, 150, 52, 0.05);
    const g = this.gain();
    perc(g.gain, t, 0.55 * vel, 0.001, 0.24);
    o.connect(g).connect(out);
    const n = this.noise(t, t + 0.015);
    const hp = this.filter('highpass', 2500);
    const ng = this.gain();
    perc(ng.gain, t, 0.12 * vel, 0.0003, 0.006);
    n.connect(hp).connect(ng).connect(out);
  }

  /** LinnDrum kick: woody, round, a lowpassed thump. */
  kickLinn(out: AudioNode, t: number, vel: number): void {
    const o = this.osc('sine', 120, t, t + 0.35);
    sweep(o.frequency, t, 120, 50, 0.045);
    const g = this.gain();
    perc(g.gain, t, 0.6 * vel, 0.001, 0.3);
    o.connect(g).connect(out);
    const n = this.noise(t, t + 0.04);
    const lp = this.filter('lowpass', 900);
    const ng = this.gain();
    perc(ng.gain, t, 0.22 * vel, 0.0005, 0.03);
    n.connect(lp).connect(ng).connect(out);
  }

  /** 909 snare: two tuned shells + bright noise. */
  snare909(out: AudioNode, t: number, vel: number): void {
    for (const [f, a] of [
      [185, 0.18],
      [330, 0.1],
    ] as const) {
      const o = this.osc('triangle', f, t, t + 0.12);
      sweep(o.frequency, t, f * 1.08, f, 0.03);
      const og = this.gain();
      perc(og.gain, t, a * vel, 0.001, 0.07);
      o.connect(og).connect(out);
    }
    const n = this.noise(t, t + 0.25);
    const hp = this.filter('highpass', 1100);
    const lp = this.filter('lowpass', 9000);
    const g = this.gain();
    perc(g.gain, t, 0.2 * vel, 0.001, 0.19);
    n.connect(hp).connect(lp).connect(g).connect(out);
  }

  /** 707 snare: brighter, shorter, a little boxy. */
  snare707(out: AudioNode, t: number, vel: number): void {
    const o = this.osc('triangle', 240, t, t + 0.08);
    const og = this.gain();
    perc(og.gain, t, 0.16 * vel, 0.001, 0.05);
    o.connect(og).connect(out);
    const n = this.noise(t, t + 0.15);
    const bp = this.filter('bandpass', 4200, 0.7);
    const g = this.gain();
    perc(g.gain, t, 0.24 * vel, 0.001, 0.11);
    n.connect(bp).connect(g).connect(out);
  }

  /** Hand clap: three quick bursts then a short diffuse tail. */
  clap(out: AudioNode, t: number, vel: number): void {
    const n = this.noise(t, t + 0.25);
    const bp = this.filter('bandpass', 1250, 1.4);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.011;
      g.gain.setValueAtTime(0.2 * vel, at);
      g.gain.exponentialRampToValueAtTime(0.02 * vel, at + 0.009);
    }
    g.gain.setValueAtTime(0.13 * vel, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    g.gain.setValueAtTime(0, t + 0.201);
    n.connect(bp).connect(g).connect(out);
  }

  /** 808/909 metallic hat: six detuned squares through a high band. */
  hatMetal(out: AudioNode, t: number, vel: number, open = false): void {
    const decay = open ? 0.28 : 0.045;
    const end = t + decay + 0.02;
    const bp = this.filter('bandpass', 10000, 0.9);
    const hp = this.filter('highpass', 7000);
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) this.osc('square', f * 1.5, t, end).connect(bp);
    const g = this.gain();
    perc(g.gain, t, 0.05 * vel, 0.0005, decay);
    bp.connect(hp).connect(g).connect(out);
  }

  /** Simmons tom: the electronic "pew": long downward sweep plus a noise stick. */
  simmons(out: AudioNode, t: number, midi: number, vel: number): void {
    const f = mtof(midi);
    const o = this.osc('sine', f * 2.4, t, t + 0.6);
    sweep(o.frequency, t, f * 2.4, f * 0.9, 0.35);
    const tri = this.osc('triangle', f * 2.4, t, t + 0.6);
    sweep(tri.frequency, t, f * 2.4, f * 0.9, 0.35);
    const tg = this.gain(0.3);
    const g = this.gain();
    perc(g.gain, t, 0.38 * vel, 0.001, 0.5);
    o.connect(g);
    tri.connect(tg).connect(g);
    g.connect(out);
    const n = this.noise(t, t + 0.05);
    const bp = this.filter('bandpass', 1800, 0.8);
    const ng = this.gain();
    perc(ng.gain, t, 0.1 * vel, 0.0005, 0.04);
    n.connect(bp).connect(ng).connect(out);
  }

  /** Timpani: inharmonic drum-head partials, slight pitch settle, soft mallet. */
  timpani(out: AudioNode, t: number, midi: number, vel: number, decay = 1.8): void {
    const f = mtof(midi);
    const end = t + decay + 0.05;
    const g = this.gain();
    perc(g.gain, t, 0.3 * vel, 0.004, decay);
    for (const [r, a] of [
      [1, 1],
      [1.5, 0.5],
      [1.98, 0.3],
      [2.44, 0.18],
    ] as const) {
      const o = this.osc('sine', f * r * 1.03, t, end);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.12);
      const og = this.gain(a);
      o.connect(og).connect(g);
    }
    g.connect(out);
    const n = this.noise(t, t + 0.06);
    const lp = this.filter('lowpass', 700);
    const ng = this.gain();
    perc(ng.gain, t, 0.12 * vel, 0.001, 0.05);
    n.connect(lp).connect(ng).connect(out);
  }

  /** Orchestral snare: crisp head + wire rattle, no gate. */
  orchSnare(out: AudioNode, t: number, vel: number): void {
    const n = this.noise(t, t + 0.22);
    const bp = this.filter('bandpass', 3200, 0.8);
    const g = this.gain();
    perc(g.gain, t, 0.18 * vel, 0.001, 0.17);
    n.connect(bp).connect(g).connect(out);
    const o = this.osc('triangle', 195, t, t + 0.08);
    const og = this.gain();
    perc(og.gain, t, 0.1 * vel, 0.001, 0.05);
    o.connect(og).connect(out);
  }

  /** Shaker: a soft swish (the orchestra's hat). */
  shaker(out: AudioNode, t: number, vel: number): void {
    const n = this.noise(t, t + 0.1);
    const bp = this.filter('bandpass', 7200, 1.5);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    g.gain.setValueAtTime(0, t + 0.071);
    n.connect(bp).connect(g).connect(out);
  }

  /** 808 cowbell: two squares through a band-pass. */
  cowbell(out: AudioNode, t: number, vel: number): void {
    const bp = this.filter('bandpass', 800, 2.5);
    for (const f of [540, 800]) this.osc('square', f, t, t + 0.3).connect(bp);
    const g = this.gain();
    perc(g.gain, t, 0.05 * vel, 0.001, 0.22);
    bp.connect(g).connect(out);
  }

  /** Tambourine: jingles over a high noise hiss. */
  tambourine(out: AudioNode, t: number, vel: number): void {
    const n = this.noise(t, t + 0.18);
    const hp = this.filter('highpass', 8000);
    const g = this.gain();
    perc(g.gain, t, 0.06 * vel, 0.001, 0.14);
    n.connect(hp).connect(g).connect(out);
    const bp = this.filter('bandpass', 6500, 3);
    for (const f of [5400, 6900]) this.osc('square', f, t, t + 0.16).connect(bp);
    const jg = this.gain();
    perc(jg.gain, t, 0.015 * vel, 0.001, 0.12);
    bp.connect(jg).connect(out);
  }

  /** Suspended cymbal on soft mallets: a swell that blooms into a long wash. */
  susCymbal(out: AudioNode, t: number, vel: number, swell = 0.12): void {
    const end = t + swell + 2.6;
    const n = this.noise(t, end);
    const hp = this.filter('highpass', 3200);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * vel, t + swell);
    g.gain.exponentialRampToValueAtTime(0.0001, end - 0.01);
    g.gain.setValueAtTime(0, end);
    n.connect(hp).connect(g).connect(out);
  }
}
