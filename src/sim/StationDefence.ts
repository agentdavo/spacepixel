import { Quaternion, Vector3 } from 'three';
import type { FactionId } from '../assets/Blueprint';
import type { ShipModel } from '../assets/ShipBuilder';
import { hostile, type Fleet, type InstallationHit, type Installations, type ShipEntity, type Team } from './Fleet';
import type { Weapons } from './Weapons';
import { DEFAULT_LOADOUT, GUNS, SUBSYSTEM_TUNING, type DamageType, type GunId, type GunSpec } from './Loadouts';
import { addSubsystem, applyHit, createDamageState, createHitResult, facingOf, regenShields, stepShieldPower, type DamageState, type Pools, type Subsystem } from './Damage';
import { repairSubsystems, segmentSubsystem, type SegmentSubHit } from './Subsystems';
import { createTurretSolution, turretAim, turretSelectTarget, TURRET_DEFAULTS, type TurretMount, type TurretSolution } from './ai/Turret';
import { createDrive, gateTolerance, mountFromRig, nextMuzzle, restoreDrive, rigFromInfo, stepDrive, wreckDrive, type TurretDrive, type TurretRig } from './TurretRig';
import type { Rng } from './Rng';
import type { StateHasher } from './StateHash';

/**
 * Station batteries: the gun mounts on a station's hull (the bastion's
 * armour-box turrets) as real sim turrets, on the same machinery as a
 * capital's (Capitals.ts):
 *
 *   rig        TurretRig from the built model (traverse / elevation joints,
 *              barrel muzzles, arcs); the drive trains at the mount's slew
 *              rate, holds fire until the barrels are on the solution
 *              (gateTolerance) and never shoots outside its arcs.
 *   targeting  ai/Turret's lead solver and target pick (turretSelectTarget:
 *              the one hostility rule, fighters before capitals), filtered by
 *              the station's rules of engagement (below).
 *   subsystems every battery is a Damage.ts 'turret' subsystem in the
 *              station's own DamageState: six shield facings round the
 *              station (Damage.facingOf), exposure by facing
 *              (Subsystems.subsystemExposed), aimed-hit spheres
 *              (segmentSubsystem), wreck styles, damage control
 *              (repairSubsystems brings a destroyed battery back).
 *   hits       registered on the fleet as `Installations`: Weapons tests
 *              every bolt against the station's shield shell and, once the
 *              facing over a battery is down, the battery's hit sphere.
 *
 * Stations are never destroyed (the lead's StationDefence model): the hull
 * pool only absorbs; with every battery down the station is *silenced* (it
 * stops shooting) until damage control restores a mount.
 *
 * Rules of engagement:
 *   'free'        every hostile in arc and range (missions, headless tests).
 *   'defensive'   (free flight) a station doesn't start fights: it engages
 *                 hostiles that have fired on it (for AGGRO_MEMORY s) or that
 *                 are attacking a ship of its own side. So a Choir bastion on
 *                 the Treaty Line lets a Concord pilot dock — until they open
 *                 fire under its guns.
 *
 * Pure sim: plain arithmetic on the station's fixed pose, no scene graph
 * (StationView poses the model's joints from `batteries[i].drive`).
 */

export type StationRoe = 'free' | 'defensive';

/** A station's numbers (a notional hull: battery hp is SUBSYSTEM_TUNING.turret.hp × hull, as on a capital). */
export const STATION_DEFENCE = {
  hull: 60000,
  shield: 12000,
  shieldRegen: 0.03,
  shieldDelay: 8,
  facings: 6,
  /** Shield shell: the station's bounding sphere × this. */
  shell: 1.05,
  /** Battery hit sphere: the mount's base-ring radius × this (Subsystems.AIM_SPHERE scales it again). */
  mountRadius: 1.6,
} as const;

/** Seconds a station remembers who fired on it ('defensive' ROE). */
export const AGGRO_MEMORY = 90;
/** Seconds between target picks per battery (the current solution is tracked every step). */
const SCAN = 0.5;

