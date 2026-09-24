import { Vector3 } from 'three';
import { PAL, PK, type ParticleKind, type ParticlePalette } from './kinds';
import type { Particles } from './Particles';
import { makeSpawn, resetSpawn, type SpawnDesc } from './spawn';

/**
 * Weapon-impact presets, one look per damage type (Loadouts.DamageType),
 * cel-timed like presets.ts. `s` is the impact scale: 1 ≈ a pulse-laser bolt
 * on a fighter; callers grow it with damage and target size (see
 * CombatFx.impactScale). All positions are universe; `vel` is the target's
 * velocity (debris and glows ride along with it).
 *
 *   kinetic    dent flash, a ricochet fan of hard sparks, flying hull chips
 *   laser      a molten spot that cools white → orange → red → dark,
 *              spat droplets, a curl of white vapour
 *   harmonic   blue-white arcs crawling over the plating, ion glints
 *   explosive  (warhead on plating) a shock ring flat along the hull,
 *              a debris spray and a glowing crater
 *   shield     a splash off the shell per type (ricochet sparks, spray,
 *              crawling arcs, a shock ring) — the ripple itself is the
 *              shell shader's (WeaponVisuals)
 */

const d: SpawnDesc = makeSpawn();
const _v = new Vector3();
const _r = new Vector3();

function begin(kind: ParticleKind, palette: ParticlePalette, pos: Vector3, vel: Vector3): SpawnDesc {
  resetSpawn(d);
  d.kind = kind;
  d.palette = palette;
  d.pos.copy(pos);
  d.baseVel.copy(vel);
  return d;
}

/** Mirror `inc` (incoming direction, any length) about `n`, mixed toward the normal; falls back to `n`. */
function ricochet(inc: Vector3, n: Vector3, out: Vector3): Vector3 {
  const l = inc.length();
  if (l < 1e-3) return out.copy(n);
  out.copy(inc).divideScalar(l);
  out.addScaledVector(n, -2 * out.dot(n));
  return out.addScaledVector(n, 0.6).normalize();
}

/** Kinetic slug on bare plating. */
export function kineticHit(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, inc: Vector3, s: number): void {
  const rs = Math.sqrt(s);
  // Dent flash: a hard white star, then a short orange glow in the dent.
  begin(PK.FLASH, PAL.WARM, _v.copy(pos).addScaledVector(n, 0.2 * s), vel);
  d.size0 = d.size1 = 2.2 * s;
  d.lifeMin = d.lifeMax = 0.07;
  fx.emit(d);
  begin(PK.EMBER, PAL.WARM, _v, vel);
  d.size0 = 0.7 * s;
  d.size1 = 0.45 * s;
  d.lifeMin = d.lifeMax = 0.28;
  fx.emit(d);

  // Ricochet fan.
  begin(PK.SPARK, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(10 + 5 * s, 36));
  ricochet(inc, n, d.dir);
  d.spread = 0.3;
  d.speedMin = 60 * rs;
  d.speedMax = 240 * rs;
  d.drag = 2.4;
  d.size0 = d.size1 = 0.11 * rs;
  d.sizeJitter = 0.5;
  d.lifeMin = 0.14;
  d.lifeMax = 0.42;
  fx.emit(d);

  // Hull chips: small tumbling cel chunks with hot edges.
  begin(PK.DEBRIS, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(2 + s, 7));
  d.dir.copy(n);
  d.spread = 0.55;
  d.speedMin = 14 * rs;
  d.speedMax = 55 * rs;
  d.drag = 0.4;
  d.size0 = d.size1 = 0.2 * s;
  d.sizeJitter = 0.5;
  d.lifeMin = 0.9;
  d.lifeMax = 1.8;
  fx.emit(d);

  begin(PK.SMOKE, PAL.WARM, _v.copy(pos).addScaledVector(n, 0.8 * s), vel);
  d.dir.copy(n);
  d.spread = 0.4;
  d.jitter = 0.3 * s;
  d.speedMin = 1.5 * rs;
  d.speedMax = 4 * rs;
  d.drag = 1.5;
  d.size0 = 0.45 * s;
  d.size1 = 1.3 * s;
  d.lifeMin = 0.6;
  d.lifeMax = 0.9;
  d.ageA = d.ageB = -0.06;
  fx.emit(d);
}

/**
 * Laser on bare plating. `spot` false leaves the molten spot to a hull
 * decal (capitals: ImpactDecals sticks it to the plating).
 */
