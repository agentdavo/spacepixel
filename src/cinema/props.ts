import { AdditiveBlending, CircleGeometry, Color, DoubleSide, Mesh, Sprite, Vector3 } from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { Fn, uniform, uv, vec3, float, abs, max, exp, length, atan, fract, floor, log, smoothstep, saturate, sin, step } from 'three/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from '@/world/BlendedMRT';
import type { ShaderNode as Node } from '@/render/tsl';

/**
 * Small cutscene-only props: the light sheet stretched across a Lantern's
 * throat, and a single anime cross-glint star.
 */

/**
 * The "still lake seen from underneath" across a lit gate: a unit disc in the
 * XY plane (normal +Z, like LanternGate / MegaGate) that forms from the rim
 * inward as `form` rises. Posterised swirl + inward ripples, hot rim.
 * Additive and unlined. Scale it to the gate's inner radius.
 */
export class LightSheet {
  readonly mesh: Mesh;
  /** 0 = gone … 1 = fully formed. */
  readonly form: Node = uniform(0);
  /** Overall brightness multiplier. */
  readonly gain: Node = uniform(1);
  readonly time: Node = uniform(0);
  readonly rim: Node;
  readonly core: Node;

  constructor(rim = '#8fe8ff', core = '#3a6cff') {
    this.rim = uniform(new Color(rim));
    this.core = uniform(new Color(core));
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'LightSheet';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = DoubleSide;
    mat.colorNode = Fn(() => {
      const c: Node = uv().sub(0.5).mul(2.0);
      const r: Node = length(c);
      const ang: Node = atan(c.y, c.x);
      const k: Node = this.form;
      const t: Node = this.time;
      // Forms from the rim inward.
      const edge: Node = float(1.02).sub(k.mul(1.08));
      const formed: Node = smoothstep(edge.sub(0.04), edge, r);
      const inside: Node = float(1).sub(smoothstep(0.985, 1.0, r));
      const rimHot: Node = smoothstep(0.82, 0.985, r);
      // Posterised log swirl drawn inward + slow inward ripples.
      const sw: Node = fract(ang.mul(6.0 / (Math.PI * 2)).add(log(r.add(0.04)).mul(1.6)).add(t.mul(0.05)));
      const band: Node = smoothstep(0.42, 0.5, sw).mul(float(1).sub(smoothstep(0.78, 0.86, sw)));
      const rip: Node = smoothstep(0.38, 0.5, abs(fract(r.mul(7.0).add(t.mul(0.45))).sub(0.5)));
      const lake: Node = floor(saturate(r.mul(0.7).add(band.mul(0.25)).add(rip.mul(0.2))).mul(4.0)).div(4.0);
      const shimmer: Node = sin(t.mul(2.3).add(r.mul(11.0))).mul(0.08).add(0.92);
      const col: Node = vec3(this.core)
        .mul(lake.mul(0.9).add(0.12))
        .add(vec3(this.rim).mul(rimHot.mul(1.2)))
        .add(vec3(1.0, 0.97, 1.0).mul(smoothstep(0.96, 0.99, r).mul(0.8)));
      // The freshly formed edge burns brighter as it sweeps inward.
      const front: Node = exp(abs(r.sub(edge)).mul(-30.0)).mul(step(0.02, k)).mul(float(1).sub(smoothstep(0.9, 1.0, k)));
      return col.add(vec3(this.rim).mul(front.mul(2.0))).mul(formed).mul(inside).mul(shimmer).mul(this.gain);
    })();
    mat.mrtNode = noInkMRT();
    this.mesh = new Mesh(new CircleGeometry(1, 96), mat);
    this.mesh.renderOrder = 14;
    this.mesh.frustumCulled = false;
    useBlendedMRT(this.mesh);
  }

  update(time: number, form: number, gain = 1): void {
    this.time.value = time;
    this.form.value = form;
    this.gain.value = gain;
    this.mesh.visible = form > 0.001 && gain > 0.001;
  }
}

/**
 * One cross-glint star, camera-locked (like the sky): a sprite in render
 * space along a fixed direction, scaled to a constant angular size.
 */
export class StarGlint {
  readonly sprite: Sprite;
  readonly color: Node;
  readonly strength: Node = uniform(1);
  private readonly dir = new Vector3();
  private static readonly DIST = 350_000;

  constructor(color = '#dfe9ff') {
    this.color = uniform(new Color(color));
    const mat = new SpriteNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.colorNode = Fn(() => {
      const c: Node = uv().sub(0.5).mul(2.0);
      const ax: Node = abs(c.x);
      const ay: Node = abs(c.y);
      const arms: Node = max(exp(ax.mul(-34.0)).mul(saturate(float(1).sub(ay))), exp(ay.mul(-34.0)).mul(saturate(float(1).sub(ax))));
      const core: Node = exp(length(c).mul(-10.0));
      const diag: Node = exp(abs(ax.sub(ay)).mul(-44.0)).mul(saturate(float(1).sub(length(c).mul(2.4)))).mul(0.35);
      return vec3(this.color).mul(arms.mul(1.5).add(core.mul(3.0)).add(diag)).mul(this.strength);
    })();
    mat.mrtNode = noInkMRT();
    this.sprite = new Sprite(mat);
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = -990;
  }

  /** Direction (render space, from the eye) and angular size (radians). */
  place(dir: Vector3, angularSize: number, strength = 1): void {
    this.dir.copy(dir).normalize();
    this.sprite.position.copy(this.dir).multiplyScalar(StarGlint.DIST);
    this.sprite.scale.setScalar(StarGlint.DIST * angularSize);
    this.strength.value = strength;
  }
}
