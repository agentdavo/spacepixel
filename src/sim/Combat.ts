import { Box3, Matrix4, Quaternion, Vector3, type CylinderGeometry, type Mesh } from 'three';
import type { ShipModel } from '@/assets/ShipBuilder';
import type { FactionId } from '@/assets/Blueprint';
import type { ShipEntity } from './Fleet';
import { KESTREL_SPEC, type FlightSpec } from './FlightModel';
import {
  CAPITAL_LAYOUT,
  DEFAULT_CAPITAL_STATS,
  DEFAULT_FIGHTER_STATS,
  DEFAULT_LAYOUT,
  DEFAULT_LOADOUT,
  GUNS,
  LOADOUTS,
  MISSILES,
  SHIP_STATS,
  SUBSYSTEM_TUNING,
  type DamageType,
  type GunSpec,
  type Loadout,
  type MissileSpec,
  type ShipStats,
} from './Loadouts';
import {
  DAMAGE_MUL,
  FACING_AXIS,
  FACING_NAMES,
  addSubsystem,
  adoptShield,
  applyHit,
  capitalEffects,
  createDamageState,
  createHitResult,
  facingOf,
  facingUp,
  fighterEffects,
  regenShields,
  resetDamage,
  setShieldCapacity,
  stepShieldPower,
  type CapitalEffects,
  type DamageState,
  type FighterEffects,
  type HitResult,
  type Subsystem,
  type SubsystemKind,
} from './Damage';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { statsFromCatalog } from '@/game/shipyard/combatStats';
import { flightSpecFor as yardFlightSpec } from '@/game/shipyard/flight';
import { hullGridFor, raycastGrid, surfaceTop, type GridHit, type HullGrid } from './HullGrid';
import { nextSubsystem, repairSubsystems, segmentSubsystem, subsystemExposed, subsystemNearestRay, type SegmentSubHit } from './Subsystems';

/**
 * Glue between the pure damage model (Damage.ts), the data tables
 * (Loadouts.ts) and live ships: per-ship combat state, hit geometry against
 * shields and hulls, and per-frame effects (shield regen, degraded thrust,
 * roll drift, capital helm). Plain functions over ShipEntity.
 */

/** Capital ships: slow, stately, barely turn. */
export const CAPITAL_SPEC: FlightSpec = {
  ...KESTREL_SPEC,
  maxSpeed: 45,
  boostSpeed: 60,
  mainAccel: 6,
  boostAccel: 8,
  lateralAccel: 4,
  pitchRate: 0.05,
  yawRate: 0.05,
  rollRate: 0.05,
};

export interface CombatState {
  stats: ShipStats;
  loadout: Loadout;
  dmg: DamageState;
  /** Voxel hull (capitals) for exact hits. */
  grid: HullGrid | null;
  /** Shield shell (capitals): ellipsoid half axes around the hull centre. */
  shell: Vector3;
  /** Undamaged flight spec; damage scales the ship's own copy. */
  baseSpec: FlightSpec;
  /** Selected gun / missile (index into the loadout). */
  gun: number;
  missile: number;
  /** Selected subsystem on `subShip` (player sub-targeting, B / Shift+B / I; the fighter brain on a capital); −1 = none. */
  subTarget: number;
  /** Id of the ship `subTarget` indexes into (a new target starts unselected); 0 = none. */
  subShip: number;
  /** Seconds until the next missile salvo. */
  missileReload: number;
  /** Anything to repair (reset on respawn). */
  damaged: boolean;
  fx: FighterEffects;
  cap: CapitalEffects;
}

const _m = new Matrix4();
const _inv = new Matrix4();
const _box = new Box3();
const _bb = new Box3();
const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

/** Capital for combat purposes: 4+ shield facings, subsystems, voxel hull (corvettes included). */
export function isCapitalModel(model: ShipModel): boolean {
  return (SHIP_STATS[model.blueprint.id]?.facings ?? 1) >= 4 || model.radius > 200;
}