export function laserHit(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, s: number, spot = true, palette: ParticlePalette = PAL.WARM): void {
  const rs = Math.sqrt(s);
  begin(PK.FLASH, palette, _v.copy(pos).addScaledVector(n, 0.15 * s), vel);
  d.size0 = d.size1 = 1.8 * s;
  d.lifeMin = d.lifeMax = 0.07;
  fx.emit(d);
  if (spot) {
    begin(PK.EMBER, PAL.WARM, _v, vel);
    d.size0 = 0.75 * s;
    d.size1 = 0.55 * s;
    d.lifeMin = 0.8;
    d.lifeMax = 1.1;
    fx.emit(d);
  }
  // Molten droplets: spat out, cooling as they fly.
  begin(PK.EMBER, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(4 + 3 * s, 18));
  d.dir.copy(n);
  d.spread = 0.45;
  d.speedMin = 18 * rs;
  d.speedMax = 75 * rs;
  d.drag = 1.4;
  d.size0 = 0.14 * rs;
  d.size1 = 0.07 * rs;
  d.sizeJitter = 0.4;
  d.lifeMin = 0.35;
  d.lifeMax = 0.8;
  fx.emit(d);
  // Vapour: a white curl boiling off the burn (starts past the puff's hot frames).
  begin(PK.PUFF, PAL.WARM, _v.copy(pos).addScaledVector(n, 0.5 * s), vel);
  d.count = 2;
  d.dir.copy(n);
  d.spread = 0.3;
  d.jitter = 0.25 * s;
  d.speedMin = 2 * rs;
  d.speedMax = 7 * rs;
  d.drag = 1.2;
  d.size0 = 0.35 * s;
  d.size1 = 1.5 * s;
  d.sizeJitter = 0.3;
  d.lifeMin = 0.7;
  d.lifeMax = 1.2;
  d.ageA = d.ageB = 0.09;
  fx.emit(d);
}

/** Harmonic pulse on bare plating: arcs crawl over the surface around the hit. */
export function harmonicHit(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, s: number, palette: ParticlePalette = PAL.PLASMA): void {
  begin(PK.FLASH, palette, _v.copy(pos).addScaledVector(n, 0.2 * s), vel);
  d.size0 = d.size1 = 1.7 * s;
  d.lifeMin = d.lifeMax = 0.08;
  fx.emit(d);
  begin(PK.EMBER, PAL.PLASMA, _v, vel);
  d.size0 = 0.9 * s;
  d.size1 = 0.4 * s;
  d.lifeMin = d.lifeMax = 0.35;
  fx.emit(d);
  arcs(fx, _v.copy(pos).addScaledVector(n, 0.15 * s), n, vel, s, 3 + Math.min(4, Math.round(s)), PAL.PLASMA, 0.35);
  begin(PK.GLINT, PAL.PLASMA, pos, vel);
  d.count = 5;
  d.jitter = 1.4 * s;
  d.dir.copy(n);
  d.spread = 0.7;
  d.speedMin = 3 * s;
  d.speedMax = 14 * s;
  d.drag = 2;
  d.size0 = d.size1 = 0.35 * s;
  d.sizeJitter = 0.5;
  d.lifeMin = 0.08;
  d.lifeMax = 0.22;
  d.delay = 0.3;
  fx.emit(d);
}

/** Crackling arcs lying on the surface (plane normal `n`), staggered over `delay` s. */
export function arcs(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, s: number, count: number, palette: ParticlePalette, delay: number): void {
  begin(PK.ARC, palette, pos, vel);
  d.count = count;
  d.dir.copy(n);
  d.jitter = 0.9 * s;
  d.size0 = 1.6 * s;
  d.size1 = 2.4 * s;
  d.sizeJitter = 0.35;
  d.lifeMin = 0.12;
  d.lifeMax = 0.3;
  d.delay = delay;
  fx.emit(d);
}

