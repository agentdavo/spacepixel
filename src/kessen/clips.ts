import type { Stance, Stature } from './data';
import { BONE_NAMES, type BoneName, type Pose, type Rot } from './rig';

const D = Math.PI / 180;

/** Held stances and the two signature end states. Euler XYZ per bone, radians. */
export const POSES: Record<Stance | 'stand' | 'kneel' | 'standDown' | 'boost', Pose> = {
  stand: {},
  ready: {
    spine: [0, -8 * D, 0], chest: [4 * D, -6 * D, 0], head: [0, 12 * D, 0],
    shoulder_R: [-12 * D, 0, 6 * D], forearm_R: [-42 * D, 0, 0], hand_R: [-10 * D, 0, 0],
    shoulder_L: [-10 * D, 0, 8 * D], forearm_L: [-50 * D, 0, 0],
    thigh_L: [-6 * D, 0, 5 * D], shin_L: [10 * D, 0, 0], foot_L: [-4 * D, 0, -5 * D],
    thigh_R: [6 * D, 0, -6 * D], shin_R: [8 * D, 0, 0], foot_R: [-14 * D, 0, 6 * D], hipsDrop: 0.2,
  },
  aim: {
    spine: [0, -18 * D, 0], chest: [0, -10 * D, 0], head: [0, 26 * D, 0],
    shoulder_R: [-80 * D, -10 * D, -10 * D], forearm_R: [-20 * D, 0, 0], hand_R: [8 * D, 0, 0],
    shoulder_L: [-50 * D, 30 * D, 25 * D], forearm_L: [-70 * D, 0, 0],
    thigh_L: [-18 * D, 0, 8 * D], shin_L: [22 * D, 0, 0], foot_L: [-4 * D, 0, -8 * D],
    thigh_R: [14 * D, 0, -10 * D], shin_R: [16 * D, 0, 0], foot_R: [-30 * D, 0, 10 * D], hipsDrop: 0.35,
  },
  dual: {
    spine: [0, -14 * D, 0], chest: [2 * D, -8 * D, 0], head: [0, 20 * D, 0],
    shoulder_R: [-78 * D, 0, -6 * D], forearm_R: [-12 * D, 0, 0],
    shoulder_L: [-18 * D, 0, 16 * D], forearm_L: [-62 * D, 0, 0], hand_L: [-10 * D, 0, 0],
    thigh_L: [-30 * D, 0, 10 * D], shin_L: [36 * D, 0, 0], foot_L: [-6 * D, 0, -10 * D],
    thigh_R: [18 * D, 0, -12 * D], shin_R: [30 * D, 0, 0], foot_R: [-40 * D, 0, 12 * D], hipsDrop: 0.6,
  },
  lance: {
    spine: [0, -6 * D, 0], chest: [0, -4 * D, 0], head: [-4 * D, 10 * D, 0],
    shoulder_R: [-8 * D, 0, -10 * D], forearm_R: [-84 * D, 0, 0], hand_R: [96 * D, 0, 0],
    shoulder_L: [-6 * D, 0, 10 * D], forearm_L: [-30 * D, 0, 0],
    thigh_L: [-6 * D, 0, 6 * D], shin_L: [8 * D, 0, 0], foot_L: [-2 * D, 0, -6 * D],
    thigh_R: [4 * D, 0, -6 * D], shin_R: [4 * D, 0, 0], foot_R: [-8 * D, 0, 6 * D], hipsDrop: 0.1,
  },
  heavy: {
    spine: [0, -10 * D, 0], chest: [4 * D, -8 * D, 0], head: [0, 14 * D, 0],
    shoulder_R: [-40 * D, 0, -12 * D], forearm_R: [-75 * D, 10 * D, 0],
    shoulder_L: [-35 * D, -10 * D, 8 * D], forearm_L: [-60 * D, -20 * D, 0],
    thigh_L: [-10 * D, 0, 8 * D], shin_L: [14 * D, 0, 0], foot_L: [-4 * D, 0, -8 * D],
    thigh_R: [10 * D, 0, -8 * D], shin_R: [10 * D, 0, 0], foot_R: [-20 * D, 0, 8 * D], hipsDrop: 0.25,
  },
  guard: {
    spine: [4 * D, 14 * D, 0], chest: [6 * D, 8 * D, 0], head: [0, -12 * D, 0],
    shoulder_L: [-55 * D, 55 * D, 15 * D], forearm_L: [-50 * D, 0, 0],
    shoulder_R: [-150 * D, 0, -20 * D], forearm_R: [-40 * D, 0, 0], hand_R: [-30 * D, 0, 0],
    thigh_L: [-22 * D, 0, 10 * D], shin_L: [30 * D, 0, 0], foot_L: [-8 * D, 0, -10 * D],
    thigh_R: [18 * D, 0, -12 * D], shin_R: [20 * D, 0, 0], foot_R: [-38 * D, 0, 12 * D], hipsDrop: 0.55,
  },
  cast: {
    chest: [-8 * D, 0, 0], head: [-14 * D, 0, 0],
    shoulder_L: [0, 0, 70 * D], forearm_L: [-40 * D, 0, 0], shoulder_R: [0, 0, -70 * D], forearm_R: [-40 * D, 0, 0],
    thigh_L: [0, 0, 10 * D], thigh_R: [0, 0, -10 * D], foot_L: [0, 0, -10 * D], foot_R: [0, 0, 10 * D], hipsDrop: 0.15,
  },
  drive: {
    spine: [10 * D, -24 * D, 0], chest: [8 * D, -14 * D, 0], head: [-6 * D, 30 * D, 0],
    shoulder_L: [-88 * D, 12 * D, 0], forearm_L: [-10 * D, 0, 0],
    shoulder_R: [30 * D, 0, -20 * D], forearm_R: [-60 * D, 0, 0],
    thigh_L: [-40 * D, 0, 6 * D], shin_L: [42 * D, 0, 0], foot_L: [-2 * D, 0, 0],
    thigh_R: [26 * D, 0, -6 * D], shin_R: [24 * D, 0, 0], foot_R: [-40 * D, 0, 0], hipsDrop: 0.8,
  },
  /** Disabled, pilot alive: right knee down, weapon across the thigh. */
  kneel: {
    spine: [16 * D, 0, 0], chest: [10 * D, 0, 0], head: [18 * D, 0, 0],
    shoulder_L: [-30 * D, 0, 10 * D], forearm_L: [-40 * D, 0, 0],
    shoulder_R: [-35 * D, 0, 10 * D], forearm_R: [-70 * D, 0, 0], hand_R: [20 * D, 0, 0],
    thigh_L: [-88 * D, 0, 6 * D], shin_L: [46 * D, 0, 0], foot_L: [42 * D, 0, 0],
    thigh_R: [4 * D, 0, -4 * D], shin_R: [88 * D, 0, 0], foot_R: [30 * D, 0, 0],
  },
  /** Pilot dead: the frame locks upright, head bowed, weapon grounded. Kessen frames never fall. */
  standDown: {
    chest: [-2 * D, 0, 0], head: [34 * D, 0, 0],
    shoulder_L: [0, 0, 4 * D], forearm_L: [-6 * D, 0, 0], shoulder_R: [-6 * D, 0, -4 * D], forearm_R: [-24 * D, 0, 0],
    thigh_L: [0, 0, 3 * D], thigh_R: [0, 0, -3 * D], foot_L: [0, 0, -3 * D], foot_R: [0, 0, 3 * D],
  },
  /** Zero-g boost: legs trailing, jets vectored. */
  boost: {
    spine: [18 * D, 0, 0], chest: [14 * D, 0, 0], head: [-26 * D, 0, 0],
    shoulder_R: [-70 * D, 0, -18 * D], forearm_R: [-30 * D, 0, 0],
    shoulder_L: [-20 * D, 0, 30 * D], forearm_L: [-60 * D, 0, 0],
    thigh_L: [30 * D, 0, 8 * D], shin_L: [40 * D, 0, 0], foot_L: [30 * D, 0, 0],
    thigh_R: [10 * D, 0, -8 * D], shin_R: [60 * D, 0, 0], foot_R: [30 * D, 0, 0],
    skirt_F: [-20 * D, 0, 0], skirt_B: [30 * D, 0, 0], jet_L: [50 * D, 0, 0], jet_R: [50 * D, 0, 0],
  },
};

