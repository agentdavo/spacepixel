import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Fleet, ShipEntity } from './Fleet';
import type { Weapons, Beam } from './Weapons';
import { createTurretSolution, turretAim, turretSelectTarget, TURRET_DEFAULTS, type TurretMount, type TurretSolution } from './ai/Turret';
import { issueOrder } from './ai';

/**
 * Capital ships as combatants: flak turrets on every 'turret' hardpoint
 * (lead-aimed with the AI's pure turret solver), tracking beam lances on
 * 'beam' hardpoints, and hangars that launch AI fighters. Capital hulls
 * cruise slowly on a fixed heading — they're terrain with guns.
 *
 * Hardpoints are resolved once to root-local mounts (sockets may sit under
 * articulation joints), then transformed by the ship's float64 pose each step.
 */
interface Gun {
  local: Vector3;
  localUp: Vector3;
  localFwd: Vector3;
  cooldown: number;
  burst: number;
  mount: TurretMount;
  sol: TurretSolution;
}

interface Lance {
  socket: string;
  local: Vector3;
  cooldown: number;
  beam: Beam | null;
  target: ShipEntity | null;
}

interface Hangar {
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
}

export interface CapitalOptions {
  /** Fighter blueprint launched from hangars (null = no launches). */
  launchBlueprint?: string | null;
  maxFighters?: number;
  /** Seconds between flak bursts per gun. */
  gunInterval?: number;
}

const FLAK_SPEED = 1100;
const FLAK_DAMAGE = 4;
const LANCE_RANGE = 6000;

const _m = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();

export class Capitals {
  readonly list: Capital[] = [];
  private gunInterval = 1.6;

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
    for (const [id, o] of ship.model.sockets) {
      _m.multiplyMatrices(_inv, o.matrixWorld); // socket → root-local
      const local = new Vector3().setFromMatrixPosition(_m);
      _q.setFromRotationMatrix(_m);
      const up = new Vector3(0, 1, 0).applyQuaternion(_q);
      const fwd = new Vector3(0, 0, 1).applyQuaternion(_q);
      const kind = o.userData.kind as string;
      if (kind === 'turret') {
        guns.push({
          local,
          localUp: up,
          localFwd: fwd,
          cooldown: Math.random() * 2,
          burst: 0,
          mount: { ...TURRET_DEFAULTS, position: new Vector3(), forward: new Vector3(), up: new Vector3(), velocity: new Vector3(), boltSpeed: FLAK_SPEED, range: 2400 },
          sol: createTurretSolution(),
        });
      } else if (kind === 'beam') {
        lances.push({ socket: id, local, cooldown: 4 + Math.random() * 6, beam: null, target: null });
      } else if (kind === 'hangar') {
        hangars.push({ local, localFwd: fwd, cooldown: 3 + Math.random() * 3 });
      }
    }
    if (opts.gunInterval) this.gunInterval = opts.gunInterval;
    this.list.push({ ship, guns, lances, hangars, launched: [], launchBlueprint: opts.launchBlueprint ?? null, maxFighters: opts.maxFighters ?? 4 });
  }

  step(dt: number): void {
    for (const c of this.list) {
      const s = c.ship;
      if (!s.alive) continue;
      const f = s.flight;
      // Capital helm: steady slow cruise, no maneuvering (AI skips capitals).
      s.controls.pitch = s.controls.yaw = s.controls.roll = 0;
      s.controls.throttleSet = 0.35;
      s.controls.fire = false;

      // ── flak turrets ──────────────────────────────────────────────
      for (const g of c.guns) {
        g.cooldown -= dt;
        if (g.cooldown > 0) continue;
        const m = g.mount;
        m.position.copy(g.local).applyQuaternion(f.orientation).add(f.position);
        m.up.copy(g.localUp).applyQuaternion(f.orientation);
        m.forward.copy(g.localFwd).applyQuaternion(f.orientation);
        m.velocity.copy(f.velocity);
        const cur = g.sol.target && g.sol.target.alive ? g.sol.target : null;
        const ok = cur && turretAim(m, cur, g.sol) ? true : turretSelectTarget(m, s.faction, this.fleet.ships, cur, g.sol);
        if (!ok) {
          g.cooldown = 0.5;
          continue;
        }
        // Short bursts with a little scatter — flak, not snipers.
        _v.copy(g.sol.aimDir)
          .add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.03))
          .normalize()
          .multiplyScalar(FLAK_SPEED)
          .add(f.velocity);
        this.weapons.spawnBolt(m.position, _v, 2.4, FLAK_DAMAGE, s);
        g.burst++;
        if (g.burst >= 3) {
          g.burst = 0;
          g.cooldown = this.gunInterval * (0.8 + Math.random() * 0.4);
        } else g.cooldown = 0.09;
      }

      // ── beam lances: charge, then sweep onto a target for ~2 s ─────
      for (const l of c.lances) {
        if (l.beam?.active) continue;
        l.cooldown -= dt;
        if (l.cooldown > 0) continue;
        _v.copy(l.local).applyQuaternion(f.orientation).add(f.position);
        let best: ShipEntity | null = null;
        let bd = LANCE_RANGE;
        for (const o of this.fleet.ships) {
          if (!o.alive || o.faction === s.faction) continue;
          const d = o.flight.position.distanceTo(_v);
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
        l.beam = this.weapons.fireBeam(s, l.socket, LANCE_RANGE, 5, 2.2, best.radius > 60 ? 900 : 60);
        l.beam.aimTarget = best;
        l.cooldown = 7 + Math.random() * 5;
      }

      // ── hangars: launch fighters while below the cap ─────────────
      if (c.launchBlueprint) {
        c.launched = c.launched.filter((x) => x.alive);
        for (const h of c.hangars) {
          h.cooldown -= dt;
          if (h.cooldown > 0 || c.launched.length >= c.maxFighters) continue;
          h.cooldown = 6 + Math.random() * 4;
          _v.copy(h.local).applyQuaternion(f.orientation).add(f.position);
          _w.copy(h.localFwd).applyQuaternion(f.orientation);
          const fighter = this.fleet.spawn(c.launchBlueprint, s.faction, _v, _w, { name: `${s.name} flight` });
          fighter.flight.velocity.copy(f.velocity).addScaledVector(_w, 180);
          issueOrder([fighter], 'engageAtWill', fighter);
          c.launched.push(fighter);
        }
      }
    }
  }
}
