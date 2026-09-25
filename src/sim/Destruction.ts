import { Quaternion, Vector3 } from 'three';
import type { Fleet, ShipEntity } from './Fleet.ts';
import { shockwaveDamage, shockwaveSpec, type DeathCause, type ShockwaveSpec } from './Structure.ts';

/**
 * How big hulls die, as simulation (deterministic, hashed, replayed): what
 * a kill path leaves behind and what it does to the ships around it.
 *
 *   hull depletion  a rolling chain of section blasts, then the hull comes
 *                   apart into its three sections, burning, drifting apart
 *   structural      the failed section breaks the spine: two pieces, fire at
 *                   the break, spinning away from each other
 *   reactor         a white flash and an expanding shockwave that hits every
 *                   ship it crosses (explosive, through their shields); what
 *                   is left is one charred piece blown clear
 *   bridge          the ship strikes: the whole hull drifts dark on its last
 *                   vector — boardable, the richest salvage
 *
 * Wreck pieces persist (WRECK_LIFE) as salvage: flying slow and close to one
 * recovers fossil relics, sealed reactor cores and machine spares
 * (src/game/salvage.ts). Only capitals (hulls with sections) leave pieces;
 * everything else just goes up. Presentation (split hulls, fire, debris)
 * lives in src/world/DestructionFx.ts; this file owns only poses, timers and
 * yields. Deterministic: every die comes from the dead ship's own stream
 * (`ship.rng.fork('wreck')`), and the state is in StateHash.
 */
export interface SalvageYield {
  relics: number;
  cores: number;
  spares: number;
}

export interface WreckPiece {
  id: number;
  /** The dead ship (blueprint, livery, model to split). */
  ship: ShipEntity;
  cause: DeathCause;
  /** Ship-local z range this piece keeps (−∞..∞: the whole hull). */
  z0: number;
  z1: number;
  /** Ship-local centre of the piece (its pivot). */
  pivot: Vector3;
  /** Universe position of the pivot, velocity, orientation, world angular velocity (rad/s). */
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  spin: Vector3;
  /** Seconds before the pieces start to separate (the death chain plays on the whole hull first). */
  delay: number;
  /** Separation velocity and spin applied when the delay runs out. */
  kick: Vector3;
  kickSpin: Vector3;
  age: number;
  life: number;
  /** Seconds the break keeps burning. */
  burning: number;
  /** Ship-local z of the fire at the break (NaN: none). */
  breakZ: number;
  salvage: SalvageYield;
  /** Salvage progress 0..1; `taken` once recovered. */
  salvaged: number;
  taken: boolean;
}

export interface Shockwave {
  source: ShipEntity;
  by: ShipEntity | null;
  center: Vector3;
  r: number;
  age: number;
  spec: ShockwaveSpec;
  /** Ship ids already hit. */
  hit: Set<number>;
}

/** Wrecks stay in the system for 15 minutes of sim time. */
export const WRECK_LIFE = 900;
export const MAX_WRECKS = 16;

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _n = new Vector3();

export class Destruction {
  readonly wrecks: WreckPiece[] = [];
  readonly shockwaves: Shockwave[] = [];
  /** Wreck pieces made this tick (presentation builds their meshes). */
  readonly spawned: WreckPiece[] = [];
  private nextId = 1;

  constructor(private fleet: Fleet) {}

  /** Clear everything (system change, scene reset). */
  clear(): void {
    this.wrecks.length = 0;
    this.shockwaves.length = 0;
    this.spawned.length = 0;
  }

