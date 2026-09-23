import {
  AdditiveBlending,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Vector3,
  type Object3D,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  cross,
  dot,
  float,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  positionGeometry,
  pow,
  saturate,
  screenSize,
  sin,
  smoothstep,
  uniform,
  varyingProperty,
  vec3,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from './BlendedMRT';

// Loose-typed handles for graph code (see src/render/tsl.ts).
const projMatrix: Node = cameraProjectionMatrix;
const camWorld: Node = cameraWorldMatrix;
const quadCorner: Node = positionGeometry;

export interface DustLayerOptions {
  /** Edge of the wrapping cube in metres. Motes live in [-S/2, S/2)³ around the eye. */
  size: number;
  count: number;
  /** Streak exposure in seconds: trail = velocity × exposure (clamped to maxTrail). */
  exposure: number;
  /** Longest trail in metres, so a teleport/boost can't smear motes across the screen. */
  maxTrail: number;
  /** Mote width in pixels (before per-mote jitter). */
  widthPx: number;
  /** Minimum on-screen length in pixels, so slow motes read as glittering points. */
  minLengthPx: number;
  /** Distance fade-in (metres) — hides motes about to hit the lens. */
  nearFade: [number, number];
  /** Fraction of the half-cube where motes fade out, so the cube edge never shows. */
  farFade: [number, number];
  intensity: number;
  color: Color | string;
  /** Secondary tint mixed in by per-mote random. */
  altColor: Color | string;
  /** 0..1 glitter amount for slow/static motes. */
  twinkle: number;
  seed: number;
}

export const DUST_NEAR: DustLayerOptions = {
  size: 360,
  count: 5000,
  exposure: 1 / 24,
  maxTrail: 45,
  widthPx: 1.6,
  minLengthPx: 2.2,
  nearFade: [2, 9],
  farFade: [0.45, 0.95],
  intensity: 1.15,
  color: '#e4efff',
  altColor: '#ffd6b8',
  twinkle: 0.6,
  seed: 1,
};

export const DUST_FAR: DustLayerOptions = {
  size: 3600,
  count: 700,
  exposure: 1 / 24,
  maxTrail: 45,
  widthPx: 1.9,
  minLengthPx: 2.4,
  nearFade: [60, 260],
  farFade: [0.35, 0.95],
  intensity: 0.55,
  color: '#b9c8ff',
  altColor: '#f0b8e8',
  twinkle: 0.8,
  seed: 2,
};

/**
 * One wrapping layer of motes, drawn as a single instanced quad mesh.
 *
 * All per-mote work happens on the GPU: the CPU only writes three uniforms per
 * frame (eye offset mod S, clamped trail vector, nothing else). Each mote's
 * universe position is `seed + k·S` for every integer k, so wrapping around the
 * eye is `mod(seed − eyeOffset + S/2, S) − S/2`. eyeOffset = eye mod S is
 * reduced in float64 on the CPU, so the shader only ever sees small numbers —
 * dust stays rock-steady 2 000 km from the origin.
 *
 * Each mote is a quad stretched along the trail (where the mote *was* relative
 * to the camera `exposure` seconds ago = p + v·T). The trail is split into its
 * component across the view ray (drives the on-screen direction/width) and the
 * full 3D vector (so perspective foreshortens head-on streaks into the classic
 * radial "warp" burst). Minimum pixel length keeps slow motes as glints.
 */
export class DustLayer {
  readonly mesh: Mesh;
  readonly opts: DustLayerOptions;
  private readonly uEyeOffset: Node = uniform(new Vector3());
  private readonly uTrail: Node = uniform(new Vector3());
  /** Layer clock (drives glitter); advanced by update() so captures are deterministic. */
  readonly uTime: Node = uniform(0);
  readonly uIntensity: Node;

  constructor(opts: DustLayerOptions) {
    this.opts = opts;
    const S = opts.size;
    this.uIntensity = uniform(opts.intensity);

    // Base quad: x = along (0 head → 1 tail), y = side (−1..1).
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const motes = new Float32Array(opts.count * 4);
    let s = (opts.seed * 7919 + 13) | 0;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < opts.count; i++) {
      motes[i * 4] = rand() * S;
      motes[i * 4 + 1] = rand() * S;
      motes[i * 4 + 2] = rand() * S;
      motes[i * 4 + 3] = rand();
    }
    geo.setAttribute('mote', new InstancedBufferAttribute(motes, 4));
    geo.instanceCount = opts.count;

    const mat = new MeshBasicNodeMaterial();
    mat.name = 'SpaceDust';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;

    const vAlong: Node = varyingProperty('float', 'vDustAlong');
    const vSide: Node = varyingProperty('float', 'vDustSide');
    const vGain: Node = varyingProperty('float', 'vDustGain');
    const vRand: Node = varyingProperty('float', 'vDustRand');

    const eyeOffset = this.uEyeOffset;
    const trail = this.uTrail;
    const half = S / 2;

    mat.positionNode = Fn(() => {
      const corner = quadCorner;
      const m: Node = attribute('mote', 'vec4');
      const r = m.w;

      // Eye-relative wrapped position (world axes, origin at the camera).
      const p: Node = mod(m.xyz.sub(eyeOffset).add(half), vec3(S)).sub(half);
      const dist: Node = max(length(p), 0.01);
      const ray = p.div(dist);

      // World size of one pixel at this distance: 2·tan(fov/2)/H = 2/(P[1][1]·H).
      const pix = dist.mul(2).div(projMatrix.element(1).y.mul(screenSize.y));

      // Trail component across the ray sets the streak's on-screen direction.
      const tPerp: Node = trail.sub(ray.mul(dot(trail, ray)));
      const right = camWorld.element(0).xyz;
      const dir: Node = normalize(tPerp.add(right.mul(pix.mul(1e-3))));
      const perpLen = length(tPerp);
      const side = normalize(cross(dir, ray));

      const minLen = pix.mul(opts.minLengthPx).mul(r.mul(0.8).add(0.6));
      const ext = max(minLen.sub(perpLen), 0);
      const width = pix.mul(opts.widthPx).mul(r.mul(0.7).add(0.65));

      const along = corner.x;
      const pos = p
        .add(trail.mul(along))
        .add(dir.mul(ext.mul(along.sub(0.5))))
        .add(side.mul(corner.y.mul(width).mul(0.5)));

      // Fades: near (lens), far (cube edge).
      const fade = smoothstep(opts.nearFade[0], opts.nearFade[1], dist).mul(
        float(1).sub(smoothstep(half * opts.farFade[0], half * opts.farFade[1], dist)),
      );
      // Spread energy over long streaks (sqrt keeps them punchy, anime-bright).
      const pxLen = max(perpLen, minLen).div(pix);
      const spread = pow(min(float(opts.minLengthPx).div(pxLen), 1), 0.45);
      // Glitter: static motes twinkle, streaking ones hold steady.
      const moving = smoothstep(opts.minLengthPx, opts.minLengthPx * 4, pxLen);
      const tw = sin(this.uTime.mul(r.mul(5).add(1.5)).add(r.mul(91.7))).mul(0.5).add(0.5);
      const glitter = mix(mix(1, tw.mul(1.6), opts.twinkle), 1, moving);

      vAlong.assign(along);
      vSide.assign(corner.y);
      vGain.assign(fade.mul(spread).mul(glitter));
      vRand.assign(r);
      return pos.add(cameraPosition);
    })();

    const colA: Node = uniform(new Color(opts.color));
    const colB: Node = uniform(new Color(opts.altColor));
    mat.colorNode = Fn(() => {
      const headFade = pow(float(1).sub(vAlong), 1.3);
      const edge = float(1).sub(vSide.mul(vSide));
      const tint = mix(colA, colB, smoothstep(0.7, 1.0, vRand));
      const bright = vRand.mul(vRand).mul(1.4).add(0.35);
      return vec3(tint).mul(saturate(headFade.mul(edge)).mul(vGain).mul(bright).mul(this.uIntensity));
    })();
    mat.mrtNode = noInkMRT();

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = `dust:${S}m`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.matrixAutoUpdate = false;
    useBlendedMRT(this.mesh);
  }

  update(eye: Vector3, velocity: Vector3, dt: number): void {
    const S = this.opts.size;
    this.uTime.value = ((this.uTime.value as number) + dt) % 1000;
    // float64 reduction on the CPU; only the small remainder reaches the GPU.
    const e = this.uEyeOffset.value as Vector3;
    e.set(eye.x - Math.floor(eye.x / S) * S, eye.y - Math.floor(eye.y / S) * S, eye.z - Math.floor(eye.z / S) * S);
    const t = this.uTrail.value as Vector3;
    t.copy(velocity).multiplyScalar(this.opts.exposure);
    const len = t.length();
    if (len > this.opts.maxTrail) t.multiplyScalar(this.opts.maxTrail / len);
  }
}