/** Flight spec for a design: class base × stats multipliers (+ exact overrides). */
export function flightSpecFor(stats: ShipStats, capital: boolean): FlightSpec {
  const b = capital ? CAPITAL_SPEC : KESTREL_SPEC;
  return {
    ...b,
    maxSpeed: b.maxSpeed * stats.speed,
    boostSpeed: b.boostSpeed * stats.speed,
    mainAccel: b.mainAccel / stats.mass,
    boostAccel: b.boostAccel / stats.mass,
    lateralAccel: b.lateralAccel / stats.mass,
    pitchRate: b.pitchRate * stats.agility,
    yawRate: b.yawRate * stats.agility,
    rollRate: b.rollRate * stats.agility,
    ...stats.flight,
  };
}

/** Hull box of a built ship in root-local space (meshes only: no plumes). */
function modelBox(model: ShipModel, out: Box3): Box3 {
  model.root.updateMatrixWorld(true);
  _inv.copy(model.root.matrixWorld).invert();
  out.makeEmpty();
  for (const mesh of model.meshes) {
    const g = (mesh as Mesh).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) continue;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    out.union(_bb.copy(g.boundingBox).applyMatrix4(_m));
  }
  return out;
}

export function createCombat(blueprintId: string, model: ShipModel, faction: FactionId): CombatState {
  const capital = isCapitalModel(model);
  // Shipyard hulls not in the combat table take their numbers from the catalogue.
  const yard = SHIP_STATS[blueprintId] ? undefined : CATALOG_BY_ID[blueprintId];
  const fromYard = yard && !yard.legacy ? yard : undefined;
  const stats = SHIP_STATS[blueprintId] ?? (fromYard ? statsFromCatalog(fromYard) : capital ? DEFAULT_CAPITAL_STATS : DEFAULT_FIGHTER_STATS);
  const loadout = LOADOUTS[blueprintId] ?? DEFAULT_LOADOUT[faction];
  const grid = capital ? hullGridFor(blueprintId, model.root, model.meshes) : null;
  if (grid) {
    const b = grid.box;
    _box.min.set(b.minX, b.minY, b.minZ);
    _box.max.set(b.maxX, b.maxY, b.maxZ);
  } else modelBox(model, _box);
  const c = _box.getCenter(new Vector3());
  const h = _box.getSize(new Vector3()).multiplyScalar(0.5);
  // Hulls that fly and take hits as fighters (sphere hits, gunships, small corvettes) get at most the fore / aft halves.
  const dmg = createDamageState(capital, stats.shield, stats.hull, { cx: c.x, cy: c.y, cz: c.z, halfW: h.x, halfH: h.y, halfL: h.z }, stats.shieldRegen, stats.shieldDelay, capital ? stats.facings : Math.min(stats.facings, 2), stats.shieldTransfer);
  if (capital && grid) addCapitalSubsystems(dmg, model, blueprintId, grid, stats.hull);
  else if (model.radius >= MOUNT_MIN_RADIUS) addMountSubsystems(dmg, model, stats.hull);
  // Every ship starts with its shield officer on (the player's keys take over: , . /).
  dmg.trimAuto = true;
  return {
    stats,
    loadout,
    dmg,
    grid,
    shell: new Vector3(h.x * 1.25 + 20, h.y * 1.35 + 20, h.z * 1.1 + 20),
    // Flight class follows size (corvettes keep the fighter base the AI and escort routes were tuned on).
    baseSpec: fromYard ? yardFlightSpec(fromYard, KESTREL_SPEC) : flightSpecFor(stats, model.radius > 200),
    gun: 0,
    missile: 0,
    subTarget: -1,
    subShip: 0,
    missileReload: 0,
    damaged: false,
    fx: fighterEffects(dmg, 1),
    cap: capitalEffects(dmg),
  };
}

