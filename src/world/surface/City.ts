import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, RingGeometry, Vector3, type BufferGeometry } from 'three';
import type { SurfaceTerrain } from '@/universe/Universe';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { rng } from '@/assets/HullKit';
import { LightPoints, LIGHT_PULSE, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from '../setpieces/LightPoints';
import { APRON_RADIUS, groundAt, type GroundSpec } from './terrain';

/**
 * The spaceport city at the foot of the tether (planetary ports), in the
 * surface frame (metres, +Y up, tether foot at the origin):
 *
 *  - the apron (or, over a gas giant, a floating platform on lift-cells);
 *  - landing pads sized by hull class — fighter pads, heavy pads for
 *    gunships and corvettes, a frigate field — with lit rims, chasing
 *    approach strobes and painted markings;
 *  - the tether foot: an anchor tower and the cable itself climbing through
 *    the cloud deck, climber lights running up it;
 *  - control tower, hangars, city blocks (instanced), spires with beacons,
 *    window bands and street glints;
 *  - traffic: small craft circling the city at their own heights.
 *
 * Everything is seeded from the port: the same port always gets the same city.
 */
export type PadClass = 'bay' | 'clamp' | 'mooring';

export interface PadInfo {
  /** Pad top centre (surface frame). */
  pos: Vector3;
  radius: number;
  cls: PadClass;
  number: number;
}

export interface CitySpec {
  ground: GroundSpec;
  terrain: SurfaceTerrain;
  seed: number;
  faction: 'concord' | 'choir' | 'rustwake';
}

const PALETTE: Record<CitySpec['faction'], { walls: string[]; trim: string; window: string; pad: string; mark: string; lights: string }> = {
  concord: { walls: ['#c9cdd6', '#9aa3b4', '#e4e0d4'], trim: '#3f5a8a', window: '#ffd08a', pad: '#3a3f4a', mark: '#ffd24f', lights: '#6fe6ff' },
  choir: { walls: ['#e8d6de', '#c7b0c8', '#f2ece2'], trim: '#6a3f7a', window: '#ff9fe2', pad: '#3d3344', mark: '#ff9fe2', lights: '#ff5fd0' },
  rustwake: { walls: ['#b08d6c', '#8a6a52', '#c9b08a'], trim: '#6b3a22', window: '#ffb45e', pad: '#3b332c', mark: '#ffb04f', lights: '#ffb04f' },
};

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();

function unitBox(): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

export class City {
  readonly group = new Group();
  readonly pads: PadInfo[] = [];
  /** Height of the apron / platform top (m). */
  readonly deck: number;
  private lights: LightPoints[] = [];
  private traffic: { g: Group; r: number; alt: number; w: number; phase: number; lights: LightPoints }[] = [];
  private mats: CelMaterial[] = [];

  constructor(readonly spec: CitySpec) {
    this.group.name = 'surface-city';
    const r = rng(spec.seed + 77);
    const pal = PALETTE[spec.faction];
    const floating = spec.terrain === 'cloud';
    this.deck = spec.ground.apron;
    const mat = (o: ConstructorParameters<typeof CelMaterial>[0]) => {
      const m = new CelMaterial({ ramp: 'classic', haze: 0, ...o });
      this.mats.push(m);
      return m;
    };
    const concrete = mat({ color: spec.terrain === 'ice' ? '#b9c6d2' : '#8c8a86', gloss: 0.1, inkWeight: 0.7, inkId: 8100 });
    const padMat = mat({ color: pal.pad, gloss: 0.2, inkWeight: 0.8, inkId: 8101 });
    const markMat = mat({ color: pal.mark, gloss: 0.1, inkWeight: 0.3, inkId: 8102, emissive: pal.mark, emissiveStrength: 0.25, doubleSided: true });
    const steel = mat({ color: '#9aa0ae', gloss: 0.5, inkId: 8103 });
    const trim = mat({ color: pal.trim, gloss: 0.3, inkId: 8104 });
    const glass = mat({ color: '#1b2a44', gloss: 1, inkId: 8105, emissive: pal.lights, emissiveStrength: 0.5 });
    const add = (geo: BufferGeometry, m: CelMaterial, x: number, y: number, z: number) => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };
    const top = this.deck;
    const lights: LightSpec[] = [];

    // ── apron / floating platform ─────────────────────────────────────
    if (floating) {
      add(new CylinderGeometry(APRON_RADIUS, APRON_RADIUS * 0.96, 40, 64), concrete, 0, top - 20, 0);
      const under = add(new ConeGeometry(APRON_RADIUS * 0.94, 900, 48, 1, true), trim, 0, top - 40 - 450, 0);
      under.rotation.x = Math.PI;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const cell = add(new CylinderGeometry(150, 150, 260, 20), steel, Math.cos(a) * (APRON_RADIUS + 60), top - 160, Math.sin(a) * (APRON_RADIUS + 60));
        cell.scale.set(1, 1, 1);
        lights.push({ pos: new Vector3(Math.cos(a) * (APRON_RADIUS + 215), top - 160, Math.sin(a) * (APRON_RADIUS + 215)), color: '#ff5f7a', size: 9, mode: LIGHT_STROBE, rate: 0.5, phase: i / 10, duty: 0.2, gain: 2.5 });
      }
    } else {
      // Top face 2 m above the flattened ground (no z-fighting with the terrain).
      add(new CylinderGeometry(APRON_RADIUS * 0.97, APRON_RADIUS, 30, 64), concrete, 0, top - 13, 0);
    }

    // ── pads ──────────────────────────────────────────────────────────
    const padDefs: { cls: PadClass; radius: number; dist: number }[] = [
      { cls: 'bay', radius: 36, dist: 430 },
      { cls: 'bay', radius: 36, dist: 430 },
      { cls: 'bay', radius: 36, dist: 520 },
      { cls: 'clamp', radius: 120, dist: 760 },
      { cls: 'clamp', radius: 120, dist: 760 },
      { cls: 'mooring', radius: 240, dist: 1350 },
    ];
    const a0 = r() * Math.PI * 2;
    padDefs.forEach((pd, i) => {
      const a = a0 + i * 1.05 + (pd.cls === 'mooring' ? 0.5 : 0);
      const x = Math.cos(a) * pd.dist;
      const z = Math.sin(a) * pd.dist;
      const disc = add(new CylinderGeometry(pd.radius, pd.radius * 1.03, 4, 48), padMat, x, top + 2, z);
      disc.name = `pad-${i + 1}`;
      const ring = add(new RingGeometry(pd.radius * 0.76, pd.radius * 0.84, 48), markMat, x, top + 4.2, z);
      ring.rotation.x = -Math.PI / 2;
      const bar = add(new BoxGeometry(pd.radius * 0.9, 0.6, pd.radius * 0.12), markMat, x, top + 4.3, z);
      bar.rotation.y = a;
      const bar2 = add(new BoxGeometry(pd.radius * 0.12, 0.6, pd.radius * 0.5), markMat, x, top + 4.3, z);
      bar2.rotation.y = a;
      const n = Math.max(12, Math.round(pd.radius / 7));
      for (let k = 0; k < n; k++) {
        const b = (k / n) * Math.PI * 2;
        const lp = new Vector3(x + Math.cos(b) * pd.radius * 1.02, top + 5, z + Math.sin(b) * pd.radius * 1.02);
        lights.push({ pos: lp, color: k % 2 ? pal.lights : '#7dffb2', size: 2 + pd.radius * 0.02, mode: LIGHT_STEADY, gain: 1.6 });
        lights.push({ pos: lp.clone(), color: '#ffffff', size: 4 + pd.radius * 0.03, mode: LIGHT_STROBE, rate: 0.8, phase: k / n, duty: 0.06, gain: 2.4 });
      }
      this.pads.push({ pos: new Vector3(x, top + 4, z), radius: pd.radius, cls: pd.cls, number: i + 1 });
    });

    // ── tether foot ───────────────────────────────────────────────────
    add(new CylinderGeometry(46, 110, 520, 20), steel, 0, top + 260, 0);
    for (const h of [140, 300, 460]) add(new CylinderGeometry(118 - h * 0.12, 118 - h * 0.12, 18, 24), trim, 0, top + h, 0);
    add(new CylinderGeometry(13, 13, 14_000, 10), steel, 0, top + 520 + 7000, 0);
    for (let d = 700; d < 14_000; d += 420) lights.push({ pos: new Vector3(0, top + d, 0), color: pal.lights, size: 16, mode: LIGHT_PULSE, rate: 0.35, phase: d / 4000, gain: 2 });
    lights.push({ pos: new Vector3(0, top + 530, 0), color: '#ff5f7a', size: 18, mode: LIGHT_STROBE, rate: 0.6, duty: 0.15, gain: 3 });

    // ── control tower + hangars ───────────────────────────────────────
    const ta = a0 + 2.6;
    const tx = Math.cos(ta) * 620;
    const tz = Math.sin(ta) * 620;
    add(new CylinderGeometry(11, 16, 190, 12), concrete, tx, top + 95, tz);
    add(new CylinderGeometry(30, 22, 22, 16), glass, tx, top + 200, tz);
    add(new CylinderGeometry(31, 31, 4, 16), trim, tx, top + 213, tz);
    lights.push({ pos: new Vector3(tx, top + 222, tz), color: '#ff5f7a', size: 7, mode: LIGHT_STROBE, rate: 0.7, duty: 0.2, gain: 2.5 });
    for (let i = 0; i < 3; i++) {
      const ha = a0 + 3.3 + i * 0.32;
      const hx = Math.cos(ha) * 1150;
      const hz = Math.sin(ha) * 1150;
      const hg = add(new BoxGeometry(170, 60, 90), concrete, hx, top + 30, hz);
      hg.rotation.y = -ha;
      const roof = add(new CylinderGeometry(45, 45, 170, 16, 1, false, 0, Math.PI), trim, hx, top + 60, hz);
      roof.rotation.set(0, -ha, Math.PI / 2);
      lights.push({ pos: new Vector3(hx, top + 108, hz), color: pal.window, size: 5, mode: LIGHT_STEADY, gain: 1.4 });
    }

    // ── city blocks (instanced) ───────────────────────────────────────
    const N = floating ? 90 : 320;
    const blocks = pal.walls.map((c, i) => ({ mesh: new InstancedMesh(unitBox(), mat({ color: c, gloss: 0.15, inkWeight: 0.8, inkId: 8200 + i * 7 }), N), n: 0 }));
    const win = new InstancedMesh(unitBox(), mat({ color: '#101018', inkWeight: 0, inkId: 8300, emissive: pal.window, emissiveStrength: 1.1 }), N * 2);
    let nw = 0;
    const sample = { h: 0, h01: 0, wet: 0, glow: 0 };
    const padClear = (x: number, z: number, rad: number) => this.pads.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > p.radius + rad + 40) && Math.hypot(x, z) > 220 + rad && Math.hypot(x - tx, z - tz) > 60 + rad;
    let placed = 0;
    for (let tries = 0; placed < N && tries < N * 6; tries++) {
      const ang = r() * Math.PI * 2;
      const rad = floating ? 300 + r() * (APRON_RADIUS - 420) : 900 + Math.pow(r(), 0.8) * 6200;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const w = 30 + r() * 70;
      const d = 30 + r() * 70;
      if (!padClear(x, z, Math.max(w, d) * 0.7)) continue;
      let base = top;
      if (!floating && rad > APRON_RADIUS * 0.8) {
        groundAt(spec.ground, x, z, sample);
        if (sample.wet > 0.02) continue;
        base = sample.h;
      }
      const near = Math.exp(-Math.max(0, rad - 1200) / 2600);
      let h = 30 + r() * r() * 260 * (0.3 + near);
      if (r() < 0.05) h = 380 + r() * 320; // spires
      const blk = blocks[placed % blocks.length];
      _q.setFromAxisAngle(_p.set(0, 1, 0), r() * Math.PI);
      blk.mesh.setMatrixAt(blk.n++, _m.compose(_s.set(x, base - 6, z), _q, new Vector3(w, h + 6, d)));
      // A lit window band or two near the top.
      for (let k = 0; k < (h > 120 ? 2 : 1) && nw < N * 2; k++) {
        const by = base + h * (0.62 + k * 0.2);
        win.setMatrixAt(nw++, _m.compose(_s.set(x, by, z), _q, new Vector3(w + 1.2, Math.max(2.5, h * 0.035), d + 1.2)));
      }
      if (h > 300) lights.push({ pos: new Vector3(x, base + h + 8, z), color: '#ff5f7a', size: 6, mode: LIGHT_STROBE, rate: 0.5 + r() * 0.3, phase: r(), duty: 0.18, gain: 2.4 });
      else if (r() < 0.5) lights.push({ pos: new Vector3(x, base + h + 2, z), color: pal.window, size: 3.5, mode: LIGHT_STEADY, gain: 1.2 });
      placed++;
    }
    for (const b of blocks) {
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
      this.group.add(b.mesh);
    }
    win.count = nw;
    win.instanceMatrix.needsUpdate = true;
    win.computeBoundingSphere();
    this.group.add(win);

    // ── lights ────────────────────────────────────────────────────────
    const lp = new LightPoints(lights, { minPixels: 1.4, glint: 0.7, fadeFar: 30_000 });
    this.lights.push(lp);
    this.group.add(lp.mesh);

    // ── traffic ───────────────────────────────────────────────────────
    const hullMat = mat({ color: pal.walls[2], gloss: 0.5, inkId: 8400 });
    const wingMat = mat({ color: pal.trim, gloss: 0.3, inkId: 8401 });
    for (let i = 0; i < 9; i++) {
      const g = new Group();
      const s = 0.8 + r() * 1.6;
      const body = new Mesh(new BoxGeometry(6 * s, 4 * s, 22 * s), hullMat);
      const wing = new Mesh(new BoxGeometry(20 * s, 1 * s, 7 * s), wingMat);
      wing.position.set(0, -0.5 * s, -3 * s);
      g.add(body, wing);
      const nav = new LightPoints(
        [
          { pos: new Vector3(10 * s, -0.5 * s, -3 * s), color: '#7dffb2', size: 2.5 * s, mode: LIGHT_STEADY, gain: 2 },
          { pos: new Vector3(-10 * s, -0.5 * s, -3 * s), color: '#ff5f7a', size: 2.5 * s, mode: LIGHT_STEADY, gain: 2 },
          { pos: new Vector3(0, 2.5 * s, 0), color: '#ffffff', size: 5 * s, mode: LIGHT_STROBE, rate: 0.9, phase: r(), duty: 0.08, gain: 3 },
        ],
        { minPixels: 1.2, glint: 0.4 },
      );
      g.add(nav.mesh);
      this.group.add(g);
      this.traffic.push({ g, r: 900 + r() * 3600, alt: top + 180 + r() * 1300, w: (r() < 0.5 ? -1 : 1) * (0.018 + r() * 0.03), phase: r() * Math.PI * 2, lights: nav });
    }
  }

  /** The pad for a hull class (heavier classes fall back to the largest pad). */
  padFor(cls: PadClass): PadInfo {
    return this.pads.find((p) => p.cls === cls) ?? this.pads[this.pads.length - 1];
  }

  update(time: number): void {
    for (const l of this.lights) l.update(time);
    for (const t of this.traffic) {
      const a = t.phase + time * t.w;
      const x = Math.cos(a) * t.r;
      const z = Math.sin(a) * t.r;
      t.g.position.set(x, t.alt + Math.sin(a * 3) * 40, z);
      // Nose along the circle (explicit basis; surface frame is local, never universe).
      const fx = -Math.sin(a) * Math.sign(t.w);
      const fz = Math.cos(a) * Math.sign(t.w);
      t.g.rotation.set(0, Math.atan2(fx, fz), -Math.sign(t.w) * 0.35);
      t.lights.update(time);
    }
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
    for (const t of this.traffic) t.lights.dispose();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
  }
}
