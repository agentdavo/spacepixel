import { Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { rockGeometry } from '../AsteroidField';
import type { PlanetPreset } from '../Planet';

/**
 * A shattered moon (landmark body): a cracked core, a shell of chiselled
 * fragments drifting outward, each on a slow tumble, and a flattened cloud
 * of rubble — one InstancedMesh — trailing through the gaps. Same cel +
 * ink rules as the asteroid belts, at moon scale (radius = the old moon's).
 */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Fragment {
  mesh: Mesh;
  axis: Vector3;
  rate: number;
  base: Quaternion;
  dir: Vector3;
  dist: number;
}

const _q = new Quaternion();

export class ShatteredMoon {
  readonly group = new Group();
  private fragments: Fragment[] = [];

  constructor(readonly preset: PlanetPreset) {
    const R = preset.radius;
    const rand = mulberry(7919 + (preset.seed ?? 0) * 31);
    const cols = preset.bands.map((b) => new Color(b.color));
    this.group.name = `shattered:${preset.name}`;
    const count = 9;
    for (let i = 0; i < count; i++) {
      const core = i === 0;
      const size = core ? R * 0.62 : R * (0.14 + Math.pow(rand(), 1.6) * 0.36);
      const geo = rockGeometry(2, rand);
      geo.computeVertexNormals();
      const mat = new CelMaterial({
        color: cols[Math.min(cols.length - 1, 1 + Math.floor(rand() * (cols.length - 1)))].clone().multiplyScalar(core ? 0.9 : 1),
        ramp: 'dramatic',
        rimWidth: 0.8,
        gloss: 0,
        inkWeight: 1,
        inkId: 9400 + i,
        haze: 0.25,
      });
      const mesh = new Mesh(geo, mat);
      mesh.scale.set(size * (0.8 + rand() * 0.5), size * (0.7 + rand() * 0.4), size * (0.8 + rand() * 0.5));
      const dir = new Vector3(rand() - 0.5, (rand() - 0.5) * 0.5, rand() - 0.5).normalize();
      const dist = core ? 0 : R * (0.95 + rand() * 1.4);
      mesh.position.copy(dir).multiplyScalar(dist);
      const base = new Quaternion().setFromAxisAngle(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * 6.28);
      mesh.quaternion.copy(base);
      this.group.add(mesh);
      this.fragments.push({ mesh, axis: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rate: (rand() - 0.5) * 0.004, base, dir, dist });
    }

    // Rubble: a flattened, lumpy disc through the fragment shell.
    const n = 420;
    const rubbleGeo = rockGeometry(0, rand);
    rubbleGeo.computeVertexNormals();
    const rubble = new InstancedMesh(
      rubbleGeo,
      new CelMaterial({ color: cols[Math.max(0, cols.length - 2)], ramp: 'dramatic', rimWidth: 0.85, gloss: 0, inkWeight: 0.8, inkId: 9420, haze: 0.3 }),
      n,
    );
    const m = new Matrix4();
    const p = new Vector3();
    const s = new Vector3();
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = R * (0.7 + Math.pow(rand(), 0.8) * 2.4);
      p.set(Math.cos(a) * rr, (rand() - 0.5) * R * 0.35, Math.sin(a) * rr);
      const k = R * (0.004 + Math.pow(rand(), 3) * 0.04);
      s.set(k, k * (0.6 + rand() * 0.5), k);
      _q.setFromAxisAngle(p.clone().normalize(), rand() * 6.28);
      rubble.setMatrixAt(i, m.compose(p, _q, s));
    }
    rubble.instanceMatrix.needsUpdate = true;
    rubble.computeBoundingSphere();
    this.group.add(rubble);
  }

  /** Slow tumble + a very slow outward drift (the pieces still leaving). */
  update(time: number): void {
    for (const f of this.fragments) {
      f.mesh.quaternion.copy(f.base).multiply(_q.setFromAxisAngle(f.axis, time * f.rate));
      if (f.dist > 0) f.mesh.position.copy(f.dir).multiplyScalar(f.dist * (1 + time * 2e-6));
    }
  }
}
