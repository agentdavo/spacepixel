import { Color, DoubleSide, FrontSide } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { ShaderNode as Node } from '@/render/tsl';
import {
  Fn,
  float,
  vec2,
  vec3,
  attribute,
  uniform,
  texture,
  normalWorld,
  normalView,
  positionWorld,
  cameraPosition,
  dot,
  max,
  min,
  pow,
  mix,
  smoothstep,
  saturate,
  normalize,
} from 'three/tsl';
import { LightRig } from '../LightRig';
import { getRamp, type RampName } from './ToonRamp';
import { inkMRT } from './InkChannels';

export interface CelOptions {
  /** Flat base colour. Ignored when `vertexPaint` is true. */
  color?: Color | string;
  /** Read paint from the `color` attribute and per-vertex surface data from `surface`. */
  vertexPaint?: boolean;
  ramp?: RampName;
  /** Fresnel threshold where the rim light starts (lower = fatter rim). */
  rimWidth?: number;
  /** Specular glint strength (0 = matte). Multiplied by surface.z when vertexPaint. */
  gloss?: number;
  shininess?: number;
  /** Ink line weight for this material (0..1+). */
  inkWeight?: number;
  /** Base region id, so different materials never share ink ids. */
  inkId?: number;
  emissive?: Color | string;
  emissiveStrength?: number;
  doubleSided?: boolean;
  /** Custom paint node (overrides color / vertexPaint), e.g. procedural planet bands. */
  paintNode?: Node;
  /** How strongly aerial haze applies to this surface (0 = never, 1 = default). */
  haze?: number;
  /** Custom per-fragment region id node (overrides inkId / surface.x). */
  regionNode?: Node;
}

/**
 * Stylised cel material (Milestone 2).
 *
 *   diffuse = paint × mix(shadowTint, keyColor, ramp(halfLambert))
 *   + hard specular glint (lit side only)
 *   + stark rim light masked towards the rim-light direction
 *   + glass streak for high-gloss surfaces (canopies)
 *   + emissive (HDR, feeds bloom)
 *
 * Per-vertex `surface` attribute (vec4) produced by the ShipBuilder:
 *   x = region id (drives ink panel lines)
 *   y = emissive amount
 *   z = gloss multiplier
 *   w = reserved (damage / decal mask)
 */
export class CelMaterial extends MeshBasicNodeMaterial {
  readonly isCelMaterial = true;
  readonly baseColor = uniform(new Color('#ffffff'));
  readonly emissiveColor = uniform(new Color('#000000'));
  readonly rimWidth = uniform(0.62);
  readonly gloss = uniform(0.6);
  readonly shininess = uniform(48);
  readonly inkWeight = uniform(1);
  readonly emissiveStrength = uniform(3.0);

  constructor(opts: CelOptions = {}) {
    super();
    this.name = 'CelMaterial';
    if (opts.color) this.baseColor.value.set(opts.color);
    if (opts.emissive) this.emissiveColor.value.set(opts.emissive);
    if (opts.rimWidth !== undefined) this.rimWidth.value = opts.rimWidth;
    if (opts.gloss !== undefined) this.gloss.value = opts.gloss;
    if (opts.shininess !== undefined) this.shininess.value = opts.shininess;
    if (opts.inkWeight !== undefined) this.inkWeight.value = opts.inkWeight;
    if (opts.emissiveStrength !== undefined) this.emissiveStrength.value = opts.emissiveStrength;
    this.side = opts.doubleSided ? DoubleSide : FrontSide;

    const vertexPaint = opts.vertexPaint === true;
    const ramp = getRamp(opts.ramp ?? 'classic');
    const surface = vertexPaint ? attribute('surface', 'vec4') : null;

    const paint: Node = opts.paintNode ?? (vertexPaint ? attribute('color', 'vec3') : this.baseColor);
    const regionId: Node =
      opts.regionNode ?? (surface ? surface.x.add(opts.inkId ?? 0) : float(opts.inkId ?? 0));
    const emissiveAmt: Node = surface ? surface.y : float(0);
    const glossAmt: Node = surface ? surface.z.mul(this.gloss) : this.gloss;

    this.colorNode = Fn(() => {
      const N = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(positionWorld));
      const L = LightRig.keyDirection;

      // Banded diffuse via ramp lookup on half-lambert.
      const halfLambert = dot(N, L).mul(0.5).add(0.5);
      const light = texture(ramp, vec2(halfLambert, 0.5)).r;
      const lightColor = mix(LightRig.shadowTint, LightRig.keyColor, light);
      const col = vec3(paint).mul(lightColor).toVar();

      // Hard specular glint — only where the ramp says we're lit.
      const H = normalize(L.add(V));
      const spec = pow(max(dot(N, H), 0.0), this.shininess);
      const glint = smoothstep(0.55, 0.6, spec).mul(glossAmt).mul(smoothstep(0.6, 0.7, light));
      col.addAssign(LightRig.specColor.mul(glint));

      // Canopy streak: a diagonal white band in view space on very glossy parts.
      const nv = normalize(normalView);
      const diag = nv.x.add(nv.y).mul(0.5).add(0.2);
      const band = smoothstep(0.1, 0.14, diag).mul(float(1).sub(smoothstep(0.3, 0.34, diag)));
      col.addAssign(vec3(0.9, 0.95, 1.0).mul(band).mul(smoothstep(0.85, 0.95, glossAmt)));

      // Stark rim light, carved on the side facing the rim source.
      const fres = float(1.0).sub(saturate(dot(N, V)));
      const rimMask = smoothstep(-0.05, 0.25, dot(N, LightRig.rimDirection));
      const rim = smoothstep(this.rimWidth, this.rimWidth.add(0.04), fres).mul(rimMask);
      col.addAssign(LightRig.rimColor.mul(rim));

      // Keep painted surfaces below the bloom threshold: only emissives should glow.
      col.assign(min(col, vec3(0.97)));

      // Emissive (vertex-driven for ship lights / glass, uniform for whole-material glow).
      col.addAssign(vec3(paint).mul(emissiveAmt).mul(this.emissiveStrength));
      col.addAssign(this.emissiveColor.mul(this.emissiveStrength));

      return col;
    })();

    this.mrtNode = inkMRT(this.inkWeight, regionId, opts.haze ?? 1);
  }
}
