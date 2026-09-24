import { Vector3 } from 'three';
import type { WeaponEvent } from '@/sim/Weapons';
import type { MissileEvent } from '@/sim/Missiles';
import { MICRO_MISSILE } from '@/sim/Missiles';

/**
 * Per-tick sim events, gathered for a consumer that runs at another rate.
 *
 * `Weapons.events` / `Missiles.events` hold one tick's events (pooled
 * objects, reused next tick). With a fixed-step sim a frame runs 0..4
 * ticks, so per-frame readers (audio) would drop or double-play them;
 * the tap copies each tick's events into its own pool until `clear()`.
 * The kill-cam's history keeps one tap per recorded tick.
 */
export class EventTap {
  readonly weapons: WeaponEvent[] = [];
  readonly missiles: MissileEvent[] = [];
  private wPool: WeaponEvent[] = [];
  private mPool: MissileEvent[] = [];

  constructor(private cap = 512) {}

  /** Append one tick's events. */
  capture(w: readonly WeaponEvent[], m: readonly MissileEvent[]): void {
    for (const e of w) {
      if (this.weapons.length >= this.cap) break;
      this.weapons.push(copyWeaponEvent(e, (this.wPool[this.weapons.length] ??= blankWeaponEvent())));
    }
    for (const e of m) {
      if (this.missiles.length >= this.cap) break;
      this.missiles.push(copyMissileEvent(e, (this.mPool[this.missiles.length] ??= blankMissileEvent())));
    }
  }

  clear(): void {
    this.weapons.length = 0;
    this.missiles.length = 0;
  }
}

export function blankWeaponEvent(): WeaponEvent {
  return { kind: 'hit', position: new Vector3(), normal: new Vector3(), velocity: new Vector3(), ship: null, shooter: null, gun: null, sub: null, facing: -1, strength: -1, bleed: 0 };
}

export function blankMissileEvent(): MissileEvent {
  return { kind: 'launch', position: new Vector3(), velocity: new Vector3(), index: 0, target: null, shooter: null, spec: MICRO_MISSILE, intercepted: false };
}

export function copyWeaponEvent(e: WeaponEvent, o: WeaponEvent): WeaponEvent {
  o.kind = e.kind;
  o.position.copy(e.position);
  o.normal.copy(e.normal);
  o.velocity.copy(e.velocity);
  o.ship = e.ship;
  o.shooter = e.shooter;
  o.gun = e.gun;
  o.sub = e.sub;
  o.facing = e.facing;
  o.strength = e.strength;
  o.bleed = e.bleed;
  return o;
}

export function copyMissileEvent(e: MissileEvent, o: MissileEvent): MissileEvent {
  o.kind = e.kind;
  o.position.copy(e.position);
  o.velocity.copy(e.velocity);
  o.index = e.index;
  o.target = e.target;
  o.shooter = e.shooter;
  o.spec = e.spec;
  o.intercepted = e.intercepted;
  return o;
}
