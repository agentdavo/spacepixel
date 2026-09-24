import { Quaternion, Vector3 } from 'three';
import { facingOf, facingStrength, type DamageState } from '@/sim/Damage';
import type { ShipEntity } from '@/sim/Fleet';

/**
 * Presentation geometry of a ship's shield: the shell the FX draw on and the
 * layout of its facings. Read-only over the damage model — nothing here
 * touches sim state.
 *
 * Shell: the sim's ellipsoid (`combat.shell`, fitted to clear the hull by
 * Combat.SHELL_CLEARANCE). Capitals stop bolts on it; fighters draw their
 * skin on it (their sim bubble is a sphere, so impact points are projected
 * onto it). Centred on the hull bounding box centre.
 *
 * Facings are data-driven: the number comes from `dmg.facings.length`
 * (0 or 1 = one whole bubble), and their extents are found by probing the
 * damage model's own `facingOf()` over a sphere of directions in hull-box
 * space — so a change to the facing layout (fore/aft halves on fighters,
 * six facings on a battleship) shows up here without touching the FX.
 * Each facing becomes a centroid direction in that space; the shell shader
 * classifies a fragment by the nearest centroid (exact for box-sector
 * layouts like fore/aft/port/starboard).
 */
export const MAX_FACINGS = 8;

export interface FacingLayout {
  /** Number of facings drawn (0 = one bubble). */
  count: number;
  /** Per facing: centroid (unit, hull-box space) xyz · span (1 − min dot inside the facing; 0..2). */
  dirs: Float32Array;
  /** Shell unit sphere → hull-box space scale (shell half axes / hull half extents). */
  warp: Vector3;
  /** Facing count this layout was probed for. */
  probed: number;
}

const PROBES = 160;
const _q = new Quaternion();
const _v = new Vector3();
const _m = new Vector3();
const _l = new Vector3();
const _s = new Vector3();
const layouts = new WeakMap<DamageState, FacingLayout>();

/** Fibonacci sphere of probe directions (unit). */
const PROBE_DIRS: Vector3[] = [];
for (let i = 0; i < PROBES; i++) {
  const y = 1 - (2 * (i + 0.5)) / PROBES;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963229728653;
  PROBE_DIRS.push(new Vector3(r * Math.cos(a), y, r * Math.sin(a)));
}

/** Shell half axes (m) around the hull centre. */
export function shellScale(s: ShipEntity, out: Vector3): Vector3 {
  return out.copy(s.combat.shell);
}

/** Facing layout of a ship (cached per damage state; re-probed if the facing count changes). */
export function facingLayout(s: ShipEntity): FacingLayout {
  const st = s.combat.dmg;
  const n = Math.min(st.facings.length, MAX_FACINGS);
  let L = layouts.get(st);
  if (L && L.probed === n) return L;
  L ??= { count: 0, dirs: new Float32Array(MAX_FACINGS * 4), warp: new Vector3(), probed: -1 };
  L.probed = n;
  L.dirs.fill(0);
  shellScale(s, _s);
  L.warp.set(_s.x / Math.max(st.halfW, 0.01), _s.y / Math.max(st.halfH, 0.01), _s.z / Math.max(st.halfL, 0.01));
  if (n < 2) {
    L.count = 0;
    layouts.set(st, L);
    return L;
  }
  // Centroids: average the probe directions each facing claims (hull-box space).
  const d = L.dirs;
  for (const p of PROBE_DIRS) {
    _l.set(st.cx + p.x * st.halfW, st.cy + p.y * st.halfH, st.cz + p.z * st.halfL);
    const f = facingOf(st, _l);
    if (f < 0 || f >= n) continue;
    d[f * 4] += p.x;
    d[f * 4 + 1] += p.y;
    d[f * 4 + 2] += p.z;
  }
  for (let f = 0; f < n; f++) {
    _v.set(d[f * 4], d[f * 4 + 1], d[f * 4 + 2]);
    if (_v.lengthSq() < 1e-8) _v.set(0, 0, f === 0 ? 1 : -1);
    _v.normalize();
    d[f * 4] = _v.x;
    d[f * 4 + 1] = _v.y;
    d[f * 4 + 2] = _v.z;
  }
  // Span: how far (1 − dot) a facing reaches from its centroid, by the shader's own nearest-centroid rule.
  for (const p of PROBE_DIRS) {
    const f = classify(L, n, p.x, p.y, p.z);
    const dp = p.x * d[f * 4] + p.y * d[f * 4 + 1] + p.z * d[f * 4 + 2];
    d[f * 4 + 3] = Math.max(d[f * 4 + 3], 1 - dp);
  }
  for (let f = 0; f < n; f++) d[f * 4 + 3] = Math.max(d[f * 4 + 3], 0.05);
  L.count = n;
  layouts.set(st, L);
  return L;
}

