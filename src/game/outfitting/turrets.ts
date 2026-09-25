import { Quaternion, Vector3 } from 'three';
import { hostile, type Fleet, type ShipEntity } from '@/sim/Fleet';
import type { Weapons, Beam } from '@/sim/Weapons';
import type { Capitals } from '@/sim/Capitals';
import type { Rng } from '@/sim/Rng';
import { GUNS, type GunSpec, type Loadout, type MountSpec } from '@/sim/Loadouts';
import { createTurretSolution, issueOrder, leadPoint, turretAim, turretSelectTarget, TURRET_DEFAULTS, type TurretMount, type TurretSolution } from '@/sim/ai';
import { turretSelectThreat } from '@/sim/ai/Turret';
import { PD_TOL, createDrive, gateTolerance, mountFromRig, muzzleLocal, nextMuzzle, poseTurret, restoreDrive, rigFor, stepDrive, wreckDrive, type TurretDrive, type TurretRig } from '@/sim/TurretRig';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { computeFit, stockFit } from './fit';

/**
 * Fitted turrets, point defence and hangar complements for any ship that
 * isn't a Capitals-managed capital: the player's T3+ hulls and AI-flown
 * shipyard hulls (Bulwark, Bulldog, Knuckleduster …). Aiming reuses the
 * capital solver (src/sim/ai/Turret.ts: lead, traverse and elevation limits);
 * firing reuses Weapons (bolts, beams, bursts).
 *
 * Player turrets are *assisted*: they engage the selected target when it is
 * in their arc, else (FREE) the best hostile they can reach. U cycles
 * FREE → TARGET ONLY → HOLD.
 *
 * Mounts are physical (src/sim/TurretRig.ts, shared with Capitals): they
 * train and elevate at their size's slew rate within the arcs the hull
 * allows, fire only with the barrels on the solution, from each barrel's
 * muzzle in turn (beams from the emitter tip), idle home / scan, and freeze
 * wrecked while their subsystem is destroyed (capital-grade hulls).
 */
export type TurretMode = 'free' | 'target' | 'hold';

interface MountRt {
  spec: MountSpec;
  gun: GunSpec;
  socket: string;
  rig: TurretRig;
  drive: TurretDrive;
  /** Emitter muzzle, ship frame (beam mounts: the beam's origin rides it). */
  muzzle: Vector3;
  mount: TurretMount;
  sol: TurretSolution;
  cooldown: number;
  burst: number;
  beam: Beam | null;
  engaged: boolean;
}

interface ShipRt {
  loadout: Loadout;
  mounts: MountRt[];
  pd: number;
  pdCooldown: number;
}

interface HangarRt {
  crafts: string[];
  wing: ShipEntity[];
  cooldown: number;
}

const PD_RANGE = 1400;
const PD_GUNS = new Set(['flak', 'rustflak', 'flakcannon']);
const LAUNCH_RANGE = 6000;

const _qi = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _tp = new Vector3();
const _tv = new Vector3();
const _a = new Vector3();
const _mz = new Vector3();
const _dl = new Vector3();

export class ShipTurrets {
  /** The player's turret discipline (U). */
  mode: TurretMode = 'free';
  private rt = new Map<ShipEntity, ShipRt>();
  private hangars = new Map<ShipEntity, HangarRt>();
  /** The world's 'turrets' stream (src/sim/Rng.ts). */
  readonly rng: Rng;

  constructor(
    private fleet: Fleet,
    private weapons: Weapons,
    private capitals: Capitals | null = null,
  ) {
    this.rng = fleet.rng.fork('turrets');
  }

  private rand(): number {
    return this.rng.next();
  }

  cycleMode(): TurretMode {
    this.mode = this.mode === 'free' ? 'target' : this.mode === 'target' ? 'hold' : 'free';
    return this.mode;
  }

