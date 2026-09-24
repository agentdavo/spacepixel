import { Vector3 } from 'three';
import type { ShipEntity } from './Fleet';
import { impactDamage } from './Collision.ts';

/**
 * Fighter ↔ fighter collisions: one sphere per small craft (capitals and
 * stations are HullCollisions' proxies). Cheap by design — O(n²) over living
 * fighters, a few dozen at most — and the AI's avoidance already spaces
 * wings, so this only bites on rams, blown merges and player misjudgement.
 *
 * Response mirrors the hull world: push the pair apart along the line of
 * centres (heavier ships move less), bounce the closing speed with the same
 * restitution, and hurt both with the same damage-by-closing-speed curve
 * (`impactDamage`): a nudge in formation is free, a head-on at 300 m/s is
 * not survivable.
 *
 * Immunity: a ship gets `LAUNCH_GRACE` seconds when it first appears alive
 * (hangar launches, respawns, contract spawns, the dock catapult) so a
 * wing spawned in a tight box, or a fighter cat-shot out of a bay behind
 * its mate, doesn't start the fight by trading paint. `skip` exempts ships
 * something else owns (docking guidance).
 */
export const LAUNCH_GRACE = 2;
/** Collision sphere as a fraction of `ShipEntity.radius` (a targeting radius, a little generous). */
export const BODY_SCALE = 0.8;
const RESTITUTION = 0.35;
/** Seconds between damage knocks for the same pair (one per bounce, not per frame of a grind). */
const PAIR_COOLDOWN = 0.2;

export interface FighterContact {
  a: ShipEntity;
  b: ShipEntity;
  /** Midpoint of the contact (universe) and the normal from a to b. */
  point: Vector3;
  normal: Vector3;
  /** Closing speed along the normal, m/s. */
  impact: number;
  /** Damage applied to each ship (0 for a nudge or inside the pair cooldown). */
  damage: number;
  /** Same team. */
  friendly: boolean;
}

const _n = new Vector3();
const _dv = new Vector3();

export class FighterCollisions {
  /** Contacts this step (reused objects; read them before the next step). */
  readonly events: FighterContact[] = [];
  /** Running totals (sims and debug HUD). */
  contacts = 0;
  friendlyContacts = 0;
  private pool: FighterContact[] = [];
  private grace = new Map<ShipEntity, number>();
  private wasAlive = new WeakMap<ShipEntity, boolean>();
  private cooldown = new Map<number, number>();
  private list: ShipEntity[] = [];

  /** Give a ship a spell of collision immunity (launch catapult, jump-in, scripted spawn). */
  immune(s: ShipEntity, seconds = LAUNCH_GRACE): void {
    this.grace.set(s, Math.max(this.grace.get(s) ?? 0, seconds));
  }

  isImmune(s: ShipEntity): boolean {
    return (this.grace.get(s) ?? 0) > 0;
  }

  /**
   * After the fleet has flown. `damage` applies collision damage (usually
   * `fleet.damage`); `skip` exempts ships owned by something else.
   */
  step(ships: readonly ShipEntity[], dt: number, damage: (s: ShipEntity, amount: number) => void, skip: (s: ShipEntity) => boolean = () => false): void {
    this.events.length = 0;
    const list = this.list;
    list.length = 0;
    for (const s of ships) {
      const alive = s.alive && s.radius <= 60;
      const was = this.wasAlive.get(s) ?? false;
      if (alive && !was) this.immune(s);
      this.wasAlive.set(s, alive);
      if (!alive) continue;
      const g = this.grace.get(s);
      if (g !== undefined) {
        if (g - dt <= 0) this.grace.delete(s);
        else this.grace.set(s, g - dt);
        continue;
      }
      if (!skip(s)) list.push(s);
    }
    for (const [k, t] of this.cooldown) {
      if (t - dt <= 0) this.cooldown.delete(k);
      else this.cooldown.set(k, t - dt);
    }
    if (dt <= 0) return;

    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (!A.alive || !B.alive) continue;
        const pa = A.flight.position;
        const pb = B.flight.position;
        const r = (A.radius + B.radius) * BODY_SCALE;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-6) _n.set(dx / d, dy / d, dz / d);
        else B.flight.forward(_n).negate(); // coincident: part along B's tail
        const ma = A.combat.stats.mass;
        const mb = B.combat.stats.mass;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        // Separate.
        const depth = r - d;
        pa.addScaledVector(_n, -depth * wa);
        pb.addScaledVector(_n, depth * wb);
        // Bounce the closing component.
        const vn = _dv.subVectors(B.flight.velocity, A.flight.velocity).dot(_n);
        const impact = Math.max(0, -vn);
        if (vn < 0) {
          const jn = -(1 + RESTITUTION) * vn;
          A.flight.velocity.addScaledVector(_n, -jn * wa);
          B.flight.velocity.addScaledVector(_n, jn * wb);
        }
        const key = A.id < B.id ? A.id * 65536 + B.id : B.id * 65536 + A.id;
        let dmg = 0;
        if (!this.cooldown.has(key)) {
          dmg = impactDamage(impact);
          this.cooldown.set(key, PAIR_COOLDOWN);
          const friendly = A.team === B.team;
          this.contacts++;
          if (friendly) this.friendlyContacts++;
          if (dmg > 0) {
            damage(A, dmg);
            damage(B, dmg);
          }
          const ev = this.pool[this.events.length] ?? (this.pool[this.events.length] = { a: A, b: B, point: new Vector3(), normal: new Vector3(), impact: 0, damage: 0, friendly: false });
          ev.a = A;
          ev.b = B;
          ev.point.copy(pa).addScaledVector(_n, A.radius * BODY_SCALE);
          ev.normal.copy(_n);
          ev.impact = impact;
          ev.damage = dmg;
          ev.friendly = friendly;
          this.events.push(ev);
        }
      }
    }
  }
}
