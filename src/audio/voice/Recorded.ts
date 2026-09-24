import type { VoiceProfile } from './plan';
import type { VoiceChannel } from './VoiceSynth';
import { clipKey, neuralVoiceFor, profileSex } from './neural';

/**
 * Recorded voices at runtime: looks a line up in public/voice/manifest.json,
 * fetches and decodes its clip once, and plays it through the same kind of
 * channel the synth uses (a band-limited, driven cockpit radio with carrier
 * hiss and a squelch tail; a dry room; the narrator's hall). A line with no
 * clip (filled-in names, lines written after the last recording) returns
 * null and the caller falls back to the synth.
 */
export interface ClipRef {
  key: string;
  /** Seconds, as recorded. */
  dur: number;
}

export interface ClipHandle {
  end: number;
  stop(at?: number): void;
}

let manifest: Record<string, number> | null = null;
let loading: Promise<void> | null = null;

function base(): string {
  try {
    return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

/** Fetch the clip list (once). Headless or offline → no clips, never throws. */
export function loadClips(): Promise<void> {
  if (loading) return loading;
  if (typeof fetch === 'undefined' || typeof location === 'undefined') {
    manifest = {};
    return (loading = Promise.resolve());
  }
  loading = fetch(`${base()}voice/manifest.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((m: Record<string, number>) => void (manifest = m))
    .catch(() => void (manifest = {}));
  return loading;
}

/** The recorded clip for a line in this speaker's voice, if there is one. */
export function clipFor(who: string, text: string, profile: VoiceProfile): ClipRef | null {
  if (!manifest) return null;
  const v = neuralVoiceFor(who, profileSex(profile));
  if (!v) return null;
  const key = clipKey(v, text);
  const dur = manifest[key];
  return dur ? { key, dur } : null;
}

const inflight = new Set<Promise<unknown>>();

/** Resolves once every clip fetch started so far has landed (offline renders wait on it). */
export async function clipsSettled(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

const buffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer | Promise<AudioBuffer | null>>>();

function cache(ctx: BaseAudioContext): Map<string, AudioBuffer | Promise<AudioBuffer | null>> {
  let m = buffers.get(ctx);
  if (!m) buffers.set(ctx, (m = new Map()));
  return m;
}

/** Start fetching and decoding a clip; resolves to null on any failure. */
export function fetchClip(ctx: BaseAudioContext, key: string): Promise<AudioBuffer | null> {
  const m = cache(ctx);
  const have = m.get(key);
  if (have) return have instanceof AudioBuffer ? Promise.resolve(have) : have;
  const p = fetch(`${base()}voice/${key}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => {
      m.set(key, buf);
      return buf;
    })
    .catch(() => {
      m.delete(key);
      return null;
    });
  m.set(key, p);
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
  return p;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * seconds)), ctx.sampleRate);
  const d = b.getChannelData(0);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < d.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  return b;
}

const halls = new WeakMap<BaseAudioContext, AudioBuffer>();
function hall(ctx: BaseAudioContext): AudioBuffer {
  let h = halls.get(ctx);
  if (!h) {
    h = noiseBuffer(ctx, 1.6, 77);
    const d = h.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] *= Math.exp((-i / ctx.sampleRate) * 3.2) * 0.35;
    halls.set(ctx, h);
  }
  return h;
}

function drive(k: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(1024);
  const n = Math.tanh(k);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / n;
  }
  return c;
}

/**
 * Play a clip at `t0` through `channel`. If it is still downloading it starts
 * as soon as it decodes, unless that would be more than `lateness` s late.
 */