  /** HUD line for a ship's turrets, or null when it has none. */
  status(s: ShipEntity): { mounts: number; engaged: number; mode: TurretMode; pd: boolean } | null {
    const r = this.rt.get(s);
    if (!r || (!r.mounts.length && !r.pd)) return null;
    return { mounts: r.mounts.length, engaged: r.mounts.filter((m) => m.engaged).length, mode: s.isPlayer ? this.mode : 'free', pd: r.pd > 0 };
  }

  /** Crafts for a ship's hangar bays (player fits). */
  setHangar(s: ShipEntity, crafts: string[]): void {
    const h = this.hangars.get(s);
    if (h && h.crafts.join() === crafts.join()) return;
    this.recall(s);
    if (crafts.length) this.hangars.set(s, { crafts, wing: [], cooldown: 2 });
    else this.hangars.delete(s);
  }

  /** Docked: the complement lands (and is replaced). */
  recall(s: ShipEntity): void {
    const h = this.hangars.get(s);
    if (!h) return;
    for (const w of h.wing) {
      w.alive = false;
      w.model.root.visible = false;
      w.hull = w.hullMax;
    }
    h.cooldown = 2;
  }

  /** Complement launched / total, for the HUD. */
  hangarStatus(s: ShipEntity): { up: number; total: number } | null {
    const h = this.hangars.get(s);
    return h ? { up: h.wing.filter((w) => w.alive).length, total: h.crafts.length } : null;
  }

  /** Forget a ship (the player swapped hulls). */
  drop(s: ShipEntity): void {
    this.recall(s);
    this.rt.delete(s);
    this.hangars.delete(s);
  }

  private managed = new Set<ShipEntity>();

  private runtime(s: ShipEntity): ShipRt {
    let r = this.rt.get(s);
    if (r && r.loadout === s.combat.loadout) return r;
    let lo = s.combat.loadout;
    // AI-flown shipyard hulls: their catalogue turret mounts, stock fit.
    if (!s.isPlayer && !lo.mounts) {
      const e = CATALOG_BY_ID[s.model.blueprint.id];
      if (e && !e.legacy && e.hardpoints.turrets.length) {
        const mounts = computeFit(e, stockFit(e)).loadout.mounts;
        if (mounts) lo = s.combat.loadout = { ...lo, mounts };
      }
    }
    r = { loadout: lo, mounts: lo.mounts ? this.buildMounts(s, lo.mounts) : [], pd: lo.pd ?? 0, pdCooldown: 0 };
    this.rt.set(s, r);
    return r;
  }

  private buildMounts(s: ShipEntity, specs: MountSpec[]): MountRt[] {
    const out: MountRt[] = [];
    for (const sp of specs) {
      const gun = GUNS[sp.gun];
      for (const name of sp.mirror ? [sp.socket, `${sp.socket}.L`] : [sp.socket]) {
        const rig = rigFor(s.model, name);
        if (!rig) continue;
        const range = Math.min(gun.beam ? gun.beam.length : gun.speed * gun.life, 3200);
        const drive = createDrive();
        const muzzle = muzzleLocal(rig, 0, 0, 0, new Vector3());
        out.push({
          spec: sp,
          gun,
          socket: name,
          rig,
          drive,
          muzzle,
          mount: {
            ...TURRET_DEFAULTS,
            position: new Vector3(),
            forward: new Vector3(),
            up: new Vector3(),
            velocity: new Vector3(),
            boltSpeed: gun.beam ? 100_000 : gun.speed,
            range,
          },
          sol: createTurretSolution(),
          cooldown: this.rand() * 0.8,
          burst: 0,
          beam: null,
          engaged: false,
        });
      }
    }
    return out;
  }

