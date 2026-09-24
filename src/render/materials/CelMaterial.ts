import { Color, DoubleSide, FrontSide, Vector3, Vector4 } from 'three';
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
  positionLocal,
  screenCoordinate,
  length,
  fract,
  step,
  sin,
  time,
  mx_noise_float,
  If,
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
  /**
   * Battle damage (ships): per-object scorch marks read from
   * `mesh.userData.dmg` (see `DamageMarks`) — darkened cel patches with
   * screentone hatching round the edges, and glowing burning craters.
   */
  damage?: boolean;
}

/** Number of damage marks a mesh can show at once. */
export const DAMAGE_MARKS = 12;

/**
 * Per-mesh damage data (set on `mesh.userData.dmg`; meshes of one ship share
 * it). Marks are in ship-root-local metres: xyz centre, w radius (0 = unused).
 * `levels` packs one level per mark (0..1 scorch; ≥ 2 burning crater).
 * `mesh.userData.dmgOffset` is the mesh's rest offset from the ship root.
 */
export interface DamageMarks {
  marks: Vector4[];
  levels: Vector4[];
  /** Noise frequency (1/m) for blotchy edges and crack patterns. */
  noiseScale: number;
  /** Any mark set (skips the shader work when false). */
  any: boolean;
}

export function createDamageMarks(noiseScale: number): DamageMarks {
  return {
    marks: Array.from({ length: DAMAGE_MARKS }, () => new Vector4()),
    levels: Array.from({ length: DAMAGE_MARKS / 4 }, () => new Vector4()),
    noiseScale,
    any: false,
  };
}

const ZERO4 = new Vector4();
const ZERO3 = new Vector3();
type ObjFrame = { object?: { userData: { dmg?: DamageMarks; dmgOffset?: Vector3 } } | null };

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

    // Battle damage: per-object uniforms, so one shared material shows each ship's own scars.
    const dmg = opts.damage
      ? {
          marks: Array.from({ length: DAMAGE_MARKS }, (_, i) =>
            uniform(new Vector4()).onObjectUpdate((f: ObjFrame) => f.object?.userData.dmg?.marks[i] ?? ZERO4),
          ) as Node[],
          levels: Array.from({ length: DAMAGE_MARKS / 4 }, (_, i) =>
            uniform(new Vector4()).onObjectUpdate((f: ObjFrame) => f.object?.userData.dmg?.levels[i] ?? ZERO4),
          ) as Node[],
          offset: uniform(new Vector3()).onObjectUpdate((f: ObjFrame) => f.object?.userData.dmgOffset ?? ZERO3) as Node,
          scale: uniform(0.5).onObjectUpdate((f: ObjFrame) => f.object?.userData.dmg?.noiseScale ?? 0.5) as Node,
          on: uniform(0).onObjectUpdate((f: ObjFrame) => (f.object?.userData.dmg?.any ? 1 : 0)) as Node,
        }
      : null;

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

      // Battle damage (OVA style): scorched cel patches with hard edges, a
      // band of screentone hatching round them, burning craters that glow.
      const burn = float(0).toVar();
      const crack = float(0).toVar();
      if (dmg) {
        If(dmg.on.greaterThan(0.5), () => {
          const p = positionLocal.add(dmg.offset);
          const n = mx_noise_float(p.mul(dmg.scale));
          const scorchV = float(0).toVar();
          for (let i = 0; i < DAMAGE_MARKS; i++) {
            const m = dmg.marks[i];
            const lv = dmg.levels[i >> 2];
            const lev: Node = [lv.x, lv.y, lv.z, lv.w][i & 3];
            const d = length(p.sub(m.xyz)).div(max(m.w, 0.001));
            const f = saturate(float(1).sub(d).mul(1.6).add(n.mul(0.45))).mul(step(0.001, m.w));
            scorchV.assign(max(scorchV, f.mul(min(lev, 1.0))));
            // Burning core: a tighter disc inside the scorch.
            const core = saturate(float(1).sub(d.mul(1.8)).add(n.mul(0.3)));
            burn.assign(max(burn, core.mul(step(1.5, lev)).mul(step(0.001, m.w))));
          }
          const scorch = smoothstep(0.42, 0.46, scorchV);
          const band = smoothstep(0.16, 0.2, scorchV).mul(float(1).sub(scorch));
          const sc = screenCoordinate;
          const hatch = step(0.55, fract(sc.x.add(sc.y).mul(1 / 6)));
          col.mulAssign(float(1).sub(band.mul(hatch).mul(0.6)));
          // Soot: near-black, warm, keeping a trace of the paint so panels still read.
          const soot = mix(vec3(0.05, 0.035, 0.04), col.mul(0.3), 0.3);
          // Deep scorch: a second, darker cel step toward the middle.
          const deep = smoothstep(0.78, 0.82, scorchV);
          col.assign(mix(col, soot, scorch));
          col.assign(mix(col, soot.mul(0.45), deep));
          // Craters: thin molten cracks along the noise ridges, a glowing pit at the heart.
          const ridge = float(1).sub(n.abs().mul(7.0));
          const pit = smoothstep(0.82, 0.9, burn);
          crack.assign(max(smoothstep(0.3, 0.45, burn).mul(smoothstep(0.35, 0.6, ridge)), pit.mul(0.6)));
        });
      }

      // Keep painted surfaces below the bloom threshold: only emissives should glow.
      col.assign(min(col, vec3(0.97)));
      if (dmg) {
        const flick = sin(time.mul(23.0).add(positionLocal.x.mul(0.07))).mul(0.25).add(0.85);
        col.addAssign(vec3(1.0, 0.38, 0.08).mul(crack).mul(flick).mul(2.2));
      }

      // Emissive (vertex-driven for ship lights / glass, uniform for whole-material glow).
      col.addAssign(vec3(paint).mul(emissiveAmt).mul(this.emissiveStrength));
      col.addAssign(this.emissiveColor.mul(this.emissiveStrength));

      return col;
    })();

    this.mrtNode = inkMRT(this.inkWeight, regionId, opts.haze ?? 1);
  }
}