function addCapitalSubsystems(dmg: DamageState, model: ShipModel, id: string, grid: HullGrid, hullMax: number): void {
  const len = Math.max(model.length, 1);
  model.root.updateMatrixWorld(true);
  _inv.copy(model.root.matrixWorld).invert();
  const counts: Partial<Record<SubsystemKind, number>> = {};
  const add = (kind: SubsystemKind, sid: string, p: Vector3, radius?: number) => {
    const t = SUBSYSTEM_TUNING[kind];
    const n = (counts[kind] = (counts[kind] ?? 0) + 1);
    const single = kind === 'shieldGen' || kind === 'bridge';
    addSubsystem(dmg, {
      id: sid,
      kind,
      label: single ? t.label : `${t.label} ${n}`,
      x: p.x,
      y: p.y,
      z: p.z,
      // Routing tolerance: hits land on voxel faces up to ~a cell proud of the plating.
      // Corvettes carry relatively bigger mounts than 2–3 km capitals.
      radius: Math.max(radius ?? t.radius * len * (len < 400 ? 1.6 : 1), 2.5) + grid.cell * 0.75,
      hpMax: Math.max(40, hullMax * t.hp),
    });
  };
  const kinds: Record<string, SubsystemKind> = { turret: 'turret', beam: 'lance', hangar: 'hangar' };
  const layout = CAPITAL_LAYOUT[id] ?? DEFAULT_LAYOUT;
  for (const [sid, o] of model.sockets) {
    const kind = kinds[o.userData.kind as string];
    if (!kind) continue;
    mountCentre(model, sid, _v.setFromMatrixPosition(_m.multiplyMatrices(_inv, o.matrixWorld)));
    add(kind, sid, _v);
  }
  model.engines.forEach((e, i) => {
    const r = (e.nozzle.geometry as CylinderGeometry).parameters?.radiusTop ?? len * 0.02;
    add('engine', `engine-${i}`, _v.copy(e.nozzle.position), Math.max(r * 1.8, len * 0.02));
  });
  const b = grid.box;
  const onTop = (fx: number, fz: number) => surfaceTop(grid, (b.minX + b.maxX) / 2 + fx * (b.maxX - b.minX) * 0.5, (b.minZ + b.maxZ) / 2 + fz * (b.maxZ - b.minZ) * 0.5, _w);
  const bridgeSocket = layout.bridge.socket ? model.sockets.get(layout.bridge.socket) : undefined;
  if (bridgeSocket) add('bridge', 'bridge', _v.setFromMatrixPosition(_m.multiplyMatrices(_inv, bridgeSocket.matrixWorld)));
  else add('bridge', 'bridge', onTop(layout.bridge.x, layout.bridge.z));
  add('shieldGen', 'shield-gen', onTop(layout.shieldGen.x, layout.shieldGen.z));
  addShieldEmitters(dmg, grid, len, hullMax);
}

const _eh: GridHit = { t: 0, nx: 0, ny: 0, nz: 0 };
const _ef = new Vector3();
/** Offsets across the face (fractions of the half extents: along the hull / up the face, then the other way) tried in turn for an emitter's spot. */
const EMITTER_SLIDE = [0, 0, 0.3, 0, -0.3, 0, 0, 0.3, 0, -0.3, 0.55, 0, -0.55, 0, 0, 0.55, 0, -0.55, 0.3, 0.3, -0.3, -0.3, 0.8, 0, -0.8, 0];

/**
 * One shield emitter per facing (4+ facings): dropped onto the plating that
 * faces that way by a grid raycast inward along the facing's axis (bow and
 * stern on the centreline, flanks amidships, deck and keel on the midline),
 * slid across the face until the spot belongs to that facing's region (so
 * fire has to come through that facing to reach it) and clears the other
 * subsystems. Knocking one out keeps its facing down (Damage.ts).
 */