/** Warhead on plating: shock ring flat along the hull, debris spray, glowing crater (the fireball is presets.explosion). */
export function explosiveHit(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, s: number, glow = true): void {
  const ts = Math.min(Math.max(Math.pow(s / 10, 0.35), 0.7), 3);
  begin(PK.RING, PAL.WARM, _v.copy(pos).addScaledVector(n, 0.1 * s), vel);
  d.dir.copy(n);
  d.size0 = 0.3 * s;
  d.size1 = 3.4 * s;
  d.lifeMin = d.lifeMax = 0.5 * ts;
  fx.emit(d);
  begin(PK.DEBRIS, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(6 + s * 0.3, 18));
  d.dir.copy(n);
  d.spread = 0.5;
  d.speedMin = 4 * s;
  d.speedMax = 12 * s;
  d.drag = 0.2;
  d.size0 = d.size1 = 0.16 * s;
  d.sizeJitter = 0.6;
  d.lifeMin = 2.5;
  d.lifeMax = 5;
  fx.emit(d);
  begin(PK.SPARK, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(16 + s, 40));
  d.dir.copy(n);
  d.spread = 0.6;
  d.speedMin = 10 * s;
  d.speedMax = 30 * s;
  d.drag = 1.5;
  d.size0 = d.size1 = Math.max(0.05 * s, 0.12);
  d.sizeJitter = 0.5;
  d.lifeMin = 0.3;
  d.lifeMax = 0.8;
  fx.emit(d);
  if (!glow) return;
  begin(PK.EMBER, PAL.WARM, _v.copy(pos).addScaledVector(n, 0.2 * s), vel);
  d.size0 = 0.8 * s;
  d.size1 = 0.6 * s;
  d.lifeMin = d.lifeMax = 1.3 * ts;
  fx.emit(d);
}

/** Splash off a shield shell, per damage type. `n` = shell normal, `inc` = the shot's velocity (kinetic ricochet). */
export function shieldSplash(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, inc: Vector3, s: number, type: string | undefined, palette: ParticlePalette): void {
  const rs = Math.sqrt(s);
  begin(PK.FLASH, palette, _v.copy(pos).addScaledVector(n, 0.3 * s), vel);
  d.size0 = d.size1 = (type === 'explosive' ? 4 : 1.6) * s;
  d.lifeMin = d.lifeMax = type === 'explosive' ? 0.14 : 0.08;
  fx.emit(d);
  switch (type) {
    case 'kinetic':
      // Slugs skip off the shell: a hot amber ricochet fan.
      begin(PK.SPARK, PAL.WARM, pos, vel);
      d.count = Math.round(Math.min(8 + 4 * s, 28));
      ricochet(inc, n, d.dir);
      d.spread = 0.22;
      d.speedMin = 90 * rs;
      d.speedMax = 260 * rs;
      d.drag = 2.2;
      d.size0 = d.size1 = 0.1 * rs;
      d.sizeJitter = 0.5;
      d.lifeMin = 0.12;
      d.lifeMax = 0.35;
      fx.emit(d);
      break;
    case 'harmonic':
      // Harmonics strip shields: arcs crawl over the shell and it spits motes.
      arcs(fx, pos, n, vel, s * 1.4, 3 + Math.min(3, Math.round(s * 0.5)), palette, 0.3);
      begin(PK.GLINT, palette, pos, vel);
      d.count = 6;
      d.jitter = 1.5 * s;
      d.dir.copy(n);
      d.spread = 0.8;
      d.speedMin = 8 * rs;
      d.speedMax = 30 * rs;
      d.drag = 2;
      d.size0 = d.size1 = 0.4 * s;
      d.sizeJitter = 0.5;
      d.lifeMin = 0.15;
      d.lifeMax = 0.35;
      fx.emit(d);
      break;
    case 'explosive':
      begin(PK.RING, palette, pos, vel);
      d.dir.copy(n);
      d.size0 = 0.5 * s;
      d.size1 = 4.5 * s;
      d.lifeMin = d.lifeMax = 0.45;
      fx.emit(d);
      break;
    default:
      // Energy splashes off along the shell.
      begin(PK.SPARK, palette, pos, vel);
      d.count = Math.round(Math.min(6 + 2 * s, 18));
      d.dir.copy(n);
      d.spread = 0.6;
      d.speedMin = 30 * rs;
      d.speedMax = 110 * rs;
      d.drag = 3;
      d.size0 = d.size1 = 0.09 * rs;
      d.lifeMin = 0.14;
      d.lifeMax = 0.32;
      fx.emit(d);
      break;
  }
}

