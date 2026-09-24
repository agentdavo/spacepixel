import { Matrix4, Quaternion, Vector3 } from 'three';
import { hostile, type Fleet, type ShipEntity } from './Fleet';
import type { Weapons, Beam } from './Weapons';
import { createTurretSolution, turretAim, turretCanPoint, turretSelectTarget, TURRET_DEFAULTS, type TurretMount, type TurretSolution } from './ai/Turret';
import { issueOrder, leadPoint } from './ai';
import { CAPITAL_LANCE, GUNS, type BatterySpec, type GunSpec } from './Loadouts';
import { shieldFacing, type Subsystem } from './Damage';

/**
 * Capital ships as combatants: flak turrets on every 'turret' hardpoint
 * (lead-aimed with the AI's pure turret solver), tracking beam lances on
 * 'beam' hardpoints, and hangars that launch AI fighters. Capital hulls
 * cruise slowly on a fixed heading — they're terrain with guns.
 *
 * Hardpoints are resolved once to root-local mounts (sockets may sit under
 * articulation joints), then transformed by the ship's float64 pose each step.
 *
 * Every mount is a subsystem (Damage.ts): a destroyed turret, lance or
 * hangar goes quiet; dead engines slow the hull (all dead: it drifts on its
 * last vector); a dead bridge loses fire control (slower, wilder fire, lances
 * pick targets at random). Turrets break off to shoot down incoming torpedoes
 * and micro-missiles (at a faster point-defence cadence than their bursts).
 *
 * Main-battery turrets (Loadout.battery) are dual-purpose: against a big hull
 * — a gunship, corvette or frigate — they fire heavy rounds (the shield
 * breaker while the facing is up, the hull breaker once it is down), so a
 * corvette is a real threat to a player-flown warship, not just to fighters.
 */
interface Gun {
  sub: Subsystem | null;
  local: Vector3;
  localUp: Vector3;
  localFwd: Vector3;
  cooldown: number;
  burst: number;
  mount: TurretMount;
  sol: TurretSolution;
  /** Anti-ship mount (battery guns only): heavier, slower rounds, longer reach. */
  big: TurretMount | null;
  /** Ship the battery is laying on (null = flak role). */
  bigTarget: ShipEntity | null;
}

interface Lance {
  sub: Subsystem | null;
  socket: string;
  local: Vector3;
  cooldown: number;
  beam: Beam | null;
  target: ShipEntity | null;
}

interface Hangar {
  sub: Subsystem | null;
  local: Vector3;
  localFwd: Vector3;
  cooldown: number;
}

interface Capital {
  ship: ShipEntity;
  guns: Gun[];
  lances: Lance[];
  hangars: Hangar[];
  launched: ShipEntity[];
  launchBlueprint: string | null;
  maxFighters: number;
  gun: GunSpec;
  battery: BatterySpec | null;
  pdCooldown: number;
}

export interface CapitalOptions {
  /** Fighter blueprint launched from hangars (null = no launches). */
  launchBlueprint?: string | null;
  maxFighters?: number;
  /** Seconds between flak bursts per gun. */
  gunInterval?: number;
}

const LANCE_RANGE = CAPITAL_LANCE.range;
/** Point defence reach against torpedoes (m). */
const PD_RANGE = 1400;
/** Seconds between point-defence bursts (faster than the flak cadence: PD tracks, it doesn't volley). */
const PD_INTERVAL = 1.2;
/** Point-defence rounds are proximity-fused: they count for more against ordnance. */
const PD_DAMAGE_MUL = 1.5;
/** A main battery busy with a warship still takes ordnance this close (m). */
const PD_LAST_DITCH = 700;
const _tp = new Vector3();
const _tv = new Vector3();

const _sol = createTurretSolution();

