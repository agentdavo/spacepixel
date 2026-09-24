import { Vector3 } from 'three';

/**
 * Space dust near a hangar bay.
 *
 * The dust is eye-relative: every mote lives in a cube around the camera and
 * is drawn with depth test only, so the bay walls hide the motes *behind*
 * them but not the ones between the camera and a wall. With the eye in (or
 * just outside) a bay mouth, the motes filling the bay volume — and the ones
 * hanging in front of its dark liners — are stretched by the camera's
 * velocity into streaks across the interior: horizontal dashes over the deck
 * and walls, the "streaks through the geometry" of the docking cutaway.
 * There is no dust in a pressurised hangar, and the streak length was the
 * host's cruise (the carrier steams at ~40 m/s), not the approach.
 *
 * So, per frame, relative to the bay you are docking at (or the nearest):
 *  - `fade`: dust intensity, 1 in open space, easing to 0 over the last
 *    ~1.5 mouth-sizes of the approach and 0 inside the bay volume;
 *  - `velocity`: the eye's velocity relative to the bay's host (dust is at
 *    rest in the host's frame while you fly its corridor), blended from the
 *    world velocity as the fade closes.
 */
export interface BayFrame {
  bay: Vector3;
  axis: Vector3;
  up: Vector3;
  velocity: Vector3;
  interior: { hw: number; hh: number; depth: number };
}

const _r = new Vector3();
const _right = new Vector3();

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 0 (inside the bay) … 1 (clear of it). */
export function bayDustFade(eye: Vector3, d: BayFrame): number {
  const { hw, hh, depth } = d.interior;
  _r.subVectors(eye, d.bay);
  const z = _r.dot(d.axis); // + out of the bay
  if (z < -depth - 20) return 1; // behind the back wall: not this bay's business
  _right.crossVectors(d.up, d.axis);
  const x = Math.abs(_r.dot(_right));
  const y = Math.abs(_r.dot(d.up));
  const size = Math.max(hw, hh);
  // Lateral envelope: the mouth plus a margin that grows as you back away (the view cone into the bay).
  const reach = Math.max(0, z);
  const lateral = 1 - smooth(hw + 0.3 * size + reach * 0.6, hw + 0.9 * size + reach * 0.9, x) * 1;
  const vertical = 1 - smooth(hh + 0.3 * size + reach * 0.6, hh + 0.9 * size + reach * 0.9, y);
  const inCone = Math.min(lateral, vertical);
  // Along the corridor: full dust beyond 1.5 mouth-sizes, none at the mouth.
  const along = smooth(0, 1.5 * size, z);
  return 1 - inCone * (1 - along);
}

/**
 * Dust drive for the frame: writes the eye velocity to use into `out` and
 * returns the intensity multiplier. `bays` are the candidate bays (the
 * docking target first); the lowest fade wins.
 */
export function bayDust(eye: Vector3, worldVel: Vector3, bays: readonly (BayFrame | null | undefined)[], out: Vector3): number {
  let fade = 1;
  let host: BayFrame | null = null;
  for (const b of bays) {
    if (!b) continue;
    const f = bayDustFade(eye, b);
    if (f < fade) {
      fade = f;
      host = b;
    }
  }
  out.copy(worldVel);
  if (host) out.sub(_r.copy(host.velocity).multiplyScalar(1 - fade));
  return fade;
}
