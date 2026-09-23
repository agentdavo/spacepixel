import {
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  float,
  floor,
  mix,
  length,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  cameraPosition,
  positionGeometry,
  smoothstep,
  uniform,
  varyingProperty,
  vec3,
  vec4,
  texture,
  dot,
  select,
  step,
  abs,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from './BlendedMRT';

export interface HazeCloudOptions {
  seed: number;
  /** Puff centres, field-local metres. Radius per puff comes from `size`. */
  centres: Vector3[];
  size: [number, number];
  /** Peak opacity of the densest cel step. */
  opacity: number;
  /** Two tints (mixed per puff): dusty violet and teal to echo the nebula. */
  colors: [string, string];
}

/**
 * Bake four puff silhouettes (one per RGBA channel): value-noise fBm eroding a
 * radial falloff. Sampling a 128² texture is far cheaper per pixel than live
 * fBm, which matters because these quads are big and overlap.
 */
function bakePuffTexture(seed: number): DataTexture {
  const N = 128;
  const G = 16;
  let s = (seed * 69069 + 1) | 0;
  const lattice = new Float32Array(G * G * 4);
  for (let i = 0; i < lattice.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    lattice[i] = (s >>> 0) / 4294967296;
  }
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, ch: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const at = (a: number, b: number) => lattice[((((b % G) + G) % G) * G + (((a % G) + G) % G)) * 4 + ch];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return top + (bot - top) * fy;
  };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      const r = Math.hypot(u * 2 - 1, v * 2 - 1);
      for (let ch = 0; ch < 4; ch++) {
        let f = 0;
        let amp = 0.5;
        let freq = 3;
        for (let o = 0; o < 4; o++) {
          f += (noise(u * freq + ch * 3.1, v * freq + ch * 5.7, ch) - 0.5) * amp;
          amp *= 0.5;
          freq *= 2;
        }
        const d = Math.max(0, Math.min(1, 1 - r * 1.05 + f * 1.1));
        data[(y * N + x) * 4 + ch] = Math.round(d * 255);
      }
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Painted dust lanes: big, faint, posterised haze puffs (hundreds of metres to
 * kilometres across) scattered through an asteroid field. They give the void
 * a volume — rocks slide in front of/behind them, and because they're big and
 * soft they parallax at a different rate from both the rocks and the dust.
 *
 * One instanced draw of camera-facing quads. Density is fBm × radial falloff
 * quantised into three flat steps like a background painter's cel layers.
 * Puffs fade out as the camera approaches (you fly *through* haze, never into
 * a card edge). Alpha-blended with ink weight 0 — never outlined.
 *
 * Universe-positioned: parent `group` next to the field (e.g. as a child of
 * `AsteroidField.group`) under `WorldSpace.root`.
 */
export class HazeClouds {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly opacity: Node;

  constructor(opts: HazeCloudOptions) {
    this.group.name = 'haze-clouds';
    let s = (opts.seed * 48271 + 11) | 0;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };

    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const n = opts.centres.length;
    const puff = new Float32Array(n * 4);
    const look = new Float32Array(n * 4);
    let maxR = 0;
    opts.centres.forEach((c, i) => {
      const r = opts.size[0] + Math.pow(rand(), 1.5) * (opts.size[1] - opts.size[0]);
      maxR = Math.max(maxR, c.length() + r);
      puff.set([c.x, c.y, c.z, r], i * 4);
      look.set([rand() * 100, rand(), 0.55 + rand() * 0.45, rand() * 6.283], i * 4);
    });
    geo.setAttribute('puff', new InstancedBufferAttribute(puff, 4));
    geo.setAttribute('look', new InstancedBufferAttribute(look, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3(), maxR);

    const mat = new MeshBasicNodeMaterial();
    mat.name = 'HazeClouds';
    mat.transparent = true;
    mat.depthWrite = false;

    this.opacity = uniform(opts.opacity);
    const colA: Node = uniform(new Color(opts.colors[0]));
    const colB: Node = uniform(new Color(opts.colors[1]));
    const puffTex = bakePuffTexture(opts.seed);
    const vUV: Node = varyingProperty('vec2', 'vHazeUV');
    const vMask: Node = varyingProperty('vec4', 'vHazeMask');
    const vLook: Node = varyingProperty('vec4', 'vHazeLook');
    const vFade: Node = varyingProperty('float', 'vHazeFade');
    const camWorld: Node = cameraWorldMatrix;
    const corner: Node = positionGeometry;

    mat.positionNode = Fn(() => {
      const p: Node = attribute('puff', 'vec4');
      const lk: Node = attribute('look', 'vec4');
      // Camera right/up in the field's local frame (rotation only; no scale on the group).
      const inv: Node = modelWorldMatrixInverse;
      const right = inv.mul(vec4(camWorld.element(0).xyz, 0)).xyz.normalize();
      const up = inv.mul(vec4(camWorld.element(1).xyz, 0)).xyz.normalize();
      // In-plane spin so identical puffs don't line up.
      const c = lk.w.cos();
      const sn = lk.w.sin();
      const q = corner.xy;
      const rx = q.x.mul(c).sub(q.y.mul(sn));
      const ry = q.x.mul(sn).add(q.y.mul(c));
      const centreWorld: Node = modelWorldMatrix.mul(vec4(p.xyz, 1)).xyz;
      const d = length(centreWorld.sub(cameraPosition));
      vUV.assign(corner.xy.mul(0.5).add(0.5));
      vLook.assign(lk);
      // Channel select: one-hot from the per-puff variant.
      const ch = floor(lk.y.mul(3.999));
      vMask.assign(step(abs(vec4(ch).sub(vec4(0, 1, 2, 3))), vec4(0.5)));
      // Fade as we enter the puff; also fade very distant puffs into the sky.
      const fade: Node = smoothstep(p.w.mul(0.45), p.w.mul(1.4), d).mul(float(1).sub(smoothstep(18000, 30000, d)));
      vFade.assign(fade);
      // Fully faded puffs collapse to a point: zero fill cost when we're inside them.
      const extent = select(fade.greaterThan(0.002), p.w, float(0));
      return p.xyz.add(right.mul(rx.mul(extent))).add(up.mul(ry.mul(extent)));
    })();

    mat.colorNode = Fn(() => {
      const density = dot(texture(puffTex, vUV), vMask).mul(vLook.z);
      // Three flat cel steps.
      const stepped: Node = floor(smoothstep(0.05, 0.75, density).mul(3.0)).div(3.0);
      const tint: Node = mix(colA, colB, vLook.y.mul(vLook.y));
      return vec4(vec3(tint).mul(stepped.mul(0.35).add(0.75)), stepped.mul(this.opacity).mul(vFade));
    })();
    mat.mrtNode = noInkMRT();

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'haze-puffs';
    this.mesh.renderOrder = 5;
    useBlendedMRT(this.mesh);
    this.group.add(this.mesh);
  }
}