/** Is the shield between `from` and the ship still up (its facing, or its bubble)? */
function shieldUpToward(t: ShipEntity, from: Vector3): boolean {
  const st = t.combat.dmg;
  if (!st.capital) return t.shield > t.shieldMax * 0.05;
  _v.subVectors(from, t.flight.position).applyQuaternion(_q.copy(t.flight.orientation).invert());
  const f = shieldFacing(_v.x - st.cx, _v.z - st.cz, st.halfW, st.halfL);
  return st.facings[f] > st.facingMax * 0.05;
}

const _m = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();

export class Capitals {
  readonly list: Capital[] = [];
  /** Seconds between turret bursts (null = the turret gun's own). */
  private gunInterval: number | null = null;

  constructor(
    private fleet: Fleet,
    private weapons: Weapons,
  ) {}

  register(ship: ShipEntity, opts: CapitalOptions = {}): void {
    const root = ship.model.root;
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const guns: Gun[] = [];
    const lances: Lance[] = [];
    const hangars: Hangar[] = [];
    const gun = GUNS[ship.combat.loadout.turret ?? 'flak'];
    const battery = ship.combat.loadout.battery ?? null;
    const isBattery = (id: string) => !!battery && battery.sockets.some((b) => id === b || id === `${b}.L`);
    const subOf = (id: string) => ship.combat.dmg.subsystems.find((x) => x.id === id) ?? null;
    for (const [id, o] of ship.model.sockets) {
      _m.multiplyMatrices(_inv, o.matrixWorld); // socket → root-local
      const local = new Vector3().setFromMatrixPosition(_m);
      _q.setFromRotationMatrix(_m);
      const up = new Vector3(0, 1, 0).applyQuaternion(_q);
      const fwd = new Vector3(0, 0, 1).applyQuaternion(_q);
      const kind = o.userData.kind as string;
      if (kind === 'turret') {
        guns.push({
          sub: subOf(id),
          local,
          localUp: up,
          localFwd: fwd,
          cooldown: Math.random() * 2,
          burst: 0,
          mount: { ...TURRET_DEFAULTS, position: new Vector3(), forward: new Vector3(), up: new Vector3(), velocity: new Vector3(), boltSpeed: gun.speed, range: Math.min(2400, gun.speed * gun.life) },
          sol: createTurretSolution(),
          big:
            battery && isBattery(id)
              ? { ...TURRET_DEFAULTS, position: new Vector3(), forward: new Vector3(), up: new Vector3(), velocity: new Vector3(), boltSpeed: GUNS[battery.vsShield].speed, range: battery.range }
              : null,
          bigTarget: null,
        });
      } else if (kind === 'beam') {
        lances.push({ sub: subOf(id), socket: id, local, cooldown: 4 + Math.random() * 6, beam: null, target: null });
      } else if (kind === 'hangar') {
        hangars.push({ sub: subOf(id), local, localFwd: fwd, cooldown: 3 + Math.random() * 3 });
      }
    }
    if (opts.gunInterval) this.gunInterval = opts.gunInterval;
    this.list.push({ ship, guns, lances, hangars, launched: [], launchBlueprint: opts.launchBlueprint ?? null, maxFighters: opts.maxFighters ?? 4, gun, battery, pdCooldown: 0 });
  }

  /** Nearest hostile big hull (radius ≥ `minRadius`) the battery can lay on, or null. */
  private selectBig(m: TurretMount, s: ShipEntity, minRadius: number, sol: TurretSolution): ShipEntity | null {
    let best: ShipEntity | null = null;
    let bd = Infinity;
    for (const o of this.fleet.ships) {
      if (!o.alive || o.radius < minRadius || !hostile(o, s)) continue;
      const d = o.flight.position.distanceToSquared(m.position) * (o.isPlayer ? 0.8 : 1);
      if (d >= bd || !turretAim(m, o, _sol)) continue;
      bd = d;
      best = o;
    }
    if (best) turretAim(m, best, sol);
    return best;
  }