function addShieldEmitters(dmg: DamageState, grid: HullGrid, len: number, hullMax: number): void {
  const n = dmg.facings.length;
  if (n < 4) return;
  const t = SUBSYSTEM_TUNING.shieldEmitter;
  const radius = Math.max(t.radius * len * (len < 400 ? 1.6 : 1), 2.5) + grid.cell * 0.75;
  const b = grid.box;
  const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const h = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2, (b.maxZ - b.minZ) / 2];
  const pad = grid.cell * 2;
  const o = [0, 0, 0];
  const d = [0, 0, 0];
  for (let f = 0; f < n; f++) {
    const a = FACING_AXIS[f];
    const ax = a[0] ? 0 : a[1] ? 1 : 2;
    // Slide along the hull's length on the flanks / deck / keel, up the face at bow and stern.
    const across = ax === 2 ? 1 : 2;
    const other = 3 - ax - across;
    let fallback = 0; // 0 none · 1 any hit · 2 a hit in the facing's own region
    let placed = false;
    for (let i = 0; i < EMITTER_SLIDE.length; i += 2) {
      o[0] = c[0];
      o[1] = c[1];
      o[2] = c[2];
      o[ax] += a[ax] * (h[ax] + pad);
      o[across] += EMITTER_SLIDE[i] * h[across];
      o[other] += EMITTER_SLIDE[i + 1] * h[other];
      d[0] = d[1] = d[2] = 0;
      d[ax] = -a[ax] * (h[ax] * 2 + pad * 2);
      if (!raycastGrid(grid, o[0], o[1], o[2], d[0], d[1], d[2], _eh)) continue;
      _v.set(o[0] + d[0] * _eh.t, o[1] + d[1] * _eh.t, o[2] + d[2] * _eh.t);
      const own = facingOf(dmg, _v) === f;
      const clear = !dmg.subsystems.some((s) => Math.hypot(s.x - _v.x, s.y - _v.y, s.z - _v.z) < (s.radius + radius) * 0.6);
      if (own && clear) {
        placed = true;
        break;
      }
      const rank = own ? 2 : 1;
      if (rank > fallback) {
        fallback = rank;
        _ef.copy(_v);
      }
    }
    if (!placed) {
      if (fallback) _v.copy(_ef);
      else _v.set(c[0] + a[0] * h[0], c[1] + a[1] * h[1], c[2] + a[2] * h[2]);
    }
    addSubsystem(dmg, { id: `emitter-${FACING_NAMES[f].toLowerCase()}`, kind: 'shieldEmitter', label: `${FACING_NAMES[f]} ${t.label}`, x: _v.x, y: _v.y, z: _v.z, radius, hpMax: Math.max(40, hullMax * t.hp), facing: f });
  }
}

/**
 * A rigged turret's subsystem sits at the centre of the mount on its turning
 * axis (as TurretRig.turretWorldPosition reports it), not on the deck plate
 * under it, so its hit sphere wraps the gun house. Others keep the socket.
 */
function mountCentre(model: ShipModel, sid: string, p: Vector3): Vector3 {
  const t = model.turrets.get(sid);
  if (!t) return p;
  const lift = _w.subVectors(t.pivot, t.base).dot(t.up) * 0.8;
  return p.copy(t.base).addScaledVector(t.up, lift);
}

/** Non-capital hulls at least this big (model radius, m: gunships and up) get their turret / beam / hangar mounts as subsystems. */
const MOUNT_MIN_RADIUS = 25;

/**
 * Gunships, cruisers and haulers that fly on the fighter model (no facings,
 * no voxel hull) still carry turrets: each turret / beam / hangar socket is a
 * subsystem, hit through its aimed sphere (raycastShip) once the bubble is
 * down, and a destroyed one goes quiet (ShipTurrets).
 */
function addMountSubsystems(dmg: DamageState, model: ShipModel, hullMax: number): void {
  const len = Math.max(model.length, 1);
  model.root.updateMatrixWorld(true);
  _inv.copy(model.root.matrixWorld).invert();
  const counts: Partial<Record<SubsystemKind, number>> = {};
  const kinds: Record<string, SubsystemKind> = { turret: 'turret', beam: 'lance', hangar: 'hangar' };
  for (const [sid, o] of model.sockets) {
    const kind = kinds[o.userData.kind as string];
    if (!kind) continue;
    const t = SUBSYSTEM_TUNING[kind];
    const n = (counts[kind] = (counts[kind] ?? 0) + 1);
    mountCentre(model, sid, _v.setFromMatrixPosition(_m.multiplyMatrices(_inv, o.matrixWorld)));
    addSubsystem(dmg, { id: sid, kind, label: `${t.label} ${n}`, x: _v.x, y: _v.y, z: _v.z, radius: Math.max(t.radius * len * 1.6, 2.5), hpMax: Math.max(40, hullMax * t.hp) });
  }
}

