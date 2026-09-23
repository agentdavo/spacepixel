import { Vector3 } from 'three';
import type { Fleet, ShipEntity } from '../Fleet';
import { GUN } from './Pilot';

/**
 * Minimal stand-in guns so the AI can be scored (headless sim) and seen
 * (dogfight demo tracers) before the real weapons system (M10) lands.
 * Reads `controls.fire`, spawns nose bolts at GUN.boltSpeed with the same
 * ballistics the AI leads for, and resolves hits as swept sphere tests.
 * Fixed-size pool; no per-frame allocation.
 */
export interface DebugBolt {
  pos: Vector3;
  vel: Vector3;
  life: number;
  owner: ShipEntity | null;
  active: boolean;
}

const _fwd = new Vector3();
const _s = new Vector3();
const _d = new Vector3();

export class DebugGuns {
  readonly bolts: DebugBolt[] = [];
  shots = 0;
  hits = 0;
  friendlyHits = 0;
  kills = 0;
  /** Optional hit callback (scoring, sparks). */
  onHit: ((target: ShipEntity, shooter: ShipEntity | null, killed: boolean) => void) | null = null;
  private cooldown = new Map<number, number>();
  private cursor = 0;

  constructor(
    capacity = 512,
    public rate = 8,
    public damage = 6,
  ) {
    for (let i = 0; i < capacity; i++) this.bolts.push({ pos: new Vector3(), vel: new Vector3(), life: 0, owner: null, active: false });
  }

  step(fleet: Pick<Fleet, 'ships' | 'damage'>, dt: number): void {
    const ships = fleet.ships;
    // Fire.
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (!s.alive) continue;
      let cd = (this.cooldown.get(s.id) ?? 0) - dt;
      if (s.controls.fire && cd <= 0) {
        this.spawn(s);
        cd = Math.max(cd, -dt) + 1 / this.rate;
      }
      this.cooldown.set(s.id, Math.max(cd, -dt));
    }
    // Move + swept hit test (bolt vs. ship in the ship's frame).
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      for (let j = 0; j < ships.length; j++) {
        const o = ships[j];
        if (!o.alive || o === b.owner) continue;
        _s.subVectors(b.pos, o.flight.position);
        _d.subVectors(b.vel, o.flight.velocity).multiplyScalar(dt);
        if (segmentHitsSphere(_s, _d, o.radius)) {
          b.active = false;
          if (b.owner && b.owner.faction === o.faction) this.friendlyHits++;
          else this.hits++;
          const killed = fleet.damage(o, this.damage);
          if (killed) this.kills++;
          this.onHit?.(o, b.owner, killed);
          break;
        }
      }
      if (b.active) b.pos.addScaledVector(b.vel, dt);
    }
  }

  private spawn(s: ShipEntity): void {
    const b = this.bolts[this.cursor];
    this.cursor = (this.cursor + 1) % this.bolts.length;
    const f = s.flight;
    f.forward(_fwd);
    b.pos.copy(f.position).addScaledVector(_fwd, s.radius + 2);
    b.vel.copy(_fwd).multiplyScalar(GUN.boltSpeed);
    if (GUN.inheritVelocity) b.vel.add(f.velocity);
    b.life = (GUN.range / GUN.boltSpeed) * 1.15;
    b.owner = s;
    b.active = true;
    this.shots++;
  }
}

/** Does the segment start + [0,1]·delta pass within r of the origin? */
function segmentHitsSphere(start: Vector3, delta: Vector3, r: number): boolean {
  const dd = delta.lengthSq();
  const t = dd > 1e-9 ? Math.min(1, Math.max(0, -start.dot(delta) / dd)) : 0;
  const x = start.x + delta.x * t;
  const y = start.y + delta.y * t;
  const z = start.z + delta.z * t;
  return x * x + y * y + z * z <= r * r;
}