  step(dt: number): void {
    for (const c of this.list) {
      const s = c.ship;
      if (!s.alive) continue;
      const f = s.flight;
      const fx = s.combat.cap;
      // Capital helm: steady slow cruise, no maneuvering (AI skips capitals).
      // Engines out: flight assist off, she drifts on her last vector.
      s.controls.pitch = s.controls.yaw = s.controls.roll = 0;
      s.controls.throttleSet = fx.drift ? 0 : 0.35 * fx.speedMul;
      s.controls.fire = false;
      if (fx.drift) f.flightAssist = false;
      const coord = fx.coordination;
      const gun = c.gun;
      const burst = gun.burst ?? { count: 3, gap: 0.09, interval: 1.6, scatter: 0.03 };
      const interval = (this.gunInterval ?? burst.interval) * (1 + (1 - coord));

      // ── turrets (flak / choir batteries) ──────────────────────────
      const ord = this.fleet.ordnance;
      for (const g of c.guns) {
        if (g.sub?.destroyed) continue;
        g.cooldown -= dt;
        if (g.cooldown > 0) continue;
        const m = g.mount;
        m.position.copy(g.local).applyQuaternion(f.orientation).add(f.position);
        m.up.copy(g.localUp).applyQuaternion(f.orientation);
        m.forward.copy(g.localFwd).applyQuaternion(f.orientation);
        m.velocity.copy(f.velocity);
        // Point defence first: inbound ordnance in arc beats any ship.
        let aimed = false;
        let pd = false;
        // (A main battery laid on a warship only breaks off for last-ditch shots: PD is the small mounts' job.)
        const laid = g.bigTarget !== null && g.bigTarget.alive;
        if (ord && ord.nearestThreat(m.position, s.team, laid ? PD_LAST_DITCH : PD_RANGE, _tp, _tv) >= 0) {
          const tof = leadPoint(m.position, m.velocity, _tp, _tv, null, _w, gun.speed);
          if (tof > 0 && turretCanPoint(m, _v.subVectors(_w, m.position).normalize())) {
            g.sol.aimDir.copy(_v);
            aimed = pd = true;
          }
        }
        // Main battery: lay on a big hull (the current one while it stays in arc).
        let bigGun: GunSpec | null = null;
        if (!aimed && g.big && c.battery) {
          const bm = g.big;
          bm.position.copy(m.position);
          bm.up.copy(m.up);
          bm.forward.copy(m.forward);
          bm.velocity.copy(m.velocity);
          const cur = g.bigTarget;
          if (!(cur && cur.alive && hostile(cur, s) && turretAim(bm, cur, g.sol))) g.bigTarget = this.selectBig(bm, s, c.battery.minRadius, g.sol);
          if (g.bigTarget) {
            aimed = true;
            bigGun = GUNS[shieldUpToward(g.bigTarget, bm.position) ? c.battery.vsShield : c.battery.vsHull];
          }
        }
        if (!aimed) {
          const cur = g.sol.target && g.sol.target.alive ? g.sol.target : null;
          aimed = cur && turretAim(m, cur, g.sol) ? true : turretSelectTarget(m, s.team, this.fleet.ships, cur, g.sol);
        }
        if (!aimed) {
          g.cooldown = 0.5;
          continue;
        }
        if (bigGun && c.battery) {
          // Heavy rounds: a tight salvo, then a long reload.
          const b = c.battery.burst;
          const sc = b.scatter / coord;
          _v.copy(g.sol.aimDir)
            .add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(sc))
            .normalize()
            .multiplyScalar(bigGun.speed)
            .add(f.velocity);
          this.weapons.spawnBolt(m.position, _v, c.battery.range / bigGun.speed, bigGun.damage * c.battery.dmgMul, s, bigGun);
          g.burst++;
          if (g.burst >= b.count) {
            g.burst = 0;
            g.cooldown = b.interval * (1 + (1 - coord)) * (0.85 + Math.random() * 0.3);
          } else g.cooldown = b.gap;
          continue;
        }
        // Short bursts with a little scatter — flak, not snipers. No bridge: wilder.
        const scatter = burst.scatter / coord;
        for (let k = 0; k < gun.pellets; k++) {
          _v.copy(g.sol.aimDir)
            .add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(scatter + gun.spread))
            .normalize()
            .multiplyScalar(gun.speed)
            .add(f.velocity);
          this.weapons.spawnBolt(m.position, _v, gun.life, gun.damage * (pd ? PD_DAMAGE_MUL : 1), s, gun);
        }
        g.burst++;
        if (g.burst >= burst.count) {
          g.burst = 0;
          g.cooldown = (pd ? Math.min(interval, PD_INTERVAL) : interval) * (0.8 + Math.random() * 0.4);
        } else g.cooldown = burst.gap;
      }

