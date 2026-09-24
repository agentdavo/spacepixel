import { Quaternion, Vector3 } from 'three';
import { Particles } from '@/fx/Particles';
import { PAL, PK, type ParticlePalette } from '@/fx/kinds';
import { TRAIL_MISSILE, type TrailStyle } from '@/fx/Trails';
import { makeSpawn, resetSpawn } from '@/fx/spawn';
import { arcs, beamBurn, explosiveHit, harmonicHit, kineticHit, laserHit, shard, shieldSplash, subsystemBurst } from '@/fx/impacts';
import { DamageFx } from './DamageFx';
import { DECAL, ImpactDecals } from './ImpactDecals';
import { facingAt, facingLayout, sampleFacing, shellDir, shellPoint, shellScale } from './ShieldGeometry';
import type { WeaponEvent, Weapons } from '@/sim/Weapons';
import type { MissileEvent, Missiles } from '@/sim/Missiles';
import { MISSILE_CAPACITY } from '@/sim/Missiles';
import type { ShipEntity } from '@/sim/Fleet';
import type { Subsystem, SubsystemKind } from '@/sim/Damage';
import type { DamageType } from '@/sim/Loadouts';

/**
 * Turns the sim's event arrays into particles: impact sparks, shield
 * ripples, fighter fireballs + debris, Itano-circus smoke trails on every
 * missile, and a rolling chain of blasts when a capital ship dies. Reads
 * events; owns no simulation state beyond trail handles and pending blasts.
 *
 * Impacts read per damage type (the event's `type`, else its gun's):
 * kinetic sparks, chips and a dent flash; laser molten spots, droplets and
 * vapour; harmonic arcs crawling over the plating; warheads a shock ring
 * flat along the hull. On capitals, hits that reach the plating also leave
 * hot marks that cool into the damage model's scars (ImpactDecals), and a
 * beam sweeping bare plating burns a cut line. Shield hits splash off the
 * shell (the ripple is WeaponVisuals'); a failing facing throws hexagon
 * shards; a dying subsystem blows out with secondaries and leaves a fire
 * and smoke column that burns down into DamageFx's crater.
 */
interface Chain {
  ship: ShipEntity;
  t: number;
  next: number;
  left: number;
}

/** A delayed secondary blast (subsystem deaths). Pooled. */
interface Pop {
  ship: ShipEntity | null;
  t: number;
  /** Ship-local position / outward normal. */
  lx: number;
  ly: number;
  lz: number;
  scale: number;
  pal: ParticlePalette;
}

/** A dying subsystem's fire / smoke column (ship-local anchor, burns down over `dur`). Pooled. */
interface Column {
  ship: ShipEntity | null;
  sub: Subsystem | null;
  t: number;
  dur: number;
  next: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  pal: ParticlePalette;
  arcs: boolean;
}

/** Last contact of each beam on bare plating (burn cut lines). */
interface Cut {
  shooter: ShipEntity | null;
  ship: ShipEntity | null;
  lx: number;
  ly: number;
  lz: number;
  t: number;
}

const POPS = 32;
const COLUMNS = 16;
const CUTS = 16;

/** Subsystem blast scale by kind (× its routing radius): hangars, engines and generators go up hardest. */
const SUB_BLAST: Record<SubsystemKind, number> = { turret: 1, lance: 1.2, bridge: 1.35, shieldEmitter: 1.3, shieldGen: 1.6, hangar: 1.9, engine: 2 };

const _p = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _d = new Vector3();
const _s = new Vector3();
const sd = makeSpawn();

/** Heavy torpedo: a fat, slow-dissolving smoke rope with a hot orange head. */
const TRAIL_TORPEDO: TrailStyle = { ...TRAIL_MISSILE, size0: 2.2, size1: 9, lifeMin: 4, lifeMax: 6, spacing: 3.5, jitter: 1.2, glint: 5 };
/** Harpoon: short, thin, fast. */
const TRAIL_HARPOON: TrailStyle = { ...TRAIL_MISSILE, size0: 0.6, size1: 2.4, lifeMin: 1.0, lifeMax: 1.6, glint: 1.6 };