function classify(L: FacingLayout, n: number, x: number, y: number, z: number): number {
  const d = L.dirs;
  let best = 0;
  let bd = -9;
  for (let f = 0; f < n; f++) {
    const dp = x * d[f * 4] + y * d[f * 4 + 1] + z * d[f * 4 + 2];
    if (dp > bd) {
      bd = dp;
      best = f;
    }
  }
  return best;
}

/** Facing under a shell direction (unit sphere), by the drawn layout; −1 for a bubble. */
export function facingAt(s: ShipEntity, dir: Vector3): number {
  const L = facingLayout(s);
  if (!L.count) return -1;
  _m.copy(dir).multiply(L.warp).normalize();
  return classify(L, L.count, _m.x, _m.y, _m.z);
}

/** Universe point → direction on the shell's unit sphere (sim pose). */
export function shellDir(s: ShipEntity, universe: Vector3, out: Vector3): Vector3 {
  const st = s.combat.dmg;
  shellScale(s, _s);
  _q.copy(s.flight.orientation).invert();
  out.subVectors(universe, s.flight.position).applyQuaternion(_q);
  out.set((out.x - st.cx) / _s.x, (out.y - st.cy) / _s.y, (out.z - st.cz) / _s.z);
  const l = out.length();
  return l > 1e-6 ? out.divideScalar(l) : out.set(0, 0, 1);
}

/** Unit-sphere shell direction → universe point on the shell (sim pose); `normal` (optional) gets the outward surface normal. */
export function shellPoint(s: ShipEntity, dir: Vector3, out: Vector3, normal?: Vector3): Vector3 {
  const st = s.combat.dmg;
  shellScale(s, _s);
  if (normal) normal.set(dir.x / _s.x, dir.y / _s.y, dir.z / _s.z).normalize().applyQuaternion(s.flight.orientation);
  return out.set(st.cx + dir.x * _s.x, st.cy + dir.y * _s.y, st.cz + dir.z * _s.z).applyQuaternion(s.flight.orientation).add(s.flight.position);
}

/**
 * A random shell direction inside facing `f` (rejection sampling around its
 * centroid; −1 or a bubble = anywhere). `rand` is the caller's visual RNG.
 */
export function sampleFacing(s: ShipEntity, f: number, rand: () => number, out: Vector3): Vector3 {
  const L = facingLayout(s);
  for (let k = 0; k < 16; k++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out.set(r * Math.cos(a), r * Math.sin(a), z);
    if (!L.count || f < 0 || facingAt(s, out) === f) return out;
  }
  // Fallback: the centroid, mapped back to the shell sphere.
  const d = L.dirs;
  return out.set(d[f * 4] / L.warp.x, d[f * 4 + 1] / L.warp.y, d[f * 4 + 2] / L.warp.z).normalize();
}

/** Remaining strength of a facing, 0..1 (−1 / no facings = the whole shield pool). */
export function facingFrac(s: ShipEntity, f: number): number {
  const st = s.combat.dmg;
  if (f >= 0 && f < st.facings.length) return facingStrength(st, f);
  return s.shieldMax > 0 ? Math.min(1, Math.max(0, s.shield / s.shieldMax)) : 0;
}
