import { Vector3 } from 'three';
import type { Mood, SfxKind, StingerKind, RadioKind } from '@/audio';

/**
 * The cinema sequencer's data model and its pure sampling functions.
 *
 * A cutscene is a plain array of shots. Everything a shot shows is a pure
 * function of its local time — camera, captions, post-FX envelopes — so the
 * timeline can be seeked (`?t=`) and screenshotted deterministically. Only
 * sounds and particle bursts are one-shot "crossing" cues, and the host skips
 * those while it fast-forwards a seek.
 *
 * Units: camera keys are KILOMETRES relative to the shot's set anchor (space
 * is big; a 3 km dreadnought is 3, a gate 24). Rig-relative moves may opt into
 * metres. Times are seconds.
 */

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'expoOut';

export function ease(e: Ease | undefined, x: number): number {
  const u = x <= 0 ? 0 : x >= 1 ? 1 : x;
  switch (e ?? 'inOut') {
    case 'linear':
      return u;
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u) * (1 - u);
    case 'expoOut':
      return u >= 1 ? 1 : 1 - Math.pow(2, -10 * u);
    case 'inOut':
      return u * u * (3 - 2 * u);
  }
}

export type V3 = readonly [number, number, number];

/** A camera pose: eye + look target (km, set-relative unless the move names a rig), fov in degrees, roll in radians. */
export interface CamKey {
  eye: V3;
  look: V3;
  fov?: number;
  roll?: number;
}

/**
 * One camera move. Moves cut hard into each other (OVA editing is cuts, not
 * blends); inside a move the pose eases from `from` to `to`.
 */
export interface CamMove {
  /** Shot-local start time; the move lasts until `at + dur`. */
  at: number;
  dur: number;
  from: CamKey;
  to?: CamKey;
  ease?: Ease;
  /** Angular camera shake amplitude (radians), e.g. 0.004 for an impact rattle. */
  shake?: number;
  /**
   * Named live rig provided by the stage (tracking shots). The key's eye/look
   * are then in the rig subject's frame: x right, y up, z forward.
   */
  rig?: string;
  /**
   * Flyby: the eye stays planted in set space (km) while the look target
   * rides a rig subject — `look` is then in that subject's frame, in `units`.
   */
  aim?: string;
  /** Units for rig-frame coordinates (default km). */
  units?: 'km' | 'm';
}

export type CaptionKind = 'narration' | 'slug' | 'word' | 'count' | 'title';

export interface Caption {
  at: number;
  dur: number;
  text: string;
  /** Small label above the line (faction name, date). */
  kicker?: string;
  /** Optional Japanese line (OVA dual subtitle flavour). */
  jp?: string;
  kind?: CaptionKind;
}

export type FxField = 'flash' | 'fade' | 'invert' | 'hue' | 'solarize' | 'jump' | 'boost' | 'speed';
export const FX_FIELDS: readonly FxField[] = ['flash', 'fade', 'invert', 'hue', 'solarize', 'jump', 'boost', 'speed'];

/** Piecewise-linear envelope for one postFx field, keyed in shot time. Tracks on the same field combine by max (hue: sum). */
export interface FxTrack {
  field: FxField;
  keys: readonly (readonly [number, number])[];
}

export interface SoundCue {
  at: number;
  sfx?: SfxKind;
  stinger?: StingerKind;
  radio?: RadioKind;
  gain?: number;
}

export interface MusicCue {
  at: number;
  mood: Mood;
  fade?: number;
}

/** Stage events (particle bursts, prop state changes) — fired on crossing, also while seeking. */
export interface EventCue {
  at: number;
  id: string;
}

export interface Shot {
  id: string;
  /** Which prebuilt set (props, sky, light) is live. */
  set: string;
  dur: number;
  cams: CamMove[];
  captions?: Caption[];
  fx?: FxTrack[];
  music?: MusicCue[];
  sound?: SoundCue[];
  events?: EventCue[];
}

// ── sampling ──────────────────────────────────────────────────────────

export function totalDuration(shots: readonly Shot[]): number {
  let s = 0;
  for (const sh of shots) s += sh.dur;
  return s;
}

export interface Located {
  index: number;
  /** Global start time of the shot. */
  start: number;
  /** Shot-local time. */
  local: number;
}

/** Which shot plays at global time `t` (clamped to the last shot's end). */
export function locate(shots: readonly Shot[], t: number): Located {
  let start = 0;
  for (let i = 0; i < shots.length; i++) {
    const d = shots[i].dur;
    if (t < start + d || i === shots.length - 1) return { index: i, start, local: Math.min(Math.max(0, t - start), d) };
    start += d;
  }
  return { index: 0, start: 0, local: 0 };
}

/** The camera move live at shot-local time `local` (the last one that has started). */
export function moveAt(shot: Shot, local: number): CamMove {
  let m = shot.cams[0];
  for (const c of shot.cams) if (c.at <= local) m = c;
  return m;
}

export interface CamPose {
  eye: Vector3;
  look: Vector3;
  fov: number;
  roll: number;
}

export function makePose(): CamPose {
  return { eye: new Vector3(), look: new Vector3(), fov: 50, roll: 0 };
}

/** Interpolate a move at shot-local time into `out` (units as authored, no rig applied). */
export function sampleMove(m: CamMove, local: number, out: CamPose): CamPose {
  const u = ease(m.ease, m.dur > 0 ? (local - m.at) / m.dur : 1);
  const a = m.from;
  const b = m.to ?? m.from;
  out.eye.set(lerp(a.eye[0], b.eye[0], u), lerp(a.eye[1], b.eye[1], u), lerp(a.eye[2], b.eye[2], u));
  out.look.set(lerp(a.look[0], b.look[0], u), lerp(a.look[1], b.look[1], u), lerp(a.look[2], b.look[2], u));
  out.fov = lerp(a.fov ?? 50, b.fov ?? a.fov ?? 50, u);
  out.roll = lerp(a.roll ?? 0, b.roll ?? a.roll ?? 0, u);
  return out;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Evaluate one envelope at `t` (constant beyond its ends). */
export function sampleTrack(keys: FxTrack['keys'], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return keys[keys.length - 1][1];
}

export type FxValues = Record<FxField, number>;

export function emptyFx(): FxValues {
  return { flash: 0, fade: 0, invert: 0, hue: 0, solarize: 0, jump: 0, boost: 0, speed: 0 };
}

/** All postFx envelopes of a shot at shot-local time. */
export function sampleFx(shot: Shot, local: number, out: FxValues = emptyFx()): FxValues {
  for (const f of FX_FIELDS) out[f] = 0;
  for (const tr of shot.fx ?? []) {
    const v = sampleTrack(tr.keys, local);
    out[tr.field] = tr.field === 'hue' ? out[tr.field] + v : Math.max(out[tr.field], v);
  }
  return out;
}

/** Captions on screen at shot-local time, with their age. */
export function captionsAt(shot: Shot, local: number): { caption: Caption; age: number }[] {
  const out: { caption: Caption; age: number }[] = [];
  for (const c of shot.captions ?? []) if (local >= c.at && local < c.at + c.dur) out.push({ caption: c, age: local - c.at });
  return out;
}

/** True when a one-shot cue at `at` falls in (prev, now]. A shot's first frame passes prev = -Infinity. */
export function crossed(at: number, prev: number, now: number): boolean {
  return at > prev && at <= now;
}

/**
 * Typewriter reveal: how many characters of `text` are visible `age`
 * seconds in, at `cps` characters per second.
 */
export function typed(text: string, age: number, cps = 42): number {
  return Math.max(0, Math.min(text.length, Math.floor(age * cps)));
}
