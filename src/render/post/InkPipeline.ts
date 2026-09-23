import { Color, Vector4, type Camera, type Scene } from 'three';
import { RenderPipeline, type WebGPURenderer, type TextureNode } from 'three/webgpu';
import type { ShaderNode as Node } from '@/render/tsl';
import {
  pass,
  uniform,
  screenUV,
  vec3,
  vec4,
  float,
  mix,
  exp,
  clamp,
  smoothstep,
  length,
  dot,
  fract,
  sin,
  renderOutput,
  select,
  log2,
  max,
  atan,
  floor,
  vec2,
  time,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { sceneMRT } from '../materials/InkChannels';
import { inkEdgeWGSL } from './shaders/inkEdge.wgsl';
import { makeInkEdgeTSL } from './shaders/inkEdge.tsl';
import type { DebugView } from '@/core/Flags';
import { postFx } from './PostFx';
import { cos as tslCos, abs as tslAbs, cross as tslCross, step as tslStep } from 'three/tsl';

export interface InkSettings {
  enabled: boolean;
  /** Base line radius in physical pixels. */
  lineRadius: number;
  silhouetteThreshold: number;
  creaseThreshold: number;
  regionThreshold: number;
  /** Silhouettes sample further out → heavier outer contours. */
  silhouetteScale: number;
  boilAmount: number;
  /** Boil re-seeds this many times per second (12 = animating "on twos"). */
  boilRate: number;
  boilFrequency: number;
  inkColor: Color;
  /** Aerial-perspective haze for scale: distant hulls & lines fade into it. */
  hazeColor: Color;
  /** Distance (km) at which haze reaches ~63%. */
  hazeDistance: number;
  hazeStrength: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
}

export const DEFAULT_INK: InkSettings = {
  enabled: true,
  lineRadius: 1.0,
  silhouetteThreshold: 0.03,
  creaseThreshold: 0.22,
  regionThreshold: 0.004,
  silhouetteScale: 1.8,
  boilAmount: 0.35,
  boilRate: 12,
  boilFrequency: 42,
  inkColor: new Color('#120d1f'),
  hazeColor: new Color('#5b4b8a'),
  hazeDistance: 9,
  hazeStrength: 0.55,
  bloomStrength: 0.55,
  bloomRadius: 0.35,
  bloomThreshold: 1.0,
};

/**
 * The OVA render pipeline (Milestone 3):
 *
 *   scene pass ──MRT──► output (HDR cel colour)
 *                   ├─► gbuf  (view normal, linear depth km)
 *                   └─► ink   (ink weight, region id)
 *        │
 *        ├─ ink edges (raw WGSL on WebGPU / TSL twin on WebGL2)
 *        ├─ aerial haze on inked surfaces → sells kilometre-scale capital ships
 *        ├─ ink composite (distant lines fade toward haze)
 *        ├─ HDR bloom from emissives only (engines, beams, glints)
 *        ├─ tone map + sRGB (renderOutput)
 *        ├─ cel "film" grade: vignette + fine grain
 *        └─ FXAA
 */
export class InkPipeline {
  readonly pipeline: RenderPipeline;
  readonly settings: InkSettings;
  readonly scenePass: ReturnType<typeof pass>;
  readonly isWebGPU: boolean;

  private readonly params = uniform(new Vector4());
  private readonly params2 = uniform(new Vector4());
  private readonly inkColor = uniform(new Color());
  private readonly hazeColor = uniform(new Color());
  private readonly hazeParams = uniform(new Vector4());
  private readonly inkOn = uniform(1);
  private readonly grainSeed = uniform(0);
  private readonly boost = uniform(0);
  private readonly speed = uniform(0);
  private readonly jump = uniform(0);
  private readonly flash = uniform(0);
  // Set-piece grade (postFx.fog/invert/hue/solarize/fade/radiation); identity at defaults.
  private readonly fog = uniform(0);
  private readonly fogColor = uniform(new Color());
  private readonly fogRange = uniform(1.6);
  private readonly invert = uniform(0);
  private readonly hue = uniform(0);
  private readonly solarize = uniform(0);
  private readonly fade = uniform(0);
  private readonly radiation = uniform(0);

  private view: DebugView = 'final';
  private pixelRatio = 1;
  /** Scene-pass resolution scale (dynamic resolution). */
  renderScale = 1;
  private nodes!: Record<DebugView, Node>;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera, isWebGPU: boolean, settings: Partial<InkSettings> = {}) {
    this.isWebGPU = isWebGPU;
    this.settings = { ...DEFAULT_INK, ...settings };

    const scenePass = pass(scene, camera);
    scenePass.setMRT(sceneMRT());
    this.scenePass = scenePass;

    const color = scenePass.getTextureNode('output');
    const gbuf = scenePass.getTextureNode('gbuf') as unknown as TextureNode;
    const ink = scenePass.getTextureNode('ink') as unknown as TextureNode;

    // ── edge detection ────────────────────────────────────────────────
    const edgeData: Node = isWebGPU
      ? inkEdgeWGSL({ gbuf, ink, uv: screenUV, params: this.params, params2: this.params2 })
      : makeInkEdgeTSL(gbuf, ink)(screenUV, this.params, this.params2);
    const edges = vec4(edgeData).toVar('inkEdges');

    // ── haze + ink composite (linear HDR) ─────────────────────────────
    const g = gbuf.sample(screenUV);
    const inkSample = ink.sample(screenUV);
    const depthKm = g.a;
    const surface = inkSample.r.greaterThan(0.0);
    const haze = select(
      surface,
      float(1).sub(exp(depthKm.div(this.hazeParams.x).negate())).mul(this.hazeParams.y).mul(inkSample.b),
      float(0),
    );
    // Afterburner focal distortion: radial chromatic split of the lit frame.
    const caDir = screenUV.sub(0.5);
    const caAmt = this.boost.mul(0.0035).add(this.speed.mul(0.001)).add(this.jump.mul(0.03));
    const litR = color.sample(screenUV.add(caDir.mul(caAmt))).r;
    const litB = color.sample(screenUV.sub(caDir.mul(caAmt))).b;
    // Hyperspace radial zoom blur (a few taps toward the centre, only while jumping).
    const zoom = this.jump.mul(0.09);
    const blur = color
      .sample(screenUV.sub(caDir.mul(zoom.mul(0.25))))
      .rgb.add(color.sample(screenUV.sub(caDir.mul(zoom.mul(0.5)))).rgb)
      .add(color.sample(screenUV.sub(caDir.mul(zoom.mul(0.75)))).rgb)
      .add(color.sample(screenUV.sub(caDir.mul(zoom))).rgb)
      .mul(0.25);
    const caColor = mix(vec3(litR, color.g, litB), blur, this.jump.mul(0.7));
    const lit = mix(caColor, this.hazeColor, haze);
    const lineColor = mix(this.inkColor, this.hazeColor, haze.mul(0.85));
    const inked = mix(lit, lineColor, edges.x.mul(this.inkOn));

    // Bloom reads the pre-ink HDR buffer so only true emissives glow.
    const glow = bloom(color, this.settings.bloomStrength, this.settings.bloomRadius, this.settings.bloomThreshold);
    // Set-piece depth fog (dense nebula): zero at postFx.fog = 0.
    const fogK = this.fog.mul(float(1).sub(exp(depthKm.div(max(this.fogRange, 0.001)).negate())));
    const fogged = mix(inked, this.fogColor, fogK);
    const hdr = vec4(fogged.add(glow.rgb.mul(float(1).sub(fogK.mul(0.6)))), 1.0);

    // ── display transform + film grade ────────────────────────────────
    const display = renderOutput(hdr);
    const centered = screenUV.sub(0.5);
    const vignette = float(1).sub(smoothstep(0.35, 0.95, length(centered.mul(vec3(1.25, 1.0, 0).xy))));
    const grain = fract(sin(dot(screenUV.add(this.grainSeed), vec3(12.9898, 78.233, 0).xy)).mul(43758.5453)).sub(0.5);
    // Anime speed lines: radial streaks on the frame edges while boosting.
    const ang = atan(centered.y, centered.x.mul(1.7));
    const sector = floor(ang.mul(38.0).add(floor(time.mul(24.0)).mul(7.31)));
    const lineHash = fract(sin(sector.mul(91.17)).mul(43758.5453));
    const radius = length(centered.mul(vec2(1.7, 1.0)));
    const along = fract(radius.mul(1.5).sub(time.mul(3.0)).add(lineHash));
    const dash = smoothstep(0.0, 0.25, along).mul(float(1).sub(smoothstep(0.55, 0.9, along)));
    // Thin tapered line inside each lit sector (not a solid wedge).
    const across = fract(ang.mul(38.0)).sub(0.5).abs().mul(2.0);
    const thin = float(1).sub(smoothstep(0.08, 0.22, across.div(radius.mul(1.4).add(0.2))));
    const streak = smoothstep(0.8, 0.88, lineHash).mul(smoothstep(0.32, 0.85, radius)).mul(dash).mul(thin);
    const speedLines = streak.mul(max(this.boost, this.jump)).mul(0.75);
    const graded = display.rgb
      .mul(mix(0.78, 1.0, vignette))
      .add(grain.mul(0.025))
      .add(vec3(0.85, 0.95, 1.0).mul(speedLines));
    const setGraded = setPieceGrade(graded, centered, this.invert, this.hue, this.solarize, this.fade, this.radiation, this.grainSeed);
    const flashed = mix(setGraded, vec3(1.0, 0.98, 0.95), this.flash);
    const final = fxaa(vec4(clamp(flashed, 0, 1), 1.0));

    // ── debug views ───────────────────────────────────────────────────
    const showDepth = log2(depthKm.mul(1000).add(1)).div(20);
    this.nodes = {
      final,
      color: renderOutput(color),
      normal: vec4(g.rgb, 1),
      depth: vec4(vec3(float(1).sub(showDepth)), 1),
      id: vec4(fract(inkSample.g.mul(vec3(1.0, 7.13, 13.7))).mul(inkSample.r), 1),
      edges: vec4(vec3(1).sub(vec3(edges.y, edges.z, edges.w).mul(vec3(0.2, 0.9, 0.9))), 1),
    };

    this.pipeline = new RenderPipeline(renderer, final);
    this.pipeline.outputColorTransform = false;
    this.applySettings();
  }

  applySettings(): void {
    const s = this.settings;
    this.params.value.set(s.lineRadius * this.pixelRatio * this.renderScale, s.silhouetteThreshold, s.creaseThreshold, s.regionThreshold);
    this.params2.value.set(s.silhouetteScale, s.boilAmount, 0, s.boilFrequency);
    this.inkColor.value.copy(s.inkColor);
    this.hazeColor.value.copy(s.hazeColor);
    this.hazeParams.value.set(s.hazeDistance, s.hazeStrength, 0, 0);
    this.inkOn.value = s.enabled ? 1 : 0;
  }

  /**
   * Render the scene pass at a fraction of native resolution. Ink radius is
   * scaled with it so lines keep the same on-screen weight; the ink, grade
   * and FXAA still run at output resolution.
   */
  setRenderScale(scale: number): void {
    const s = Math.min(1, Math.max(0.5, scale));
    if (Math.abs(s - this.renderScale) < 1e-3) return;
    this.renderScale = s;
    this.scenePass.setResolutionScale(s);
    this.applySettings();
  }

  setView(view: DebugView): void {
    if (view === this.view) return;
    this.view = view;
    this.pipeline.outputNode = this.nodes[view];
    // Debug views need the raw buffer, so skip the manual display transform.
    this.pipeline.needsUpdate = true;
  }

  /** Scale line radius with pixel ratio so ink looks identical on hi-dpi screens. */
  resize(_w: number, _h: number, pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.applySettings();
  }

  update(time: number): void {
    this.boost.value = postFx.boost;
    this.speed.value = postFx.speed;
    this.jump.value = postFx.jump;
    this.flash.value = postFx.flash;
    this.fog.value = postFx.fog;
    this.fogColor.value.copy(postFx.fogColor);
    this.fogRange.value = postFx.fogRange;
    this.invert.value = postFx.invert;
    this.hue.value = postFx.hue;
    this.solarize.value = postFx.solarize;
    this.fade.value = postFx.fade;
    this.radiation.value = postFx.radiation;
    // Stepped clock → lines re-trace 12×/s like hand-inked animation.
    this.params2.value.z = Math.floor(time * this.settings.boilRate) % 97;
    this.grainSeed.value = (Math.floor(time * 24) % 64) * 0.013;
  }

  render(): void {
    this.pipeline.render();
  }
}

