import { makeImpulse, makeNoiseBuffer, softClipCurve } from './dsp';
import { SpatialRouter, type DynamicRange, type OutputMode } from './spatial';
export type { DynamicRange, OutputMode } from './spatial';

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
  serial = 0;
  readonly input: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: StereoPannerNode;
  readonly spatial: SpatialRouter;
  /** When the current sound starts (ctx time). Sounds must schedule from here. */
  t0 = 0;
  end = 0;
  priority = 0;
  level = 0;
  cockpit = false;
  readonly sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = Math.min(20000, ctx.sampleRate / 2);
    this.filter.Q.value = 0.5;
    this.spatial = new SpatialRouter(ctx, dest);
    this.panner = this.spatial.stereo;
    this.input.connect(this.filter).connect(this.spatial.input);
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
  external: GainNode | null = null;
  cockpit: GainNode | null = null;
  private externalDuck: GainNode | null = null;
  readonly metrics = { dropped: 0, stolen: 0 };
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
  outputMode: OutputMode = 'stereo';
  requestedOutput: OutputMode = 'stereo';
  outputReason = '';
  dynamicRange: DynamicRange = 'full';
  private outputRevision = 0;
  private surroundLoad: Promise<void> | null = null;
  private surroundLimiter: AudioWorkletNode | null = null;
  private center: ChannelMergerNode | null = null;
  private voiceMono: GainNode | null = null;

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
      const external = ctx.createGain();
      const externalDuck = ctx.createGain();
      external.connect(externalDuck).connect(sfx);
      const cockpit = ctx.createGain();
      cockpit.connect(sfx);
      const voice = ctx.createGain();
      voice.gain.value = this.volumes.voice;
      voice.connect(master);

      const verb = ctx.createConvolver();
      verb.normalize = false;
      verb.buffer = makeImpulse(ctx, 0.95, 0x77, 0.35, 0.02);
      const verbRet = ctx.createGain();
      verbRet.gain.value = 0.18;
      verb.connect(verbRet).connect(external);

      this.master = master;
      this.compressor = comp;
      this.limiter = lim;
      this.music = music;
      this.musicDuck = duck;
      this.sfx = sfx;
      this.external = external;
      this.cockpit = cockpit;
      this.externalDuck = externalDuck;
      this.voice = voice;
      this.sfxVerb = verb;

      for (let i = 0; i < this.maxVoices; i++) this.slots.push(new VoiceSlot(ctx, external));
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
    void this.setOutputMode(this.requestedOutput);
    this.setDynamicRange(this.dynamicRange);
  }

  /** Output changes preserve sources; unsupported devices stay on stereo. */
  async setOutputMode(requested: OutputMode): Promise<OutputMode> {
    this.requestedOutput = requested;
    const revision = ++this.outputRevision;
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.compressor || !this.voice) return this.outputMode;
    let mode = requested;
    this.outputReason = '';
    const channels = this.live ? ctx.destination.maxChannelCount : ctx.destination.channelCount;
    if (requested === 'surround') {
      if (channels < 6) { mode = 'stereo'; this.outputReason = `This output exposes ${channels} channels; using stereo.`; }
      else {
        try {
          this.surroundLoad ??= ctx.audioWorklet.addModule(new URL('./surround-limiter.worklet.js', import.meta.url));
          await this.surroundLoad;
          if (revision !== this.outputRevision) return this.outputMode;
          if (!this.surroundLimiter) this.surroundLimiter = new AudioWorkletNode(ctx, 'vanguard-surround-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [6], channelCount: 6, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
          this.surroundLimiter.port.postMessage(this.dynamicRange);
        } catch {
          mode = 'stereo'; this.outputReason = 'Surround processing unavailable; using stereo.';
          this.surroundLoad = null;
        }
      }
    }
    if (revision !== this.outputRevision) return this.outputMode;
    if (this.live) {
      try { ctx.destination.channelCount = mode === 'surround' ? 6 : Math.min(2, channels); }
      catch { mode = 'stereo'; this.outputReason = 'Device rejected surround; using stereo.'; }
    }
    this.master.disconnect();
    this.surroundLimiter?.disconnect();
    this.voice.disconnect();
    this.voiceMono?.disconnect();
    this.center?.disconnect();
    if (mode === 'surround') {
      this.master.connect(this.surroundLimiter!).connect(ctx.destination);
      this.center ??= ctx.createChannelMerger(6);
      this.voiceMono ??= ctx.createGain();
      this.voiceMono.channelCount = 1; this.voiceMono.channelCountMode = 'explicit';
      this.voice.connect(this.voiceMono).connect(this.center, 0, 2);
      this.center.connect(this.master);
    } else {
      this.master.connect(this.compressor);
      this.voice.connect(this.master);
    }
    this.outputMode = mode;
    for (const s of this.slots) s.spatial.setMode(mode);
    return mode;
  }

  setDynamicRange(range: DynamicRange): void {
    this.dynamicRange = range;
    if (this.compressor) {
      this.compressor.threshold.value = range === 'reduced' ? -23 : -14;
      this.compressor.ratio.value = range === 'reduced' ? 5 : 2.5;
    }
    this.surroundLimiter?.port.postMessage(range);
  }

  /** Quiet sequential channel identification; UI supplies the matching labels. */
  testChannels(): string[] {
    const labels = this.outputMode === 'surround' ? ['Front left', 'Front right', 'Center', 'LFE', 'Surround left', 'Surround right'] : ['Left', 'Right'];
    const ctx = this.ctx;
    if (!ctx || !this.master) return [];
    const merger = ctx.createChannelMerger(labels.length);
    merger.connect(this.master);
    labels.forEach((_, i) => {
      const t = ctx.currentTime + 0.1 + i * 0.7;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = labels.length === 6 && i === 3 ? 65 : 440;
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
      gain.gain.setValueAtTime(0.12, t + 0.3); gain.gain.linearRampToValueAtTime(0, t + 0.36);
      osc.connect(gain).connect(merger, 0, i); osc.start(t); osc.stop(t + 0.4);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); if (i === labels.length - 1) merger.disconnect(); };
    });
    return labels;
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
    // Leave cockpit alarms/player damage intact while radio clears room in
    // the external battle. A modest reduction keeps weapons present.
    const fx = this.externalDuck?.gain;
    if (fx) {
      fx.cancelScheduledValues(now);
      fx.setTargetAtTime(Math.pow(10, -3 / 20), now, 0.04);
      fx.setTargetAtTime(1, now + hold, release / 3);
    }
  }

  /**
   * Claim a pooled SFX voice for a sound of `duration` seconds. When all
   * voices are busy, the least important (priority × level, then oldest) is
   * faded out and stolen — unless the new sound matters even less, in which
   * case it is dropped (returns null). Allocation-free.
   */
  acquire(priority: number, level: number, duration: number, pan = 0, cutoff = 20000, cockpit = false): VoiceSlot | null {
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
      if (!victim || priority * (0.2 + level) <= victimScore) { this.metrics.dropped++; return null; }
      this.metrics.stolen++;
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
    slot.serial++;
    if (slot.cockpit !== cockpit) {
      slot.spatial.setDestination((cockpit ? this.cockpit : this.external)!);
      slot.cockpit = cockpit;
    }
    slot.t0 = t0;
    slot.end = t0 + duration;
    slot.priority = priority;
    slot.level = level;
    const g = slot.input.gain;
    if (t0 === now) g.cancelScheduledValues(now); // (a steal keeps its fade-out ramp)
    g.setValueAtTime(1, t0);
    slot.filter.frequency.cancelScheduledValues(now);
    slot.filter.frequency.setValueAtTime(Math.min(cutoff, ctx.sampleRate / 2), t0);
    slot.panner.pan.cancelScheduledValues(now);
    slot.panner.pan.setValueAtTime(pan, t0);
    slot.spatial.position(pan, undefined, 0, t0);
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
