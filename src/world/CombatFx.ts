import { Vector3 } from 'three';
import { Particles } from '@/fx/Particles';
import { PAL, type ParticlePalette } from '@/fx/kinds';
import { TRAIL_MISSILE } from '@/fx/Trails';
import type { Weapons } from '@/sim/Weapons';
import type { Missiles } from '@/sim/Missiles';
import { MISSILE_CAPACITY } from '@/sim/Missiles';
import type { ShipEntity } from '@/sim/Fleet';

/**
 * Turns the sim's event arrays into particles: impact sparks, shield
 * ripples, fighter fireballs + debris, Itano-circus smoke trails on every
 * missile, and a rolling chain of blasts when a capital ship dies. Reads
 * events; owns no simulation state beyond trail handles and pending blasts.
 */
interface Chain {
  ship: ShipEntity;
  t: number;
  next: number;
  left: number;
}

const _p = new Vector3();
const _v = new Vector3();

function paletteOf(s: ShipEntity | null): ParticlePalette {
  return s?.faction === 'choir' ? PAL.MAGENTA : PAL.WARM;
}

export class CombatFx {
  readonly fx = new Particles();
  private trail = new Int32Array(MISSILE_CAPACITY).fill(-1);
  private chains: Chain[] = [];
  private rng = 777;

  constructor(
    private weapons: Weapons,
    private missiles: Missiles,
  ) {}

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng - 1) / 2147483646;
  }

  /** Consume this frame's events. Call after weapons/missiles step. */
  consume(dt: number): void {
    const fx = this.fx;
    for (const e of this.weapons.events) {
      switch (e.kind) {
        case 'hit':
          fx.impact(e.position, e.normal, e.ship?.flight.velocity ?? e.velocity, PAL.WARM);
          break;
        case 'shield':
          if (e.ship) fx.shieldHit(e.position, e.normal, e.ship.radius * 1.3, e.ship.flight.velocity, e.ship.faction === 'choir' ? PAL.MAGENTA : PAL.PLASMA);
          break;
        case 'beam-hit':
          if (this.rand() < 0.25) fx.impact(e.position, e.normal, e.velocity, PAL.PLASMA);
          break;
        case 'kill': {
          const s = e.ship;
          if (!s) break;
          if (s.radius > 60) {
            // Capital: a rolling chain of section blasts, then the big one.
            this.chains.push({ ship: s, t: 0, next: 0, left: 9 });
          } else {
            fx.explosion(s.flight.position, s.flight.velocity, Math.max(10, s.radius * 1.4), paletteOf(s));
            fx.debris(s.flight.position, s.flight.velocity, s.radius, 10);
          }
          break;
        }
      }
    }

    // Missile trails: one smoke ribbon per live missile.
    const m = this.missiles;
    for (const e of m.events) {
      if (e.kind === 'detonate') fx.explosion(e.position, e.target?.flight.velocity ?? e.velocity, 7, PAL.WARM);
    }
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      const h = this.trail[i];
      if (m.alive[i]) {
        // Start smoking once clear of the launcher, not on the rail itself.
        if (h < 0 && m.age[i] > 0.25) this.trail[i] = fx.trails.create(TRAIL_MISSILE);
        if (this.trail[i] >= 0) fx.trails.update(this.trail[i], m.pos[i]);
      } else if (h >= 0) {
        fx.trails.release(h);
        this.trail[i] = -1;
      }
    }

    // Capital death chains.
    for (let k = this.chains.length - 1; k >= 0; k--) {
      const c = this.chains[k];
      c.t += dt;
      if (c.t < c.next) continue;
      const s = c.ship;
      const r = s.model.radius;
      if (c.left > 1) {
        _p.set(this.rand() - 0.5, (this.rand() - 0.5) * 0.4, this.rand() - 0.5).multiplyScalar(r * 1.2).applyQuaternion(s.flight.orientation).add(s.flight.position);
        fx.explosion(_p, s.flight.velocity, r * (0.08 + this.rand() * 0.06), paletteOf(s));
        fx.debris(_p, _v.copy(s.flight.velocity), r * 0.05, 6);
        c.next = c.t + 0.18 + this.rand() * 0.3;
      } else {
        fx.explosion(s.flight.position, s.flight.velocity, r * 0.35, paletteOf(s));
        fx.debris(s.flight.position, s.flight.velocity, r * 0.12, 24);
      }
      if (--c.left <= 0) this.chains.splice(k, 1);
    }
  }

  /** Once per frame after the eye is final. */
  update(dt: number, eye: Vector3): void {
    this.fx.update(dt, eye);
  }
}
