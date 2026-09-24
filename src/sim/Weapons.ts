import { Vector3 } from 'three';
import type { Fleet, HitEventKind, ShipEntity, Team } from './Fleet';
import type { FactionId } from '@/assets/Blueprint';
import { GUNS, GUN_INDEX, GUN_LIST, type DamageType, type GunSpec } from './Loadouts';
import type { Subsystem } from './Damage';
import { chooseGun, createRayHit, cycleSubsystem, gunOf, pickSubsystemAtCrosshair, raycastShip } from './Combat';
import type { Rng } from './Rng';

export type { GunSpec } from './Loadouts';
export { segmentSphere } from './Combat';

/**
 * Milestone 10 — weapons simulation (no rendering here).
 *
 * Bolts: fixed pool of projectiles in flat Float64Arrays (universe space).
 * Each step they move and are tested as swept segments against every enemy:
 * fighters are spheres (their shield bubble), capitals are a shield shell
 * (four facings) around a voxel hull (Combat.raycastShip) so hits land on the
 * plating and route to the subsystem under them. Heavy torpedoes in the way
 * can be shot down.
 *
 * Guns come from the ship's loadout (Loadouts.ts): lasers, autocannon, the
 * Choir hymn pulse and beam-lance, the Rustwake scattergun. Damage types
 * scale against shields and hull (Damage.ts).
 *
 * Beams: continuous rays with a lifetime and damage-per-second (capital
 * lances, fighter beam-lances), hit-tested the same way each step.
 *
 * Results are pushed to `events` for FX, HUD and cameras to consume and
 * clear each frame. One array, read by whoever cares — no callbacks.
 */
export const BOLT_CAPACITY = 4096;

export type WeaponEventKind = 'hit' | 'shield' | 'kill' | 'fire' | 'beam-hit' | HitEventKind | 'shield-up';

export interface WeaponEvent {
  kind: WeaponEventKind;
  position: Vector3;
  /** Surface normal at impact (points out of the ship). */
  normal: Vector3;
  velocity: Vector3;
  ship: ShipEntity | null;
  shooter: ShipEntity | null;
  /** Gun that fired / hit (fire, hit, shield); null for beams from capitals and hit consequences. */
  gun: GunSpec | null;
  /** Destroyed subsystem ('subsystem'); on 'hit' / 'beam-hit', the subsystem the hit struck (null = bare hull). */
  sub: Subsystem | null;
  /** `sub`'s hit points after the event, 0..1 (0 on 'subsystem'); −1 / absent = no subsystem involved. */
  subHp?: number;
  /** Capital shield facing (shield, shield-down, shield-up); −1 = fighter bubble / n/a. */
  facing: number;
}

export interface Beam {
  active: boolean;
  owner: ShipEntity;
  socket: string | null;
  origin: Vector3; // universe, updated each step from the owner
  dir: Vector3;
  length: number;
  width: number;
  life: number;
  maxLife: number;
  dps: number;
  type: DamageType;
  faction: FactionId;
  team: Team;
  /** Where the beam currently terminates (hit point or full length). */
  end: Vector3;
  /** Track this ship (sweeping lance) instead of firing along the owner's nose. */
  aimTarget: ShipEntity | null;
  /** Fired by a fighter gun (beam-lance). */
  gun: GunSpec | null;
  /** Ship-frame origin (a turret's emitter muzzle, kept current by its drive); overrides `socket`. */
  muzzle?: Vector3 | null;
}

const GUN_SOCKETS = ['gun', 'gun.L'];

/** The Directorate pulse laser (kept for callers that want "the" default gun). */
export const LASER: GunSpec = GUNS.laser;

const EVENT_POOL = 384;
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _c = new Vector3();
const _f = new Vector3();
const _s = new Vector3();
const _u = new Vector3();
const _hit = createRayHit();