export function combatOf(s: ShipEntity): CombatState {
  return s.combat;
}

export function gunOf(s: ShipEntity): GunSpec | null {
  const g = s.combat.loadout.guns;
  return g.length ? GUNS[g[s.combat.gun % g.length]] : null;
}

export function missileOf(s: ShipEntity): MissileSpec | null {
  const lo = s.combat.loadout;
  const m = lo.missiles;
  if (!m.length) return null;
  const i = s.combat.missile % m.length;
  return lo.missileSpecs?.[i] ?? MISSILES[m[i]];
}

/** Bolt speed the AI and HUD should lead for (beams hit instantly). */
export function leadSpeedOf(s: ShipEntity): number {
  const g = gunOf(s);
  if (!g) return 1600;
  return g.beam ? 3000 : g.speed;
}

/** Effective reach of the selected gun (m). */
export function gunRange(g: GunSpec): number {
  return g.beam ? g.beam.length : g.speed * g.life;
}

/** Average damage per second of a gun against a layer, all hits. */
export function gunDps(g: GunSpec, layer: 'shield' | 'hull'): number {
  const raw = g.beam ? (g.beam.dps * g.beam.duration) * g.rate : g.rate * g.damage * g.pellets;
  return raw * DAMAGE_MUL[g.type][layer];
}

/** Best gun for the AI: highest effective dps on the layer that's up, within range. */
export function chooseGun(s: ShipEntity, target: ShipEntity | null): void {
  const guns = s.combat.loadout.guns;
  if (guns.length < 2 || !target) return;
  const dist = target.flight.position.distanceTo(s.flight.position);
  // The facing between us and the hull is what matters (a fighter's aft half when we're on its six).
  // Keep stripping until it is really down: a live facing gets charge shunted into it.
  const st = target.combat.dmg;
  const up = st.facings.length ? facingUp(st, facingOf(st, toLocal(target, s.flight.position, _v)), 0.005) : false;
  const layer = up ? 'shield' : 'hull';
  let best = s.combat.gun;
  let bs = -1;
  for (let i = 0; i < guns.length; i++) {
    const g = GUNS[guns[i]];
    const inRange = dist < gunRange(g) * 0.95;
    const score = gunDps(g, layer) * (inRange ? 1 : 0.2) * (g.pellets > 1 ? Math.min(1, 500 / Math.max(dist, 1)) : 1);
    if (score > bs) {
      bs = score;
      best = i;
    }
  }
  s.combat.gun = best;
}

// ── per-frame ─────────────────────────────────────────────────────────

/**
 * Before flight: regenerate shields, sync external hull/shield writes
 * (respawns set hull = hullMax), and push damage effects into the ship's
 * flight spec and controls.
 */
export function stepCombat(s: ShipEntity, dt: number): void {
  const c = s.combat;
  const st = c.dmg;
  if (c.damaged && s.hull >= s.hullMax) {
    resetDamage(st, s);
    c.damaged = false;
  }
  // A scene resized or refilled / drained the pools directly: carry it into the facings.
  if (Math.abs(s.shieldMax - st.facingMax * st.facings.length) > 1e-6 * Math.max(1, s.shieldMax)) setShieldCapacity(st, s, s.shieldMax);
  adoptShield(st, s);
  // Shield power: AI ships (and the player on autopilot) trim toward incoming fire; the player trims by hand or AUTO.
  stepShieldPower(st, s, dt, !s.isPlayer || (s.brain as { autopilot?: boolean } | null)?.autopilot === true);
  regenShields(st, s, s.sinceHit, dt);
  if (st.subsystems.length) repairSubsystems(st, s.sinceHit, dt);
  if (st.tether > 0) st.tether = Math.max(0, st.tether - dt);
  if (c.missileReload > 0) c.missileReload = Math.max(0, c.missileReload - dt);

  const spec = s.flight.spec;
  const base = c.baseSpec;
  if (st.capital) {
    capitalEffects(st, c.cap);
    return;
  }
  const fx = fighterEffects(st, s.hull / s.hullMax, c.fx);
  spec.mainAccel = base.mainAccel * fx.thrustMul;
  spec.boostAccel = base.boostAccel * fx.thrustMul;
  spec.maxSpeed = base.maxSpeed * fx.speedMul;
  spec.boostSpeed = base.boostSpeed * fx.speedMul;
  if (fx.noBoost) s.controls.afterburner = false;
  if (fx.rollDrift !== 0) s.controls.roll = Math.max(-1, Math.min(1, s.controls.roll + fx.rollDrift));
}

