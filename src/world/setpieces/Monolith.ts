import { BackSide, Color, Group, Mesh, SphereGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  Discard,
  abs,
  atan,
  acos,
  asin,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraViewMatrix,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  mx_cell_noise_float,
  normalize,
  positionWorld,
  pow,
  reflect,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
  viewZToReversedPerspectiveDepth,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { inkMRT, noInkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { bool, num, str } from './types';

/** Proxy geometry must stay inside the camera far plane (FlightScene: 1.5e6 m). */
const PROXY_FAR = 1.25e6;
/** Written depth is clamped inside the Backdrop sparkle shell (0.9 × 400 km) so sky sprites never draw over it. */
const DEPTH_CLAMP = 330_000;
/** Halo extent in body radii. */
const HALO = 1.7;

/**
 * The Builder monolith: a sphere the size of a moon (default R = 1 400 km).
 *
 * Rendering (floating-origin safe at any range):
 *  - Nothing is ever drawn at true scale. Each frame a unit-sphere PROXY is
 *    placed along the eye→centre line and scaled by k so its angular size is
 *    exact and its far side sits inside the camera far plane.
 *  - The body is ray-traced per pixel against the analytic sphere, in units
 *    of R with the eye-relative centre computed in float64 on the CPU — the
 *    limb is mathematically perfect from 50 000 km down to a 5 km skim, with
 *    no tessellation and no float32 blow-up.
 *  - The fragment writes its TRUE depth (clamped to 330 km), so ships near
 *    the surface sort correctly against it even though the proxy is scaled.
 *  - The lattice is a cube-sphere equi-angular grid at four octaves drawn as
 *    "pristine" lines: fixed world width, pixel-footprint anti-aliasing and
 *    coverage fade, so it stays razor-thin and moiré-free at any distance.
 *  - A halo shell draws the razor limb line, the corona and a gravitational
 *    lens: a dark ring in which the star field is re-sampled through a
 *    point-mass deflection (Einstein ring, stars smeared into arcs).
 *
 * Ink weight 0 — never outlined. Params: `radius` (m), `broadcast` (bool,
 * lattice "breathes"; also driven by flag `oracle-broadcast`), `spin`
 * (rad/s, default 0.0004), `tint` (lattice colour).
 * Flag: `${tag}-contact` when the player is within 20 km of the surface.
 */
export class Monolith implements SetPiece {
  readonly kind: SetPieceKind = 'monolith';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  /** Player altitude above the surface (m), updated each frame. */
  altitude = Infinity;
  /** 0..1 breathing amount (smoothed). */
  breath = 0;

  private readonly body: Mesh;
  private readonly halo: Mesh;
  private readonly uCn: Node = uniform(new Vector3(0, 0, -10));
  private readonly uAx: Node = uniform(new Vector3(1, 0, 0));
  private readonly uAy: Node = uniform(new Vector3(0, 1, 0));
  private readonly uAz: Node = uniform(new Vector3(0, 0, 1));
  private readonly uR: Node = uniform(1);
  private readonly uTime: Node = uniform(0);
  private readonly uBreath: Node = uniform(0);
  private readonly broadcastParam: boolean;
  private readonly spin: number;
  private readonly tilt = new Vector3(0.21, 0.94, -0.27).normalize();
  private readonly rel = new Vector3();
  private readonly ax = new Vector3();
  private readonly ay = new Vector3();
  private readonly az = new Vector3();
  private readonly x0 = new Vector3();

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:monolith:${tag}`;
    this.radius = num(params, 'radius', 1_400_000);
    this.broadcastParam = bool(params, 'broadcast', false);
    this.spin = num(params, 'spin', 0.0004);
    const tint: Node = uniform(new Color(str(params, 'tint', '#8a6cff')));

    const geo = new SphereGeometry(1, 48, 24);

    // ── body ─────────────────────────────────────────────────────────
    const bodyMat = new MeshBasicNodeMaterial();
    bodyMat.name = 'MonolithBody';
    bodyMat.side = BackSide;
    const hit = this.hitNodes();
    bodyMat.colorNode = Fn(() => {
      const h = hit();
      If(h.disc.lessThan(0.0), () => {
        Discard();
      });
      return this.surfaceColor(h, tint);
    })();
    bodyMat.depthNode = Fn((_: unknown, builder: { renderer: { reversedDepthBuffer?: boolean } }) => {
      const h = hit();
      const dist = min(h.t.mul(this.uR), float(DEPTH_CLAMP));
      const pw = h.dir.mul(dist).add(cameraPosition);
      const viewZ: Node = cameraViewMatrix.mul(vec4(pw, 1)).z;
      return builder.renderer.reversedDepthBuffer
        ? viewZToReversedPerspectiveDepth(viewZ, cameraNear, cameraFar)
        : viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar);
    })();
    bodyMat.mrtNode = inkMRT(0, 0, 0);
    this.body = new Mesh(geo, bodyMat);
    this.body.name = 'monolith-body';
    this.body.frustumCulled = false;
    this.body.renderOrder = -990;
    this.group.add(this.body);

    // ── halo: razor limb, corona, lensing ────────────────────────────
    const haloMat = new MeshBasicNodeMaterial();
    haloMat.name = 'MonolithHalo';
    haloMat.side = BackSide;
    haloMat.transparent = true;
    haloMat.premultipliedAlpha = true;
    haloMat.depthWrite = false;
    const halo = this.haloNodes(tint);
    haloMat.colorNode = halo.color;
    haloMat.opacityNode = halo.alpha;
    haloMat.mrtNode = noInkMRT();
    this.halo = new Mesh(geo, haloMat);
    this.halo.name = 'monolith-halo';
    this.halo.frustumCulled = false;
    this.halo.renderOrder = -998;
    this.group.add(this.halo);
  }

  /** Ray/sphere in units of R: ray from the eye along `dir`, sphere centre uCn, radius 1. */
  private hitNodes() {
    return () => {
      const dir: Node = normalize(positionWorld.sub(cameraPosition));
      const b: Node = dot(dir, this.uCn);
      const cc: Node = dot(this.uCn, this.uCn);
      const disc: Node = b.mul(b).sub(cc).add(1.0);
      const t: Node = max(b.sub(sqrt(max(disc, 0.0))), 0.0);
      const N: Node = normalize(dir.mul(t).sub(this.uCn));
      // Impact parameter (closest approach of the ray to the centre, in R).
      const p: Node = sqrt(max(float(1).sub(disc), 0.0));
      return { dir, b, cc, disc, t, N, p };
    };
  }

  /** Cube-sphere equi-angular face coordinates in [-1, 1]². */
  private cubeUV(n: Node): Node {
    const a: Node = abs(n);
    const xMajor = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
    const yMajor = a.y.greaterThan(a.x).and(a.y.greaterThanEqual(a.z));
    const uv: Node = select(xMajor, n.yz.div(a.x), select(yMajor, n.xz.div(a.y), n.xy.div(a.z)));
    return atan(uv).mul(4 / Math.PI);
  }

  /** Pristine grid lines: fixed world width in cell units, pixel-footprint AA, fade to coverage when too dense. */
  private gridLines(w: Node, divisions: number, width: number): Node {
    const g: Node = w.mul(divisions);
    const fw: Node = max(fwidth(g), vec2(1e-6));
    const d: Node = abs(fract(g.sub(0.5)).sub(0.5));
    const drawW: Node = max(vec2(width), fw);
    const cov: Node = min(vec2(width).div(fw), vec2(1));
    const line: Node = float(1).sub(smoothstep(drawW.mul(0.5), drawW.mul(0.5).add(fw), d)).mul(cov);
    const l: Node = max(line.x, line.y);
    // Beyond ~2 cells per pixel the lattice becomes an even tone (no moiré).
    const dense: Node = smoothstep(0.25, 0.6, max(fw.x, fw.y));
    return mix(l, float(width * 2), dense);
  }

  private surfaceColor(h: { dir: Node; N: Node; p: Node; t: Node }, tint: Node): Node {
    const N = h.N;
    const L: Node = LightRig.keyDirection;
    const V: Node = h.dir.negate();
    // Local frame (slow spin) for the lattice.
    const Nl: Node = vec3(dot(N, this.uAx), dot(N, this.uAy), dot(N, this.uAz));
    const w = this.cubeUV(Nl);

    // Matte black-violet with a hard cel terminator and one soft sheen band.
    const ndl: Node = dot(N, L);
    const lit: Node = smoothstep(-0.015, 0.015, ndl);
    const hi: Node = smoothstep(0.55, 0.58, ndl);
    const shadow = vec3(0.004, 0.0028, 0.009);
    const mid = vec3(0.028, 0.019, 0.058);
    const top = vec3(0.05, 0.036, 0.1);
    const col: Node = mix(mix(shadow, mid, lit), top, hi).toVar();
    const sheen: Node = pow(max(dot(reflect(h.dir, N), L), 0.0), 28.0);
    col.addAssign(vec3(0.16, 0.14, 0.3).mul(smoothstep(0.35, 0.4, sheen)).mul(0.35));

    // The lattice: four octaves of an impossibly precise grid.
    const g0 = this.gridLines(w, 6, 0.01);
    const g1 = this.gridLines(w, 48, 0.018);
    const g2 = this.gridLines(w, 384, 0.03);
    const g3 = this.gridLines(w, 3072, 0.05);
    const lattice: Node = g0.mul(1.0).add(g1.mul(0.5)).add(g2.mul(0.32)).add(g3.mul(0.22));

    // Breathing: a slow standing pulse that runs pole-to-pole along the lattice.
    const lat: Node = acos(Nl.y.clamp(-1, 1));
    const wave: Node = pow(sin(this.uTime.mul(0.9).sub(lat.mul(9.0))).mul(0.5).add(0.5), 6.0);
    const node: Node = pow(g0.mul(g1), 0.5);
    const gain: Node = float(0.14).add(this.uBreath.mul(wave.mul(2.6).add(0.25)));
    col.addAssign(vec3(tint).mul(lattice.mul(gain)).mul(mix(0.55, 1.0, lit)));
    col.addAssign(vec3(0.9, 0.85, 1.0).mul(node.mul(this.uBreath).mul(wave).mul(1.6)));

    // Inner limb: a thin, hard light line hugging the silhouette on the lit/rim side.
    const fres: Node = float(1).sub(max(dot(N, V), 0.0));
    const rimSide: Node = max(smoothstep(-0.2, 0.6, ndl), smoothstep(0.0, 0.7, dot(N, LightRig.rimDirection)).mul(0.6));
    const pw: Node = max(fwidth(h.p), 1e-7);
    const limb: Node = smoothstep(float(1).sub(pw.mul(2.5)), float(1).sub(pw.mul(0.5)), h.p);
    col.addAssign(vec3(0.85, 0.8, 1.0).mul(limb.mul(rimSide).mul(1.6)));
    col.addAssign(vec3(tint).mul(smoothstep(0.86, 0.99, fres).mul(rimSide).mul(0.06)));
    return col;
  }

  /** Procedural star cells on the direction sphere (same idiom as the Backdrop). */
  private stars(d: Node, scale: number, threshold: number, radius: number, gain: number): Node {
    const q = d.mul(scale);
    const cell = floor(q);
    const f = fract(q);
    const jitter = vec3(mx_cell_noise_float(cell), mx_cell_noise_float(cell.add(19.19)), mx_cell_noise_float(cell.add(47.7))).mul(0.7).add(0.15);
    const dist = length(f.sub(jitter));
    const on = step(threshold, mx_cell_noise_float(cell.add(91.3)));
    return float(1).sub(smoothstep(0.0, radius, dist)).mul(on).mul(gain);
  }

  private haloNodes(tint: Node): { color: Node; alpha: Node } {
    const hit = this.hitNodes();
    const out = Fn(() => {
      const h = hit();
      const dir: Node = h.dir;
      const cLen: Node = sqrt(h.cc);
      const cHat: Node = this.uCn.div(cLen);
      // Closest-approach vector (limb direction) and impact parameter p (> 1 outside the disc).
      const q: Node = dir.mul(h.b).sub(this.uCn);
      const p: Node = max(length(q), 1e-5);
      const qHat: Node = q.div(p);
      const x: Node = max(p.sub(1.0), 0.0);
      const pw: Node = max(fwidth(p), 1e-7);
      const front: Node = step(0.0, h.b);
      const L: Node = LightRig.keyDirection;
      const facing: Node = dot(qHat, L);
      const rimFacing: Node = dot(qHat, LightRig.rimDirection);

      // Razor limb line: ~1.5 px, brightest where the star is behind the limb.
      const razor: Node = exp(x.div(pw.mul(1.1)).negate());
      const razorI: Node = float(0.5).add(smoothstep(-0.2, 0.9, facing).mul(4.5)).add(smoothstep(0.2, 0.9, rimFacing).mul(1.2));
      // Corona: a stepped (cel) soft glow + a tight inner sheath.
      const corona: Node = exp(x.mul(-16.0)).mul(0.22).add(exp(x.mul(-70.0)).mul(0.5));
      const coronaStep: Node = floor(corona.mul(7.0)).div(7.0);
      const lightSide: Node = smoothstep(-0.6, 0.9, facing).mul(0.8).add(0.2);

      // Gravitational lens: point-mass deflection with the Einstein ring at ~1.22 R.
      const theta: Node = acos(dot(dir, cHat).clamp(-1, 1));
      const thetaS: Node = asin(min(float(1).div(cLen), 0.9999));
      const thetaE: Node = thetaS.mul(1.22);
      const alpha: Node = thetaE.mul(thetaE).div(max(theta, 1e-6));
      const beta: Node = theta.sub(alpha);
      const perp: Node = normalize(dir.sub(cHat.mul(dot(dir, cHat))).add(vec3(1e-7, 0, 0)));
      const src: Node = cHat.mul(cos(beta)).add(perp.mul(sin(beta)));
      const lensed: Node = this.stars(src, 170, 0.62, 0.2, 1.8).add(this.stars(src, 60, 0.88, 0.12, 3.0));
      const lensMask: Node = float(1).sub(smoothstep(1.0, HALO * 0.92, p)).mul(front);
      const ringD: Node = abs(theta.sub(thetaE)).div(max(fwidth(theta), 1e-7));
      const einstein: Node = exp(ringD.mul(-0.7)).mul(0.35).add(exp(abs(p.sub(1.22)).mul(-40.0)).mul(0.05));

      const glow: Node = vec3(tint)
        .mul(coronaStep.mul(lightSide))
        .add(vec3(0.92, 0.88, 1.0).mul(razor.mul(razorI)))
        .add(vec3(0.75, 0.7, 1.0).mul(einstein))
        .mul(front);
      const starCol: Node = vec3(0.85, 0.9, 1.0).mul(lensed).mul(lensMask);
      // Premultiplied: the lens darkens the real sky behind it (alpha) and adds the re-mapped stars + glow.
      const a: Node = lensMask.mul(0.82);
      return vec4(glow.add(starCol), a);
    })();
    return { color: out.rgb, alpha: out.a };
  }

  update(ctx: SetPieceFrame): void {
    const R = this.radius;
    // Eye-relative centre in float64.
    this.rel.subVectors(this.position, ctx.eye);
    const D = this.rel.length();
    const k = Math.min(1, PROXY_FAR / (D + HALO * R));
    // Group sits at `position` under the root (world = rel); move the proxies to rel·k.
    this.group.position.copy(this.position);
    this.body.position.copy(this.rel).multiplyScalar(k - 1);
    this.body.scale.setScalar(R * k * 1.03);
    this.halo.position.copy(this.body.position);
    this.halo.scale.setScalar(R * k * HALO);
    this.uCn.value.copy(this.rel).divideScalar(R);
    this.uR.value = R;
    this.uTime.value = ctx.time;

    // Slow, silent spin about a tilted axis.
    const a = ctx.time * this.spin;
    this.ay.copy(this.tilt);
    this.ax.set(1, 0, 0).addScaledVector(this.ay, -this.ay.x).normalize();
    this.az.crossVectors(this.ax, this.ay);
    const c = Math.cos(a);
    const s = Math.sin(a);
    // rotate ax/az about ay
    this.x0.copy(this.ax);
    this.ax.multiplyScalar(c).addScaledVector(this.az, s);
    this.az.multiplyScalar(c).addScaledVector(this.x0, -s);
    (this.uAx.value as Vector3).copy(this.ax);
    (this.uAy.value as Vector3).copy(this.ay);
    (this.uAz.value as Vector3).copy(this.az);

    const want = this.broadcastParam || ctx.flags.has('oracle-broadcast') ? 1 : 0;
    this.breath += (want - this.breath) * Math.min(1, ctx.dt * 0.6);
    this.uBreath.value = this.breath;

    this.altitude = ctx.playerPos.distanceTo(this.position) - R;
    if (this.altitude < 20_000) ctx.setFlag(`${this.tag}-contact`);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.body.geometry.dispose();
    (this.body.material as MeshBasicNodeMaterial).dispose();
    (this.halo.material as MeshBasicNodeMaterial).dispose();
  }
}
