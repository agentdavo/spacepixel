export type OutputMode = 'stereo' | 'headphones' | 'surround';
export type DynamicRange = 'full' | 'reduced';
const SPEAKERS = [[-110, 4], [-30, 0], [0, 2], [30, 1], [110, 5], [250, 4]];

/** Web Audio speaker order: L, R, C, LFE, SL, SR. Equal-power azimuth pairs. */
export function speakerGains(x: number, z: number, out = new Float32Array(6)): Float32Array {
  out.fill(0);
  if (Math.hypot(x, z) < 1e-8) { out[2] = 1; return out; }
  const angle = Math.atan2(x, -z) * 180 / Math.PI;
  const speakers = SPEAKERS;
  const a = angle < -110 ? angle + 360 : angle;
  for (let i = 0; i < speakers.length - 1; i++) {
    const [left, li] = speakers[i], [right, ri] = speakers[i + 1];
    if (a < left || a > right) continue;
    const t = (a - left) / (right - left) * Math.PI / 2;
    out[li] = Math.cos(t); out[ri] = Math.sin(t);
    break;
  }
  return out;
}

/** One mono source, selectable stereo/HRTF/discrete speaker renderer. */
export class SpatialRouter {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly stereo: StereoPannerNode;
  private hrtf: PannerNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private gains: GainNode[] = [];
  private lowpass: BiquadFilterNode | null = null;
  private mode: OutputMode = 'stereo';
  private spatial = false;
  private xyz = [0, 0, -1];
  private pan = 0;
  private lfe = 0;
  private levels = new Float32Array(6);

  constructor(private ctx: BaseAudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    this.output = ctx.createGain();
    this.stereo = ctx.createStereoPanner();
    this.output.connect(dest);
    this.reconnect();
  }

  setDestination(dest: AudioNode): void { this.output.disconnect(); this.output.connect(dest); }

  setMode(mode: OutputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.reconnect();
    this.write(this.ctx.currentTime);
  }

  position(pan: number, xyz?: { x: number; y: number; z: number }, lfe = 0, at = this.ctx.currentTime): void {
    const spatial = !!xyz;
    const changed = spatial !== this.spatial;
    this.spatial = spatial;
    this.pan = pan;
    this.lfe = lfe;
    if (xyz) this.xyz = [xyz.x, xyz.y, xyz.z];
    if (changed) this.reconnect();
    this.write(at);
  }

  private reconnect(): void {
    const c = this.ctx;
    this.input.disconnect(); this.stereo.disconnect(); this.hrtf?.disconnect(); this.merger?.disconnect();
    if (this.mode === 'surround') {
      if (!this.merger) {
        this.merger = c.createChannelMerger(6);
        this.lowpass = c.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 100;
        for (let i = 0; i < 6; i++) {
          const gain = c.createGain(); gain.gain.value = 0;
          gain.connect(this.merger, 0, i); this.gains.push(gain);
        }
        this.lowpass.connect(this.gains[3]);
      }
      for (let i = 0; i < 6; i++) if (i !== 3) this.input.connect(this.gains[i]);
      this.input.connect(this.lowpass!);
      this.merger.connect(this.output);
    } else if (this.mode === 'headphones' && this.spatial) {
      if (!this.hrtf) {
        this.hrtf = c.createPanner(); this.hrtf.panningModel = 'HRTF';
        this.hrtf.rolloffFactor = 0; // Distance gain is already authored by Sfx.
      }
      this.input.connect(this.hrtf).connect(this.output);
    } else this.input.connect(this.stereo).connect(this.output);
  }

  private write(t: number): void {
    const set = (p: AudioParam, v: number) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, 0.008); };
    if (this.mode === 'surround') {
      if (this.spatial) speakerGains(this.xyz[0], this.xyz[2], this.levels);
      else { this.levels.fill(0); this.levels[0] = Math.cos((this.pan + 1) * Math.PI / 4); this.levels[1] = Math.sin((this.pan + 1) * Math.PI / 4); }
      this.levels[3] = this.lfe;
      this.gains.forEach((g, i) => set(g.gain, this.levels[i]));
    } else if (this.mode === 'headphones' && this.spatial && this.hrtf) {
      set(this.hrtf.positionX, this.xyz[0]); set(this.hrtf.positionY, this.xyz[1]); set(this.hrtf.positionZ, this.xyz[2]);
    } else set(this.stereo.pan, this.pan);
  }
}