// ── hits ──────────────────────────────────────────────────────────────

export interface ShipRayHit {
  /** Segment parameter 0..1. */
  t: number;
  /** Universe impact point and world normal. */
  point: Vector3;
  normal: Vector3;
  /** Ship-local impact point. */
  local: Vector3;
  /** Hit the shield shell (capitals) / an up bubble (fighters). */
  onShield: boolean;
  /** Aimed hit: the segment entered this intact subsystem's hit sphere (Subsystems.AIM_SPHERE) before the plating. */
  sub: Subsystem | null;
}

export function createRayHit(): ShipRayHit {
  return { t: 2, point: new Vector3(), normal: new Vector3(), local: new Vector3(), onShield: false, sub: null };
}

const _lo = new Vector3();
const _ld = new Vector3();
const _gh: GridHit = { t: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Swept segment a → a + d (universe) against a ship: its shield bubble or
 * shell, else (capitals) the voxel hull. Where the shield is down, each
 * intact subsystem's aimed-hit sphere is tested before the plating
 * (Subsystems.segmentSubsystem): a hit sets `out.sub` so the damage routes to
 * that mount. `pad` fattens the target (beams). Writes `out` and returns
 * true on a hit.
 */
export function raycastShip(s: ShipEntity, a: Vector3, d: Vector3, pad: number, out: ShipRayHit): boolean {
  const c = s.combat;
  const f = s.flight;
  out.sub = null;
  if (!c.dmg.capital || !c.grid) {
    const t = segmentSphere(a, d, f.position, s.radius + pad);
    if (t > 1) return false;
    out.t = t;
    out.point.copy(a).addScaledVector(d, t);
    out.normal.subVectors(out.point, f.position).normalize();
    toLocal(s, out.point, out.local);
    const st = c.dmg;
    out.onShield = st.facings.length > 0 && st.facings[facingOf(st, out.local)] > 0;
    if (!out.onShield && st.subsystems.length) {
      // Through a down facing: mounts sit inside the bounding sphere, so look along the whole chord this step.
      _lo.copy(out.local);
      const dl = Math.max(d.length(), 1e-6);
      _ld.copy(d).applyQuaternion(_q.copy(f.orientation).invert()).multiplyScalar((dl + 2 * (s.radius + pad)) / dl);
      const sub = segmentSubsystem(st.subsystems, _lo.x, _lo.y, _lo.z, _ld.x, _ld.y, _ld.z, pad, 1, _sh);
      if (sub) {
        out.local.copy(_lo).addScaledVector(_ld, _sh.c);
        toUniverse(s, out.local.x, out.local.y, out.local.z, out.point);
        subNormal(s, sub, out);
        out.sub = sub;
      }
    }
    return true;
  }
  // Broad phase: full bounding sphere.
  if (segmentSphere(a, d, f.position, s.model.radius + pad) > 1) return false;
  _q.copy(f.orientation).invert();
  _lo.subVectors(a, f.position).applyQuaternion(_q);
  _ld.copy(d).applyQuaternion(_q);
  const st = c.dmg;
  // Shield shell: an ellipsoid; the facing under the entry point decides whether it holds.
  const sx = c.shell.x + pad;
  const sy = c.shell.y + pad;
  const sz = c.shell.z + pad;
  const ox = (_lo.x - st.cx) / sx;
  const oy = (_lo.y - st.cy) / sy;
  const oz = (_lo.z - st.cz) / sz;
  const inside = ox * ox + oy * oy + oz * oz < 1;
  if (!inside && s.shield > 0) {
    _v.set(ox, oy, oz);
    _w.set(_ld.x / sx, _ld.y / sy, _ld.z / sz);
    const t = segmentSphere(_v, _w, ORIGIN, 1);
    if (t <= 1) {
      const lx = _lo.x + _ld.x * t;
      const lz = _lo.z + _ld.z * t;
      out.local.set(lx, _lo.y + _ld.y * t, lz);
      if (st.facings[facingOf(st, out.local)] > 0) {
        out.t = t;
        out.point.copy(a).addScaledVector(d, t);
        // Ellipsoid normal: gradient of the implicit surface.
        out.normal.set((lx - st.cx) / (sx * sx), (out.local.y - st.cy) / (sy * sy), (lz - st.cz) / (sz * sz)).normalize().applyQuaternion(f.orientation);
        out.onShield = true;
        return true;
      }
    }
  }
  const onGrid = raycastGrid(c.grid, _lo.x, _lo.y, _lo.z, _ld.x, _ld.y, _ld.z, _gh);
  const tg = onGrid ? _gh.t : 1;
  // Aimed hits: a mount's hit sphere stands proud of the plating, so a shot at a
  // small turret on a big hull lands on it rather than skipping past to the hull.
  const sub = st.subsystems.length ? segmentSubsystem(st.subsystems, _lo.x, _lo.y, _lo.z, _ld.x, _ld.y, _ld.z, pad, tg, _sh) : null;
  if (sub) {
    // Report the closest pass to the mount (never beyond the plating) so impacts read on the turret, not in the air.
    const t = _sh.c;
    out.t = t;
    out.local.copy(_lo).addScaledVector(_ld, t);
    out.point.copy(a).addScaledVector(d, t);
    subNormal(s, sub, out);
    out.onShield = false;
    out.sub = sub;
    return true;
  }
  if (!onGrid) return false;
  out.t = _gh.t;
  out.local.copy(_lo).addScaledVector(_ld, _gh.t);
  out.point.copy(a).addScaledVector(d, _gh.t);
  out.normal.set(_gh.nx, _gh.ny, _gh.nz).applyQuaternion(f.orientation);
  out.onShield = false;
  return true;
}

const ORIGIN = new Vector3();

const _sh: SegmentSubHit = { t: 0, c: 0 };

/** World normal for an aimed hit: out of the mount through the impact point. */
function subNormal(s: ShipEntity, sub: Subsystem, out: ShipRayHit): void {
  out.normal.set(out.local.x - sub.x, out.local.y - sub.y, out.local.z - sub.z);
  if (out.normal.lengthSq() < 1e-9) out.normal.set(out.local.x - s.combat.dmg.cx, out.local.y - s.combat.dmg.cy, out.local.z - s.combat.dmg.cz);
  out.normal.normalize().applyQuaternion(s.flight.orientation);
}

export function toLocal(s: ShipEntity, universe: Vector3, out: Vector3): Vector3 {
  return out.subVectors(universe, s.flight.position).applyQuaternion(_q.copy(s.flight.orientation).invert());
}

export function toUniverse(s: ShipEntity, x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, y, z).applyQuaternion(s.flight.orientation).add(s.flight.position);
}

