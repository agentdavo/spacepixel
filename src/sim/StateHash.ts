import type { Fleet, ShipEntity } from './Fleet';
import type { Weapons } from './Weapons';
import type { Missiles } from './Missiles';

/**
 * Bit-exact world hash for the determinism harness and replay checkpoints.
 *
 * Every float goes in as its raw IEEE-754 bits (two 32-bit words), so two
 * worlds hash equal only if they are identical to the last bit — not "close".
 * Covers what the sim reads next tick: every ship's flight state, hull,
 * shields, damage pools, target, RNG state; live bolts and beams; live
 * missiles; the system streams. Pure and allocation-free after the first
 * call; cheap enough to run every second (≈ 0.1 ms at 60 ships / 1k bolts).
 */
const _f = new Float64Array(1);
const _u = new Uint32Array(_f.buffer);

export class StateHasher {
  h = 0x811c9dc5;

  reset(): this {
    this.h = 0x811c9dc5;
    return this;
  }

  u32(x: number): this {
    // murmur3-style mix per word: order-sensitive, avalanches every bit.
    let k = Math.imul(x >>> 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h = this.h ^ k;
    h = (h << 13) | (h >>> 19);
    this.h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    return this;
  }

  f64(x: number): this {
    _f[0] = x;
    return this.u32(_u[0]).u32(_u[1]);
  }

  bool(b: boolean): this {
    return this.u32(b ? 1 : 0);
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i));
    return this.u32(s.length);
  }

  vec(v: { x: number; y: number; z: number }): this {
    return this.f64(v.x).f64(v.y).f64(v.z);
  }

  quat(q: { x: number; y: number; z: number; w: number }): this {
    return this.f64(q.x).f64(q.y).f64(q.z).f64(q.w);
  }

  /** Final value (fmix32). */
  digest(): number {
    let h = this.h;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

export function hashShip(H: StateHasher, s: ShipEntity): void {
  const f = s.flight;
  H.u32(s.id).bool(s.alive).str(s.team);
  if (!s.alive) return;
  H.vec(f.position).vec(f.velocity).quat(f.orientation).vec(f.bodyRates);
  H.f64(f.throttle).f64(f.boostGauge).bool(f.boosting).bool(f.flightAssist).str(f.cruise).f64(f.cruiseT);
  H.f64(s.hull).f64(s.shield).f64(s.sinceHit).u32(s.target ? s.target.id : 0).u32(s.rng.state);
  const c = s.combat;
  H.u32(c.gun).u32(c.missile).f64(c.missileReload).u32(c.subTarget + 1).u32(c.subShip);
  const d = c.dmg;
  for (const x of d.facings) H.f64(x);
  // Shield power: trim, per-facing capacity / collapse cooldown / incoming-fire memory.
  H.u32(d.trim + 1).bool(d.trimAuto).f64(d.trimHold).f64(d.facingMax);
  for (const x of d.facingCap) H.f64(x);
  for (const x of d.cooldown) H.f64(x);
  for (const x of d.heat) H.f64(x);
  for (const x of d.zones) H.f64(x);
  for (const sub of d.subsystems) H.f64(sub.hp);
  // Kill paths: section integrity, the reactor's fuse and venting.
  const S = d.structure;
  for (const sec of S.sections) H.f64(sec.hp);
  H.str(S.reactor.phase).f64(S.reactor.t).f64(S.reactor.vent).u32(S.lastBy);
  const b = s.brain as { rng?: number; maneuver?: string; nextThink?: number } | null;
  if (b && typeof b.rng === 'number') H.u32(b.rng).str(b.maneuver ?? '').f64(b.nextThink ?? 0);
}

/** Hash of the combat world: fleet (+ weapons, missiles when given). */
export function hashWorld(fleet: Fleet, weapons?: Weapons | null, missiles?: Missiles | null, H = new StateHasher()): number {
  H.reset();
  H.u32(fleet.ships.length).u32(fleet.nextEntityId).u32(fleet.rng.state);
  for (const s of fleet.ships) hashShip(H, s);
  // Kill-path aftermath: wreck pieces (salvage) and live reactor shockwaves.
  const D = fleet.destruction;
  H.u32(D.wrecks.length).u32(D.shockwaves.length);
  for (const w of D.wrecks) H.u32(w.id).vec(w.position).quat(w.orientation).vec(w.spin).f64(w.salvaged).bool(w.taken);
  for (const w of D.shockwaves) H.u32(w.source.id).f64(w.r);
  if (weapons) {
    H.u32(weapons.rng.state);
    let n = 0;
    for (let i = 0; i < weapons.life.length; i++) {
      if (weapons.life[i] <= 0) continue;
      n++;
      H.u32(i).f64(weapons.px[i]).f64(weapons.py[i]).f64(weapons.pz[i]).f64(weapons.life[i]).u32(weapons.owner[i]);
    }
    H.u32(n);
    for (const b of weapons.beams) if (b.active) H.u32(b.owner.id).f64(b.life).vec(b.end);
  }
  if (missiles) {
    H.u32(missiles.rng.state);
    for (let i = 0; i < missiles.alive.length; i++) {
      if (!missiles.alive[i]) continue;
      H.u32(i).vec(missiles.pos[i]).vec(missiles.vel[i]).f64(missiles.hp[i]).u32(missiles.target[i]?.id ?? 0);
    }
  }
  return H.digest();
}

/** 8-hex-digit form for logs and replay checkpoints. */
export function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
