import { Matrix4, Quaternion, Vector3 } from 'three';
import { hostile, type Fleet, type ShipEntity } from './Fleet';
import type { Weapons, Beam } from './Weapons';
import { createTurretSolution, turretAim, turretCanPoint, turretSelectTarget, TURRET_DEFAULTS, type TurretMount, type TurretSolution } from './ai/Turret';
import { issueOrder, leadPoint } from './ai';
import { CAPITAL_LANCE, GUNS, type GunSpec } from './Loadouts';
import type { Subsystem } from './Damage';
import type { Rng } from './Rng';

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
 * pick targets at random). Turrets break off to shoot down incoming torpedoes.
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
  /** Fire-control dice: this capital's own stream (ship.rng → 'capital'). */
  rng: Rng;
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
const _tp = new Vector3();
const _tv = new Vector3();

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
    const subOf = (id: string) => ship.combat.dmg.subsystems.find((x) => x.id === id) ?? null;
    const rng = ship.rng.fork('capital');
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
          cooldown: rng.next() * 2,
          burst: 0,
          mount: { ...TURRET_DEFAULTS, position: new Vector3(), forward: new Vector3(), up: new Vector3(), velocity: new Vector3(), boltSpeed: gun.speed, range: Math.min(2400, gun.speed * gun.life) },
          sol: createTurretSolution(),
        });
      } else if (kind === 'beam') {
        lances.push({ sub: subOf(id), socket: id, local, cooldown: 4 + rng.next() * 6, beam: null, target: null });
      } else if (kind === 'hangar') {
        hangars.push({ sub: subOf(id), local, localFwd: fwd, cooldown: 3 + rng.next() * 3 });
      }
    }
    if (opts.gunInterval) this.gunInterval = opts.gunInterval;
    this.list.push({ ship, guns, lances, hangars, launched: [], launchBlueprint: opts.launchBlueprint ?? null, maxFighters: opts.maxFighters ?? 4, gun, rng });
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
      const rng = c.rng;
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
        // Point defence first: an inbound torpedo in arc beats any fighter.
        let aimed = false;
        if (ord && ord.nearestThreat(m.position, s.team, PD_RANGE, _tp, _tv) >= 0) {
          const tof = leadPoint(m.position, m.velocity, _tp, _tv, null, _w, gun.speed);
          if (tof > 0 && turretCanPoint(m, _v.subVectors(_w, m.position).normalize())) {
            g.sol.aimDir.copy(_v);
            aimed = true;
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
        // Short bursts with a little scatter — flak, not snipers. No bridge: wilder.
        const scatter = burst.scatter / coord;
        for (let k = 0; k < gun.pellets; k++) {
          _v.copy(g.sol.aimDir)
            .add(_w.set(rng.centered(), rng.centered(), rng.centered()).multiplyScalar(scatter + gun.spread))
            .normalize()
            .multiplyScalar(gun.speed)
            .add(f.velocity);
          this.weapons.spawnBolt(m.position, _v, gun.life, gun.damage, s, gun);
        }
        g.burst++;
        if (g.burst >= burst.count) {
          g.burst = 0;
          g.cooldown = interval * (0.8 + rng.next() * 0.4);
        } else g.cooldown = burst.gap;
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
          const d = o.flight.position.distanceTo(_v) * (coord < 1 ? 0.5 + rng.next() : 1);
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
        l.cooldown = (7 + rng.next() * 5) / (0.55 + 0.45 * coord);
      }

      // ── hangars: launch fighters while below the cap ─────────────
      if (c.launchBlueprint) {
        c.launched = c.launched.filter((x) => x.alive);
        for (const h of c.hangars) {
          if (h.sub?.destroyed) continue;
          h.cooldown -= dt;
          if (h.cooldown > 0 || c.launched.length >= c.maxFighters) continue;
          h.cooldown = 6 + rng.next() * 4;
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
