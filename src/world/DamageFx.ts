import { Matrix4, Vector3 } from 'three';
import type { Particles } from '@/fx/Particles';
import { makeSpawn, resetSpawn } from '@/fx/spawn';
import { PAL, PK } from '@/fx/kinds';
import { TRAIL_DAMAGE_HEAVY, TRAIL_DAMAGE_LIGHT } from '@/fx/Trails';
import { createDamageMarks, DAMAGE_MARKS, type DamageMarks } from '@/render/materials/CelMaterial';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import { toUniverse } from '@/sim/Combat';
import type { DamageState, Subsystem } from '@/sim/Damage';

/**
 * Visible battle damage (anime style), driven by the damage model:
 *
 * - Scorch marks on the hull: each ship's worst damage (fighter zones;
 *   capital subsystems and hull scars) becomes up to 12 marks the cel
 *   material paints as dark cel patches, hatched edges and — for destroyed
 *   capital subsystems — glowing, flickering craters (CelMaterial `damage`).
 * - Smoke: a hurt fighter trails grey puffs, a dying one fat black smoke
 *   from its worst zone, like every 90s OVA dogfight.
 * - Sparks spit from damaged zones and subsystems; burning craters keep
 *   coughing fire and smoke.
 *
 * Cheap: marks are rebuilt only when a ship's damage version changes; the
 * particle emits are a few requests per damaged ship per second.
 */
interface ShipFx {
  marks: DamageMarks;
  version: number;
  trail: number;
  trailHeavy: boolean;
  sparkT: number;
  fireT: number;
}

const ZONE_POINTS: [number, number, number][] = [
  [0, 0.05, 0.62], // nose
  [0.6, 0, -0.1], // port wing
  [-0.6, 0, -0.1], // starboard wing
  [0, 0.05, -0.78], // engines
];

const _p = new Vector3();
const _n = new Vector3();
const _m = new Matrix4();
const _inv = new Matrix4();
const d = makeSpawn();

export class DamageFx {
  private ships = new Map<number, ShipFx>();
  private rng = 99;
  private clock = 0;