/** One tick of a beam grinding on bare plating: spat molten droplets and sparks (or arcs, for a harmonic lance). */
export function beamBurn(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, s: number, harmonic: boolean, puff: boolean): void {
  const rs = Math.sqrt(s);
  begin(PK.EMBER, PAL.WARM, pos, vel);
  d.count = 2;
  d.dir.copy(n);
  d.spread = 0.5;
  d.speedMin = 15 * rs;
  d.speedMax = 60 * rs;
  d.drag = 1.2;
  d.size0 = 0.18 * rs;
  d.size1 = 0.08 * rs;
  d.sizeJitter = 0.4;
  d.lifeMin = 0.35;
  d.lifeMax = 0.8;
  fx.emit(d);
  if (harmonic) arcs(fx, _r.copy(pos).addScaledVector(n, 0.15 * s), n, vel, s * 0.8, 1, PAL.PLASMA, 0);
  else {
    begin(PK.SPARK, PAL.WARM, pos, vel);
    d.count = 2;
    d.dir.copy(n);
    d.spread = 0.6;
    d.speedMin = 40 * rs;
    d.speedMax = 120 * rs;
    d.drag = 2.5;
    d.size0 = d.size1 = 0.1 * rs;
    d.lifeMin = 0.12;
    d.lifeMax = 0.3;
    fx.emit(d);
  }
  if (!puff) return;
  begin(PK.PUFF, PAL.WARM, _r.copy(pos).addScaledVector(n, 0.5 * s), vel);
  d.dir.copy(n);
  d.spread = 0.3;
  d.speedMin = 2 * rs;
  d.speedMax = 6 * rs;
  d.drag = 1;
  d.size0 = 0.4 * s;
  d.size1 = 1.8 * s;
  d.lifeMin = 0.8;
  d.lifeMax = 1.4;
  d.ageA = d.ageB = 0.09;
  fx.emit(d);
}

/** Shield shards: `count` flat hex tiles off a failing facing (one request per tile: each has its own plane). */
export function shard(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, size: number, speed: number, palette: ParticlePalette, life: number): void {
  begin(PK.SHARD, palette, pos, vel);
  d.dir.copy(n);
  d.spread = 0;
  d.speedMin = d.speedMax = speed;
  // Drag holds them to the shell: the lattice breaks up where it was, it doesn't come away as debris.
  d.drag = 3.5;
  d.size0 = size;
  d.size1 = size * 0.1;
  d.lifeMin = life * 0.7;
  d.lifeMax = life;
  fx.emit(d);
}

/**
 * The first beat of a subsystem dying: a hard flash, a blast punched out
 * along the plating normal, a shock ring flat on the hull and a spray of
 * debris. The fireball, secondaries and the smoke column are CombatFx's.
 */
export function subsystemBurst(fx: Particles, pos: Vector3, n: Vector3, vel: Vector3, r: number, palette: ParticlePalette): void {
  begin(PK.FLASH, palette, _v.copy(pos).addScaledVector(n, r * 0.4), vel);
  d.size0 = d.size1 = r * 2.6;
  d.lifeMin = d.lifeMax = 0.22;
  fx.emit(d);
  begin(PK.RING, palette, _v.copy(pos).addScaledVector(n, r * 0.1), vel);
  d.dir.copy(n);
  d.size0 = r * 0.4;
  d.size1 = r * 4.2;
  d.lifeMin = d.lifeMax = 0.7;
  fx.emit(d);
  // Blast column punched out of the plating.
  begin(PK.FIRE, palette, pos, vel);
  d.count = 10;
  d.dir.copy(n);
  d.spread = 0.18;
  d.jitter = r * 0.25;
  d.speedMin = r * 1.2;
  d.speedMax = r * 3.2;
  d.drag = 2.2;
  d.size0 = r * 0.25;
  d.size1 = r * 0.6;
  d.sizeJitter = 0.35;
  d.lifeMin = 0.5;
  d.lifeMax = 0.9;
  fx.emit(d);
  begin(PK.DEBRIS, PAL.WARM, pos, vel);
  d.count = Math.round(Math.min(10 + r * 0.2, 28));
  d.dir.copy(n);
  d.spread = 0.55;
  d.jitter = r * 0.3;
  d.speedMin = r * 0.8;
  d.speedMax = r * 3.0;
  d.drag = 0.08;
  d.size0 = d.size1 = r * 0.09;
  d.sizeJitter = 0.6;
  d.lifeMin = 4;
  d.lifeMax = 7;
  fx.emit(d);
  begin(PK.SPARK, palette, pos, vel);
  d.count = 40;
  d.dir.copy(n);
  d.spread = 0.7;
  d.speedMin = r * 3;
  d.speedMax = r * 9;
  d.drag = 1.4;
  d.size0 = d.size1 = Math.max(r * 0.02, 0.15);
  d.sizeJitter = 0.5;
  d.lifeMin = 0.4;
  d.lifeMax = 1.0;
  fx.emit(d);
}