export type ClipId = 'idle' | 'walk' | 'run' | 'fire' | 'melee' | 'kneel' | 'standDown' | 'boost';

export const CLIPS: readonly ClipId[] = ['idle', 'walk', 'run', 'fire', 'melee', 'kneel', 'standDown', 'boost'];

/** What a clip needs to know about the frame playing it. */
export interface ClipContext {
  stance: Stance;
  stature: Stature;
}

/** Mutable working pose: every bone always present, so blending never allocates. */
export interface PoseBuffer {
  rot: Record<BoneName, [number, number, number]>;
  hipsDrop: number;
  /** Extra root height (jump / boost bob), canonical metres. */
  lift: number;
}

export function createPoseBuffer(): PoseBuffer {
  const rot = {} as PoseBuffer['rot'];
  for (const b of BONE_NAMES) rot[b] = [0, 0, 0];
  return { rot, hipsDrop: 0, lift: 0 };
}

function load(out: PoseBuffer, p: Pose): PoseBuffer {
  for (const b of BONE_NAMES) {
    const r = p[b];
    const o = out.rot[b];
    if (r) {
      o[0] = r[0];
      o[1] = r[1];
      o[2] = r[2];
    } else o[0] = o[1] = o[2] = 0;
  }
  out.hipsDrop = p.hipsDrop ?? 0;
  out.lift = 0;
  return out;
}

