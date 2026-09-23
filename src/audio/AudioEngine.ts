import { makeImpulse, makeNoiseBuffer, softClipCurve } from './dsp';

/**
 * Procedural audio core: context lifecycle, mix buses and the SFX voice pool.
 *
 *   music ─► duck ─┐
 *   sfx  ◄─ sfx reverb return
 *   sfx ───────────┼─► master gain ─► glue compressor ─► limiter ─► safety clip ─► out
 *   voice ─────────┘
 *
 * The AudioContext is created lazily on the first user gesture (browsers
 * refuse to start audio before one). Until then — and forever, if Web Audio
 * is missing or blocked — every call is a silent no-op; nothing here throws.
 *
 * Pass `context` to target an existing (e.g. Offline) context instead: that is
 * how scripts/audio-render.mjs renders the exact same synth code to WAV.
 */
export type BusName = 'master' | 'music' | 'sfx' | 'voice';

export interface AudioEngineOptions {
  /** Use this context immediately instead of creating one on first gesture. */
  context?: BaseAudioContext;
  /** Where to listen for the unlocking gesture (default: window). */
  unlockTarget?: EventTarget | null;
  /** Concurrent pooled SFX voices (default 40). */
  maxVoices?: number;
}

/**
 * A pooled SFX voice: a persistent fader → distance low-pass → stereo pan
 * chain. Each sound builds its short-lived source nodes into `input` and
 * registers them with `track()` so a steal can silence them.
 */
export class VoiceSlot {
  readonly input: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: StereoPannerNode;
  /** When the current sound starts (ctx time). Sounds must schedule from here. */
  t0 = 0;
  end = 0;
  priority = 0;
  level = 0;
  readonly sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.5;
    this.panner = ctx.createStereoPanner();
    this.input.connect(this.filter).connect(this.panner).connect(dest);
  }

  track<T extends AudioScheduledSourceNode>(src: T): T {
    this.sources.push(src);
    return src;
  }
}