/**
 * Camera-locked space dust: THE motion cue in a groundless void. Fast flight
 * pulls the motes into anime speed lines, slow drift leaves sparse glitter.
 * A near layer (hundreds of metres) and a sparse far layer (kilometres) give
 * two parallax rates.
 *
 * Parent `object` directly to the Scene (not WorldSpace.root) — positions are
 * eye-relative and offset by `cameraPosition` in the shader, so it also works
 * in scenes that move the camera instead of the world.
 *
 * Per frame: two uniform writes per layer, one draw call per layer.
 */
export class SpaceDust {
  readonly object: Object3D = new Group();
  readonly layers: DustLayer[];

  constructor(layers: DustLayerOptions[] = [DUST_NEAR, DUST_FAR]) {
    this.object.name = 'space-dust';
    this.layers = layers.map((o) => new DustLayer(o));
    for (const l of this.layers) this.object.add(l.mesh);
  }

  /**
   * @param eye       universe position of the eye (float64)
   * @param velocity  eye velocity in m/s, world axes (relative to the local rest frame)
   * @param dt        frame time in seconds (glitter clock)
   */
  update(eye: Vector3, velocity: Vector3, dt: number): void {
    for (const l of this.layers) l.update(eye, velocity, dt);
  }

  set intensity(v: number) {
    for (const l of this.layers) l.uIntensity.value = l.opts.intensity * v;
  }
}