export function playClip(ctx: BaseAudioContext, dest: AudioNode, clip: ClipRef, t0: number, channel: VoiceChannel, level: number, rate = 1, rasp = 0.2, lateness = 0.8): ClipHandle {
  const radio = channel === 'radio' || channel === 'intercept';
  const dur = clip.dur / rate;
  const end = t0 + dur;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const track = <T extends AudioNode>(n: T): T => (nodes.push(n), n);
  const biquad = (type: BiquadFilterType, f: number, q: number, g = 0) => {
    const b = track(ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = g;
    return b;
  };
  const gain = (v = 1) => {
    const g = track(ctx.createGain());
    g.gain.value = v;
    return g;
  };
  const noise = (seed: number) => {
    const s = track(ctx.createBufferSource());
    s.buffer = noiseBuffer(ctx, 1.1, seed);
    s.loop = true;
    sources.push(s);
    return s;
  };

  const out = gain(0);
  const input = gain(1);
  if (radio) {
    const intercept = channel === 'intercept';
    // A clean 320–3600 Hz band (4th order each side), then gentle tanh drive
    // on the band-limited voice. Driving before the band, or into the
    // shaper's ±1 clamp, turns a recorded voice to buzz.
    const hp = biquad('highpass', 320, 0.54);
    const hp2 = biquad('highpass', 320, 1.31);
    const lp = biquad('lowpass', 3600, 0.54);
    const lp2 = biquad('lowpass', 3600, 1.31);
    const pre = gain(0.85);
    const sh = track(ctx.createWaveShaper());
    sh.curve = drive(2 + rasp * 0.6 + (intercept ? 1.2 : 0));
    input.connect(hp).connect(hp2).connect(lp).connect(lp2).connect(pre).connect(sh).connect(out);
    // Carrier hiss under the transmission, a key-up click and the squelch tail.
    const hiss = gain(0);
    const hb = biquad('bandpass', 2600, 0.5);
    const hn = noise(91);
    hn.connect(hb).connect(hiss).connect(out);
    const hl = intercept ? 0.06 : 0.02;
    hiss.gain.setValueAtTime(0, t0 - 0.06);
    hiss.gain.linearRampToValueAtTime(hl, t0 - 0.04);
    hiss.gain.setValueAtTime(hl, end);
    hiss.gain.linearRampToValueAtTime(0, end + 0.04);
    const sq = gain(0);
    const sqBp = biquad('bandpass', 3200, 0.9);
    sqBp.frequency.setValueAtTime(3200, end);
    sqBp.frequency.exponentialRampToValueAtTime(900, end + 0.16);
    noise(177).connect(sqBp).connect(sq).connect(out);
    for (const [at, pk2] of [
      [t0 - 0.06, 0.28],
      [end, 0.24],
    ] as const) {
      sq.gain.setValueAtTime(0, at);
      sq.gain.linearRampToValueAtTime(pk2, at + 0.005);
      sq.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
      sq.gain.setValueAtTime(0, at + 0.16);
    }
    if (intercept) {
      // Dropouts: the signal fading in and out on a long-range band.
      let x = Math.round(clip.dur * 1000) || 1;
      const r = () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
      let t = t0 + 0.1;
      while (t < end) {
        const len = 0.03 + r() * 0.09;
        if (r() < 0.3) {
          input.gain.setValueAtTime(1, t);
          input.gain.linearRampToValueAtTime(0.08, t + 0.006);
          input.gain.setValueAtTime(0.08, t + len);
          input.gain.linearRampToValueAtTime(1, t + len + 0.006);
        }
        t += len + 0.08 + r() * 0.3;
      }
    }
  } else {
    const narrator = channel === 'narrator';
    const hp = biquad('highpass', 90, 0.7);
    const shelf = biquad('lowshelf', 200, 0.7, narrator ? 3 : 0);
    const lp = biquad('lowpass', narrator ? 7000 : 8000, 0.7);
    input.connect(hp).connect(shelf).connect(lp).connect(out);
    const verb = track(ctx.createConvolver());
    verb.normalize = false;
    verb.buffer = hall(ctx);
    lp.connect(verb).connect(gain(narrator ? 0.16 : 0.05)).connect(out);
  }
  out.gain.setValueAtTime(level, t0);
  out.connect(dest);

  const stopAt = end + (radio ? 0.25 : 1.7);
  let player: AudioBufferSourceNode | null = null;
  let stopped = false;
  const begin = (buf: AudioBuffer) => {
    if (stopped) return;
    const at = Math.max(t0, ctx.currentTime + 0.005);
    if (at - t0 > lateness) return;
    player = track(ctx.createBufferSource());
    player.buffer = buf;
    player.playbackRate.value = rate;
    player.connect(input);
    player.start(at);
    player.stop(stopAt);
  };
  const cached = cache(ctx).get(clip.key);
  if (cached instanceof AudioBuffer) begin(cached);
  else void fetchClip(ctx, clip.key).then((b) => b && begin(b));
  for (const s of sources) {
    s.start(Math.max(ctx.currentTime, t0 - 0.08));
    s.stop(stopAt);
  }
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
  if (sources[0]) sources[0].onended = cleanup;
  else setTimeout(cleanup, (stopAt - ctx.currentTime + 0.5) * 1000);

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
        (player as AudioBufferSourceNode | null)?.stop(t + 0.03);
        for (const s of sources) s.stop(t + 0.03);
      } catch {
        /* already stopped */
      }
    },
  };
}