  /**
   * Step every non-capital ship's mounts. `playerTarget` = the player's
   * selected target (assisted aim prefers it).
   */
  step(dt: number, playerTarget: ShipEntity | null): void {
    if (dt <= 0) return;
    this.managed.clear();
    if (this.capitals) for (const c of this.capitals.list) this.managed.add(c.ship);
    const ord = this.fleet.ordnance;
    for (const s of this.fleet.ships) {
      if (!s.alive || this.managed.has(s)) continue;
      const lo = s.combat.loadout;
      if (!lo.mounts && !lo.pd && s.isPlayer) continue;
      const r = this.runtime(s);
      if (r.mounts.length) this.stepMounts(s, r, dt, s.isPlayer ? playerTarget : s.target);
      if (r.pd > 0 && ord) {
        r.pdCooldown -= dt;
        if (r.pdCooldown <= 0) {
          r.pdCooldown = 4 / r.pd; // flak rounds of 4 damage at pd dps
          const f = s.flight;
          if (ord.nearestThreat(f.position, s.team, PD_RANGE * 0.65, _tp, _tv) >= 0) {
            const g = GUNS.flak;
            if (leadPoint(f.position, f.velocity, _tp, _tv, null, _w, g.speed) > 0) {
              _v.subVectors(_w, f.position).normalize().add(_a.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(0.02)).normalize();
              this.weapons.spawnBolt(f.position, _v.multiplyScalar(g.speed).add(f.velocity), g.life, g.damage, s, g);
            }
          }
        }
      }
    }
    for (const [s, h] of this.hangars) this.stepHangar(s, h, dt);
  }

  private stepMounts(s: ShipEntity, r: ShipRt, dt: number, preferred: ShipEntity | null): void {
    const f = s.flight;
    const hold = s.isPlayer && this.mode === 'hold';
    const onlyTarget = s.isPlayer && this.mode === 'target';
    const ord = this.fleet.ordnance;
    const team = s.team;
    const subs = s.combat.dmg.subsystems;
    _qi.copy(f.orientation).invert();
    for (const g of r.mounts) {
      const d = g.drive;
      const rig = g.rig;
      // Capital-grade hulls carry turret subsystems: a destroyed mount is a wreck.
      const sub = subs.length ? subs.find((x) => x.id === g.socket) : undefined;
      if (sub?.destroyed) {
        if (!d.wrecked) {
          wreckDrive(rig, d);
          poseTurret(s.model, rig, d);
          if (g.beam?.active && g.beam.muzzle === g.muzzle) g.beam.active = false;
        }
        g.engaged = false;
        continue;
      }
      if (d.wrecked) restoreDrive(d);
      const m = g.mount;
      mountFromRig(rig, m, f.position, f.orientation, f.velocity);
      g.cooldown -= dt;
      let aimed = false;
      let pd = false;
      g.engaged = false;
      if (!hold) {
        // Flak mounts break off for inbound torpedoes.
        if (ord && PD_GUNS.has(g.gun.id)) aimed = pd = turretSelectThreat(m, team, ord, PD_RANGE, g.sol);
        const pref = preferred && preferred.alive && hostile(preferred, s) ? preferred : null;
        if (!aimed && pref) aimed = turretAim(m, pref, g.sol);
        if (!aimed && !onlyTarget) {
          const cur = g.sol.target && g.sol.target.alive ? g.sol.target : null;
          aimed = (cur && turretAim(m, cur, g.sol)) || turretSelectTarget(m, team, this.fleet.ships, cur, g.sol, s.isPlayer || g.spec.size === 'L');
        }
      }
      const err = stepDrive(rig, d, aimed ? _dl.copy(g.sol.aimDir).applyQuaternion(_qi) : null, dt);
      poseTurret(s.model, rig, d);
      muzzleLocal(rig, d.yaw, d.pitch, 0, g.muzzle);
      if (!aimed) {
        if (g.cooldown < 0) g.cooldown = 0;
        continue;
      }
      g.engaged = true;
      if (g.cooldown > 0) continue;
      // Fire gate: the barrels must be on the solution.
      const tgt = pd ? null : g.sol.target;
      if (err > (pd ? PD_TOL : gateTolerance(tgt ? tgt.radius : 0, g.sol.distance))) {
        if (g.cooldown < 0) g.cooldown = 0;
        continue;
      }
      const gun = g.gun;
      const sp = g.spec;
      if (gun.beam) {
        if (g.beam?.active) continue;
        const b = this.weapons.fireBeam(s, g.socket, gun.beam.length, gun.beam.width, gun.beam.duration, gun.beam.dps * sp.dmgMul, gun.type);
        b.aimTarget = g.sol.target;
        b.gun = gun;
        b.muzzle = g.muzzle;
        b.origin.copy(g.muzzle).applyQuaternion(f.orientation).add(f.position);
        b.dir.copy(g.sol.aimDir);
        this.weapons.muzzleFlash(b.origin, g.sol.aimDir, f.velocity, s, gun);
        d.recoil = 0.5;
        g.beam = b;
        g.cooldown = 1 / (gun.rate * sp.rateMul);
        continue;
      }
      nextMuzzle(rig, d, _mz).applyQuaternion(f.orientation).add(f.position);
      _tp.subVectors(g.sol.aimPoint, _mz).normalize();
      const scatter = sp.scatter + (gun.burst?.scatter ?? 0) * 0.5;
      for (let k = 0; k < gun.pellets; k++) {
        _v.copy(_tp)
          .add(_a.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(2 * (scatter + gun.spread)))
          .normalize()
          .multiplyScalar(gun.speed)
          .add(f.velocity);
        this.weapons.spawnBolt(_mz, _v, gun.life, gun.damage * sp.dmgMul, s, gun);
      }
      this.weapons.muzzleFlash(_mz, _tp, f.velocity, s, gun);
      if (gun.burst) {
        g.burst++;
        if (g.burst >= gun.burst.count) {
          g.burst = 0;
          g.cooldown = (gun.burst.interval / sp.rateMul) * (0.85 + this.rand() * 0.3);
        } else g.cooldown = gun.burst.gap;
      } else g.cooldown += 1 / (gun.rate * sp.rateMul);
    }
  }