const add = (out: PoseBuffer, b: BoneName, x: number, y = 0, z = 0) => {
  const o = out.rot[b];
  o[0] += x;
  o[1] += y;
  o[2] += z;
};
const set = (out: PoseBuffer, b: BoneName, r: Rot) => {
  const o = out.rot[b];
  o[0] = r[0];
  o[1] = r[1];
  o[2] = r[2];
};

/** Heavier frames move slower and sway less. */
const tempo = (s: Stature) => 1.25 - s * 0.09;

/** Gait, phase in radians. Heavy gait: long contact, short flight. `k` scales the stride. */
function gait(out: PoseBuffer, t: number, k: number, upper: boolean): void {
  const s = Math.sin(t);
  const c = Math.cos(t);
  const lift = (x: number) => Math.max(0, Math.sin(x));
  set(out, 'thigh_L', [-26 * D * s * k, 0, 3 * D]);
  set(out, 'shin_L', [(6 + 38 * k * lift(t + Math.PI * 0.1)) * D, 0, 0]);
  set(out, 'foot_L', [10 * D * s * k, 0, 0]);
  set(out, 'thigh_R', [26 * D * s * k, 0, -3 * D]);
  set(out, 'shin_R', [(6 + 38 * k * lift(t + Math.PI * 1.1)) * D, 0, 0]);
  set(out, 'foot_R', [-10 * D * s * k, 0, 0]);
  set(out, 'hips', [4 * D * k, -6 * D * s, -2 * D * c]);
  set(out, 'skirt_F', [Math.min(0, -26 * D * Math.abs(s) * k), 0, 0]);
  if (upper) {
    set(out, 'shoulder_L', [22 * D * s * k, 0, 6 * D]);
    set(out, 'forearm_L', [-20 * D * k, 0, 0]);
    set(out, 'shoulder_R', [-22 * D * s * k, 0, -6 * D]);
    set(out, 'forearm_R', [-20 * D * k, 0, 0]);
    set(out, 'spine', [10 * D * k, 8 * D * s, 0]);
    set(out, 'chest', [6 * D * k, -4 * D * s, 3 * D * c]);
    set(out, 'head', [-12 * D * k, 0, 0]);
  } else {
    // Weapon stays up: counter-rotate the spine against the hips.
    add(out, 'spine', 4 * D * k, 6 * D * s);
  }
  out.hipsDrop = 0.15 * k + 0.12 * k * Math.abs(c);
}

/**
 * Samples a clip at time `t` (seconds since it started) into `out`.
 * Pure: the same inputs always give the same pose (replays, lockstep).
 */
