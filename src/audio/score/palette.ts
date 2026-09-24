import type { OvaRack } from './rack';

/**
 * A score's studio palette: which patch plays each part. The mood scripts in
 * Music.ts call a fixed instrument surface (`p.ins.pad(...)`, `p.ins.kick(...)`);
 * `PatchedIns` routes each call to the palette's patch, so one arrangement
 * sounds like a mecha march on strings + 909 in one score and a city-pop
 * night on Juno + LinnDrum in another. 'classic' keeps the original voice.
 */
export interface Palette {
  pad: 'classic' | 'juno' | 'solina' | 'strings' | 'glass';
  /** 'hybrid' layers JP-8 brass and orchestral horns (the 90s "synth-orchestra" section). */
  brass: 'classic' | 'horns' | 'orchHit' | 'hybrid';
  arp: 'classic' | 'pizz' | 'epiano' | 'harp' | 'celesta';
  bass: 'classic' | 'slap' | 'synth' | 'cello';
  bell: 'classic' | 'celesta' | 'epiano' | 'harp';
  /** The generated melody. */
  lead: 'bell' | 'epiano' | 'sax' | 'synth' | 'violin' | 'flute' | 'strings';
  drone: 'classic' | 'strings';
  kit: 'classic' | '909' | '707' | 'linn' | 'orch';
  /** String section doubling the pad chords (0 = none, 1 = equal level). */
  strings: number;
}

export const CLASSIC_PALETTE: Palette = { pad: 'classic', brass: 'classic', arp: 'classic', bass: 'classic', bell: 'classic', lead: 'bell', drone: 'classic', kit: 'classic', strings: 0 };

/** The instrument surface mood scripts and stings call. */
export interface InsLike {
  brass(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright?: number, attack?: number): void;
  pad(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack?: number, release?: number, cutoff?: number): void;
  choir(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack?: number, release?: number): void;
  arp(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright?: number): void;
  bass(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom?: number | null): void;
  bell(out: AudioNode, t: number, midi: number, vel: number, decay?: number, ratio?: number): void;
  kick(out: AudioNode, t: number, vel: number): void;
  snare(out: AudioNode, t: number, vel: number, gated?: boolean): void;
  hat(out: AudioNode, t: number, vel: number, open?: boolean): void;
  crash(out: AudioNode, t: number, vel: number): void;
  tom(out: AudioNode, t: number, midi: number, vel: number): void;
  drone(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack?: number, release?: number): void;
  sine(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack?: number, release?: number, driftCents?: number): void;
  swell(out: AudioNode, t: number, dur: number, vel: number): void;
  /** Melody note of `len` seconds (legato into the next note when they touch). */
  lead(out: AudioNode, t: number, midi: number, vel: number, len: number): void;
}

/** The channels a palette may route to besides the one the caller passed. */
export interface PaletteChannels {
  readonly strings: AudioNode;
}

export class PatchedIns implements InsLike {
  private lastBass = -1;
  private lastLead = -1;
  private leadEnd = -1;

  constructor(
    readonly rack: OvaRack,
    readonly palette: Palette,
    private ch: PaletteChannels,
    /** MIDI root of the current chord (tunes timpani). */
    private root: () => number,
  ) {}

  brass(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright = 1, attack = 0.02): void {
    const r = this.rack;
    switch (this.palette.brass) {
      case 'horns':
        r.horns(out, t, midi, dur, vel, bright, Math.max(attack, 0.05));
        break;
      case 'orchHit':
        if (dur < 0.45) r.orchHit(out, t, midi, vel * 0.9, 0.45);
        else r.horns(out, t, midi, dur, vel, bright, Math.max(attack, 0.05));
        break;
      case 'hybrid':
        r.brass(out, t, midi, dur, vel * 0.7, bright, attack);
        r.horns(out, t, midi - (midi > 60 ? 12 : 0), dur, vel * 0.6, bright, Math.max(attack, 0.05));
        break;
      default:
        r.brass(out, t, midi, dur, vel, bright, attack);
    }
  }

  pad(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 0.8, release = 1.5, cutoff = 1500): void {
    const r = this.rack;
    const p = this.palette;
    switch (p.pad) {
      case 'juno':
        r.juno(out, t, midi, dur, vel, Math.max(0.05, attack * 0.7), release, cutoff * 1.2);
        break;
      case 'solina':
        r.solina(out, t, midi, dur, vel, Math.max(0.08, attack * 0.6), release);
        break;
      case 'strings':
        r.strings(this.ch.strings, t, midi, dur, vel, Math.max(0.15, attack), release, cutoff / 1500);
        break;
      case 'glass':
        r.glass(out, t, midi, dur, vel, Math.max(0.3, attack), release + 0.5);
        break;
      default:
        r.pad(out, t, midi, dur, vel, attack, release, cutoff);
    }
    if (p.strings > 0 && p.pad !== 'strings') {
      // Section doubling, an octave up from the low voicing so it sings over the synth.
      const m = midi < 58 ? midi + 12 : midi;
      r.strings(this.ch.strings, t, m, dur, vel * p.strings, Math.max(0.25, attack), release, cutoff / 1500);
    }
  }

  choir(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 2, release = 3): void {
    this.rack.choir(out, t, midi, dur, vel, attack, release);
  }

  arp(out: AudioNode, t: number, midi: number, dur: number, vel: number, bright = 1): void {
    const r = this.rack;
    switch (this.palette.arp) {
      case 'pizz':
        r.pizz(out, t, midi, vel * 1.1, Math.min(0.4, Math.max(0.15, dur * 2)));
        break;
      case 'epiano':
        r.epiano(out, t, midi, Math.max(dur, 0.12), vel * 0.8);
        break;
      case 'harp':
        r.harp(out, t, midi, vel * 0.9, 1.1);
        break;
      case 'celesta':
        r.celesta(out, t, midi + 12, vel * 0.8, 0.9);
        break;
      default:
        r.arp(out, t, midi, dur, vel, bright);
    }
  }

