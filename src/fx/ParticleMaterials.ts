import { AdditiveBlending, Color, FrontSide } from 'three';
import { MeshBasicNodeMaterial, type StorageInstancedBufferAttribute } from 'three/webgpu';
import {
  Discard,
  Fn,
  abs,
  atan,
  cameraPosition,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  length,
  max,
  min,
  mix,
  mrt,
  normalize,
  packNormalToRGB,
  positionGeometry,
  positionView,
  pow,
  screenSize,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  uint,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { LightRig } from '@/render/LightRig';
import { DEPTH_SCALE, hashInkId, noInkMRT } from '@/render/materials/InkChannels';
import { PK } from './kinds';
import { fxHex } from './shaders.wgsl';

/** GPU handles shared by the particle system and its materials. */
export interface ParticleGpu {
  attrP: StorageInstancedBufferAttribute;
  attrV: StorageInstancedBufferAttribute;
  attrB: StorageInstancedBufferAttribute;
  attrS: StorageInstancedBufferAttribute;
  capacity: number;
  /** First live slot (uint). Instance i draws slot (tail + i) & (capacity − 1). */
  uTail: Node;
  /** anchor − eye (float64 on the CPU → small float32 here). */
  uAnchorOffset: Node;
}

const projMatrix: Node = cameraProjectionMatrix;
const camWorld: Node = cameraWorldMatrix;
const quadCorner: Node = positionGeometry;

/** Animate "on twos": shapes/colours step at 12 Hz like hand-drawn effects cels. */
const STEP_HZ = 12;
/** Streak exposure for sparks (s). */
const SPARK_STREAK = 0.05;

const c3 = (hex: string, k = 1): Node => {
  const c = new Color(hex);
  return vec3(c.r * k, c.g * k, c.b * k);
};

/** Pick by palette index (0 warm, 1 plasma, 2 magenta). */
const byPal = (pal: Node, warm: Node, plasma: Node, magenta: Node): Node =>
  select(pal.lessThan(0.5), warm, select(pal.lessThan(1.5), plasma, magenta));

/** Stepped fireball ramp. step 0 = white-hot … 5 = charred maroon. HDR (>1 feeds bloom). */
function fireRamp(step: Node, pal: Node): Node {
  const ramp = (cols: Node[]): Node =>
    select(
      step.lessThan(0.5),
      cols[0],
      select(step.lessThan(1.5), cols[1], select(step.lessThan(2.5), cols[2], select(step.lessThan(3.5), cols[3], select(step.lessThan(4.5), cols[4], cols[5])))),
    );
  const warm = ramp([c3('#ffffff', 3), c3('#fff27a', 1.35), c3('#ffa52a', 1.15), c3('#f2511c', 1.0), c3('#a81c2a', 0.85), c3('#3e1a2c', 0.9)]);
  const plasma = ramp([c3('#ffffff', 3), c3('#c8fbff', 1.35), c3('#5ee0ff', 1.15), c3('#3a7dff', 1.0), c3('#4b2aa8', 0.85), c3('#1d1740', 0.9)]);
  const magenta = ramp([c3('#ffffff', 3), c3('#ffd2f5', 1.35), c3('#ff6ad5', 1.15), c3('#c42bb0', 1.0), c3('#6a1a78', 0.85), c3('#25122e', 0.9)]);
  return byPal(pal, warm, plasma, magenta);
}

interface Decoded {
  P: Node;
  V: Node;
  B: Node;
  kind: Node;
  pal: Node;
  age: Node;
  ageQ: Node;
  life: Node;
  t: Node;
  tq: Node;
  s0: Node;
  s1: Node;
  seed: Node;
}

function readers(g: ParticleGpu) {
  const cap = g.capacity;
  return {
    P: storage(g.attrP, 'vec4', cap).toReadOnly() as Node,
    V: storage(g.attrV, 'vec4', cap).toReadOnly() as Node,
    B: storage(g.attrB, 'vec4', cap).toReadOnly() as Node,
    S: storage(g.attrS, 'vec4', cap).toReadOnly() as Node,
  };
}

/** Vertex stage: fetch this instance's particle from the ring. */
function decode(g: ParticleGpu, r: ReturnType<typeof readers>): Decoded {
  const slot = g.uTail.add(instanceIndex).bitAnd(uint(g.capacity - 1));
  const P = r.P.element(slot).toVar('fxP');
  const V = r.V.element(slot).toVar('fxV');
  const B = r.B.element(slot).toVar('fxB');
  const S = r.S.element(slot).toVar('fxS');
  const kp = B.w.add(0.5);
  const kind = floor(kp.mod(16)).toVar('fxKind');
  const pal = floor(kp.div(16));
  const age = P.w;
  const life = max(V.w, 1e-4);
  const ageQ = floor(age.mul(STEP_HZ)).div(STEP_HZ);
  return {
    P,
    V,
    B,
    kind,
    pal,
    age,
    ageQ,
    life: V.w,
    t: clamp(age.div(life), 0, 1),
    tq: clamp(ageQ.div(life), 0, 1),
    s0: S.x,
    s1: S.y,
    seed: S.z,
  };
}

const ease = (t: Node, p: number): Node => float(1).sub(pow(float(1).sub(t), p));

/**
 * Builds the two particle materials. Both read the same storage buffers and
 * draw the same instanced quad over the live window; each collapses the
 * particles of the other class to a degenerate point.
 */
export function createParticleMaterials(g: ParticleGpu): { opaque: MeshBasicNodeMaterial; glow: MeshBasicNodeMaterial } {
  return { opaque: createOpaque(g), glow: createGlow(g) };
}

// ─────────────────────────────────────────────────────────────────────────
// Opaque cel pass: FIRE, SMOKE, PUFF, DEBRIS
// ─────────────────────────────────────────────────────────────────────────

function createOpaque(g: ParticleGpu): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  mat.name = 'FxCel';
  mat.side = FrontSide;
  mat.transparent = false;
  mat.depthWrite = true;

  const vA: Node = varyingProperty('vec4', 'vFxA'); // quad uv · kind · stepped t
  const vB: Node = varyingProperty('vec4', 'vFxB'); // seed · palette · radius (m) · radius (px)
  const vC: Node = varyingProperty('vec4', 'vFxC'); // age · quad rotation · hot-side dir (quad space)
  const rd = readers(g);

  mat.positionNode = Fn(() => {
    const d = decode(g, rd);
    const q: Node = quadCorner.xy;
    const kind = d.kind;
    const tq = d.tq;

    // Size envelopes per kind (stepped time → grows in hand-drawn increments).
    const rFire = mix(d.s0, d.s1, ease(tq, 3)).mul(float(1).sub(smoothstep(0.7, 1.0, tq).mul(0.55)));
    const rSmoke = mix(d.s0, d.s1, ease(tq, 2)).mul(float(1).sub(smoothstep(0.75, 1.0, tq).mul(0.4)));
    const rPuff = mix(d.s0, d.s1, ease(tq, 3.5)).mul(float(1).sub(smoothstep(0.85, 1.0, tq).mul(0.3)));
    const r = select(kind.equal(PK.FIRE), rFire, select(kind.equal(PK.SMOKE), rSmoke, select(kind.equal(PK.PUFF), rPuff, d.s0))).toVar();

    const c = d.P.xyz.add(g.uAnchorOffset).toVar();
    const dist = max(length(c), 1e-3);
    const right = camWorld.element(0).xyz;
    const up = camWorld.element(1).xyz;
    const pix = dist.mul(2).div(projMatrix.element(1).y.mul(screenSize.y));

    // Debris tumbles in the picture plane (stepped on twos too).
    const spin = fract(d.seed.mul(7.13)).sub(0.5).mul(7.0);
    const ang = select(kind.equal(PK.DEBRIS), d.seed.mul(6.2831).add(d.ageQ.mul(spin)), float(0));
    const ca = cos(ang);
    const sa = sin(ang);
    const qr = vec2(q.x.mul(ca).sub(q.y.mul(sa)), q.x.mul(sa).add(q.y.mul(ca)));
    const pos = c.add(right.mul(qr.x.mul(r))).add(up.mul(qr.y.mul(r)));

    const inClass = kind.greaterThan(0.5).and(kind.lessThan(PK.DEBRIS + 0.5));
    const alive = d.age.greaterThanEqual(0).and(d.age.lessThan(d.life)).and(inClass);

    // Hot side of a fire blob faces back toward the blast centre (−velocity, screen space).
    const vr = d.V.xyz.sub(d.B.xyz);
    const h2 = vec2(dot(vr, right), dot(vr, up));
    const hdir = h2.div(max(length(h2), 1e-4));

    vA.assign(vec4(q, kind, tq));
    vB.assign(vec4(d.seed, d.pal, r, r.div(pix)));
    vC.assign(vec4(d.age, ang, hdir));
    return select(alive, pos, vec3(0, 0, 0)).add(cameraPosition);
  })();

  // ── fragment ──
  const uv: Node = vA.xy;
  const kind: Node = vA.z;
  const tq: Node = vA.w;
  const seed: Node = vB.x;
  const pal: Node = vB.y;
  const radius: Node = vB.z;
  const radiusPx: Node = vB.w;
  const age: Node = vC.x;
  const quadAng: Node = vC.y;
  const hdir: Node = vec2(vC.z, vC.w);

  const isFire = kind.lessThan(1.5);
  const isSmoke = kind.greaterThan(1.5).and(kind.lessThan(2.5));
  const isPuff = kind.greaterThan(2.5).and(kind.lessThan(3.5));
  const isDebris = kind.greaterThan(3.5);

  const dd = length(uv);
  const a = atan(uv.y, uv.x);
  // Lumpy hand-drawn blob outline.
  const lump = sin(a.mul(3).add(seed.mul(40))).mul(0.5).add(sin(a.mul(5).sub(seed.mul(23))).mul(0.3)).add(sin(a.mul(2).add(seed.mul(9))).mul(0.2));
  const edge = lump.mul(0.07).add(0.92);
  // Chunky break-up field: blobs erode from the outside in as they die.
  const n1 = sin(uv.x.mul(4.3).add(uv.y.mul(1.7)).add(seed.mul(31)));
  const n2 = sin(uv.y.mul(3.9).sub(uv.x.mul(2.1)).sub(seed.mul(17)));
  const erosion = n1.mul(n2).mul(0.5).add(0.5).mul(0.65).add(float(1).sub(dd).mul(0.35));
  const dissolve = select(isFire, smoothstep(0.7, 1.0, tq), smoothstep(0.55, 1.0, tq)).mul(1.02);
  const blobCut = dd.greaterThan(edge).or(erosion.lessThan(dissolve));

  // Debris: random convex polygon (5 half-planes) split into two facets.
  let minEdge: Node = float(10);
  for (let i = 0; i < 5; i++) {
    const th = float(i * 1.2566).add(fract(seed.mul((i + 3) * 7.77)).sub(0.5).mul(0.9));
    const di = fract(seed.mul((i + 5) * 3.31)).mul(0.42).add(0.5);
    minEdge = min(minEdge, di.sub(dot(uv, vec2(cos(th), sin(th)))));
  }
  const fa = seed.mul(9.1);
  const facet = dot(uv, vec2(cos(fa), sin(fa))).greaterThan(fract(seed.mul(5.3)).sub(0.5).mul(0.4));

  // Normals (view space). Blobs: fake sphere. Debris: two flat facets tumbling.
  const nz: Node = sqrt(max(float(1).sub(dd.mul(dd)), 0.0));
  const nSphere = normalize(vec3(uv.x, uv.y, nz.add(0.02)));
  const spin2 = fract(seed.mul(3.7)).sub(0.5).mul(5.0);
  const a1 = seed.mul(20).add(floor(age.mul(STEP_HZ)).div(STEP_HZ).mul(spin2));
  const nq1 = normalize(vec3(cos(a1).mul(0.75), sin(a1).mul(0.75), 0.66));
  const nq2 = normalize(vec3(cos(a1.add(2.3)).mul(0.8), sin(a1.add(2.3)).mul(0.8), 0.6));
  const nq = select(facet, nq1, nq2);
  const cq = cos(quadAng);
  const sq = sin(quadAng);
  const nDeb = vec3(nq.x.mul(cq).sub(nq.y.mul(sq)), nq.x.mul(sq).add(nq.y.mul(cq)), nq.z);
  // NB: shared by colorNode, mrtNode and depthNode — keep it a plain
  // expression (a .toVar() here would only be declared in one of those graphs).
  const nView: Node = select(isDebris, nDeb, nSphere);
  const nWorld = normalize(camWorld.mul(vec4(nView, 0)).xyz);
  const ndl = dot(nWorld, LightRig.keyDirection);
  const hi = ndl.greaterThan(0.72);
  const lit = ndl.greaterThan(-0.12);
  const rimOn: Node = float(1)
    .sub(nz)
    .greaterThan(0.72)
    .and(dot(nWorld, LightRig.rimDirection).greaterThan(0.1));

  mat.colorNode = Fn((): Node => {
    Discard(select(isDebris, minEdge.lessThan(0), blobCut));

    // FIRE: stepped heat ramp with a hotter inner blob (toward the blast
    // centre) and a darker outer band — the layered cel fireball.
    const inner = length(uv.add(hdir.mul(0.32))).lessThan(0.52);
    const outer = dd.greaterThan(edge.mul(0.8));
    const heat = tq
      .mul(1.05)
      .add(seed.sub(0.5).mul(0.22))
      .sub(select(inner, 0.2, 0.0))
      .add(select(outer, 0.16, 0.0));
    const step = clamp(floor(heat.mul(5.2)), 0, 5);
    const fireStep = select(age.lessThan(1 / STEP_HZ), float(0), step);
    const fire = fireRamp(fireStep, pal);

    // SMOKE: three-tone cel ball, red-hot for its first couple of frames.
    const smokeHi = byPal(pal, c3('#b3a3b5'), c3('#a3b0c8'), c3('#b69ab8'));
    const smokeLit = byPal(pal, c3('#85768f'), c3('#74819f'), c3('#886c90'));
    const smokeDark = byPal(pal, c3('#3b3050'), c3('#2f3656'), c3('#3d2448'));
    const smokeCel = select(hi, smokeHi, select(lit, smokeLit, smokeDark)).mul(select(lit, LightRig.keyColor, vec3(1)));
    const smokeHot = fireRamp(select(tq.lessThan(0.06), float(3), float(4)), pal);
    const smoke = select(tq.lessThan(0.12).and(nz.greaterThan(0.25).or(tq.lessThan(0.06))), smokeHot, smokeCel);

    // PUFF: white missile smoke with blue-violet shadow; white-hot while young.
    const puffLit = c3('#ffffff').mul(LightRig.keyColor);
    const puffMid = c3('#e9e9f2').mul(LightRig.keyColor);
    const puffDark = mix(c3('#b3b8d8'), LightRig.shadowTint, 0.15);
    const puffCel = select(hi, puffLit, select(lit, puffMid, puffDark));
    const puffHot = select(
      age.lessThan(0.025),
      c3('#ffffff', 3),
      select(age.lessThan(0.05), fireRamp(float(1), pal), fireRamp(float(2), pal).mul(0.9)),
    );
    const puff = select(age.lessThan(0.085), puffHot, puffCel);

    // DEBRIS: dark hull metal, two facet tones, cooling hot edge.
    const debLit = c3('#8d92a8').mul(LightRig.keyColor);
    const debDark = mix(c3('#2c2a40'), LightRig.shadowTint, 0.2);
    const debCel = select(lit, debLit, debDark);
    const heatEdge = minEdge.lessThan(0.13).and(age.lessThan(1.4));
    const glow = fireRamp(select(age.lessThan(0.5), float(2), float(3)), pal);
    const debrisCol = select(heatEdge, glow, debCel);

    const rim = select(rimOn.and(isFire.not()), LightRig.rimColor.mul(0.45), vec3(0));
    const surface = min(select(isSmoke, smoke, select(isPuff, puff, debrisCol)).add(rim), vec3(0.97));
    // Emissive parts (hot smoke, hot puffs, hot edges) may exceed 1 → bloom.
    const hot: Node = select(isSmoke, tq.lessThan(0.12), select(isPuff, age.lessThan(0.085), heatEdge));
    const surfaceOut = select(hot, select(isSmoke, smoke, select(isPuff, puff, debrisCol)), surface);
    return select(isFire, fire, surfaceOut);
  })();

  // G-buffer: fake-sphere normal and sphere-corrected depth so the ink pass
  // outlines each smoke ball; ink fades out for tiny (few-pixel) particles.
  const zOff: Node = select(isDebris, float(0), nz.mul(radius));
  const pvS = positionView.add(vec3(0, 0, zOff));
  const clip = projMatrix.mul(vec4(pvS, 1.0));
  mat.depthNode = clip.z.div(clip.w);
  const inkW = select(isFire, float(0), float(1)).mul(smoothstep(2.5, 7.0, radiusPx));
  // Smoke balls and debris facets get their own ids (each ball fully outlined,
  // cotton-ball clusters); trail puffs share one id so a trail reads as one
  // lumpy ribbon outlined by silhouette/crease lines rather than a bead chain.
  const regionId = select(isPuff, float(777), floor(seed.mul(1000)).add(select(isDebris.and(facet), float(0.5), float(0))));
  mat.mrtNode = mrt({
    gbuf: vec4(packNormalToRGB(nView), pvS.z.negate().mul(DEPTH_SCALE)),
    ink: vec4(inkW, hashInkId(regionId), select(isFire, float(0), float(1)), 1.0),
  });
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────
// Additive glow pass: SPARK, FLASH, RING, SHIELD, GLINT
// ─────────────────────────────────────────────────────────────────────────

function createGlow(g: ParticleGpu): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  mat.name = 'FxGlow';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  mat.side = FrontSide;

  const vA: Node = varyingProperty('vec4', 'vFxA'); // uv · kind · t
  const vB: Node = varyingProperty('vec4', 'vFxB'); // seed · palette · radius px · age
  const rd = readers(g);

  mat.positionNode = Fn(() => {
    const d = decode(g, rd);
    const q: Node = quadCorner.xy;
    const kind = d.kind;
    const t = d.t;

    const rFlash = d.s0.mul(float(0.55).add(min(t.mul(5), 1).mul(0.45))).mul(float(1).sub(smoothstep(0.6, 1.0, t).mul(0.35)));
    const rRing = mix(d.s0, d.s1, ease(t, 2.5));
    const rSpark = d.s0.mul(float(1).sub(t.mul(0.7)));
    let r: Node = select(kind.equal(PK.FLASH), rFlash, select(kind.equal(PK.RING), rRing, select(kind.equal(PK.SPARK), rSpark, d.s0)));

    const c = d.P.xyz.add(g.uAnchorOffset).toVar();
    const dist = max(length(c), 1e-3);
    const ray: Node = c.div(dist);
    const right = camWorld.element(0).xyz;
    const up = camWorld.element(1).xyz;
    const pix = dist.mul(2).div(projMatrix.element(1).y.mul(screenSize.y));

    // Oriented planes (tilted shock ring, shield hex) — normal lives in V.xyz.
    const nLen = length(d.V.xyz);
    const oriented = nLen.greaterThan(0.5).and(kind.equal(PK.RING).or(kind.equal(PK.SHIELD)));
    const n = d.V.xyz.div(max(nLen, 1e-4));
    const helper = select(abs(n.y).lessThan(0.95), vec3(0, 1, 0), vec3(1, 0, 0));
    const t1 = normalize(cross(n, helper));
    const t2 = cross(n, t1);
    const axX = select(oriented, t1, right);
    const axY = select(oriented, t2, up);

    // Camera-facing glows are pulled toward the eye so they sit in front of
    // the fireball volume (and don't clip into hulls), keeping angular size.
    const pushable = oriented.not().and(kind.equal(PK.FLASH).or(kind.equal(PK.RING)).or(kind.equal(PK.GLINT)));
    const push = select(pushable, min(r.mul(0.9), dist.mul(0.5)), float(0));
    const cP = c.sub(ray.mul(push));
    r = max(r.mul(dist.sub(push).div(dist)), pix.mul(1.5));
    const bill = cP.add(axX.mul(q.x.mul(r))).add(axY.mul(q.y.mul(r)));

    // Sparks: streak along the screen-space velocity (relative to the emitter).
    const vrel: Node = d.V.xyz.sub(d.B.xyz);
    const vPerp: Node = vrel.sub(ray.mul(dot(vrel, ray)));
    const width = max(r, pix.mul(0.9));
    const len = max(length(vPerp).mul(SPARK_STREAK), width.mul(3));
    const sdir: Node = normalize(vPerp.add(right.mul(1e-5)));
    const sside = normalize(cross(sdir, ray));
    const spark = c.add(sdir.mul(len.mul(q.x.sub(1)).mul(0.5))).add(sside.mul(q.y.mul(width)));

    const pos = select(kind.equal(PK.SPARK), spark, bill);
    const inClass = kind.greaterThan(PK.DEBRIS + 0.5);
    const alive = d.age.greaterThanEqual(0).and(d.age.lessThan(d.life)).and(inClass);

    vA.assign(vec4(q, kind, t));
    vB.assign(vec4(d.seed, d.pal, r.div(pix), d.age));
    return select(alive, pos, vec3(0, 0, 0)).add(cameraPosition);
  })();

  const uv: Node = vA.xy;
  const kind: Node = vA.z;
  const t: Node = vA.w;
  const seed: Node = vB.x;
  const pal: Node = vB.y;
  const is = (k: number): Node => abs(kind.sub(k)).lessThan(0.5);

  mat.colorNode = Fn((): Node => {
    const core = byPal(pal, c3('#fff8e6'), c3('#f0ffff'), c3('#fff0fb'));
    const midC = byPal(pal, c3('#ffe070'), c3('#8cf0ff'), c3('#ff9ae6'));
    const outerC = byPal(pal, c3('#ff9a2e'), c3('#2fa8ff'), c3('#d02bd0'));
    const fade = float(1).sub(floor(t.mul(4)).div(4)); // 4 hard brightness steps
    const dd = length(uv);
    const a = atan(uv.y, uv.x);

    // SPARK — tapered hard streak, white core.
    const along = uv.x.mul(0.5).add(0.5);
    const w = along.mul(0.7).add(0.3);
    const sMask = abs(uv.y).lessThan(w);
    const sCore = abs(uv.y).lessThan(w.mul(0.45)).and(along.greaterThan(0.3));
    const spark = select(sCore, core.mul(2.6), midC.mul(1.6)).mul(select(sMask, fade, float(0)));

    // FLASH — hard 4+4-point star with a white disc.
    const ar = a.add(seed.mul(6.2831));
    const star4 = pow(abs(cos(ar.mul(2))), 18).mul(0.78).add(0.22);
    const star8 = pow(abs(cos(ar.mul(2).add(0.785))), 30).mul(0.45).add(0.16);
    const rs = max(star4, star8).mul(float(1).sub(t.mul(0.3)));
    const fMask = dd.lessThan(rs);
    const flashCol = select(dd.lessThan(float(0.3).mul(float(1).sub(t))), core.mul(3.5), select(dd.lessThan(0.5), midC.mul(1.8), outerC.mul(1.3)));
    const flash = flashCol.mul(select(fMask, fade, float(0)));

    // RING — thinning annulus with a slightly wobbly hand-drawn edge.
    // Outer radius 0.92 so the wobbly ring never touches the quad edge.
    const wob = sin(a.mul(7).add(seed.mul(30))).mul(0.02).add(0.92);
    const thick = mix(0.2, 0.035, t);
    const inner = float(1).sub(thick);
    const rMask = dd.lessThan(wob).and(dd.greaterThan(inner.mul(wob)));
    const rCore = dd.lessThan(inner.add(thick.mul(0.35)).mul(wob));
    const ring = select(rCore, core.mul(1.7), outerC.mul(1.1)).mul(select(rMask, fade, float(0)));

    // SHIELD — hexagon ripple: cells light up as a ring sweeps outward.
    const hx: Node = fxHex({ p: uv.mul(5.5) });
    const cellR = length(vec2(hx.y, hx.z)).div(5.5);
    const ripple = t.mul(1.25);
    const band = abs(cellR.sub(ripple)).lessThan(0.2);
    const edgeLine = hx.x.greaterThan(0.41);
    const centre = cellR.lessThan(float(0.38).mul(float(1).sub(t.mul(2.5))));
    const inDisc = dd.lessThan(1.0);
    const hexGain = select(band, select(edgeLine, float(3.0), float(0.7)), float(0)).add(select(centre, float(2.2), float(0)));
    const shield = mix(midC, core, select(edgeLine, float(0.6), float(0))).mul(hexGain).mul(select(inDisc, fade, float(0)));

    // GLINT — small 4-point star.
    const gs = pow(abs(cos(a.mul(2))), 40).mul(0.85).add(0.15);
    const glint = select(dd.lessThan(0.22), core.mul(3), midC.mul(1.6)).mul(select(dd.lessThan(gs), float(1), float(0)));

    return select(is(PK.SPARK), spark, select(is(PK.FLASH), flash, select(is(PK.RING), ring, select(is(PK.SHIELD), shield, glint))));
  })();
  mat.mrtNode = noInkMRT();
  return mat;
}