  constructor(
    private fleet: Fleet,
    private fx: Particles,
  ) {}

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng - 1) / 2147483646;
  }

  private state(s: ShipEntity): ShipFx {
    let f = this.ships.get(s.id);
    if (f) return f;
    const st = s.combat.dmg;
    const size = st.capital ? Math.max(st.halfL, st.halfW) : Math.max(st.halfL, st.halfW, 3);
    f = { marks: createDamageMarks(st.capital ? 60 / size : 0.9), version: -1, trail: -1, trailHeavy: false, sparkT: 0, fireT: 0 };
    // Share the marks with every hull mesh; joint meshes also need their rest offset from the root.
    s.model.root.updateMatrixWorld(true);
    _inv.copy(s.model.root.matrixWorld).invert();
    for (const mesh of s.model.meshes) {
      mesh.userData.dmg = f.marks;
      _m.multiplyMatrices(_inv, mesh.matrixWorld);
      mesh.userData.dmgOffset = new Vector3().setFromMatrixPosition(_m);
    }
    this.ships.set(s.id, f);
    return f;
  }

  /** Hull paint: refresh each damaged ship's scorch marks (cheap; call every frame, FX or not). */
  paint(): void {
    for (const s of this.fleet.ships) {
      if (!s.alive) continue;
      const st = s.combat.dmg;
      const f = this.ships.get(s.id);
      if (!f && !s.combat.damaged) continue;
      const fx = f ?? this.state(s);
      if (fx.version !== st.version || (!s.combat.damaged && fx.marks.any)) {
        fx.version = st.version;
        if (st.capital) this.capitalMarks(st, fx.marks);
        else this.fighterMarks(st, fx.marks);
      }
    }
  }

  /** Particles: smoke trails, sparks, burning craters. */
  update(dt: number): void {
    this.clock += dt;
    for (const s of this.fleet.ships) {
      const st = s.combat.dmg;
      const f = this.ships.get(s.id);
      if (!s.alive) {
        if (f && f.trail >= 0) {
          this.fx.trails.release(f.trail);
          f.trail = -1;
        }
        continue;
      }
      if (!f && !s.combat.damaged) continue;
      const fx = f ?? this.state(s);
      if (st.capital) this.capitalFx(s, st, fx, dt);
      else this.fighterFx(s, st, fx, dt);
    }
  }

  // ── marks ────────────────────────────────────────────────────────────

  private fighterMarks(st: DamageState, m: DamageMarks): void {
    let any = false;
    for (let z = 0; z < 4; z++) {
      const [x, y, zz] = ZONE_POINTS[z];
      const lev = st.zones[z];
      const r = z === 0 || z === 3 ? st.halfL * 0.62 : st.halfW * 0.9;
      m.marks[z].set(st.cx + x * st.halfW, st.cy + y * st.halfH, st.cz + zz * st.halfL, lev > 0.02 ? r : 0);
      setLevel(m, z, Math.min(1, lev * 1.15));
      any ||= lev > 0.02;
    }
    for (let i = 4; i < DAMAGE_MARKS; i++) m.marks[i].w = 0;
    m.any = any;
  }

  private capitalMarks(st: DamageState, m: DamageMarks): void {
    // Destroyed subsystems first (burning craters), then the most damaged, then scars.
    const subs = st.subsystems.filter((x) => x.hp < x.hpMax).sort((a, b) => Number(b.destroyed) - Number(a.destroyed) || a.hp / a.hpMax - b.hp / b.hpMax);
    let k = 0;
    for (const sub of subs) {
      if (k >= DAMAGE_MARKS - 3) break;
      const frac = 1 - sub.hp / sub.hpMax;
      m.marks[k].set(sub.x, sub.y, sub.z, sub.radius * (sub.destroyed ? 1.45 : 1.1));
      setLevel(m, k, sub.destroyed ? 2 : 0.25 + frac * 0.75);
      k++;
    }
    const scars = [...st.scars].sort((a, b) => b.level - a.level);
    for (const sc of scars) {
      if (k >= DAMAGE_MARKS) break;
      m.marks[k].set(sc.x, sc.y, sc.z, sc.radius);
      setLevel(m, k, sc.level);
      k++;
    }
    m.any = k > 0;
    for (; k < DAMAGE_MARKS; k++) m.marks[k].w = 0;
  }

  // ── particles ────────────────────────────────────────────────────────

  private fighterFx(s: ShipEntity, st: DamageState, fx: ShipFx, dt: number): void {
    const eff = s.combat.fx;
    let worst = 0;
    for (let z = 1; z < 4; z++) if (st.zones[z] > st.zones[worst]) worst = z;
    const [x, y, z] = ZONE_POINTS[worst];
    toUniverse(s, st.cx + x * st.halfW * 0.7, st.cy + y * st.halfH, st.cz + z * st.halfL * 0.8, _p);

    // Smoke trail from the worst zone.
    const want = eff.smoke;
    if (want === 0 || (fx.trail >= 0 && fx.trailHeavy !== (want === 2))) {
      if (fx.trail >= 0) this.fx.trails.release(fx.trail);
      fx.trail = -1;
    }
    if (want > 0 && fx.trail < 0) {
      fx.trail = this.fx.trails.create(want === 2 ? TRAIL_DAMAGE_HEAVY : TRAIL_DAMAGE_LIGHT);
      fx.trailHeavy = want === 2;
    }
    if (fx.trail >= 0) this.fx.trails.update(fx.trail, _p);

    // Sparks and licks of flame from a badly hit zone.
    const dmg = st.zones[worst];
    if (dmg < 0.25) return;
    fx.sparkT -= dt;
    if (fx.sparkT > 0) return;
    fx.sparkT = 0.12 + this.rand() * (0.5 - dmg * 0.35);
    _n.subVectors(_p, s.flight.position).normalize();
    resetSpawn(d);
    d.kind = PK.SPARK;
    d.palette = PAL.WARM;
    d.pos.copy(_p);
    d.baseVel.copy(s.flight.velocity);
    d.dir.copy(_n);
    d.spread = 0.5;
    d.count = 4 + Math.round(dmg * 6);
    d.speedMin = 20;
    d.speedMax = 70;
    d.drag = 3;
    d.size0 = d.size1 = 0.1;
    d.lifeMin = 0.15;
    d.lifeMax = 0.35;
    this.fx.emit(d);
    if (eff.smoke === 2) {
      resetSpawn(d);
      d.kind = PK.FIRE;
      d.palette = PAL.WARM;
      d.pos.copy(_p);
      d.baseVel.copy(s.flight.velocity);
      d.count = 2;
      d.jitter = 0.5;
      d.radial = true;
      d.speedMin = 2;
      d.speedMax = 5;
      d.drag = 4;
      d.size0 = 0.6;
      d.size1 = 1.3;
      d.lifeMin = 0.2;
      d.lifeMax = 0.35;
      this.fx.emit(d);
    }
  }

  private capitalFx(s: ShipEntity, st: DamageState, fx: ShipFx, dt: number): void {
    fx.fireT -= dt;
    if (fx.fireT > 0) return;
    fx.fireT = 0.22;
    for (const sub of st.subsystems) {
      const frac = 1 - sub.hp / sub.hpMax;
      if (!sub.destroyed && frac < 0.5) continue;
      if (this.rand() > (sub.destroyed ? 0.7 : 0.35)) continue;
      this.crater(s, st, sub);
    }
  }

  /** A burning crater coughs fire, sparks and ink-lined smoke up off the hull. */
  private crater(s: ShipEntity, st: DamageState, sub: Subsystem): void {
    toUniverse(s, sub.x, sub.y, sub.z, _p);
    // Outward: away from the hull's long axis, biased to the socket's side.
    _n.set(sub.x - st.cx, (sub.y - st.cy) * 1.5 + st.halfH * 0.2, 0).normalize().applyQuaternion(s.flight.orientation);
    const r = sub.radius;
    const v = s.flight.velocity;
    resetSpawn(d);
    d.kind = sub.destroyed ? PK.FIRE : PK.SPARK;
    d.palette = PAL.WARM;
    d.pos.copy(_p);
    d.baseVel.copy(v);
    d.dir.copy(_n);
    d.spread = 0.35;
    d.count = sub.destroyed ? 2 : 6;
    d.jitter = r * 0.25;
    d.speedMin = r * 0.3;
    d.speedMax = r * (sub.destroyed ? 0.8 : 2.2);
    d.drag = 1.5;
    // Licks of flame, not a bonfire: the crater's glow is in the hull paint.
    d.size0 = sub.destroyed ? r * 0.09 : r * 0.02;
    d.size1 = sub.destroyed ? r * 0.2 : r * 0.02;
    d.sizeJitter = 0.4;
    d.lifeMin = 0.4;
    d.lifeMax = 0.8;
    this.fx.emit(d);
    if (!sub.destroyed) return;
    resetSpawn(d);
    d.kind = PK.SMOKE;
    d.palette = PAL.WARM;
    d.pos.copy(_p).addScaledVector(_n, r * 0.3);
    d.baseVel.copy(v).addScaledVector(_n, r * 0.25);
    d.dir.copy(_n);
    d.spread = 0.3;
    d.count = 2;
    d.jitter = r * 0.3;
    d.speedMin = r * 0.15;
    d.speedMax = r * 0.4;
    d.drag = 0.6;
    d.size0 = r * 0.2;
    d.size1 = r * 0.65;
    d.sizeJitter = 0.3;
    d.lifeMin = 1.8;
    d.lifeMax = 3.0;
    d.ageA = d.ageB = -0.05;
    this.fx.emit(d);
  }
}

function setLevel(m: DamageMarks, i: number, v: number): void {
  const l = m.levels[i >> 2];
  if ((i & 3) === 0) l.x = v;
  else if ((i & 3) === 1) l.y = v;
  else if ((i & 3) === 2) l.z = v;
  else l.w = v;
}