export class Weapons {
  // Bolt pool (structure of arrays).
  readonly px = new Float64Array(BOLT_CAPACITY);
  readonly py = new Float64Array(BOLT_CAPACITY);
  readonly pz = new Float64Array(BOLT_CAPACITY);
  readonly vx = new Float32Array(BOLT_CAPACITY);
  readonly vy = new Float32Array(BOLT_CAPACITY);
  readonly vz = new Float32Array(BOLT_CAPACITY);
  readonly life = new Float32Array(BOLT_CAPACITY);
  readonly damage = new Float32Array(BOLT_CAPACITY);
  readonly faction = new Uint8Array(BOLT_CAPACITY); // index into FACTION_INDEX
  readonly team = new Uint8Array(BOLT_CAPACITY); // index into TEAM_INDEX (who it can hit)
  /** Index into GUN_LIST: damage type, visual style, sound. */
  readonly gun = new Uint8Array(BOLT_CAPACITY);
  readonly owner = new Int32Array(BOLT_CAPACITY);
  private head = 0;

  readonly beams: Beam[] = [];
  readonly events: WeaponEvent[] = [];
  private eventPool: WeaponEvent[] = [];
  /** Queued turret muzzle flashes (see `muzzleFlash`). */
  private flashes: WeaponEvent[] = [];
  private flashCount = 0;
  private cooldown = new Map<number, number>();
  private gunSide = new Map<number, number>();
  /** Gun spread / pellet dice: the world's 'weapons' stream (Rng.ts). */
  readonly rng: Rng;

  constructor(readonly fleet: Fleet) {
    this.rng = fleet.rng.fork('weapons');
    for (let i = 0; i < EVENT_POOL; i++) {
      this.eventPool.push({ kind: 'hit', position: new Vector3(), normal: new Vector3(), velocity: new Vector3(), ship: null, shooter: null, gun: null, sub: null, subHp: -1, facing: -1 });
    }
    for (let i = 0; i < 128; i++) {
      this.flashes.push({ kind: 'fire', position: new Vector3(), normal: new Vector3(), velocity: new Vector3(), ship: null, shooter: null, gun: null, sub: null, facing: -1 });
    }
    fleet.onEvent = (kind, ship, point, normal, shooter, sub, facing) => {
      const e = this.emit(kind, point, normal, ship.flight.velocity, ship, shooter);
      if (e) {
        e.sub = sub;
        e.subHp = sub ? sub.hp / sub.hpMax : -1;
        e.facing = facing;
      }
    };
  }

  private rand(): number {
    return this.rng.next();
  }

  private emit(kind: WeaponEventKind, pos: Vector3, normal: Vector3, vel: Vector3, ship: ShipEntity | null, shooter: ShipEntity | null, gun: GunSpec | null = null): WeaponEvent | null {
    if (this.events.length >= EVENT_POOL) return null;
    const e = this.eventPool[this.events.length];
    e.kind = kind;
    e.position.copy(pos);
    e.normal.copy(normal);
    e.velocity.copy(vel);
    e.ship = ship;
    e.shooter = shooter;
    e.gun = gun;
    e.sub = null;
    e.subHp = -1;
    e.facing = -1;
    this.events.push(e);
    return e;
  }

  /** Universe position of a named socket on a ship. */
  socketPosition(s: ShipEntity, socket: string, out: Vector3): Vector3 {
    const o = s.model.sockets.get(socket);
    if (!o) return out.copy(s.flight.position);
    // Direct children: local position. Nested (articulated) sockets: walk up to
    // the root composing each joint's own position / rotation / scale — never
    // `matrix`, which only the renderer refreshes (a sim read of it would
    // depend on when the last frame was drawn, and a headless shard has none).
    out.copy(o.position);
    for (let p = o.parent; p && p !== s.model.root; p = p.parent) out.multiply(p.scale).applyQuaternion(p.quaternion).add(p.position);
    return out.applyQuaternion(s.flight.orientation).add(s.flight.position);
  }