export interface StationBattery {
  sub: Subsystem;
  rig: TurretRig;
  drive: TurretDrive;
  mount: TurretMount;
  sol: TurretSolution;
  scan: number;
  cooldown: number;
  burst: number;
  laid: boolean;
}

export interface StationDefence {
  /** Bolt owner id (negative: never a ship's). */
  readonly id: number;
  /** Station site id. */
  readonly key: string;
  readonly faction: FactionId;
  team: Team;
  roe: StationRoe;
  /** Universe pose (fixed: stations don't drift; the ring's spin carries no guns). */
  readonly position: Vector3;
  readonly orientation: Quaternion;
  /** Shield shell radius (m). */
  readonly shell: number;
  readonly dmg: DamageState;
  readonly pools: Pools;
  readonly batteries: StationBattery[];
  readonly gun: GunSpec;
  sinceHit: number;
  /** Ship id → seconds since it last hit the station. */
  readonly aggressors: Map<number, number>;
  readonly rng: Rng;
}

/** What `StationDefences.sync` needs from a station (StationView satisfies it). */
export interface StationInstallation {
  readonly site: { readonly id: string; readonly faction: FactionId };
  readonly model: ShipModel;
  readonly center: Vector3;
  readonly quaternion: Quaternion;
  /** Written by `sync`: the station's defence (null: unarmed). */
  defence: StationDefence | null;
}

export interface StationDefenceOptions {
  team?: Team;
  roe?: StationRoe;
  /** Turret gun (GUNS); default the faction's capital turret. */
  gun?: GunId;
}

/** Guns still in action, and whether the station has been silenced. */
export function stationGuns(d: StationDefence): { online: number; total: number; silenced: boolean } {
  let online = 0;
  for (const b of d.batteries) if (!b.sub.destroyed) online++;
  return { online, total: d.batteries.length, silenced: d.batteries.length > 0 && online === 0 };
}

/** Station-local position of a universe point. */
export function stationLocal(d: StationDefence, p: Vector3, out: Vector3): Vector3 {
  return out.subVectors(p, d.position).applyQuaternion(_qi.copy(d.orientation).invert());
}

/** Universe position of a battery's mount (explosion FX, HUD brackets). */
export function batteryWorldPosition(d: StationDefence, b: StationBattery, out: Vector3): Vector3 {
  return out.set(b.sub.x, b.sub.y, b.sub.z).applyQuaternion(d.orientation).add(d.position);
}

/** Fold a station's defence state into a world hash (determinism checks). */
export function hashStation(H: StateHasher, d: StationDefence): void {
  H.u32(d.id >>> 0).u32(d.rng.state).f64(d.pools.hull).f64(d.pools.shield).f64(d.sinceHit);
  for (const f of d.dmg.facings) H.f64(f);
  for (const b of d.batteries) H.f64(b.sub.hp).u32(b.sub.destroyed ? 1 : 0).f64(b.drive.yaw).f64(b.drive.pitch).f64(b.cooldown).u32(b.burst);
}

const ZERO = new Vector3();
const _qi = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _tp = new Vector3();
const _mz = new Vector3();
const _dl = new Vector3();
const _lo = new Vector3();
const _ld = new Vector3();
const _hit = createHitResult();
const _sh: SegmentSubHit = { t: 0, c: 0 };
const _mem: number[] = [];