  bass(out: AudioNode, t: number, midi: number, dur: number, vel: number, slideFrom: number | null = null): void {
    const r = this.rack;
    const prev = this.lastBass;
    this.lastBass = midi;
    switch (this.palette.bass) {
      case 'slap':
        r.slap(out, t, midi, dur, vel, prev >= 0 && midi - prev >= 10);
        break;
      case 'synth':
        r.synthBass(out, t, midi, dur, vel, slideFrom);
        break;
      case 'cello':
        r.cello(out, t, midi, dur, vel, slideFrom);
        break;
      default:
        r.bass(out, t, midi, dur, vel, slideFrom);
    }
  }

  bell(out: AudioNode, t: number, midi: number, vel: number, decay = 1.2, ratio = 3.5): void {
    const r = this.rack;
    switch (this.palette.bell) {
      case 'celesta':
        r.celesta(out, t, midi, vel, Math.min(decay, 2.5));
        break;
      case 'epiano':
        r.epiano(out, t, midi, Math.min(decay * 0.5, 1.2), vel * 0.8);
        break;
      case 'harp':
        r.harp(out, t, midi, vel, Math.min(decay + 0.4, 2.4));
        break;
      default:
        r.bell(out, t, midi, vel, decay, ratio);
    }
  }

  lead(out: AudioNode, t: number, midi: number, vel: number, len: number): void {
    const r = this.rack;
    const legato = this.lastLead >= 0 && t - this.leadEnd < 0.04 && Math.abs(midi - this.lastLead) <= 7 ? this.lastLead : null;
    this.lastLead = midi;
    this.leadEnd = t + len;
    const dur = Math.max(0.08, len * 0.94);
    switch (this.palette.lead) {
      case 'epiano':
        r.epiano(out, t, midi, dur, vel);
        break;
      case 'sax':
        r.sax(out, t, midi, dur, vel, legato);
        break;
      case 'synth':
        r.synthLead(out, t, midi, dur, vel, legato);
        break;
      case 'violin':
        r.violin(out, t, midi, dur, vel, legato);
        break;
      case 'flute':
        r.flute(out, t, midi, dur, vel);
        break;
      case 'strings':
        r.strings(out, t, midi, dur, vel * 1.3, 0.12, 0.45, 1.3);
        break;
      default:
        r.bell(out, t, midi, vel, Math.min(2.2, 0.5 + len * 2));
    }
  }

  kick(out: AudioNode, t: number, vel: number): void {
    const r = this.rack;
    switch (this.palette.kit) {
      case '909':
        r.kick909(out, t, vel);
        break;
      case '707':
        r.kick707(out, t, vel);
        break;
      case 'linn':
        r.kickLinn(out, t, vel);
        break;
      case 'orch': {
        const root = this.root();
        r.timpani(out, t, root - 12 * Math.ceil((root - 47) / 12), vel * 0.7, 0.55);
        break;
      }
      default:
        r.kick(out, t, vel);
    }
  }

  snare(out: AudioNode, t: number, vel: number, gated = true): void {
    const r = this.rack;
    switch (this.palette.kit) {
      case '909':
        r.snare909(out, t, vel);
        if (gated && vel > 0.6) r.clap(out, t, vel * 0.5);
        break;
      case '707':
        r.snare707(out, t, vel);
        break;
      case 'linn':
        r.snare(out, t, vel, gated);
        if (gated && vel > 0.6) r.clap(out, t + 0.004, vel * 0.45);
        break;
      case 'orch':
        r.orchSnare(out, t, vel * 0.8);
        break;
      default:
        r.snare(out, t, vel, gated);
    }
  }

  hat(out: AudioNode, t: number, vel: number, open = false): void {
    const r = this.rack;
    switch (this.palette.kit) {
      case '909':
        r.hatMetal(out, t, vel * 1.2, open);
        break;
      case 'orch':
        if (open) r.tambourine(out, t, vel);
        else r.shaker(out, t, vel);
        break;
      default:
        r.hat(out, t, vel, open);
    }
  }

  crash(out: AudioNode, t: number, vel: number): void {
    if (this.palette.kit === 'orch') this.rack.susCymbal(out, t, vel, 0.03);
    else this.rack.crash(out, t, vel);
  }

  tom(out: AudioNode, t: number, midi: number, vel: number): void {
    const r = this.rack;
    switch (this.palette.kit) {
      case 'linn':
        r.simmons(out, t, midi, vel);
        break;
      case 'orch':
        r.timpani(out, t, midi - 12 * Math.ceil((midi - 50) / 12), vel, 1.4);
        break;
      default:
        r.tom(out, t, midi, vel);
    }
  }

  drone(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 3, release = 3): void {
    if (this.palette.drone === 'strings') {
      this.rack.cello(this.ch.strings, t, midi + (midi < 36 ? 12 : 0), dur, vel * 0.55);
      this.rack.drone(out, t, midi, dur, vel * 0.45, attack, release);
    } else this.rack.drone(out, t, midi, dur, vel, attack, release);
  }

  sine(out: AudioNode, t: number, midi: number, dur: number, vel: number, attack = 3, release = 4, driftCents = 0): void {
    this.rack.sine(out, t, midi, dur, vel, attack, release, driftCents);
  }

  swell(out: AudioNode, t: number, dur: number, vel: number): void {
    this.rack.swell(out, t, dur, vel);
  }
}
