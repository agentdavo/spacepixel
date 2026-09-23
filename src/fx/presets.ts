import { Vector3 } from 'three';
import { PAL, PK, type ParticlePalette } from './kinds';
import type { Particles } from './Particles';
import { makeSpawn, resetSpawn, type SpawnDesc } from './spawn';

/**
 * Effect presets, timed and shaped like hand-drawn 90s effects animation:
 * a one-frame star flash, a fireball of flat posterised blobs that burns
 * white → yellow → orange → red and breaks up, a hard shock ring, chunky
 * streak sparks, then a late billow of ink-outlined smoke balls.
 *
 * Everything scales from a 10 m fighter pop to a 300 m capital-ship section:
 * sizes and speeds scale linearly, while timing stretches by (scale/10)^0.35 —
 * big explosions evolve more slowly, which is what sells their size.
 */

const d: SpawnDesc = makeSpawn();
const _v = new Vector3();

// Deterministic LCG so shot-mode captures are repeatable.
let rngState = 0x1234567;
function rand(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
  return (rngState >>> 0) / 4294967296;
}
function randomUnit(out: Vector3): Vector3 {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

function begin(kind: number, palette: ParticlePalette, pos: Vector3, vel: Vector3 | null): SpawnDesc {
  resetSpawn(d);
  d.kind = kind as SpawnDesc['kind'];
  d.palette = palette;
  d.pos.copy(pos);
  if (vel) d.baseVel.copy(vel);
  return d;
}

export function explosion(fx: Particles, pos: Vector3, vel: Vector3, scale: number, palette: ParticlePalette = PAL.WARM): void {
  const s = Math.max(scale, 0.5);
  const ts = Math.min(Math.max(Math.pow(s / 10, 0.35), 0.7), 4);
  const big = s > 60;

  // 1. Star flash.
  begin(PK.FLASH, palette, pos, vel);
  d.count = 1;
  d.size0 = d.size1 = s * 1.7;
  d.lifeMin = d.lifeMax = 0.2 * Math.sqrt(ts);
  fx.emit(d);

  // 2. Fireball: flat blobs expanding radially from the core.
  const drag = 3.2 / ts;
  begin(PK.FIRE, palette, pos, vel);
  d.count = Math.round(Math.min(14 + s * 0.08, 34));
  d.jitter = s * 0.4;
  d.radial = true;
  d.speedMin = s * 0.9 * drag * 0.45;
  d.speedMax = s * 0.9 * drag;
  d.drag = drag;
  d.size0 = s * 0.34;
  d.size1 = s * 0.78;
  d.sizeJitter = 0.35;
  d.lifeMin = 0.75 * ts;
  d.lifeMax = 1.25 * ts;
  d.delay = 0.05 * ts;
  fx.emit(d);

  // 2b. Secondary billows: smaller, later, further out (the "chain" look).
  begin(PK.FIRE, palette, pos, vel);
  d.count = Math.round(Math.min(8 + s * 0.05, 20));
  d.jitter = s * 0.75;
  d.radial = true;
  d.speedMin = s * 0.4 * drag;
  d.speedMax = s * 0.9 * drag;
  d.drag = drag;
  d.size0 = s * 0.2;
  d.size1 = s * 0.5;
  d.sizeJitter = 0.4;
  d.lifeMin = 0.5 * ts;
  d.lifeMax = 0.9 * ts;
  d.ageA = d.ageB = -0.1 * ts;
  d.delay = 0.2 * ts;
  fx.emit(d);

  // 3. Shock ring, tilted (reads as an ellipse, very Macross).
  begin(PK.RING, palette, pos, vel);
  d.count = 1;
  randomUnit(d.dir);
  d.dir.y = d.dir.y * 0.4 + (d.dir.y >= 0 ? 0.6 : -0.6);
  d.dir.normalize();
  d.size0 = s * 0.4;
  d.size1 = s * 2.6;
  d.lifeMin = d.lifeMax = 0.45 * ts;
  fx.emit(d);
  if (big) {
    // A second, flatter camera-facing ring for capital blasts.
    begin(PK.RING, palette, pos, vel);
    d.count = 1;
    d.size0 = s * 0.6;
    d.size1 = s * 2.4;
    d.lifeMin = d.lifeMax = 0.4 * ts;
    d.ageA = d.ageB = -0.08 * ts;
    fx.emit(d);
  }

  // 4. Chunky sparks.
  begin(PK.SPARK, palette, pos, vel);
  d.count = Math.round(Math.min(22 + s * 0.25, 70));
  d.jitter = s * 0.15;
  d.radial = true;
  d.speedMin = (s * 5) / ts;
  d.speedMax = (s * 13) / ts;
  d.drag = 1.4 / ts;
  d.size0 = d.size1 = Math.max(s * 0.035, 0.15);
  d.sizeJitter = 0.5;
  d.lifeMin = 0.35 * ts;
  d.lifeMax = 0.85 * ts;
  fx.emit(d);

  // 5. Late smoke billow: dark, ink-outlined balls that swallow the dying fire.
  begin(PK.SMOKE, palette, pos, vel);
  d.count = Math.round(Math.min(10 + s * 0.05, 22));
  d.jitter = s * 0.55;
  d.radial = true;
  d.speedMin = (s * 0.35) / ts;
  d.speedMax = (s * 0.9) / ts;
  d.drag = 1.1 / ts;
  d.size0 = s * 0.38;
  d.size1 = s * 0.85;
  d.sizeJitter = 0.3;
  d.lifeMin = 1.7 * ts;
  d.lifeMax = 2.7 * ts;
  d.ageA = d.ageB = -0.32 * ts;
  d.delay = 0.3 * ts;
  fx.emit(d);

  // 6. A few chunks of hull.
  if (s >= 6) debris(fx, pos, vel, s * 0.6, Math.round(Math.min(5 + s * 0.04, 16)));
}

export function debris(fx: Particles, pos: Vector3, vel: Vector3, scale: number, count = 10): void {
  const s = Math.max(scale, 0.5);
  begin(PK.DEBRIS, PAL.WARM, pos, vel);
  d.count = count;
  d.jitter = s * 0.3;
  d.radial = true;
  d.speedMin = s * 0.5;
  d.speedMax = s * 2.2;
  d.drag = 0.05;
  d.size0 = d.size1 = s * 0.14;
  d.sizeJitter = 0.6;
  d.lifeMin = 5;
  d.lifeMax = 8;
  fx.emit(d);
}

export function impact(fx: Particles, pos: Vector3, normal: Vector3, vel: Vector3, palette: ParticlePalette = PAL.WARM): void {
  begin(PK.FLASH, palette, pos, vel);
  d.count = 1;
  d.size0 = d.size1 = 2.4;
  d.lifeMin = d.lifeMax = 0.08;
  fx.emit(d);

  begin(PK.SPARK, palette, pos, vel);
  d.count = 12;
  d.dir.copy(normal);
  d.spread = 0.22;
  d.speedMin = 40;
  d.speedMax = 150;
  d.drag = 3;
  d.size0 = d.size1 = 0.12;
  d.sizeJitter = 0.5;
  d.lifeMin = 0.15;
  d.lifeMax = 0.4;
  fx.emit(d);

  begin(PK.FIRE, palette, _v.copy(normal).multiplyScalar(0.6).add(pos), vel);
  d.count = 3;
  d.jitter = 0.7;
  d.radial = true;
  d.speedMin = 2;
  d.speedMax = 6;
  d.drag = 4;
  d.size0 = 0.8;
  d.size1 = 1.7;
  d.sizeJitter = 0.3;
  d.lifeMin = 0.25;
  d.lifeMax = 0.42;
  fx.emit(d);

  begin(PK.SMOKE, palette, _v.copy(normal).multiplyScalar(1.2).add(pos), vel);
  d.count = 2;
  d.dir.copy(normal);
  d.spread = 0.5;
  d.jitter = 0.6;
  d.speedMin = 1.5;
  d.speedMax = 4;
  d.drag = 1.5;
  d.size0 = 0.8;
  d.size1 = 2.1;
  d.lifeMin = 0.9;
  d.lifeMax = 1.5;
  d.ageA = d.ageB = -0.12;
  fx.emit(d);
}

export function shieldHit(
  fx: Particles,
  pos: Vector3,
  normal: Vector3,
  radius = 14,
  vel?: Vector3,
  palette: ParticlePalette = PAL.PLASMA,
): void {
  begin(PK.SHIELD, palette, pos, vel ?? null);
  d.count = 1;
  d.dir.copy(normal).normalize();
  d.size0 = d.size1 = radius;
  d.lifeMin = d.lifeMax = 0.45;
  fx.emit(d);

  begin(PK.FLASH, palette, _v.copy(normal).multiplyScalar(0.3).add(pos), vel ?? null);
  d.count = 1;
  d.size0 = d.size1 = radius * 0.16;
  d.lifeMin = d.lifeMax = 0.1;
  fx.emit(d);

  begin(PK.SPARK, palette, pos, vel ?? null);
  d.count = 8;
  d.dir.copy(normal);
  d.spread = 0.45;
  d.speedMin = 30;
  d.speedMax = 90;
  d.drag = 3;
  d.size0 = d.size1 = 0.09;
  d.lifeMin = 0.15;
  d.lifeMax = 0.32;
  fx.emit(d);
}