/** Build the defence for a station model, or null when it carries no rigged guns. */
export function createStationDefence(id: number, key: string, faction: FactionId, model: ShipModel, position: Vector3, orientation: Quaternion, rng: Rng, opts: StationDefenceOptions = {}): StationDefence | null {
  if (!model.turrets.size) return null;
  const S = STATION_DEFENCE;
  const r = model.radius;
  const shell = r * S.shell;
  // A round shell: facings by the dominant axis from the station's centre.
  const dmg = createDamageState(true, S.shield, S.hull, { cx: 0, cy: 0, cz: 0, halfW: r, halfH: r, halfL: r }, S.shieldRegen, S.shieldDelay, S.facings);
  dmg.trimAuto = true;
  const pools: Pools = { hull: S.hull, hullMax: S.hull, shield: S.shield, shieldMax: S.shield };
  const gun = GUNS[opts.gun ?? DEFAULT_LOADOUT[faction].turret ?? 'flak'];
  const t = SUBSYSTEM_TUNING.turret;
  const batteries: StationBattery[] = [];
  for (const info of model.turrets.values()) {
    const rig = rigFromInfo(info);
    // The mount's centre on its turning axis (as a capital's: Combat.mountCentre).
    const lift = _w.subVectors(info.pivot, info.base).dot(info.up) * 0.8;
    _v.copy(info.base).addScaledVector(info.up, lift);
    const n = batteries.length + 1;
    const sub = addSubsystem(dmg, { id: info.socket, kind: 'turret', label: `BATTERY ${n}`, x: _v.x, y: _v.y, z: _v.z, radius: Math.max(info.radius * S.mountRadius, 2.5), hpMax: Math.max(40, S.hull * t.hp) });
    batteries.push({
      sub,
      rig,
      drive: createDrive(),
      mount: { ...TURRET_DEFAULTS, position: new Vector3(), forward: new Vector3(), up: new Vector3(), velocity: new Vector3(), boltSpeed: gun.speed, range: Math.min(2400, gun.speed * gun.life) },
      sol: createTurretSolution(),
      scan: (batteries.length % 5) * 0.05,
      cooldown: rng.next() * 2,
      burst: 0,
      laid: false,
    });
  }
  return {
    id,
    key,
    faction,
    team: opts.team ?? faction,
    roe: opts.roe ?? 'defensive',
    position: position.clone(),
    orientation: orientation.clone().normalize(),
    shell,
    dmg,
    pools,
    batteries,
    gun,
    sinceHit: 1e6,
    aggressors: new Map(),
    rng,
  };
}

/**
 * Every armed station in the current system: registers with the fleet as its
 * `installations` (bolts hit the shields and batteries), steps the batteries
 * after the capitals (FlightScene order: AI → capitals → stations → turrets).
 */
export class StationDefences implements Installations {
  readonly list: StationDefence[] = [];
  private byStation = new Map<object, StationDefence>();
  private nextId = 1;
  /** Candidate targets under the station's ROE (scratch). */
  private cands: ShipEntity[] = [];

  constructor(
    private fleet: Fleet,
    private weapons: Weapons,
  ) {
    fleet.installations = this;
  }

  /** Add one station's batteries (null: nothing to arm). */
  register(key: string, faction: FactionId, model: ShipModel, position: Vector3, orientation: Quaternion, opts: StationDefenceOptions = {}): StationDefence | null {
    const id = -this.nextId;
    const d = createStationDefence(id, key, faction, model, position, orientation, this.fleet.rng.fork(`station:${key}`), opts);
    if (!d) return null;
    this.nextId++;
    this.list.push(d);
    return d;
  }

  /**
   * Keep the list in step with the system's stations (called every tick;
   * cheap when nothing changed): arms new ones in list order, drops the ones
   * that left (a jump, an outpost torn down). Writes `st.defence`.
   */
  sync(stations: readonly StationInstallation[], opts: (st: StationInstallation) => StationDefenceOptions = () => ({})): void {
    let changed = stations.length !== this.byStation.size;
    if (!changed) for (const st of stations) if (!this.byStation.has(st)) changed = true;
    if (!changed) return;
    const keep = new Map<object, StationDefence>();
    for (const st of stations) {
      let d = this.byStation.get(st);
      if (d === undefined) {
        d = this.register(st.site.id, st.site.faction, st.model, st.center, st.quaternion, opts(st)) ?? undefined;
        // (Unarmed stations are remembered too, so they aren't re-checked every tick.)
        keep.set(st, d ?? NONE);
      } else keep.set(st, d);
      const got = keep.get(st)!;
      st.defence = got === NONE ? null : got;
    }
    this.byStation = keep;
    const live = new Set(keep.values());
    for (let i = this.list.length - 1; i >= 0; i--) if (!live.has(this.list[i])) this.list.splice(i, 1);
  }