  private stepHangar(s: ShipEntity, h: HangarRt, dt: number): void {
    if (!s.alive) return;
    // A wrecked bay launches nothing (its cook-off is Fleet.cookOff's).
    if (s.combat.dmg.subsystems.some((x) => x.id === 'hangar' && x.destroyed)) return;
    h.cooldown -= dt;
    if (h.cooldown > 0) return;
    // A craft shot down (hull 0) stays down until the carrier docks.
    const spare = h.wing.find((w) => !w.alive && w.hull > 0);
    if (!spare && h.wing.length >= h.crafts.length) return;
    // Launch only when something hostile closes.
    const p = s.flight.position;
    if (!this.fleet.ships.some((o) => o.alive && hostile(o, s) && o.flight.position.distanceTo(p) < LAUNCH_RANGE)) return;
    h.cooldown = 5;
    const bay = s.model.sockets.get('hangar');
    _v.copy(bay ? bay.position : _a.set(0, -s.model.radius * 0.3, 0)).applyQuaternion(s.flight.orientation).add(p);
    _w.set(0, -0.35, 1).normalize().applyQuaternion(s.flight.orientation);
    let w: ShipEntity;
    if (spare) {
      w = spare;
      w.alive = true;
      w.model.root.visible = true;
      w.hull = w.hullMax;
      w.shield = w.shieldMax;
      w.flight.position.copy(_v);
    } else {
      w = this.fleet.spawn(h.crafts[h.wing.length], s.faction, _v, _w, { name: `${s.name} flight ${h.wing.length + 1}`, team: s.team });
      h.wing.push(w);
    }
    w.team = s.team;
    w.flight.velocity.copy(s.flight.velocity).addScaledVector(_w, 160);
    issueOrder([w], 'engageAtWill', s);
  }
}