function paletteOf(s: ShipEntity | null): ParticlePalette {
  return s?.faction === 'choir' ? PAL.MAGENTA : PAL.WARM;
}

/** Shield colour family per faction (cyan Directorate, magenta Choir, amber Rustwake). */
function shieldPalette(s: ShipEntity): ParticlePalette {
  return s.faction === 'choir' ? PAL.MAGENTA : s.faction === 'rustwake' ? PAL.WARM : PAL.PLASMA;
}

export class CombatFx {
  readonly fx = new Particles();
  /** Scorch marks, smoke trails, burning craters (reads the fleet's damage state). */
  readonly damage: DamageFx;
  /** Hot impact marks and beam cut lines stuck to capital plating. */
  readonly decals = new ImpactDecals();
  private trail = new Int32Array(MISSILE_CAPACITY).fill(-1);
  private chains: Chain[] = [];
  private pops: Pop[] = [];
  private columns: Column[] = [];
  private cuts: Cut[] = [];
  private rng = 777;
  /** Sim time seen by consume() (beam cut-line continuity). */
  private clock = 0;
  private readonly randFn = (): number => this.rand();

  /** Event / missile sources: the live sim, or the kill-cam's recorded frame (same shapes). */
  weapons: Pick<Weapons, 'events'>;
  missiles: Pick<Missiles, 'events' | 'alive' | 'pos' | 'age' | 'spec'>;