  clear(): void {
    this.list.length = 0;
    this.byStation.clear();
  }

  // ── fire control ─────────────────────────────────────────────────────

  /** Ships the station may engage under its ROE (hostility itself is turretSelectTarget's check). */
  private candidates(d: StationDefence): readonly ShipEntity[] {
    if (d.roe === 'free') return this.fleet.ships;
    const out = this.cands;
    out.length = 0;
    for (const s of this.fleet.ships) {
      if (!s.alive || !hostile(s, d)) continue;
      if (d.aggressors.has(s.id) || (s.target !== null && s.target.alive && s.target.team === d.team)) out.push(s);
    }
    return out;
  }

  step(dt: number): void {
    for (const d of this.list) {
      d.sinceHit += dt;
      // Forget old grudges (sorted keys: the map's order never feeds the sim).
      if (d.aggressors.size) {
        _mem.length = 0;
        for (const [id, t] of d.aggressors) {
          if (t + dt > AGGRO_MEMORY) _mem.push(id);
          else d.aggressors.set(id, t + dt);
        }
        for (const id of _mem) d.aggressors.delete(id);
      }
      // Shields and damage control: the ships' rules.
      stepShieldPower(d.dmg, d.pools, dt, true);
      regenShields(d.dmg, d.pools, d.sinceHit, dt);
      repairSubsystems(d.dmg, d.sinceHit, dt);

      const ships = this.candidates(d);
      _qi.copy(d.orientation).invert();
      const gun = d.gun;
      const burst = gun.burst ?? { count: 3, gap: 0.09, interval: 1.6, scatter: 0.03 };
      for (const b of d.batteries) {
        const dr = b.drive;
        if (b.sub.destroyed) {
          if (!dr.wrecked) wreckDrive(b.rig, dr);
          b.laid = false;
          continue;
        }
        if (dr.wrecked) restoreDrive(dr);
        b.cooldown -= dt;
        b.scan -= dt;
        const m = b.mount;
        mountFromRig(b.rig, m, d.position, d.orientation, ZERO);
        // Track the lay every step; re-pick when ready to fire, every SCAN s when idle, now when the lay is lost.
        const cur = b.sol.target;
        let aimed = b.laid && !!cur && cur.alive && hostile(cur, d) && ships.includes(cur) && turretAim(m, cur, b.sol);
        if (aimed ? b.cooldown <= 0 && b.scan <= 0 : b.scan <= 0 || b.laid) {
          aimed = turretSelectTarget(m, d.team, ships, aimed ? cur : null, b.sol);
          b.scan = SCAN;
        }
        b.laid = aimed;
        const err = stepDrive(b.rig, dr, aimed ? _dl.copy(b.sol.aimDir).applyQuaternion(_qi) : null, dt);
        if (!aimed || b.cooldown > 0 || !b.sol.target) continue;
        // Fire gate: only with the barrels on the solution.
        if (err > gateTolerance(b.sol.target.radius, b.sol.distance)) continue;
        nextMuzzle(b.rig, dr, _mz).applyQuaternion(d.orientation).add(d.position);
        _tp.subVectors(b.sol.aimPoint, _mz).normalize();
        for (let k = 0; k < gun.pellets; k++) {
          _v.copy(_tp)
            .add(_w.set(d.rng.centered(), d.rng.centered(), d.rng.centered()).multiplyScalar(burst.scatter + gun.spread))
            .normalize()
            .multiplyScalar(gun.speed);
          this.weapons.spawnBolt(_mz, _v, gun.life, gun.damage, d, gun);
        }
        this.weapons.muzzleFlash(_mz, _tp, ZERO, null, gun);
        b.burst++;
        if (b.burst >= burst.count) {
          b.burst = 0;
          b.cooldown = burst.interval * (0.8 + d.rng.next() * 0.4);
        } else b.cooldown = burst.gap;
      }
    }
  }