  /** A big hull died by `cause`: leave the pieces (and, for a reactor, the shockwave). */
  onKill(s: ShipEntity, cause: DeathCause, by: ShipEntity | null): void {
    const st = s.combat.dmg;
    if (!st.capital || !st.structure.sections.length) return;
    const rng = s.rng.fork('wreck');
    const f = s.flight;
    const big = s.model.length > 400;
    const S = st.structure;
    const cz = st.cz;
    const hl = st.halfL;
    const make = (z0: number, z1: number, delay: number, sep: number, spinK: number, burning: number, breakZ: number, y: SalvageYield): void => {
      const lo = Math.max(z0, cz - hl);
      const hi = Math.min(z1, cz + hl);
      const pivot = new Vector3(st.cx, st.cy, (lo + hi) / 2);
      const position = new Vector3().copy(pivot).applyQuaternion(f.orientation).add(f.position);
      // Pieces fly apart along the keel (away from the middle of the hull) and tumble end over end.
      const along = Math.sign(pivot.z - cz) || (rng.next() < 0.5 ? -1 : 1);
      const kick = new Vector3(rng.centered() * 0.4, rng.centered() * 0.4, along).normalize().multiplyScalar(sep).applyQuaternion(f.orientation);
      const kickSpin = new Vector3(along * (0.6 + rng.next() * 0.4), rng.centered() * 0.4, rng.centered() * 0.6).multiplyScalar(spinK).applyQuaternion(f.orientation);
      const mul = big ? 2 : 1;
      const w: WreckPiece = {
        id: this.nextId++,
        ship: s,
        cause,
        z0,
        z1,
        pivot,
        position,
        // A contact can leave the parent turning: each fragment inherits the
        // rigid body's velocity at its pivot, in addition to breakup energy.
        velocity: new Vector3(-f.bodyRates.x, f.bodyRates.y, f.bodyRates.z).applyQuaternion(f.orientation).cross(_a.copy(pivot).applyQuaternion(f.orientation)).add(f.velocity),
        orientation: f.orientation.clone(),
        spin: new Vector3(-f.bodyRates.x, f.bodyRates.y, f.bodyRates.z).applyQuaternion(f.orientation),
        delay,
        kick,
        kickSpin,
        age: 0,
        life: WRECK_LIFE,
        burning,
        breakZ,
        salvage: { relics: y.relics * mul, cores: y.cores * mul, spares: y.spares * mul },
        salvaged: 0,
        taken: false,
      };
      // No wait (struck hulls, a reactor's blown-clear piece): they part at once.
      if (delay <= 0) {
        w.velocity.add(kick);
        w.spin.add(kickSpin);
      }
      this.add(w);
    };
    const core = st.subsystems.find((x) => x.kind === 'reactor');
    const coreIntact = !!core && !core.destroyed && S.reactor.phase === 'ok';
    // Separation (m/s) and tumble (rad/s): slow enough to read as mass, fast enough to see.
    const sep = big ? 14 : 5;
    const spin = big ? 0.03 : 0.07;
    switch (cause) {
      case 'bridge':
        // Struck: one dark hull, a slow tumble, everything aboard still there.
        make(-Infinity, Infinity, 0, 0, big ? 0.004 : 0.012, 0, NaN, { relics: 3, cores: coreIntact ? 2 : 0, spares: 5 });
        break;
      case 'structural': {
        const z = S.breakZ;
        make(z, Infinity, 0.35, sep, spin, 90, z, { relics: 2, cores: 0, spares: 3 });
        make(-Infinity, z, 0.35, sep, spin, 90, z, { relics: 1, cores: coreIntact ? 1 : 0, spares: 3 });
        break;
      }
      case 'reactor': {
        // The core takes the middle of her with it: the end furthest from it is blown clear, charred.
        const rz = core ? core.z : cz;
        const keepFore = rz < cz;
        const cut = keepFore ? cz + hl * 0.35 : cz - hl * 0.35;
        if (keepFore) make(cut, Infinity, 0, sep * 3.5, spin * 4, 25, cut, { relics: 1, cores: 0, spares: 1 });
        else make(-Infinity, cut, 0, sep * 3.5, spin * 4, 25, cut, { relics: 1, cores: 0, spares: 1 });
        this.shockwaves.push({ source: s, by, center: f.position.clone(), r: 0, age: 0, spec: shockwaveSpec(s.model.length, s.hullMax), hit: new Set([s.id]) });
        break;
      }
      default: {
        // Hull depletion: the chain rolls along her, then she comes apart at the section joints.
        const b0 = S.sections[0].z0;
        const b1 = S.sections[1].z0;
        make(b0, Infinity, 3.4, sep * 0.7, spin * 0.8, 60, b0, { relics: 1, cores: 0, spares: 2 });
        make(b1, b0, 3.4, sep * 0.25, spin * 0.5, 60, NaN, { relics: 1, cores: coreIntact ? 1 : 0, spares: 2 });
        make(-Infinity, b1, 3.4, sep * 0.7, spin * 0.8, 60, b1, { relics: 0, cores: 0, spares: 2 });
      }
    }
  }

