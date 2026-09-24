import { DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, NormalBlending, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, abs, atan, attribute, clamp, dot, float, floor, fract, length, max, min, positionGeometry, positionLocal, select, sin, smoothstep, time, varyingProperty, vec2, vec3, vec4 } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from './BlendedMRT';
import type { ShipEntity } from '@/sim/Fleet';

/**
 * Glowing impact marks stuck to hull plating (capitals): where a shot got
 * through to the metal, the plating glows and cools in hard cel bands —
 * white-hot → orange → red → a dark char that fades out, leaving the
 * permanent scorch to the damage model's scars (DamageFx paints those as
 * damage accumulates; these are the fresh, hot layer on top).
 *
 *   MOLTEN   laser burn: a big molten spot, slow to cool
 *   DENT     kinetic: a small hot dent, quick
 *   ION      harmonic: a blue-white ionised patch that crackles, then chars
 *   CRATER   warhead: a wide glowing crater with a hot rim
 *   CUT      beam on bare plating: capsule segments that chain into a
 *            burning cut line along the sweep
 *
 * Marks live in ship-local space (exact on a turning hull) and are posed
 * each frame from the model's render pose: one instanced draw, fixed pool,
 * no per-frame allocation. Hits close to a live mark of the same kind reheat
 * it instead of stacking.
 */
export const DECAL = { MOLTEN: 0, DENT: 1, ION: 2, CRATER: 3, CUT: 4 } as const;
export type DecalKind = (typeof DECAL)[keyof typeof DECAL];

const CAP = 256;
/** Lift off the plating (m) — the voxel hull is flat-faced, so a little goes a long way. */
const LIFT = 0.35;

const _q = new Quaternion();
const _p = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();

export class ImpactDecals {
  readonly mesh: InstancedMesh;
  private readonly data: InstancedBufferAttribute;
  private readonly ships: (ShipEntity | null)[] = new Array<ShipEntity | null>(CAP).fill(null);
  /** Ship-local position · normal · tangent (xyz each). */
  private readonly lp = new Float32Array(CAP * 3);
  private readonly ln = new Float32Array(CAP * 3);
  private readonly lt = new Float32Array(CAP * 3);
  private readonly size = new Float32Array(CAP);
  /** Half length (m) of a CUT segment (0 for spots). */
  private readonly len = new Float32Array(CAP);
  private readonly age = new Float32Array(CAP);
  private readonly life = new Float32Array(CAP);
  private readonly kind = new Uint8Array(CAP);
  private readonly seed = new Float32Array(CAP);
  private n = 0;
  private rng = 0x6d2b79f5;

