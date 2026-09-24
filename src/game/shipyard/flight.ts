import { Mesh, Raycaster, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { FlightSpec } from '@/sim/FlightModel';
import { DEFAULT_CHASE, type ChaseTuning } from '@/sim/ChaseCamera';
import type { ShipModel } from '@/assets/ShipBuilder';
import { CATALOG_BY_ID, type CatalogEntry } from './catalog';

/**
 * Flight-model and camera parameters derived from the catalogue, so every
 * hull flies the same FlightModel with handling that scales with its size:
 * bigger = slower, lazier turns, more inertia (longer rate response), and a
 * chase camera that sits proportionally further back.
 *
 * Pure functions of catalogue data (plus a base spec for the fields the
 * catalogue does not describe, e.g. cruise drive and boost gauge), and of the
 * built model for the camera framings.
 */

const DEG = Math.PI / 180;

/** FlightSpec for a catalogue entry, layered over `base` (normally KESTREL_SPEC). */
export function flightSpecFor(e: CatalogEntry, base: FlightSpec): FlightSpec {
  const s = e.stats;
  const L = Math.max(10, e.length);
  // Inertia: fighters converge body rates in ~30 ms; a 370 m frigate in ~0.6 s.
  const rateResponse = Math.max(1.6, Math.min(base.rateResponse, base.rateResponse * Math.pow(17 / L, 0.85)));
  const pitch = s.turn * DEG;
  return {
    ...base,
    maxSpeed: s.speed,
    boostSpeed: s.boost,
    mainAccel: s.accel,
    boostAccel: s.accel * (s.boost > s.speed * 1.6 ? 2.5 : 1.6),
    lateralAccel: s.accel * (L > 60 ? 0.6 : 1.15),
    pitchRate: pitch,
    yawRate: pitch * 0.6,
    rollRate: s.roll * DEG,
    rateResponse,
    // Big drives burn longer but recover slower.
    boostDrain: base.boostDrain * (L > 60 ? 0.6 : 1),
    boostRegen: base.boostRegen * (L > 60 ? 0.7 : 1),
    // Capital hulls spool the cruise drive longer.
    cruiseSpool: base.cruiseSpool * (L > 100 ? 2.2 : L > 40 ? 1.5 : 1),
  };
}

/**
 * Catalogue-driven spec by blueprint id for AI spawns — undefined for hulls
 * that aren't catalogued or that predate the shipyard (their sim spec rules).
 */
export function shipyardFlightSpec(blueprintId: string, base: FlightSpec): FlightSpec | undefined {
  const e = CATALOG_BY_ID[blueprintId];
  return e && !e.legacy ? flightSpecFor(e, base) : undefined;
}

/**
 * Bridge eye above / behind the bridge socket and the aim distance, as
 * fractions of hull length. Warships with a forward battery (`overBattery`)
 * ride higher and further back so the superfiring mount sits in the bottom
 * sixth of the frame, not the bottom third; merchant bridges (at the stern,
 * over a long flat deck) keep the low eye.
 */
export const BRIDGE_EYE = {
  battery: { up: 0.16, back: 0.08, lookAhead: 5 },
  deck: { up: 0.05, back: 0.03, lookAhead: 6 },
};

export interface ChaseFraming {
  /** Ship-frame camera offset, metres (behind = −Z). */
  offset: [number, number, number];
  lookAhead: number;
  speedPullback: number;
  /** Spring smooth times grow with mass so the frame "weighs" the hull. */
  posSmooth: number;
  lookSmooth: number;
  upSmooth: number;
  shake: number;
  /** Suggested near plane, metres. */
  near: number;
}

/**
 * Chase framing scaled to hull length — the Kestrel's (0, 5.2, −26) at 17 m
 * grows proportionally, with a gentle curve so a frigate isn't a speck.
 */
export function chaseFraming(lengthM: number): ChaseFraming {
  const k = Math.max(1, lengthM / 17);
  const back = 26 * Math.pow(k, 0.92);
  return {
    offset: [0, 5.2 * Math.pow(k, 0.95), -back],
    lookAhead: 90 * k,
    speedPullback: 5 * k,
    posSmooth: 0.16 * Math.min(4, Math.pow(k, 0.35)),
    lookSmooth: 0.09 * Math.min(4, Math.pow(k, 0.35)),
    upSmooth: 0.28 * Math.min(3, Math.pow(k, 0.3)),
    shake: 0.12 * Math.min(4, k),
    near: Math.max(0.3, lengthM * 0.01),
  };
}

/**
 * Bridge camera: an eye above and a little behind the bridge socket, looking
 * over the bow (the Yamato shot). With a forward battery the eye rides high
 * enough that the forward mounts (barrels trained up included, mostly) sit
 * low in the frame and the bow reads below the reticle. `bridge` is the
 * socket position in ship metres.
 */
export function bridgeFraming(bridge: [number, number, number], lengthM: number, overBattery = false): ChaseFraming {
  const base = chaseFraming(lengthM);
  const k = overBattery ? BRIDGE_EYE.battery : BRIDGE_EYE.deck;
  return {
    ...base,
    offset: [bridge[0], bridge[1] + lengthM * k.up, bridge[2] - lengthM * k.back],
    lookAhead: lengthM * k.lookAhead,
    speedPullback: 0,
    posSmooth: 0.05,
    lookSmooth: 0.12,
    upSmooth: 0.2,
    shake: 0.02 * lengthM * 0.01,
    near: 0.5,
  };
}

/** Does this hull have a forward battery the bridge looks over? */
export function hasBowBattery(e: CatalogEntry | undefined): boolean {
  return !!e?.hardpoints.turrets.some((t) => t.arc === 'bow');
}

/**
 * Which chase framing the player's hull rides:
 * - `chase`  behind the hull, distance scaled to length;
 * - `bridge` over the bow from the bridge (catalogue `camera: 'bridge'`);
 * - `bow`    on the foredeck, forward of the bow battery, so mounts training
 *            up at a target overhead stay out of the frame (V on bridge hulls).
 */
export type ShipView = 'chase' | 'bridge' | 'bow';

/** The part of a built ShipModel the framings read. */
export type FramingModel = Pick<ShipModel, 'root' | 'hull' | 'sockets' | 'articulations' | 'length' | 'bounds'>;

/** `?bridge=0|1|bow`: force the chase cam, force the bridge, or start on the bow. */
export function cameraOverride(): string | null {
  return typeof location !== 'undefined' ? new URLSearchParams(location.search).get('bridge') : null;
}

/**
 * The view a hull flies with: bridge hulls (catalogue `camera: 'bridge'`, or
 * any hull with a bridge socket under `?bridge=1`) ride the bridge, or the
 * bow when `bow` is set; everything else rides the chase cam.
 */
export function viewFor(model: Pick<ShipModel, 'sockets'>, e: CatalogEntry | undefined, bow = false, param: string | null = null): ShipView {
  const bridge = model.sockets.has('bridge') && param !== '0' && (param === '1' || param === 'bow' || e?.camera === 'bridge');
  return !bridge ? 'chase' : bow ? 'bow' : 'bridge';
}

/**
 * Framing for a view, or null for a fighter-sized hull on the chase cam (it
 * keeps DEFAULT_CHASE). A view the hull has no bridge for falls back to the
 * chase cam.
 */
export function framingFor(model: FramingModel, e: CatalogEntry | undefined, view: ShipView): ChaseFraming | null {
  const sock = model.sockets.get('bridge');
  if (view === 'bow' && sock) return bowFraming(model, e);
  if (view === 'bridge' && sock) return bridgeFraming([sock.position.x, sock.position.y, sock.position.z], model.length, hasBowBattery(e));
  return model.length > 20 ? chaseFraming(model.length) : null;
}

/**
 * Bow eye as fractions of hull length: `up` above the deck, `ahead` past the
 * forward-most reach of the bow battery (a mount's full traverse circle,
 * barrels included), and at least `tip` of the way from there to the stem.
 */
export const BOW_EYE = { up: 0.014, ahead: 0.02, tip: 0.3, lookAhead: 6 };

const _ray = new Raycaster();
const _from = new Vector3();
const _down = new Vector3(0, -1, 0);

/** Position of `o` in the ship frame (walks its parents up to the model root). */
function shipFramePos(o: Object3D, root: Object3D, out: Vector3): Vector3 {
  out.set(0, 0, 0);
  for (let n: Object3D | null = o; n && n !== root; n = n.parent) {
    n.updateMatrix();
    out.applyMatrix4(n.matrix);
  }
  return out;
}

/** Height of the static hull's top surface at (x, z) in ship metres; null if there's no hull there. */
export function deckHeightAt(model: FramingModel, x: number, z: number): number | null {
  const probe = new Mesh(model.hull.geometry); // identity transform = the ship frame
  _ray.set(_from.set(x, model.bounds.max.y + 1, z), _down);
  const hit = _ray.intersectObject(probe, false)[0];
  return hit ? hit.point.y : null;
}

/**
 * Bow camera: the eye just above the foredeck, forward of the bow battery and
 * short of the stem, looking ahead. Mounts training up at a target overhead
 * sit behind the camera instead of poking into the bottom of the frame. An
 * authored `bow` socket places the eye outright; otherwise it comes from the
 * bow-battery mounts and the hull bounds, at the height of the deck under the
 * eye (not the top of a towered hull's box).
 */
export function bowFraming(model: FramingModel, e: CatalogEntry | undefined): ChaseFraming {
  const L = model.length;
  const p = new Vector3();
  const authored = model.sockets.get('bow');
  let eye: [number, number, number];
  if (authored) {
    shipFramePos(authored, model.root, p);
    eye = [p.x, p.y, p.z];
  } else {
    const stem = model.bounds.max.z;
    // Forward-most reach of the bow battery: pivot + the mount's traverse radius.
    let front = -Infinity;
    let mountTop = -Infinity;
    for (const t of e?.hardpoints.turrets ?? []) {
      if (t.arc !== 'bow') continue;
      const s = model.sockets.get(t.socket);
      if (!s) continue;
      shipFramePos(s, model.root, p);
      const bb = model.articulations.get(t.socket)?.mesh?.geometry.boundingBox;
      const reach = bb ? Math.hypot(Math.max(-bb.min.x, bb.max.x), Math.max(-bb.min.z, bb.max.z)) : L * 0.05;
      front = Math.max(front, p.z + reach);
      mountTop = Math.max(mountTop, p.y + (bb ? bb.max.y : 0));
    }
    if (!Number.isFinite(front)) front = stem - L * 0.2;
    const z = Math.max(front + L * BOW_EYE.ahead, front + (stem - front) * BOW_EYE.tip);
    const deck = deckHeightAt(model, 0, z) ?? deckHeightAt(model, L * 0.02, z) ?? (Number.isFinite(mountTop) ? mountTop : 0);
    eye = [0, deck + L * BOW_EYE.up, z];
  }
  return {
    ...chaseFraming(L),
    offset: eye,
    lookAhead: L * BOW_EYE.lookAhead,
    speedPullback: 0,
    posSmooth: 0.04,
    lookSmooth: 0.1,
    upSmooth: 0.2,
    shake: 0.02 * L * 0.01,
    near: 0.5,
  };
}

/** Put a framing on the chase camera (null = the fighter default) and set the near plane. */
export function applyFraming(chase: { tuning: ChaseTuning }, camera: PerspectiveCamera, f: ChaseFraming | null): void {
  const t = chase.tuning;
  const d = DEFAULT_CHASE;
  t.offset = f ? new Vector3(...f.offset) : d.offset.clone();
  t.lookAhead = f ? f.lookAhead : d.lookAhead;
  t.speedPullback = f ? f.speedPullback : d.speedPullback;
  t.posSmooth = f ? f.posSmooth : d.posSmooth;
  t.lookSmooth = f ? f.lookSmooth : d.lookSmooth;
  t.upSmooth = f ? f.upSmooth : d.upSmooth;
  t.shake = f ? f.shake : d.shake;
  camera.near = Math.min(0.3, f?.near ?? 0.3);
  camera.updateProjectionMatrix();
}