      // ── point-defence cluster (Loadout.pd): flak rounds at the nearest inbound ordnance ──
      const pdDps = s.combat.loadout.pd ?? 0;
      if (pdDps > 0 && ord) {
        c.pdCooldown -= dt;
        if (c.pdCooldown <= 0) {
          const g = GUNS.flak;
          c.pdCooldown = g.damage / pdDps;
          if (ord.nearestThreat(f.position, s.team, PD_RANGE, _tp, _tv) >= 0 && leadPoint(f.position, f.velocity, _tp, _tv, null, _w, g.speed) > 0) {
            _v.subVectors(_w, f.position)
              .normalize()
              .add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.02 / coord))
              .normalize()
              .multiplyScalar(g.speed)
              .add(f.velocity);
            this.weapons.spawnBolt(f.position, _v, g.life, g.damage, s, g);
          }
        }
      }

      // ── beam lances: charge, then sweep onto a target for ~2 s ─────
      for (const l of c.lances) {
        if (l.sub?.destroyed) {
          if (l.beam?.active) l.beam.active = false;
          continue;
        }
        if (l.beam?.active) continue;
        l.cooldown -= dt;
        if (l.cooldown > 0) continue;
        _v.copy(l.local).applyQuaternion(f.orientation).add(f.position);
        let best: ShipEntity | null = null;
        let bd = LANCE_RANGE;
        for (const o of this.fleet.ships) {
          if (!o.alive || !hostile(o, s)) continue;
          // No bridge: no fire control — lances take whatever they see first.
          const d = o.flight.position.distanceTo(_v) * (coord < 1 ? 0.5 + Math.random() : 1);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (!best) {
          l.cooldown = 1;
          continue;
        }
        l.target = best;
        const L = CAPITAL_LANCE;
        l.beam = this.weapons.fireBeam(s, l.socket, LANCE_RANGE, L.width, L.duration, best.radius > 60 ? L.dpsCapital : L.dpsFighter, L.type);
        l.beam.aimTarget = best;
        l.cooldown = (7 + Math.random() * 5) / (0.55 + 0.45 * coord);
      }

      // ── hangars: launch fighters while below the cap ─────────────
      if (c.launchBlueprint) {
        c.launched = c.launched.filter((x) => x.alive);
        for (const h of c.hangars) {
          if (h.sub?.destroyed) continue;
          h.cooldown -= dt;
          if (h.cooldown > 0 || c.launched.length >= c.maxFighters) continue;
          h.cooldown = 6 + Math.random() * 4;
          _v.copy(h.local).applyQuaternion(f.orientation).add(f.position);
          _w.copy(h.localFwd).applyQuaternion(f.orientation);
          const fighter = this.fleet.spawn(c.launchBlueprint, s.faction, _v, _w, { name: `${s.name} flight`, team: s.team });
          fighter.flight.velocity.copy(f.velocity).addScaledVector(_w, 180);
          issueOrder([fighter], 'engageAtWill', fighter);
          c.launched.push(fighter);
        }
      }
    }
  }
}
