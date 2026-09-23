import { AdditiveBlending, Color, DoubleSide } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  uniform,
  uv,
  vec3,
  float,
  pow,
  abs,
  dot,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  cameraPosition,
  smoothstep,
  saturate,
  time,
  sin,
} from 'three/tsl';
import { noInkMRT } from './InkChannels';

export interface GlowOptions {
  color?: Color | string;
  core?: Color | string;
  intensity?: number;
  /** Falloff along the mesh's V coordinate (plumes are brightest at v=0, the nozzle). */
  lengthFalloff?: boolean;
  flicker?: number;
}

/**
 * Additive HDR glow for engine plumes, nozzles, beacons. Anime exhaust reads as
 * a white-hot core inside a saturated coloured sheath: we fake the core with a
 * facing-ratio term so the centre of any convex glow mesh blows out to white.
 * Writes nothing into the ink/G-buffer channels so glows are never outlined.
 */
export class GlowMaterial extends MeshBasicNodeMaterial {
  readonly glowColor = uniform(new Color('#4fc3ff'));
  readonly coreColor = uniform(new Color('#ffffff'));
  readonly intensity = uniform(4);
  readonly flicker = uniform(0.08);

  constructor(opts: GlowOptions = {}) {
    super();
    this.name = 'GlowMaterial';
    if (opts.color) this.glowColor.value.set(opts.color);
    if (opts.core) this.coreColor.value.set(opts.core);
    if (opts.intensity !== undefined) this.intensity.value = opts.intensity;
    if (opts.flicker !== undefined) this.flicker.value = opts.flicker;

    this.transparent = true;
    this.depthWrite = false;
    this.blending = AdditiveBlending;
    this.side = DoubleSide;

    const lengthFalloff = opts.lengthFalloff === true;

    this.colorNode = Fn(() => {
      const V = normalize(cameraPosition.sub(positionWorld));
      const facing = abs(dot(normalize(normalWorld), V));
      const core = smoothstep(0.55, 0.9, facing);
      const sheath = pow(facing, 1.5);
      const along = lengthFalloff ? float(1).sub(smoothstep(0.05, 1.0, uv().y)) : float(1);
      const fl = float(1).add(sin(time.mul(53.0)).mul(sin(time.mul(31.0))).mul(this.flicker));
      const c = mix(this.glowColor, this.coreColor, core.mul(along));
      return vec3(c).mul(sheath.mul(along).mul(this.intensity).mul(fl));
    })();
    this.opacityNode = saturate(float(1));
    this.mrtNode = noInkMRT();
  }
}