const DEFAULT_VOLUME: Record<BusName, number> = { master: 0.9, music: 0.3, sfx: 1, voice: 1 };
const STEAL_FADE = 0.012;

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  /** True when this engine owns a real-time AudioContext (not offline). */
  readonly live: boolean;
  /** Set when Web Audio could not be created at all. */
  unavailable = false;

  // Buses (null until the context exists).
  master: GainNode | null = null;
  music: GainNode | null = null;
  musicDuck: GainNode | null = null;
  sfx: GainNode | null = null;
  voice: GainNode | null = null;
  /** Send into the SFX space reverb (short, dark). */
  sfxVerb: AudioNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  limiter: DynamicsCompressorNode | null = null;

  /** 3 s white-noise and 3 s pink-noise buffers shared by every synth. */
  noise: AudioBuffer | null = null;
  pink: AudioBuffer | null = null;

  private volumes: Record<BusName, number> = { ...DEFAULT_VOLUME };
  private _muted = false;
  private readyCbs: ((ctx: BaseAudioContext) => void)[] = [];
  private slots: VoiceSlot[] = [];
  private maxVoices: number;
  private unlockHandler: (() => void) | null = null;
  private unlockTarget: EventTarget | null = null;

  constructor(opts: AudioEngineOptions = {}) {
    this.maxVoices = opts.maxVoices ?? 40;
    this.live = !opts.context;
    if (opts.context) {
      this.init(opts.context);
      return;
    }
    const target = opts.unlockTarget === undefined ? (typeof window !== 'undefined' ? window : null) : opts.unlockTarget;
    if (!target) return;
    this.unlockTarget = target;
    this.unlockHandler = () => {
      if (this.ctx && this.ctx.state === 'running') return;
      this.unlock();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) {
      target.addEventListener(ev, this.unlockHandler, { capture: true, passive: true });
    }
  }

  /** Context exists (sounds can be scheduled). */
  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Context is actually producing sound. Offline contexts count as running. */
  get running(): boolean {
    const c = this.ctx;
    if (!c) return false;
    return !this.live || c.state === 'running';
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Run `cb` once the context exists (immediately if it already does). */
  onReady(cb: (ctx: BaseAudioContext) => void): void {
    if (this.ctx) {
      try {
        cb(this.ctx);
      } catch (e) {
        console.warn('[audio] init callback failed', e);
      }
    } else this.readyCbs.push(cb);
  }

  /**
   * Create / resume the context. Must run inside a user-gesture handler the
   * first time (the engine installs its own listeners, so callers rarely need this).
   */
  unlock(): void {
    if (this.unavailable) return;
    if (this.ctx) {
      if (this.live && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        (this.ctx as AudioContext).resume().catch(() => {});
      }
      return;
    }
    try {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) {
        this.unavailable = true;
        return;
      }
      const ctx = new AC({ latencyHint: 'interactive' });
      this.init(ctx);
      ctx.resume().catch(() => {});
    } catch (e) {
      console.warn('[audio] Web Audio unavailable', e);
      this.unavailable = true;
    }
  }

  private init(ctx: BaseAudioContext): void {
    try {
      this.ctx = ctx;
      this.noise = makeNoiseBuffer(ctx, 3, 0x51f7);
      this.pink = makeNoiseBuffer(ctx, 3, 0x2a9d, true);

      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : this.volumes.master;
      // Gentle glue: catches pile-ups (a salvo of 12 detonations + music) without pumping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 2.5;
      comp.attack.value = 0.008;
      comp.release.value = 0.22;
      // Brick-wall-ish limiter.
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -4;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.08;
      // Safety soft-clip: output can never exceed ~-0.3 dBFS whatever gets through.
      // Compensate for the compressors' automatic make-up gain.
      const trim = ctx.createGain();
      trim.gain.value = 0.72;
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = '2x';
      master.connect(comp).connect(lim).connect(trim).connect(clip).connect(ctx.destination);

      const music = ctx.createGain();
      music.gain.value = this.volumes.music;
      const duck = ctx.createGain();
      music.connect(duck).connect(master);
      const sfx = ctx.createGain();
      sfx.gain.value = this.volumes.sfx;
      sfx.connect(master);
      const voice = ctx.createGain();
      voice.gain.value = this.volumes.voice;
      voice.connect(master);

      const verb = ctx.createConvolver();
      verb.normalize = false;
      verb.buffer = makeImpulse(ctx, 1.6, 0x77, 0.35, 0.02);
      const verbRet = ctx.createGain();
      verbRet.gain.value = 0.28;
      verb.connect(verbRet).connect(sfx);

      this.master = master;
      this.compressor = comp;
      this.limiter = lim;
      this.music = music;
      this.musicDuck = duck;
      this.sfx = sfx;
      this.voice = voice;
      this.sfxVerb = verb;

      for (let i = 0; i < this.maxVoices; i++) this.slots.push(new VoiceSlot(ctx, sfx));
    } catch (e) {
      console.warn('[audio] graph init failed', e);
      this.ctx = null;
      this.unavailable = true;
      return;
    }
    const cbs = this.readyCbs;
    this.readyCbs = [];
    for (const cb of cbs) {
      try {
        cb(ctx);
      } catch (e) {
        console.warn('[audio] init callback failed', e);
      }
    }
  }

  bus(name: BusName): GainNode | null {
    return name === 'master' ? this.master : name === 'music' ? this.music : name === 'sfx' ? this.sfx : this.voice;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, now, 0.03);
    }
  }

  /** Bus volume, 0..1 (linear gain; 1 = design level). */
  setVolume(bus: BusName, v: number): void {
    const vol = Math.max(0, Math.min(1.5, v));
    this.volumes[bus] = vol;
    const node = this.bus(bus);
    if (!this.ctx || !node) return;
    if (bus === 'master' && this._muted) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(vol, now, 0.03);
  }

  getVolume(bus: BusName): number {
    return this.volumes[bus];
  }

  /** Duck the music bus by `db` for `hold` seconds (radio voice, jump tunnel). */
  duckMusic(db: number, hold: number, release = 0.6): void {
    if (!this.ctx || !this.musicDuck) return;
    const now = this.ctx.currentTime;
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(Math.pow(10, db / 20), now, 0.04);
    p.setTargetAtTime(1, now + hold, release / 3);
  }

  /**
   * Claim a pooled SFX voice for a sound of `duration` seconds. When all
   * voices are busy, the least important (priority × level, then oldest) is
   * faded out and stolen — unless the new sound matters even less, in which
   * case it is dropped (returns null). Allocation-free.
   */
  acquire(priority: number, level: number, duration: number, pan = 0, cutoff = 20000): VoiceSlot | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const now = ctx.currentTime;
    let slot: VoiceSlot | null = null;
    let victim: VoiceSlot | null = null;
    let victimScore = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.end <= now) {
        slot = s;
        break;
      }
      // Sounds nearly finished are cheap to steal.
      const remaining = Math.max(0.05, Math.min(1, (s.end - now) / Math.max(0.05, s.end - s.t0)));
      const score = s.priority * (0.2 + s.level) * remaining;
      if (score < victimScore || (score === victimScore && victim && s.t0 < victim.t0)) {
        victimScore = score;
        victim = s;
      }
    }
    let t0 = now;
    if (!slot) {
      if (!victim || priority * (0.2 + level) <= victimScore) return null;
      slot = victim;
      const sg = slot.input.gain;
      sg.cancelScheduledValues(now);
      sg.setValueAtTime(sg.value, now);
      sg.linearRampToValueAtTime(0, now + STEAL_FADE);
      for (let i = 0; i < slot.sources.length; i++) {
        try {
          slot.sources[i].stop(now + STEAL_FADE);
        } catch {
          /* already stopped */
        }
      }
      t0 = now + STEAL_FADE + 0.001;
    }
    slot.sources.length = 0;
    slot.t0 = t0;
    slot.end = t0 + duration;
    slot.priority = priority;
    slot.level = level;
    const g = slot.input.gain;
    if (t0 === now) g.cancelScheduledValues(now); // (a steal keeps its fade-out ramp)
    g.setValueAtTime(1, t0);
    slot.filter.frequency.cancelScheduledValues(now);
    slot.filter.frequency.setValueAtTime(cutoff, t0);
    slot.panner.pan.cancelScheduledValues(now);
    slot.panner.pan.setValueAtTime(pan, t0);
    return slot;
  }

  /** Number of pooled voices currently sounding (debug HUD). */
  activeVoices(): number {
    const now = this.now;
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].end > now) n++;
    return n;
  }

  dispose(): void {
    if (this.unlockTarget && this.unlockHandler) {
      for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) {
        this.unlockTarget.removeEventListener(ev, this.unlockHandler, { capture: true });
      }
    }
    if (this.live && this.ctx) (this.ctx as AudioContext).close().catch(() => {});
  }
}