  constructor() {
    const geo = new PlaneGeometry(2, 2);
    this.data = new InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.data.setUsage(DynamicDrawUsage);
    geo.setAttribute('aDecal', this.data);
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = NormalBlending;
    mat.side = DoubleSide;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;

    // Per-instance data and the quad corner reach the fragment through explicit varyings.
    const a: Node = varyingProperty('vec4', 'vDecal'); // t · kind · seed · aspect (half length / half width)
    const uvq: Node = varyingProperty('vec2', 'vDecalUV');
    mat.positionNode = Fn(() => {
      a.assign(attribute('aDecal', 'vec4'));
      uvq.assign(positionGeometry.xy);
      return positionLocal;
    })();
    // NB: plain node graph, no Fn / toVar — reading these varyings inside a Fn
    // (on an InstancedMesh) silently drops the draw on the WebGPU backend.
    const t = a.x;
    const k = a.y;
    const seed = a.z;
    const L = max(a.w, 1);
    // Capsule for cuts (in units of the half width), lumpy disc for spots.
    const q = vec2(uvq.x.mul(L), uvq.y);
    const dCut = length(vec2(max(abs(q.x).sub(L.sub(1)), 0), q.y));
    const ang = atan(uvq.y, uvq.x);
    const lump = sin(ang.mul(3).add(seed.mul(40))).mul(0.06).add(sin(ang.mul(7).sub(seed.mul(13))).mul(0.04)).add(0.9);
    const isCut = k.greaterThan(3.5);
    const dd = select(isCut, dCut, length(uvq).div(lump));
    const isDent = k.greaterThan(0.5).and(k.lessThan(1.5));
    const isIon = k.greaterThan(1.5).and(k.lessThan(2.5));
    const isCrater = k.greaterThan(2.5).and(k.lessThan(3.5));
    // Heat step 0 (white-hot) … 4 (dull red), 5 = char. Edges cool first; crater rims stay hot.
    const radial = select(isCrater, abs(dd.sub(0.62)).mul(0.9), dd.mul(dd).mul(0.55));
    const heat = t.mul(select(isDent, float(7.5), float(6.2))).add(radial.mul(2.2)).add(select(isDent, float(0.8), float(0)));
    const stepH = clamp(floor(heat), 0, 5);
    const ramp = (c: Node[]): Node => select(stepH.lessThan(0.5), c[0], select(stepH.lessThan(1.5), c[1], select(stepH.lessThan(2.5), c[2], select(stepH.lessThan(3.5), c[3], select(stepH.lessThan(4.5), c[4], c[5])))));
    const molten = ramp([vec3(3.2, 3.0, 2.3), vec3(2.4, 1.5, 0.35), vec3(1.6, 0.55, 0.12), vec3(0.95, 0.18, 0.08), vec3(0.42, 0.07, 0.06), vec3(0.07, 0.05, 0.07)]);
    const ion = ramp([vec3(2.6, 3.0, 3.3), vec3(1.2, 2.2, 3.2), vec3(0.4, 1.0, 2.4), vec3(0.35, 0.3, 1.3), vec3(0.2, 0.1, 0.45), vec3(0.06, 0.05, 0.1)]);
    // Ion patches crackle while hot: cells of the patch blink on twos.
    const cellQ: Node = floor(uvq.mul(4));
    const cellId = dot(cellQ, vec2(7.1, 13.7));
    const blink = fract(sin(cellId.add(floor(time.mul(24))).add(seed.mul(31))).mul(43758.5453)).greaterThan(0.5);
    const ionCol = select(isIon.and(blink).and(stepH.lessThan(2.5)), ion.mul(1.6), ion);
    const c = select(isIon, ionCol, molten);
    const inside = dd.lessThan(1);
    // Char fades out over the last third; glow fades a touch earlier at the rim.
    const fade = float(1).sub(smoothstep(0.62, 1.0, t));
    const alpha = select(inside, select(stepH.lessThan(4.5), float(1), float(0.8)), float(0)).mul(fade).mul(float(1).sub(smoothstep(0.85, 1.0, dd).mul(0.5)));
    const col: Node = vec4(min(c, vec3(6)), alpha);
    mat.colorNode = col;
    mat.mrtNode = noInkMRT();

    this.mesh = new InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.name = 'impact-decals';
    useBlendedMRT(this.mesh);
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) | 0;
    return (this.rng >>> 0) / 4294967296;
  }

  /** Live marks. */
  get count(): number {
    return this.n;
  }

  /**
   * Stick a mark on `ship` at a universe point / normal (sim pose). `to`
   * (CUT only) is the far end of the segment. Returns the slot.
   */
  add(ship: ShipEntity, pos: Vector3, normal: Vector3, kind: DecalKind, size: number, life: number, to: Vector3 | null = null): void {
    _q.copy(ship.flight.orientation).invert();
    _p.subVectors(pos, ship.flight.position).applyQuaternion(_q);
    _n.copy(normal).applyQuaternion(_q);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    _n.normalize();
    let half = 0;
    if (to) {
      _t.subVectors(to, ship.flight.position).applyQuaternion(_q);
      _b.subVectors(_t, _p);
      half = _b.length() * 0.5;
      _p.addScaledVector(_b, 0.5);
      _t.copy(_b).addScaledVector(_n, -_b.dot(_n));
    } else _t.set(_n.y, _n.z, _n.x).cross(_n);
    if (_t.lengthSq() < 1e-8) _t.set(1, 0, 0).cross(_n);
    _t.normalize();

    // Reheat a live mark of the same kind right here instead of stacking one on it.
    if (kind !== DECAL.CUT) {
      for (let i = 0; i < this.n; i++) {
        if (this.ships[i] !== ship || this.kind[i] !== kind) continue;
        const o = i * 3;
        const dx = this.lp[o] - _p.x;
        const dy = this.lp[o + 1] - _p.y;
        const dz = this.lp[o + 2] - _p.z;
        if (dx * dx + dy * dy + dz * dz > this.size[i] * this.size[i] * 0.36) continue;
        this.age[i] = Math.min(this.age[i], this.life[i] * 0.06);
        this.size[i] = Math.min(Math.max(this.size[i], size) * 1.08, size * 1.6);
        return;
      }
    }

    let i = this.n;
    if (i >= CAP) {
      // Full: recycle the most-spent mark.
      let worst = 0;
      let wt = -1;
      for (let k = 0; k < CAP; k++) {
        const t = this.age[k] / this.life[k];
        if (t > wt) {
          wt = t;
          worst = k;
        }
      }
      i = worst;
    } else this.n++;
    const o = i * 3;
    this.ships[i] = ship;
    this.lp[o] = _p.x;
    this.lp[o + 1] = _p.y;
    this.lp[o + 2] = _p.z;
    this.ln[o] = _n.x;
    this.ln[o + 1] = _n.y;
    this.ln[o + 2] = _n.z;
    this.lt[o] = _t.x;
    this.lt[o + 1] = _t.y;
    this.lt[o + 2] = _t.z;
    this.size[i] = size;
    this.len[i] = half;
    this.age[i] = 0;
    this.life[i] = life;
    this.kind[i] = kind;
    this.seed[i] = this.rand();
  }

  /** Drop every mark on `ship` (e.g. it was destroyed or left the scene). */
  clearShip(ship: ShipEntity): void {
    for (let i = this.n - 1; i >= 0; i--) if (this.ships[i] === ship) this.remove(i);
  }

  private remove(i: number): void {
    const j = --this.n;
    if (i !== j) {
      this.ships[i] = this.ships[j];
      for (let c = 0; c < 3; c++) {
        this.lp[i * 3 + c] = this.lp[j * 3 + c];
        this.ln[i * 3 + c] = this.ln[j * 3 + c];
        this.lt[i * 3 + c] = this.lt[j * 3 + c];
      }
      this.size[i] = this.size[j];
      this.len[i] = this.len[j];
      this.age[i] = this.age[j];
      this.life[i] = this.life[j];
      this.kind[i] = this.kind[j];
      this.seed[i] = this.seed[j];
    }
    this.ships[j] = null;
  }

  /** Age the marks and pose them on their hulls (render pose), eye-relative. */
  update(dt: number, eye: Vector3): void {
    const d = this.data.array as Float32Array;
    for (let i = this.n - 1; i >= 0; i--) {
      const s = this.ships[i];
      this.age[i] += dt;
      if (!s || !s.alive || this.age[i] >= this.life[i]) this.remove(i);
    }
    for (let i = 0; i < this.n; i++) {
      const s = this.ships[i]!;
      const root = s.model.root;
      const o = i * 3;
      _n.set(this.ln[o], this.ln[o + 1], this.ln[o + 2]).applyQuaternion(root.quaternion);
      _t.set(this.lt[o], this.lt[o + 1], this.lt[o + 2]).applyQuaternion(root.quaternion);
      _b.crossVectors(_n, _t);
      _p.set(this.lp[o], this.lp[o + 1], this.lp[o + 2]).applyQuaternion(root.quaternion).add(root.position).sub(eye).addScaledVector(_n, LIFT);
      const w = this.size[i];
      const hx = this.len[i] > 0 ? this.len[i] + w : w;
      _m.makeBasis(_t.multiplyScalar(hx), _b.multiplyScalar(w), _n);
      _m.setPosition(_p);
      this.mesh.setMatrixAt(i, _m);
      d[i * 4] = this.age[i] / this.life[i];
      d[i * 4 + 1] = this.kind[i];
      d[i * 4 + 2] = this.seed[i];
      d[i * 4 + 3] = hx / w;
    }
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.data.clearUpdateRanges();
      this.data.addUpdateRange(0, this.n * 4);
      this.data.needsUpdate = true;
    }
  }
}
