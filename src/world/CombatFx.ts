import { Vector3 } from 'three';
import { Particles } from '@/fx/Particles';
import { PAL, PK, type ParticlePalette } from '@/fx/kinds';
import { TRAIL_MISSILE, type TrailStyle } from '@/fx/Trails';
import { makeSpawn, resetSpawn } from '@/fx/spawn';
import { DamageFx } from './DamageFx';
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
  /** Single delayed pop at a fixed point (subsystem blasts) instead of a death chain. */
  at?: Vector3;
  scale?: number;
}

const _p = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const sd = makeSpawn();

/** Heavy torpedo: a fat, slow-dissolving smoke rope with a hot orange head. */
const TRAIL_TORPEDO: TrailStyle = { ...TRAIL_MISSILE, size0: 2.2, size1: 9, lifeMin: 4, lifeMax: 6, spacing: 3.5, jitter: 1.2, glint: 5 };
/** Harpoon: short, thin, fast. */
const TRAIL_HARPOON: TrailStyle = { ...TRAIL_MISSILE, size0: 0.6, size1: 2.4, lifeMin: 1.0, lifeMax: 1.6, glint: 1.6 };

function paletteOf(s: ShipEntity | null): ParticlePalette {
  return s?.faction === 'choir' ? PAL.MAGENTA : PAL.WARM;
}

export class CombatFx {
  readonly fx = new Particles();
  /** Scorch marks, smoke trails, burning craters (reads the fleet's damage state). */
  readonly damage: DamageFx;
  private trail = new Int32Array(MISSILE_CAPACITY).fill(-1);
  private chains: Chain[] = [];
  private rng = 777;

  constructor(
    private weapons: Weapons,
    private missiles: Missiles,
  ) {
    this.damage = new DamageFx(weapons.fleet, this.fx);
  }

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
          // Capitals: a hex ripple sized to the shell patch, not the whole bubble.
          if (e.ship) fx.shieldHit(e.position, e.normal, e.ship.combat.dmg.capital ? Math.min(160, e.ship.model.length * 0.05) : e.ship.radius * 1.3, e.ship.flight.velocity, e.ship.faction === 'choir' ? PAL.MAGENTA : PAL.PLASMA);
          break;
        case 'shield-down':
          if (e.ship) this.shieldCollapse(e.ship, e.position, e.normal);
          break;
        case 'subsystem': {
          const s = e.ship;
          const sub = e.sub;
          if (!s || !sub) break;
          // Section blast off the plating: fireball + debris + a second, delayed pop.
          const r = sub.radius;
          _n.copy(e.normal);
          _p.copy(e.position).addScaledVector(_n, r * 0.2);
          fx.explosion(_p, s.flight.velocity, r * 0.9, paletteOf(s));
          fx.debris(_p, _v.copy(s.flight.velocity).addScaledVector(_n, r * 0.6), r * 0.35, 14);
          this.chains.push({ ship: s, t: 0, next: 0.35, left: 1, at: _p.clone(), scale: r * 0.55 });
          break;
        }
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
      if (e.kind !== 'detonate') continue;
      const big = e.spec.id === 'torpedo';
      if (e.intercepted) fx.explosion(e.position, e.velocity, big ? 16 : 6, PAL.WARM);
      else fx.explosion(e.position, e.target?.flight.velocity ?? e.velocity, big ? 45 : e.spec.id === 'harpoon' ? 5 : 7, PAL.WARM);
    }
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      const h = this.trail[i];
      if (m.alive[i]) {
        // Start smoking once clear of the launcher, not on the rail itself.
        if (h < 0 && m.age[i] > 0.25) {
          const id = m.spec[i].id;
          this.trail[i] = fx.trails.create(id === 'torpedo' ? TRAIL_TORPEDO : id === 'harpoon' ? TRAIL_HARPOON : TRAIL_MISSILE);
        }
        if (this.trail[i] >= 0) fx.trails.update(this.trail[i], m.pos[i]);
      } else if (h >= 0) {
        fx.trails.release(h);
        this.trail[i] = -1;
      }
    }

    // Scorch marks, smoke, sparks, burning craters.
    this.damage.update(dt);

    // Capital death chains.
    for (let k = this.chains.length - 1; k >= 0; k--) {
      const c = this.chains[k];
      c.t += dt;
      if (c.t < c.next) continue;
      const s = c.ship;
      const r = s.model.radius;
      if (c.at) {
        // Subsystem secondary: offset a little, smaller, darker smoke.
        _p.copy(c.at).add(_v.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar((c.scale ?? 10) * 0.8));
        fx.explosion(_p, s.flight.velocity, c.scale ?? 10, paletteOf(s));
      } else if (c.left > 1) {
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

  /**
   * A shield facing (or a fighter's bubble) failing: the hex lattice flares
   * over the whole patch, then a hard ring and a spray of plasma motes.
   */
  private shieldCollapse(s: ShipEntity, pos: Vector3, normal: Vector3): void {
    const fx = this.fx;
    const cap = s.combat.dmg.capital;
    const size = cap ? Math.min(420, s.model.length * 0.14) : s.radius * 2.2;
    const pal = s.faction === 'choir' ? PAL.MAGENTA : PAL.PLASMA;
    const v = s.flight.velocity;
    fx.shieldHit(pos, normal, size, v, pal);
    resetSpawn(sd);
    sd.kind = PK.RING;
    sd.palette = pal;
    sd.pos.copy(pos);
    sd.baseVel.copy(v);
    sd.dir.copy(normal);
    sd.count = 1;
    sd.size0 = size * 0.3;
    sd.size1 = size * 1.6;
    sd.lifeMin = sd.lifeMax = 0.5;
    fx.emit(sd);
    resetSpawn(sd);
    sd.kind = PK.FLASH;
    sd.palette = pal;
    sd.pos.copy(pos);
    sd.baseVel.copy(v);
    sd.count = 1;
    sd.size0 = sd.size1 = size * 0.7;
    sd.lifeMin = sd.lifeMax = 0.16;
    fx.emit(sd);
    resetSpawn(sd);
    sd.kind = PK.GLINT;
    sd.palette = pal;
    sd.pos.copy(pos);
    sd.baseVel.copy(v);
    sd.dir.copy(normal);
    sd.spread = 0.8;
    sd.count = cap ? 40 : 18;
    sd.jitter = size * 0.3;
    sd.speedMin = size * 0.4;
    sd.speedMax = size * 1.6;
    sd.drag = 1.8;
    sd.size0 = sd.size1 = Math.max(0.5, size * 0.03);
    sd.sizeJitter = 0.5;
    sd.lifeMin = 0.4;
    sd.lifeMax = 0.9;
    fx.emit(sd);
  }

  /** Once per frame after the eye is final. */
  update(dt: number, eye: Vector3): void {
    this.damage.paint();
    this.fx.update(dt, eye);
  }
}