/**
 * Display-space set-piece grade (src/world/setpieces): hue rotation,
 * solarisation, inversion, fade to black and a radiation warning (green-gold
 * edge tint + white sensor-hit speckle). Every term is the identity when its
 * amount is 0, so scenes that never touch these fields are unaffected.
 */
function setPieceGrade(c: Node, centered: Node, invert: Node, hue: Node, solarize: Node, fade: Node, radiation: Node, seed: Node): Node {
  // Hue: Rodrigues rotation of the colour vector about the grey axis.
  const k = vec3(0.57735, 0.57735, 0.57735);
  const ch = tslCos(hue);
  const sh = sin(hue);
  const rot = c.mul(ch).add(tslCross(k, c).mul(sh)).add(k.mul(dot(k, c).mul(float(1).sub(ch))));
  const hued = clamp(rot, 0, 1);
  const sol = mix(hued, float(1).sub(tslAbs(hued.mul(2).sub(1))), solarize);
  const inv = mix(sol, float(1).sub(sol), invert);
  // Radiation: speckles on a coarse pixel lattice, re-seeded with the grain clock.
  const cell = floor(screenUV.mul(vec2(960, 540)));
  const h = fract(sin(dot(cell.add(seed.mul(97.0)), vec2(12.9898, 78.233))).mul(43758.5453));
  const speck = tslStep(float(1).sub(radiation.mul(0.0035)), h).mul(radiation);
  const edge = smoothstep(0.25, 0.75, length(centered.mul(vec2(1.25, 1.0))));
  const rad = mix(inv, vec3(0.72, 0.8, 0.3), edge.mul(radiation).mul(0.28)).add(vec3(speck.mul(0.9)));
  return mix(rad, vec3(0), fade);
}