  /** Weapon-select edges (R guns · Y missiles · B / Shift+B / I subsystem) and the AI's gun choice. */
  private arms(s: ShipEntity): void {
    const c = s.controls;
    const cs = s.combat;
    if (c.cycleGun && cs.loadout.guns.length) cs.gun = (cs.gun + 1) % cs.loadout.guns.length;
    if (c.cycleMissile && cs.loadout.missiles.length) cs.missile = (cs.missile + 1) % cs.loadout.missiles.length;
    if (c.cycleSub) cycleSubsystem(s, 1);
    if (c.cycleSubBack) cycleSubsystem(s, -1);
    if (c.pickSub) pickSubsystemAtCrosshair(s);
    const auto = !s.isPlayer || (s.brain as { autopilot?: boolean } | null)?.autopilot === true;
    if (auto && !cs.dmg.capital) chooseGun(s, s.target);
  }

  /** Fire the ship's selected gun if its controls say so and it's off cooldown. */
  private fireGuns(s: ShipEntity, dt: number): void {
    const gun = gunOf(s);
    const cd = (this.cooldown.get(s.id) ?? 0) - dt;
    if (!gun || !s.controls.fire || cd > 0) {
      this.cooldown.set(s.id, Math.max(cd, 0));
      return;
    }
    // Outfitted ships name the sockets per gun (src/game/outfitting); else the classic twin mount.
    const lo = s.combat.loadout;
    const gi = lo.guns.length ? s.combat.gun % lo.guns.length : 0;
    const mul = lo.gunMul?.[gi] ?? 1;
    const rate = gun.rate * (lo.gunRate?.[gi] ?? 1);
    const sockets = (lo.gunSockets?.[gi] ?? GUN_SOCKETS).filter((n) => s.model.sockets.has(n));
    const side = (this.gunSide.get(s.id) ?? 0) + 1;
    this.gunSide.set(s.id, side);
    const name = sockets.length ? sockets[side % sockets.length] : null;
    if (name) this.socketPosition(s, name, _a);
    else _a.copy(s.flight.position);
    s.flight.forward(_f);
    if (gun.beam) {
      const sock = ['lance', 'harp'].find((n) => s.model.sockets.has(n)) ?? name;
      const b = this.fireBeam(s, sock, gun.beam.length, gun.beam.width, gun.beam.duration, gun.beam.dps * mul, gun.type);
      b.gun = gun;
      this.emit('fire', _a, _f, s.flight.velocity, null, s, gun);
      this.cooldown.set(s.id, Math.max(cd, 0) + 1 / rate);
      return;
    }
    const spread = gun.spread + s.combat.fx.gunSpread;
    for (let k = 0; k < gun.pellets; k++) {
      _u.copy(_f);
      if (spread > 0) {
        // Uniform-ish cone: two random perpendicular offsets.
        _s.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).cross(_f).normalize();
        _u.addScaledVector(_s, Math.tan(spread) * Math.sqrt(this.rand())).normalize();
      }
      _d.copy(_u).multiplyScalar(gun.speed * (gun.pellets > 1 ? 0.94 + this.rand() * 0.12 : 1)).add(s.flight.velocity);
      this.spawnBolt(_a, _d, gun.life, gun.damage * mul, s, gun);
    }
    this.emit('fire', _a, _f, _d, null, s, gun);
    this.cooldown.set(s.id, cd + 1 / rate);
  }

  /**
   * A 'fire' event (muzzle flash, gun sound, shot counters) for a shot a
   * turret system spawned itself: at the barrel muzzle, `dir` along the shot,
   * `vel` = the carrying ship's (the flash rides the barrel).
   */
  muzzleFlash(pos: Vector3, dir: Vector3, vel: Vector3, shooter: ShipEntity, gun: GunSpec): void {
    // Turret systems step before Weapons (which clears the event list): queue, emit on the next step.
    if (this.flashCount >= this.flashes.length) return;
    const e = this.flashes[this.flashCount++];
    e.position.copy(pos);
    e.normal.copy(dir).normalize();
    e.velocity.copy(vel);
    e.shooter = shooter;
    e.gun = gun;
  }

  spawnBolt(pos: Vector3, vel: Vector3, life: number, damage: number, owner: ShipEntity, gun: GunSpec = GUNS.laser): void {
    const i = this.head;
    this.head = (this.head + 1) % BOLT_CAPACITY;
    this.px[i] = pos.x;
    this.py[i] = pos.y;
    this.pz[i] = pos.z;
    this.vx[i] = vel.x;
    this.vy[i] = vel.y;
    this.vz[i] = vel.z;
    this.life[i] = life;
    this.damage[i] = damage;
    this.faction[i] = FACTION_INDEX[owner.faction];
    this.team[i] = TEAM_INDEX[owner.team];
    this.gun[i] = GUN_INDEX[gun.id];
    this.owner[i] = owner.id;
  }

  fireBeam(owner: ShipEntity, socket: string | null, length: number, width: number, duration: number, dps: number, type: DamageType = 'harmonic'): Beam {
    let b = this.beams.find((x) => !x.active);
    if (!b) {
      b = { active: false, owner, socket, origin: new Vector3(), dir: new Vector3(), length, width, life: 0, maxLife: duration, dps, type, faction: owner.faction, team: owner.team, end: new Vector3(), aimTarget: null, gun: null, muzzle: null };
      this.beams.push(b);
    }
    Object.assign(b, { active: true, owner, socket, length, width, life: duration, maxLife: duration, dps, type, faction: owner.faction, team: owner.team, aimTarget: null, gun: null, muzzle: null });
    // Place it now so a beam fired this frame draws from the right spot.
    if (socket) this.socketPosition(owner, socket, b.origin);
    else b.origin.copy(owner.flight.position);
    owner.flight.forward(b.dir);
    b.end.copy(b.origin);
    return b;
  }

  step(dt: number): void {
    this.events.length = 0;
    const ships = this.fleet.ships;
    for (let i = 0; i < this.flashCount; i++) {
      const q = this.flashes[i];
      this.emit('fire', q.position, q.normal, q.velocity, null, q.shooter, q.gun);
      q.shooter = null;
    }
    this.flashCount = 0;

    for (const s of ships) {
      if (!s.alive) continue;
      this.arms(s);
      this.fireGuns(s, dt);
      // Shield regeneration shimmer (flags set by the damage model during Fleet.step).
      const st = s.combat.dmg;
      if (st.regenStarted) {
        for (let f = 0; f < Math.max(1, st.facings.length); f++) {
          if (!(st.regenStarted & (1 << f))) continue;
          const e = this.emit('shield-up', s.flight.position, _c.set(0, 1, 0), s.flight.velocity, s, null);
          if (e) e.facing = st.capital ? f : -1;
        }
        st.regenStarted = 0;
      }
      st.collapsed = 0;
    }

    // ── bolts ────────────────────────────────────────────────────────
    const ord = this.fleet.ordnance;
    for (let i = 0; i < BOLT_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      _a.set(this.px[i], this.py[i], this.pz[i]);
      _d.set(this.vx[i] * dt, this.vy[i] * dt, this.vz[i] * dt);
      const tm = this.team[i];
      let hitT = 2;
      let hitShip: ShipEntity | null = null;
      let hitSub: Subsystem | null = null;
      for (const s of ships) {
        // Bolts hit anyone not on the shooter's team (neutrals included — shooting them provokes them).
        if (!s.alive || TEAM_INDEX[s.team] === tm || s.id === this.owner[i]) continue;
        if (raycastShip(s, _a, _d, 0, _hit) && _hit.t < hitT) {
          hitT = _hit.t;
          hitShip = s;
          hitSub = _hit.sub;
          _b.copy(_hit.point);
          _c.copy(_hit.normal);
        }
      }
      const gun = GUN_LIST[this.gun[i]];
      if (hitShip) {
        _f.set(this.vx[i], this.vy[i], this.vz[i]);
        const shooter = ships.find((x) => x.id === this.owner[i]) ?? null;
        if (shooter) provoke(hitShip, shooter);
        const r = this.fleet.hit(hitShip, this.damage[i], gun.type, _b, _c, shooter, hitSub);
        const shielded = r.shielded;
        const e = this.emit(shielded ? 'shield' : 'hit', _b, _c, _f, hitShip, shooter, gun);
        if (e) {
          e.facing = r.facing;
          subOnEvent(e, r.subsystem);
        }
        // Explosive rounds splash the mounts around the burst (Subsystems.splashSubsystems).
        if (gun.blast && !shielded) this.fleet.blast(hitShip, _b, gun.blast, this.damage[i], gun.type, shooter, r.subsystem);
        this.life[i] = 0;
        continue;
      }
      if (ord && ord.shoot(_a.x, _a.y, _a.z, _d.x, _d.y, _d.z, TEAM_LIST[tm], this.damage[i])) {
        this.life[i] = 0;
        continue;
      }
      this.px[i] += _d.x;
      this.py[i] += _d.y;
      this.pz[i] += _d.z;
    }

    // ── beams ────────────────────────────────────────────────────────
    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0 || !b.owner.alive) {
        b.active = false;
        continue;
      }
      if (b.muzzle) b.origin.copy(b.muzzle).applyQuaternion(b.owner.flight.orientation).add(b.owner.flight.position);
      else if (b.socket) this.socketPosition(b.owner, b.socket, b.origin);
      else b.origin.copy(b.owner.flight.position);
      if (b.aimTarget?.alive) {
        // Sweep toward the target at a limited angular rate (dodgeable).
        _f.subVectors(b.aimTarget.flight.position, b.origin).normalize();
        if (b.life > b.maxLife - dt * 1.5) b.dir.copy(_f).add(_c.set(0.08, 0.05, 0)).normalize();
        else b.dir.lerp(_f, 1 - Math.exp(-2.2 * dt)).normalize();
      } else b.owner.flight.forward(b.dir);
      _d.copy(b.dir).multiplyScalar(b.length);
      let hitT = 1;
      let hitShip: ShipEntity | null = null;
      let hitSub: Subsystem | null = null;
      for (const s of ships) {
        if (!s.alive || s.team === b.team || s === b.owner) continue;
        if (raycastShip(s, b.origin, _d, b.width * 0.5, _hit) && _hit.t < hitT) {
          hitT = _hit.t;
          hitShip = s;
          hitSub = _hit.sub;
          _c.copy(_hit.normal);
        }
      }
      b.end.copy(b.origin).addScaledVector(_d, Math.min(hitT, 1));
      if (hitShip) {
        const r = this.fleet.hit(hitShip, b.dps * dt, b.type, b.end, _c, b.owner, hitSub);
        const e = this.emit(r.shielded ? 'shield' : 'beam-hit', b.end, _c, hitShip.flight.velocity, hitShip, b.owner, b.gun);
        if (e) {
          e.facing = r.facing;
          subOnEvent(e, r.subsystem);
          // Beam shield contact is continuous: only flash the ripple now and then.
          if (r.shielded && this.rand() > 0.12) e.kind = 'beam-hit';
        }
      }
    }
  }
}

/** A hit that struck a subsystem carries it and its remaining hp (for damage VFX, the HUD bracket flash). */
function subOnEvent(e: WeaponEvent, sub: Subsystem | null): void {
  if (!sub) return;
  e.sub = sub;
  e.subHp = sub.hp / sub.hpMax;
}

export const FACTION_INDEX: Record<FactionId, number> = { concord: 0, choir: 1, rustwake: 2 };
export const TEAM_INDEX: Record<Team, number> = { concord: 0, choir: 1, rustwake: 2, renegade: 3, neutral: 4 };
const TEAM_LIST: Team[] = ['concord', 'choir', 'rustwake', 'renegade', 'neutral'];

/** A neutral that gets shot turns on its attacker's side. */
export function provoke(victim: ShipEntity, attacker: ShipEntity): void {
  if (victim.team !== 'neutral' || attacker.team === 'neutral') return;
  victim.team = victim.faction !== attacker.team ? victim.faction : 'renegade';
}
