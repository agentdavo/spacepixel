import {
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Plane,
  Quaternion,
  Sphere,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Fn, attribute, cross, float, mix, mx_noise_float, positionGeometry, smoothstep, uniform, varyingProperty } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { box, rib, cylinder } from '@/assets/HullKit';
import { assets } from '@/assets/AssetLibrary';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num, str } from './types';
import { LightPoints, LIGHT_FLICKER, type LightSpec } from './LightPoints';
import { HazeClouds } from '../HazeClouds';
import { mulberry, seedOf, splitGeometry } from './util';

/** Strip to bare positions (flat shading from derivatives, like the asteroid field). */
function bare(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position') out.deleteAttribute(k);
  return out;
}

/** Three unit-ish debris shapes: torn plate, girder cluster, hull-shell fragment. */
function debrisVariants(rand: () => number): BufferGeometry[] {
  const jitter = (g: BufferGeometry, amt: number) => {
    const p = g.getAttribute('position');
    const cache = new Map<string, [number, number, number]>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
      let d = cache.get(key);
      if (!d) cache.set(key, (d = [(rand() - 0.5) * amt, (rand() - 0.5) * amt * 0.3, (rand() - 0.5) * amt]));
      p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    return g;
  };
  // Plate: a thin slab with a stiffener rib, corners torn.
  const plate = mergeGeometries([
    bare(jitter(box(2.0, 0.08, 1.4, 0.02), 0.5)),
    bare(box(1.8, 0.16, 0.12, 0.02).translate(0, 0.1, 0.25)),
    bare(box(0.12, 0.16, 1.1, 0.02).translate(-0.4, 0.1, 0)),
  ])!;
  // Girder: a broken truss.
  const parts: BufferGeometry[] = [bare(box(0.14, 0.14, 2.4, 0.02)), bare(box(0.14, 0.14, 2.1, 0.02).translate(0.5, 0, 0.1))];
  for (let i = 0; i < 4; i++) parts.push(bare(box(0.6, 0.08, 0.08).translate(0.25, 0, -0.9 + i * 0.55)));
  parts.push(bare(box(0.06, 0.5, 0.06).rotateZ(0.7).translate(0.25, 0, 0.3)));
  const girder = mergeGeometries(parts)!;
  // Shell: a curved slice of hull with frames.
  const shell = mergeGeometries([
    bare(jitter(rib(1.2, 0.08, 1.6, 70, 10, 8, 0.02), 0.25)),
    bare(rib(1.12, 0.14, 0.12, 75, 8, 6).translate(0, 0, 0.5)),
    bare(rib(1.12, 0.14, 0.12, 60, 15, 6).translate(0, 0, -0.5)),
    bare(cylinder(0.05, 0.05, 1.2, 5).rotateY(0.3).translate(0.3, 1.0, 0)),
  ])!;
  [plate, girder, shell].forEach((g) => g.computeBoundingSphere());
  return [plate, girder, shell];
}

/**
 * The aftermath of a battle: a slowly tumbling field of torn plating,
 * girders and hull-shell fragments (instanced, tumble evaluated on the GPU:
 * three draw calls for any count), a few broken capital-ship sections split
 * from a real hull, guttering fires on the wrecks and a thin smoke haze.
 *
 * Params: `radius` (m, default 1500), `count` (default 600), `hulks`
 * (broken hull sections, default 3), `hulk` (blueprint id, default
 * 'ffc-lantern-guard'), `tint` (paint, default Directorate ivory).
 */