export function sampleClip(clip: ClipId, t: number, ctx: ClipContext, out: PoseBuffer): PoseBuffer {
  const k = tempo(ctx.stature);
  switch (clip) {
    case 'idle': {
      // Hydraulic sway around the variant's stance.
      load(out, POSES[ctx.stance]);
      const w = t * 1.3 * k;
      add(out, 'spine', Math.sin(w) * 1.2 * D, Math.sin(w * 0.5) * 2 * D);
      add(out, 'chest', Math.sin(w + 1) * 1.5 * D);
      add(out, 'head', 0, Math.sin(w * 0.37) * 6 * D);
      add(out, 'skirt_F', Math.sin(w * 2) * 1.5 * D);
      add(out, 'skirt_B', -Math.sin(w * 2) * 1.5 * D);
      out.hipsDrop += Math.sin(w * 2) * 0.02;
      return out;
    }
    case 'walk':
    case 'run': {
      const run = clip === 'run';
      load(out, run ? POSES.stand : POSES[ctx.stance]);
      const rate = (run ? 2.1 : 1.05) * k;
      gait(out, t * rate * Math.PI * 2, run ? 1.45 : 1, run);
      if (run) {
        add(out, 'spine', 14 * D);
        add(out, 'chest', 6 * D);
        add(out, 'head', -16 * D);
        out.lift = Math.abs(Math.sin(t * rate * Math.PI * 2)) * 0.25;
      }
      return out;
    }
    case 'fire': {
      // Stance, plus a recoil kick on the gun arm every 0.6 s, scaled down for big frames.
      load(out, POSES[ctx.stance]);
      const ph = (t % 0.6) / 0.6;
      const kick = Math.exp(-ph * 9) * (1.2 - ctx.stature * 0.12);
      add(out, 'shoulder_R', 14 * D * kick);
      add(out, 'forearm_R', -10 * D * kick);
      add(out, 'chest', -3 * D * kick, 3 * D * kick);
      add(out, 'head', -2 * D * kick);
      return out;
    }
    case 'melee': {
      // Wind up over the head, strike through, recover: 1.6 s loop.
      load(out, POSES[ctx.stance]);
      const ph = (t * k % 1.6) / 1.6;
      const wind = ph < 0.45 ? smooth(ph / 0.45) : ph < 0.55 ? 1 - smooth((ph - 0.45) / 0.1) * 1.6 : -0.6 * (1 - smooth((ph - 0.55) / 0.45));
      set(out, 'shoulder_R', [-150 * D * Math.max(0, wind) + 30 * D * Math.max(0, -wind), 0, -20 * D]);
      set(out, 'forearm_R', [-40 * D - 30 * D * Math.max(0, wind), 0, 0]);
      add(out, 'spine', 6 * D * Math.min(0, wind), 18 * D * wind);
      add(out, 'chest', 12 * D * Math.max(0, -wind), 10 * D * wind);
      out.hipsDrop += 0.25 * Math.max(0, -wind);
      return out;
    }
    case 'kneel':
      return load(out, POSES.kneel);
    case 'standDown':
      return load(out, POSES.standDown);
    case 'boost': {
      load(out, POSES.boost);
      const w = t * 2.2;
      add(out, 'thigh_L', Math.sin(w) * 5 * D);
      add(out, 'thigh_R', Math.sin(w + 1.3) * 5 * D);
      add(out, 'skirt_B', Math.sin(w * 3) * 4 * D);
      add(out, 'jet_L', Math.sin(w * 1.7) * 6 * D);
      add(out, 'jet_R', Math.sin(w * 1.7 + 0.5) * 6 * D);
      out.lift = 1.2 + Math.sin(w * 0.8) * 0.3;
      return out;
    }
  }
}

function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** out = a + (b - a) * w, per bone (Euler lerp is fine inside these joint ranges). */
export function blendPoses(a: PoseBuffer, b: PoseBuffer, w: number, out: PoseBuffer): PoseBuffer {
  for (const n of BONE_NAMES) {
    const ra = a.rot[n];
    const rb = b.rot[n];
    const o = out.rot[n];
    o[0] = ra[0] + (rb[0] - ra[0]) * w;
    o[1] = ra[1] + (rb[1] - ra[1]) * w;
    o[2] = ra[2] + (rb[2] - ra[2]) * w;
  }
  out.hipsDrop = a.hipsDrop + (b.hipsDrop - a.hipsDrop) * w;
  out.lift = a.lift + (b.lift - a.lift) * w;
  return out;
}

/** Clips that end in a held state rather than looping (the pose simply holds). */
export const HELD: ReadonlySet<ClipId> = new Set(['kneel', 'standDown']);
