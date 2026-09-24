import { AdditiveBlending, Color, DoubleSide, LatheGeometry, Mesh, SphereGeometry, Vector2, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, abs, dot, float, fract, mix, mx_noise_float, normalView, positionLocal, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { ShipModel } from '@/assets/ShipBuilder';
import { CloudCards } from '../setpieces/CloudCards';
import { useBlendedMRT } from '../BlendedMRT';
import { veilMaterial } from './materials';
import { hullHalfExtents } from '../berths/sites';

/**
 * Atmospheric entry effects (planetary descent), all camera- or ship-locked:
 *
 *  - plasma sheath: an additive paraboloid shell over the hull's nose, hot
 *    white at the stagnation point grading to magenta / orange along the
 *    flanks, stepped bands streaming aft, a noise-torn trailing edge (heat
 *    shimmer) — the cel version of re-entry;
 *  - atmosphere veil: a camera-centred shell tinted with the planet's
 *    atmosphere colour, denser toward the planet: the band on the limb
 *    grows until it fills the frame (depth-tested, so the ship stays in
 *    front; the depth fog does the same job on every surface behind it);
 *  - cloud punch-through: camera-locked cel cloud cards streaming past on
 *    the ship's travel, thickening to the whiteout under which the surface
 *    scene is swapped in.
 *
 * Never inked (noInkMRT / blended MRT; the cards are ink weight 0).
 */
export class EntryFx {
  readonly veil: Mesh;
  private veilOpacity: Node;
  private veilColor: Node;
  readonly punch: CloudCards;
  private readonly wrap = 2600;
  private sheath: Mesh | null = null;
  private sheathK: Node = uniform(0);
  private time: Node = uniform(0);
  private hot: Node = uniform(new Color('#ff6ad5'));
  private travel = new Vector3();

  constructor() {
    const v = veilMaterial(new Color('#9fdcff'));
    this.veil = new Mesh(new SphereGeometry(1400, 32, 16), v.mat);
    this.veil.name = 'entry-veil';
    this.veil.renderOrder = 30;
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    useBlendedMRT(this.veil);
    this.veilOpacity = v.opacity;
    this.veilColor = v.color;

    const n = 64;
    const pf = new Float32Array(n * 4);
    let s = 91;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < n; i++) pf.set([(rnd() - 0.5) * this.wrap, (rnd() - 0.5) * this.wrap, (rnd() - 0.5) * this.wrap, 220 + rnd() * 460], i * 4);
    this.punch = new CloudCards({ seed: 404, puffs: pf, colors: ['#ffffff', '#dfe9f2'], shade: '#9aa8c4', wrap: this.wrap, near: [0.35, 1.1], lining: '#ffffff' });
    this.punch.mesh.name = 'entry-clouds';
    this.punch.mesh.visible = false;
  }

  /** Tint everything to this planet's air. */
  setAtmosphere(atmo: Color, cloud: Color, shade: Color): void {
    (this.veilColor.value as Color).copy(atmo);
    const hsl = { h: 0, s: 0, l: 0 };
    atmo.getHSL(hsl);
    (this.hot.value as Color).setHSL((hsl.h + 0.45) % 1, 0.85, 0.62);
    void cloud;
    void shade;
  }

  /** Build the sheath over `model`'s nose (child of its root: rides the ship). */
  attach(model: ShipModel): void {
    this.detach();
    const half = hullHalfExtents(model);
    const R = Math.max(half.x, half.y) * 1.45 + 2;
    const len = half.z * 1.25 + 6;
    const pts: Vector2[] = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(new Vector2(R * Math.sqrt(t) + 0.01, half.z * 1.08 - t * len));
    }
    const geo = new LatheGeometry(pts, 28);
    geo.rotateX(Math.PI / 2); // lathe axis +Y → ship +Z: the cap sits over the nose
    const m = new MeshBasicNodeMaterial();
    m.name = 'PlasmaSheath';
    m.transparent = true;
    m.depthWrite = false;
    m.blending = AdditiveBlending;
    m.side = DoubleSide;
    m.colorNode = Fn(() => {
      const v: Node = uv().y; // 0 at the nose cap … 1 at the trailing edge
      const bands: Node = smoothstep(0.35, 0.5, abs(fract(v.mul(7.0).sub(this.time.mul(2.6))).sub(0.5)).mul(2.0));
      const torn: Node = mx_noise_float(vec3(positionLocal.xy.mul(0.08), this.time.mul(3.0)));
      const tail: Node = float(1).sub(smoothstep(0.45, 1.0, v.add(torn.mul(0.25))));
      const edge: Node = float(1).sub(abs(dot(normalView, vec3(0, 0, 1)))).mul(0.8).add(0.35);
      const col: Node = mix(vec3(1.0, 0.95, 0.85), vec3(this.hot), smoothstep(0.0, 0.35, v));
      return col.mul(bands.mul(0.55).add(0.45)).mul(tail).mul(edge).mul(this.sheathK).mul(2.2);
    })();
    m.mrtNode = noInkMRT();
    const mesh = new Mesh(geo, m);
    mesh.name = 'plasma-sheath';
    mesh.renderOrder = 25;
    mesh.frustumCulled = false;
    mesh.visible = false;
    useBlendedMRT(mesh);
    model.root.add(mesh);
    this.sheath = mesh;
  }

  detach(): void {
    if (!this.sheath) return;
    this.sheath.removeFromParent();
    this.sheath.geometry.dispose();
    (this.sheath.material as MeshBasicNodeMaterial).dispose();
    this.sheath = null;
  }

  /**
   * Per frame. `up` = universe direction away from the planet (the veil's
   * dense side faces −up); `step` = how far the ship moved this frame (the
   * cloud cards stream past on it).
   */
  set(time: number, k: { sheath: number; veil: number; punch: number }, up: Vector3, step: Vector3): void {
    this.time.value = time;
    this.sheathK.value = k.sheath;
    if (this.sheath) this.sheath.visible = k.sheath > 0.01;
    this.veil.visible = k.veil > 0.005;
    this.veilOpacity.value = k.veil;
    if (this.veil.visible) this.veil.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
    this.punch.mesh.visible = k.punch > 0.01;
    this.travel.add(step);
    if (this.punch.mesh.visible) {
      const w = this.wrap;
      const m = (x: number) => ((x % w) + w) % w;
      (this.punch.eyeMod.value as Vector3).set(m(this.travel.x), m(this.travel.y), m(this.travel.z));
      this.punch.erode.value = 1 - k.punch;
    }
  }

  off(): void {
    this.set(0, { sheath: 0, veil: 0, punch: 0 }, new Vector3(0, 1, 0), new Vector3());
  }

  dispose(): void {
    this.detach();
    this.veil.removeFromParent();
    this.veil.geometry.dispose();
    (this.veil.material as MeshBasicNodeMaterial).dispose();
    this.punch.mesh.removeFromParent();
    this.punch.dispose();
  }
}