  // ── hits (Installations) ─────────────────────────────────────────────

  /**
   * A bolt a → a + d (universe) fired by `team` (ship `owner`): the station's
   * shield shell where it enters and the facing there holds; inside the shell
   * (or through a down facing), a battery's aimed-hit sphere. Only hits
   * nearer than `maxT` count (a ship in the way takes it). Applies the hit
   * with Damage.applyHit and fills `out`.
   */
  shoot(a: Vector3, dv: Vector3, team: Team, owner: number, amount: number, type: DamageType, maxT: number, out: InstallationHit): boolean {
    let best: StationDefence | null = null;
    let bt = maxT;
    let bSub: Subsystem | null = null;
    let bShell = false;
    for (const d of this.list) {
      if (team === d.team) continue;
      // Broad phase: the shell sphere.
      const t0 = sphereEntry(a, dv, d.position, d.shell);
      if (t0 > 1) continue;
      _qi.copy(d.orientation).invert();
      _lo.subVectors(a, d.position).applyQuaternion(_qi);
      _ld.copy(dv).applyQuaternion(_qi);
      const inside = _lo.lengthSq() < d.shell * d.shell;
      if (!inside && t0 < bt && d.pools.shield > 0) {
        _v.copy(_lo).addScaledVector(_ld, t0);
        if (d.dmg.facings[facingOf(d.dmg, _v)] > 0) {
          best = d;
          bt = t0;
          bSub = null;
          bShell = true;
          continue;
        }
      }
      const sub = segmentSubsystem(d.dmg.subsystems, _lo.x, _lo.y, _lo.z, _ld.x, _ld.y, _ld.z, 0, 1, _sh);
      if (sub && _sh.t < bt) {
        best = d;
        bt = _sh.c;
        bSub = sub;
        bShell = false;
      }
    }
    if (!best) return false;
    const d = best;
    _qi.copy(d.orientation).invert();
    _lo.subVectors(a, d.position).applyQuaternion(_qi);
    _ld.copy(dv).applyQuaternion(_qi);
    _v.copy(_lo).addScaledVector(_ld, bt);
    applyHit(d.dmg, d.pools, { amount, type, local: _v, sub: bSub }, _hit);
    // Never destroyed: the hull pool only absorbs.
    d.pools.hull = Math.max(1, d.pools.hull);
    d.sinceHit = 0;
    if (hostile({ team }, d) && owner > 0) d.aggressors.set(owner, 0);
    out.station = d;
    out.point.copy(_v).applyQuaternion(d.orientation).add(d.position);
    if (bShell || !bSub) out.normal.copy(_v);
    else out.normal.set(_v.x - bSub.x, _v.y - bSub.y, _v.z - bSub.z);
    if (out.normal.lengthSq() < 1e-9) out.normal.copy(_v);
    out.normal.normalize().applyQuaternion(d.orientation);
    out.shielded = _hit.shielded;
    out.facing = _hit.facing;
    out.strength = _hit.strength;
    out.bleed = _hit.bleed;
    out.sub = _hit.subsystem;
    out.destroyed = _hit.subsystemDestroyed;
    return true;
  }
}

/** Unarmed-station marker in `byStation`. */
const NONE = {} as StationDefence;

/** Earliest t in [0, 1] where a + t·d enters the sphere (0 when it starts inside), or 2. */
function sphereEntry(a: Vector3, d: Vector3, c: Vector3, r: number): number {
  const mx = a.x - c.x;
  const my = a.y - c.y;
  const mz = a.z - c.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return 0;
  const aa = d.x * d.x + d.y * d.y + d.z * d.z;
  const bb = mx * d.x + my * d.y + mz * d.z;
  if (bb > 0 || aa < 1e-12) return 2;
  const disc = bb * bb - aa * cc;
  if (disc < 0) return 2;
  const t = (-bb - Math.sqrt(disc)) / aa;
  return t >= 0 && t <= 1 ? t : 2;
}