export function subsystemPosition(s: ShipEntity, sub: Subsystem, out: Vector3): Vector3 {
  return toUniverse(s, sub.x, sub.y, sub.z, out);
}

/** The shooter's selected subsystem on `target`, if still intact. */
export function selectedSubsystem(shooter: ShipEntity, target: ShipEntity | null): Subsystem | null {
  if (!target) return null;
  const c = shooter.combat;
  if (c.subShip !== target.id) return null;
  const i = c.subTarget;
  const subs = target.combat.dmg.subsystems;
  return i >= 0 && i < subs.length && !subs[i].destroyed ? subs[i] : null;
}

/** Select subsystem `index` (−1 = none) on `target` for the shooter. */
export function selectSubsystem(shooter: ShipEntity, target: ShipEntity | null, index: number): void {
  const c = shooter.combat;
  c.subTarget = target ? index : -1;
  c.subShip = target && index >= 0 ? target.id : 0;
}

/** Is this subsystem of `s` exposed — the shield over it down (Subsystems.subsystemExposed)? */
export function isExposed(s: ShipEntity, sub: Subsystem): boolean {
  return subsystemExposed(s.combat.dmg, s.shield, sub);
}

/**
 * Cycle the shooter's subsystem selection on its target (B forward, Shift+B
 * back): exposed mounts first, then protected ones; past either end → none.
 */