  private add(w: WreckPiece): void {
    this.wrecks.push(w);
    this.spawned.push(w);
    while (this.wrecks.length > MAX_WRECKS) this.wrecks.shift();
  }

  /** Nearest untaken wreck piece within `range` of `p` (salvage), or null. */
  nearest(p: Vector3, range: number): WreckPiece | null {
    let best: WreckPiece | null = null;
    let bd = range;
    for (const w of this.wrecks) {
      if (w.taken) continue;
      const d = w.position.distanceTo(p) - w.ship.model.length * this.extentFrac(w) * 0.5;
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Fraction of the hull length a piece keeps. */
  extentFrac(w: WreckPiece): number {
    const st = w.ship.combat.dmg;
    const lo = Math.max(w.z0, st.cz - st.halfL);
    const hi = Math.min(w.z1, st.cz + st.halfL);
    return Math.max(0.1, (hi - lo) / Math.max(1, st.halfL * 2));
  }

  /** One tick: shockwaves expand and hit what they cross; wreck pieces drift, spin, burn out, expire. */
  step(dt: number): void {
    this.spawned.length = 0;
    for (let k = this.shockwaves.length - 1; k >= 0; k--) {
      const w = this.shockwaves[k];
      const r0 = w.r;
      w.r += w.spec.speed * dt;
      w.age += dt;
      for (const o of this.fleet.ships) {
        if (!o.alive || w.hit.has(o.id)) continue;
        const d = o.flight.position.distanceTo(w.center) - o.radius * 0.5;
        if (d > w.r || d < r0 - o.radius) continue;
        w.hit.add(o.id);
        const dmg = shockwaveDamage(w.spec, Math.max(0, d), o.combat.dmg.capital);
        if (dmg <= 0) continue;
        _n.subVectors(o.flight.position, w.center).normalize();
        // Hit the side facing the blast; small ships are thrown and tumbled.
        _a.copy(o.flight.position).addScaledVector(_n, -o.radius * 0.8);
        if (!o.combat.dmg.capital) {
          const k2 = 1 - d / w.spec.radius;
          o.flight.velocity.addScaledVector(_n, 60 * k2);
          o.flight.bodyRates.x += 1.2 * k2;
        }
        this.fleet.hit(o, dmg, 'explosive', _a, _b.copy(_n).negate(), w.by);
      }
      for (const p of this.wrecks) {
        const d = p.position.distanceTo(w.center);
        if (d >= r0 && d < w.r && d < w.spec.radius) p.velocity.addScaledVector(_n.subVectors(p.position, w.center).normalize(), 8 * (1 - d / w.spec.radius));
      }
      if (w.r >= w.spec.radius) this.shockwaves.splice(k, 1);
    }
    for (let k = this.wrecks.length - 1; k >= 0; k--) {
      const p = this.wrecks[k];
      p.age += dt;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0) {
          p.velocity.add(p.kick);
          p.spin.add(p.kickSpin);
        }
      }
      p.position.addScaledVector(p.velocity, dt);
      const a = p.spin.length();
      if (a > 1e-9) {
        _q.setFromAxisAngle(_a.copy(p.spin).divideScalar(a), a * dt);
        p.orientation.premultiply(_q).normalize();
      }
      if (p.burning > 0) p.burning = Math.max(0, p.burning - dt);
      if (p.age >= p.life) this.wrecks.splice(k, 1);
    }
  }
}