  constructor(weapons: Weapons, missiles: Missiles) {
    this.weapons = weapons;
    this.missiles = missiles;
    this.damage = new DamageFx(weapons.fleet, this.fx);
    // Drawn with the particles (every scene already adds `fx.object`).
    this.fx.object.add(this.decals.mesh);
    for (let i = 0; i < POPS; i++) this.pops.push({ ship: null, t: 0, lx: 0, ly: 0, lz: 0, scale: 0, pal: PAL.WARM });
    for (let i = 0; i < COLUMNS; i++) this.columns.push({ ship: null, sub: null, t: 0, dur: 0, next: 0, nx: 0, ny: 1, nz: 0, r: 0, pal: PAL.WARM, arcs: false });
    for (let i = 0; i < CUTS; i++) this.cuts.push({ shooter: null, ship: null, lx: 0, ly: 0, lz: 0, t: -1 });
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng - 1) / 2147483646;
  }

  /** Consume this frame's events. Call after weapons/missiles step. */
  consume(dt: number): void {
    const fx = this.fx;
    this.clock += dt;
    for (const e of this.weapons.events) {
      switch (e.kind) {
        case 'hit':
          this.hullHit(e, true);
          break;
        case 'shield':
        case 'shield-bleed':
          this.shieldHit(e);
          break;
        case 'shield-down':
          if (e.ship) this.shieldCollapse(e.ship, e.position, e.facing);
          break;
        case 'shield-up':
          if (e.ship) this.shieldRegen(e.ship, e.facing);
          break;
        case 'subsystem':
          if (e.ship && e.sub) this.subsystemDeath(e.ship, e.sub, e.normal, true);
          break;
        case 'beam-hit':
          this.beamHit(e);
          break;
        case 'kill': {
          const s = e.ship;
          if (!s) break;
          this.decals.clearShip(s);
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
      this.detonation(e, true);
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
    this.stepPops(dt);
    this.stepColumns(dt);

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

  /**
   * Kill-cam: re-play recorded events as particles. No death chains, trails,
   * scorch marks or hull marks — those belong to the live world and resume with it.
   */
  replayEvents(w: readonly WeaponEvent[], m: readonly MissileEvent[]): void {
    const fx = this.fx;
    for (const e of w) {
      const s = e.ship;
      if (e.kind === 'hit') this.hullHit(e, false);
      else if (e.kind === 'shield') this.shieldHit(e);
      else if (e.kind === 'shield-down' && s) this.shieldCollapse(s, e.position, e.facing);
      else if (e.kind === 'subsystem' && s && e.sub) this.subsystemDeath(s, e.sub, e.normal, false);
      else if (e.kind === 'kill' && s) {
        const big = s.radius > 60;
        fx.explosion(e.position, e.velocity, big ? s.model.radius * 0.35 : Math.max(10, s.radius * 1.4), paletteOf(s));
        fx.debris(e.position, e.velocity, big ? s.model.radius * 0.12 : s.radius, big ? 24 : 10);
      }
    }
    for (const e of m) if (e.kind === 'detonate') this.detonation(e, false);
  }

  // ── impacts ──────────────────────────────────────────────────────────

  /** Impact scale: grows with the shot's damage, and on capitals (they're seen from further out). */
  private impactScale(e: WeaponEvent, s: ShipEntity): number {
    const amt = e.amount || e.gun?.damage || 6;
    return Math.min(4, Math.max(0.6, Math.sqrt(amt / 6))) * (s.combat.dmg.capital ? 4 : 1);
  }

  /**
   * A shot that reached the plating. Fighters are hit on their collision
   * sphere, so their impacts are pulled in onto the airframe.
   */
  private hullHit(e: WeaponEvent, live: boolean): void {
    const s = e.ship;
    if (!s) {
      this.fx.impact(e.position, e.normal, e.velocity, PAL.WARM);
      return;
    }
    const cap = s.combat.dmg.capital;
    const v = s.flight.velocity;
    const sc = this.impactScale(e, s);
    _n.copy(e.normal);
    if (cap) _p.copy(e.position);
    else {
      shellPoint(s, shellDir(s, e.position, _d), _p, _n);
      _p.lerp(s.flight.position, 0.3);
    }
    const type: DamageType = e.type ?? e.gun?.type ?? 'laser';
    const dec = live && cap;
    switch (type) {
      case 'kinetic':
        kineticHit(this.fx, _p, _n, v, e.velocity, sc);
        if (dec) this.decals.add(s, _p, _n, DECAL.DENT, 1.1 * sc, 1.4);
        break;
      case 'harmonic':
        harmonicHit(this.fx, _p, _n, v, sc, PAL.PLASMA);
        if (dec) this.decals.add(s, _p, _n, DECAL.ION, 1.5 * sc, 1.8);
        break;
      case 'explosive':
        this.fx.explosion(_p, v, sc * 2, PAL.WARM);
        explosiveHit(this.fx, _p, _n, v, sc * 2, !cap);
        if (dec) this.decals.add(s, _p, _n, DECAL.CRATER, 2.4 * sc, 4.5);
        break;
      default:
        laserHit(this.fx, _p, _n, v, sc, !dec);
        if (dec) this.decals.add(s, _p, _n, DECAL.MOLTEN, 1.4 * sc, 2.8);
        break;
    }
  }

  /** A bolt splashing off a shield: particles on the shell (the ripple itself is the shell shader's). */
  private shieldHit(e: WeaponEvent): void {
    const s = e.ship;
    if (!s) return;
    shellPoint(s, shellDir(s, e.position, _d), _p, _n);
    const sc = this.impactScale(e, s) * (s.combat.dmg.capital ? 1.4 : 1);
    shieldSplash(this.fx, _p, _n, s.flight.velocity, e.velocity, sc, e.type ?? e.gun?.type, shieldPalette(s));
  }

  /** Beam contact, every tick: a boiling splash on a shield, or a burning cut on bare plating. */
  private beamHit(e: WeaponEvent): void {
    const s = e.ship;
    if (!s) return;
    const cap = s.combat.dmg.capital;
    const v = s.flight.velocity;
    if (e.shielded) {
      if (this.rand() > 0.4) return;
      shellPoint(s, shellDir(s, e.position, _d), _p, _n);
      shieldSplash(this.fx, _p, _n, v, e.velocity, cap ? 2.4 : 1, e.type === 'harmonic' && this.rand() < 0.3 ? 'harmonic' : 'laser', shieldPalette(s));
      return;
    }
    beamBurn(this.fx, e.position, e.normal, v, cap ? 3 : 1, e.type === 'harmonic', this.rand() < 0.12);
    if (!cap || !e.shooter) return;
    // Cut line: chain capsule segments behind the contact as the beam sweeps.
    const w = e.shooter.combat.dmg.capital ? 3.2 : 1.4;
    let c: Cut | null = null;
    let oldest: Cut = this.cuts[0];
    for (const k of this.cuts) {
      if (k.shooter === e.shooter && k.ship === s) c = k;
      if (k.t < oldest.t) oldest = k;
    }
    const now = this.clock;
    if (c && now - c.t < 0.25) {
      _v.set(c.lx, c.ly, c.lz).applyQuaternion(s.flight.orientation).add(s.flight.position);
      const dist = _v.distanceTo(e.position);
      if (dist < w * 1.2) {
        // Dwelling: the spot keeps heating (merged into the live molten mark).
        if (this.rand() < 0.2) this.decals.add(s, e.position, e.normal, DECAL.MOLTEN, w * 1.3, 3);
        c.t = now;
        return;
      }
      if (dist < w * 40) this.decals.add(s, e.position, e.normal, DECAL.CUT, w, 3.6, _v);
    } else c = oldest;
    c.shooter = e.shooter;
    c.ship = s;
    c.t = now;
    _v.subVectors(e.position, s.flight.position).applyQuaternion(_qInv(s));
    c.lx = _v.x;
    c.ly = _v.y;
    c.lz = _v.z;
  }

  /** Missile detonation: a warhead on a shield, on plating, or shot down in space. */
  private detonation(e: MissileEvent, live: boolean): void {
    const fx = this.fx;
    const big = e.spec.id === 'torpedo';
    const t = e.target;
    if (e.intercepted || !t) {
      fx.explosion(e.position, e.velocity, e.intercepted ? (big ? 16 : 6) : big ? 45 : 7, PAL.WARM);
      return;
    }
    const v = t.flight.velocity;
    const scale = big ? 45 : e.spec.id === 'harpoon' ? 5 : 7;
    const n = e.normal && e.normal.lengthSq() > 0.25 ? e.normal : _n.subVectors(e.position, t.flight.position).normalize();
    if (e.shielded) {
      // The shield takes it: the blast flattens against the shell.
      shellPoint(t, shellDir(t, e.position, _d), _p, _s);
      fx.explosion(_p, v, scale * 0.6, shieldPalette(t) === PAL.MAGENTA ? PAL.MAGENTA : PAL.WARM);
      shieldSplash(fx, _p, _s, v, e.velocity, scale * 0.25, 'explosive', shieldPalette(t));
      return;
    }
    fx.explosion(e.position, v, scale, PAL.WARM);
    explosiveHit(fx, e.position, n, v, scale * 0.6, !t.combat.dmg.capital);
    if (live && t.combat.dmg.capital) this.decals.add(t, e.position, n, DECAL.CRATER, scale * 0.9, big ? 7 : 3.5);
  }

  // ── shields ──────────────────────────────────────────────────────────

  /**
   * A shield facing (or a fighter's bubble) failing: a flash and a hard
   * ring at the hit, and the facing's lattice breaking into hexagon shards
   * that tumble off the shell (the fold-in itself is the shell shader's).
   */
  private shieldCollapse(s: ShipEntity, pos: Vector3, facing: number): void {
    const fx = this.fx;
    const cap = s.combat.dmg.capital;
    shellScale(s, _s);
    const big = Math.max(_s.x, _s.y, _s.z);
    const size = cap ? Math.min(420, s.model.length * 0.14) : big * 1.4;
    const pal = shieldPalette(s);
    const v = s.flight.velocity;
    shellPoint(s, shellDir(s, pos, _d), _p, _n);
    resetSpawn(sd);
    sd.kind = PK.RING;
    sd.palette = pal;
    sd.pos.copy(_p);
    sd.baseVel.copy(v);
    sd.dir.copy(_n);
    sd.size0 = size * 0.3;
    sd.size1 = size * 1.6;
    sd.lifeMin = sd.lifeMax = 0.5;
    fx.emit(sd);
    resetSpawn(sd);
    sd.kind = PK.FLASH;
    sd.palette = pal;
    sd.pos.copy(_p);
    sd.baseVel.copy(v);
    sd.size0 = sd.size1 = size * 0.7;
    sd.lifeMin = sd.lifeMax = 0.16;
    fx.emit(sd);
    resetSpawn(sd);
    sd.kind = PK.GLINT;
    sd.palette = pal;
    sd.pos.copy(_p);
    sd.baseVel.copy(v);
    sd.dir.copy(_n);
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
    // Shards over the failing facing (the hit's side of a bubble).
    const f = facingLayout(s).count ? (facing >= 0 ? facing : facingAt(s, _d)) : -1;
    const cell = big * (cap ? 0.02 : 0.085);
    const nShards = cap ? 26 : 12;
    for (let k = 0; k < nShards; k++) {
      if (f >= 0) sampleFacing(s, f, this.randFn, _v);
      else _v.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(1.2).add(_d).normalize();
      shellPoint(s, _v, _p, _n);
      shard(fx, _p, _n, v, cell * (1.1 + this.rand() * 0.8), cell * (0.5 + this.rand() * 3), pal, 0.7 + this.rand() * 0.6);
    }
  }

  /** A facing coming back: motes wink on over it as the shell shader's sweep redraws it. */
  private shieldRegen(s: ShipEntity, facing: number): void {
    const cap = s.combat.dmg.capital;
    const f = facingLayout(s).count ? Math.max(0, facing) : -1;
    shellScale(s, _s);
    const big = Math.max(_s.x, _s.y, _s.z);
    const pal = shieldPalette(s);
    const n = cap ? 6 : 3;
    for (let k = 0; k < n; k++) {
      sampleFacing(s, f, this.randFn, _v);
      shellPoint(s, _v, _p, _n);
      resetSpawn(sd);
      sd.kind = PK.GLINT;
      sd.palette = pal;
      sd.pos.copy(_p);
      sd.baseVel.copy(s.flight.velocity);
      sd.count = 3;
      sd.jitter = big * (cap ? 0.05 : 0.2);
      sd.size0 = sd.size1 = big * (cap ? 0.012 : 0.06);
      sd.sizeJitter = 0.5;
      sd.lifeMin = 0.15;
      sd.lifeMax = 0.3;
      sd.delay = 0.9;
      this.fx.emit(sd);
    }
  }

  // ── subsystems ───────────────────────────────────────────────────────

  /**
   * A subsystem dies: flash, a blast punched out of the plating with a shock
   * ring along the hull, debris, the fireball, then secondaries and a fire /
   * smoke column that burns down over several seconds (generators crackle).
   * Hangars, engines and generators go up hardest.
   */
  private subsystemDeath(s: ShipEntity, sub: Subsystem, normal: Vector3, live: boolean): void {
    const fx = this.fx;
    const st = s.combat.dmg;
    const mul = SUB_BLAST[sub.kind] ?? 1;
    const r = sub.radius * mul;
    const gen = sub.kind === 'shieldGen' || sub.kind === 'shieldEmitter';
    const pal = gen ? PAL.PLASMA : paletteOf(s);
    const v = s.flight.velocity;
    _p.set(sub.x, sub.y, sub.z).applyQuaternion(s.flight.orientation).add(s.flight.position);
    // Outward: the hit normal if it has one, else away from the hull's long axis.
    if (normal.lengthSq() > 0.25 && Math.abs(normal.y) < 0.999) _n.copy(normal).normalize();
    else _n.set(sub.x - st.cx, (sub.y - st.cy) * 1.5 + st.halfH * 0.2, 0).normalize().applyQuaternion(s.flight.orientation);
    subsystemBurst(fx, _p, _n, v, r, pal);
    fx.explosion(_v.copy(_p).addScaledVector(_n, r * 0.3), v, r * 0.9, pal);
    if (gen) arcs(fx, _p, _n, v, r * 0.5, 8, PAL.PLASMA, 0.8);
    if (!live) return;
    this.decals.add(s, _p, _n, DECAL.CRATER, r * 0.7, 6);
    // Secondaries: two pops (three for the big ones) around the socket.
    const q = _qInv(s);
    const nPops = mul >= 1.6 ? 3 : 2;
    for (let k = 0; k < nPops; k++) {
      const p = this.pops.find((x) => !x.ship) ?? this.pops[k];
      _v.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(r * 1.1).add(_p).sub(s.flight.position).applyQuaternion(q);
      p.ship = s;
      p.t = -(0.28 + k * 0.33 + this.rand() * 0.12);
      p.lx = _v.x;
      p.ly = _v.y;
      p.lz = _v.z;
      p.scale = r * (0.55 - k * 0.08);
      p.pal = pal;
    }
    // Column: ship-local anchor + outward normal.
    let c = this.columns.find((x) => !x.ship);
    if (!c) {
      c = this.columns[0];
      for (const x of this.columns) if (x.t / x.dur > c.t / c.dur) c = x;
    }
    _d.copy(_n).applyQuaternion(q);
    c.ship = s;
    c.sub = sub;
    c.t = 0;
    c.dur = 4 + 3.5 * (mul - 1);
    c.next = 0.15;
    c.nx = _d.x;
    c.ny = _d.y;
    c.nz = _d.z;
    c.r = r;
    c.pal = pal;
    c.arcs = gen;
  }

  private stepPops(dt: number): void {
    for (const p of this.pops) {
      const s = p.ship;
      if (!s) continue;
      if (!s.alive) {
        p.ship = null;
        continue;
      }
      p.t += dt;
      if (p.t < 0) continue;
      _p.set(p.lx, p.ly, p.lz).applyQuaternion(s.flight.orientation).add(s.flight.position);
      this.fx.explosion(_p, s.flight.velocity, p.scale, p.pal);
      this.fx.debris(_p, s.flight.velocity, p.scale * 0.3, 5);
      p.ship = null;
    }
  }

  private stepColumns(dt: number): void {
    const fx = this.fx;
    for (const c of this.columns) {
      const s = c.ship;
      if (!s || !c.sub) continue;
      c.t += dt;
      if (!s.alive || c.t >= c.dur) {
        c.ship = null;
        continue;
      }
      if (c.t < c.next) continue;
      c.next = c.t + 0.12;
      const k = 1 - c.t / c.dur;
      const r = c.r * (0.45 + 0.55 * Math.sqrt(k));
      _p.set(c.sub.x, c.sub.y, c.sub.z).applyQuaternion(s.flight.orientation).add(s.flight.position);
      _n.set(c.nx, c.ny, c.nz).applyQuaternion(s.flight.orientation);
      const v = s.flight.velocity;
      // Licks of fire boiling up out of the wreck…
      resetSpawn(sd);
      sd.kind = PK.FIRE;
      sd.palette = c.pal;
      sd.pos.copy(_p);
      sd.baseVel.copy(v);
      sd.dir.copy(_n);
      sd.spread = 0.25;
      sd.count = k > 0.5 ? 3 : 2;
      sd.jitter = r * 0.25;
      sd.speedMin = r * 0.5;
      sd.speedMax = r * 1.3;
      sd.drag = 1.6;
      sd.size0 = r * 0.14;
      sd.size1 = r * 0.34;
      sd.sizeJitter = 0.35;
      sd.lifeMin = 0.4;
      sd.lifeMax = 0.8;
      fx.emit(sd);
      // …under a leaning column of ink-lined smoke.
      resetSpawn(sd);
      sd.kind = PK.SMOKE;
      sd.palette = c.pal;
      sd.pos.copy(_p).addScaledVector(_n, r * 0.4);
      sd.baseVel.copy(v).addScaledVector(_n, r * 0.35);
      sd.dir.copy(_n);
      sd.spread = 0.2;
      sd.count = 2;
      sd.jitter = r * 0.25;
      sd.speedMin = r * 0.2;
      sd.speedMax = r * 0.5;
      sd.drag = 0.5;
      sd.size0 = r * 0.25;
      sd.size1 = r * 0.8;
      sd.sizeJitter = 0.3;
      sd.lifeMin = 2.2;
      sd.lifeMax = 3.6;
      sd.ageA = sd.ageB = -0.04;
      fx.emit(sd);
      if (c.arcs && this.rand() < 0.6) arcs(fx, _p, _n, v, r * 0.35, 2, PAL.PLASMA, 0.1);
    }
  }

  /** Once per frame after the eye is final. */
  update(dt: number, eye: Vector3): void {
    this.damage.paint();
    this.decals.update(dt, eye);
    this.fx.update(dt, eye);
  }
}

const _q = new Quaternion();
/** Inverse of the ship's sim orientation (universe → ship-local). Shared scratch. */
function _qInv(s: ShipEntity): Quaternion {
  return _q.copy(s.flight.orientation).invert();
}