export function cycleSubsystem(shooter: ShipEntity, dir: 1 | -1 = 1): void {
  const t = shooter.target;
  if (!t || !t.combat.dmg.subsystems.length) {
    selectSubsystem(shooter, null, -1);
    return;
  }
  const cur = shooter.combat.subShip === t.id ? shooter.combat.subTarget : -1;
  selectSubsystem(shooter, t, nextSubsystem(t.combat.dmg, t.shield, cur, dir));
}

/** Crosshair pick (I / middle mouse) reaches this far off the nose (rad). */
export const SUB_PICK_CONE = 0.2;

/**
 * Select the target's subsystem nearest the shooter's crosshair (its nose
 * line), exposed ones preferred; keeps the current pick if nothing is within
 * SUB_PICK_CONE. Returns whether the selection changed.
 */
export function pickSubsystemAtCrosshair(shooter: ShipEntity): boolean {
  const t = shooter.target;
  if (!t || !t.combat.dmg.subsystems.length) return false;
  toLocal(t, shooter.flight.position, _v);
  shooter.flight.forward(_w).applyQuaternion(_q.copy(t.flight.orientation).invert());
  const i = subsystemNearestRay(t.combat.dmg, t.shield, _v.x, _v.y, _v.z, _w.x, _w.y, _w.z, SUB_PICK_CONE);
  if (i < 0 || (shooter.combat.subShip === t.id && shooter.combat.subTarget === i)) return false;
  selectSubsystem(shooter, t, i);
  return true;
}

const _hit = createHitResult();

/**
 * Damage a ship. `point` (universe) routes the hit to a facing / subsystem /
 * zone; null spreads it generically. `sub` = an aimed hit's subsystem (raycastShip). Handles plot armour and death. The
 * returned result is shared scratch — read it before the next call.
 */
export function damageShip(s: ShipEntity, amount: number, type: DamageType, point: Vector3 | null, sub: Subsystem | null = null): HitResult & { killed: boolean } {
  const r = _hit as HitResult & { killed: boolean };
  r.killed = false;
  if (!s.alive) {
    r.shielded = false;
    r.hullDamage = r.shieldDamage = 0;
    r.subsystem = null;
    r.subsystemDestroyed = r.facingCollapsed = false;
    r.strength = -1;
    r.bleed = r.splash = 0;
    return r;
  }
  s.sinceHit = 0;
  const local = point ? toLocal(s, point, _lo) : null;
  applyHit(s.combat.dmg, s, { amount, type, local, sub }, r);
  if (r.hullDamage > 0 || r.subsystem) s.combat.damaged = true;
  if (s.plotArmour) s.hull = Math.max(s.hull, s.hullMax * 0.15);
  if (s.hull <= 0) {
    s.hull = 0;
    s.alive = false;
    s.model.root.visible = false;
    r.killed = true;
  }
  return r;
}

/**
 * Earliest t in [0,1] where segment p + t·d enters the sphere, or 2 if none.
 * (Starting inside counts as t = 0.)
 */
export function segmentSphere(p: Vector3, d: Vector3, c: Vector3, r: number): number {
  const mx = p.x - c.x;
  const my = p.y - c.y;
  const mz = p.z - c.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return 0;
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const bb = mx * d.x + my * d.y + mz * d.z;
  if (bb > 0 || a < 1e-12) return 2;
  const disc = bb * bb - a * cc;
  if (disc < 0) return 2;
  const t = (-bb - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : 2;
}