export class Wreckage implements SetPiece {
  readonly kind: SetPieceKind = 'wreckage';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  private readonly uTime: Node = uniform(0);
  private readonly material: CelMaterial;
  private readonly fires: LightPoints;
  private readonly hulks: { mesh: Mesh; axis: Vector3; rate: number; q0: Quaternion; drift: Vector3; p0: Vector3 }[] = [];
  private readonly q = new Quaternion();

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:wreckage:${tag}`;
    this.radius = num(params, 'radius', 1500);
    const count = Math.max(1, Math.floor(num(params, 'count', 600)));
    const rand = mulberry(seedOf(tag) + 3);
    const R = this.radius;

    const colA: Node = uniform(new Color(str(params, 'tint', '#d9d6cc')));
    const colB: Node = uniform(new Color('#2b4ea8'));
    const scorch: Node = uniform(new Color('#241c22'));
    const vLocal: Node = varyingProperty('vec3', 'vWreckLocal');
    const vRand: Node = varyingProperty('float', 'vWreckRand');
    const vId: Node = varyingProperty('float', 'vWreckId');
    this.material = new CelMaterial({
      ramp: 'classic',
      rimWidth: 0.7,
      gloss: 0.3,
      haze: 1,
      regionNode: vId,
      paintNode: Fn(() => {
        const base = mix(colA, colB, smoothstep(0.78, 0.8, vRand));
        const burn = smoothstep(-0.05, 0.25, mx_noise_float(vLocal.mul(1.7).add(vRand.mul(13.0))));
        return mix(base, scorch, burn.mul(0.85));
      })(),
    });
    this.material.positionNode = Fn(() => {
      const iPos: Node = attribute('iPos', 'vec4');
      const iSpin: Node = attribute('iSpin', 'vec4');
      const iRot: Node = attribute('iRot', 'vec4');
      const local: Node = positionGeometry;
      const k = iSpin.xyz;
      const ang = this.uTime.mul(iSpin.w);
      const c = ang.cos();
      const s = ang.sin();
      const spun = local.mul(c).add(cross(k, local).mul(s)).add(k.mul(k.dot(local).mul(float(1).sub(c))));
      const qv = iRot.xyz;
      const tq = cross(qv, spun).mul(2);
      const rotated = spun.add(tq.mul(iRot.w)).add(cross(qv, tq));
      vLocal.assign(local);
      vRand.assign(fractOf(iRot.w.mul(91.7).add(iPos.x.mul(0.013))));
      vId.assign(iSpin.w.mul(1000.0).floor().add(iPos.w.mul(7.0).floor()));
      return rotated.mul(iPos.w).add(iPos.xyz);
    })();

    // ── instanced debris (one draw per variant) ─────────────────────
    const variants = debrisVariants(rand);
    const bound = new Sphere(new Vector3(), R * 1.3);
    const per = Math.ceil(count / variants.length);
    const tmp = new Vector3();
    variants.forEach((base, vi) => {
      const n = Math.min(per, count - vi * per);
      if (n <= 0) return;
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('position', base.getAttribute('position'));
      const iPos = new Float32Array(n * 4);
      const iSpin = new Float32Array(n * 4);
      const iRot = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        // Flattened, clumpy cloud: the battle happened along a lane.
        const rr = R * Math.pow(rand(), 0.6);
        tmp.set(rand() * 2 - 1, (rand() * 2 - 1) * 0.35, rand() * 2 - 1).normalize().multiplyScalar(rr);
        const size = 3 + Math.pow(rand(), 2.2) * 45;
        iPos.set([tmp.x, tmp.y, tmp.z, size], i * 4);
        tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        iSpin.set([tmp.x, tmp.y, tmp.z, ((rand() * 0.25 + 0.03) / (1 + size / 20)) * (rand() < 0.5 ? -1 : 1)], i * 4);
        tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        const a = rand() * Math.PI;
        iRot.set([tmp.x * Math.sin(a), tmp.y * Math.sin(a), tmp.z * Math.sin(a), Math.cos(a)], i * 4);
      }
      geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 4));
      geo.setAttribute('iSpin', new InstancedBufferAttribute(iSpin, 4));
      geo.setAttribute('iRot', new InstancedBufferAttribute(iRot, 4));
      geo.instanceCount = n;
      geo.boundingSphere = bound;
      const mesh = new Mesh(geo, this.material);
      mesh.name = `wreckage:v${vi}`;
      this.group.add(mesh);
    });

    // ── broken capital sections: a real hull, split and scattered ────
    const fires: LightSpec[] = [];
    const hulkCount = Math.floor(num(params, 'hulks', 3));
    if (hulkCount > 0) {
      const ship = assets.ship(str(params, 'hulk', 'ffc-lantern-guard'));
      const len = ship.length;
      const pieces = splitGeometry(ship.hull.geometry, [
        new Plane(new Vector3(0.15, 0.3, 1).normalize(), len * 0.08),
        new Plane(new Vector3(1, 0.2, -0.3).normalize(), 0),
      ]);
      for (let h = 0; h < hulkCount; h++) {
        for (const pc of pieces) {
          if (rand() < 0.35 && h > 0) continue;
          const mesh = new Mesh(pc.geometry, ship.hull.material);
          const p0 = new Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.3, rand() * 2 - 1).multiplyScalar(R * 0.55).add(pc.centre);
          const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
          const q0 = new Quaternion().setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * 6);
          const drift = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.2);
          mesh.position.copy(p0);
          this.group.add(mesh);
          this.hulks.push({ mesh, axis, rate: (rand() * 0.02 + 0.006) * (rand() < 0.5 ? -1 : 1), q0, drift, p0 });
          // Guttering fires on the torn faces.
          const bs = pc.geometry.boundingSphere!;
          for (let f = 0; f < 3; f++) {
            fires.push({
              pos: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(bs.radius * 0.5),
              color: f % 2 ? '#ff9a3a' : '#ffd070',
              size: 3 + rand() * 5,
              mode: LIGHT_FLICKER,
              rate: 1 + rand() * 2,
              phase: rand(),
              gain: 1.3,
            });
          }
        }
      }
      for (const m of ship.meshes) m.geometry.dispose();
    }
    this.fires = new LightPoints(fires, { minPixels: 1.4, glint: 0.4 });
    if (this.hulks.length) this.hulks[0].mesh.add(this.fires.mesh);

    // ── battle smoke: a thin painted haze ────────────────────────────
    const puffs: Vector3[] = [];
    for (let i = 0; i < 16; i++) puffs.push(new Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.25, rand() * 2 - 1).multiplyScalar(R * 0.7));
    const haze = new HazeClouds({ seed: seedOf(tag) % 997, centres: puffs, size: [R * 0.15, R * 0.4], opacity: 0.16, colors: ['#5c5068', '#8a6a5a'] });
    this.group.add(haze.group);
  }

  update(ctx: SetPieceFrame): void {
    const t = ctx.time;
    this.uTime.value = t;
    for (const h of this.hulks) {
      this.q.setFromAxisAngle(h.axis, t * h.rate);
      h.mesh.quaternion.copy(h.q0).multiply(this.q);
      h.mesh.position.copy(h.p0).addScaledVector(h.drift, t);
    }
    this.fires.update(t);
  }

  dispose(): void {
    this.fires.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}

function fractOf(n: Node): Node {
  return n.fract();
}
