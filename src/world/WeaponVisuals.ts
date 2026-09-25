import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  Quaternion,
  Sprite,
  Vector3,
  Vector4,
  type BufferGeometry,
} from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { Fn, uniform, uniformArray, uv, vec2, vec3, float, abs, max, min, exp, length, dot, fract, floor, smoothstep, normalize, positionLocal, mix, sin, select, time } from 'three/tsl';
import { GlowMaterial } from '@/render/materials/GlowMaterial';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { ShaderNode } from '@/render/tsl';
import type { WorldSpace } from '@/core/WorldSpace';
import { BOLT_CAPACITY, type Weapons } from '@/sim/Weapons';
import { MISSILE_CAPACITY, type Missiles } from '@/sim/Missiles';
import { FACTIONS } from '@/assets/Factions';
import { GUN_LIST, type BoltStyle, type DamageType } from '@/sim/Loadouts';
import type { ShipEntity } from '@/sim/Fleet';
import { fxHex } from '@/fx/shaders';
import { MAX_FACINGS, facingAt, facingFrac, facingLayout, shellDir, shellScale } from './ShieldGeometry';

/** What the renderer reads from the weapons sim (the live Weapons, or the kill-cam's recorded frame). */
export type BoltSource = Pick<Weapons, 'px' | 'py' | 'pz' | 'vx' | 'vy' | 'vz' | 'life' | 'gun' | 'beams' | 'events'>;
/** What the renderer reads from the missile sim. */
export type MissileSource = Pick<Missiles, 'alive' | 'pos' | 'vel' | 'spec' | 'events'>;

/**
 * Renders the weapons sim: laser bolts (one instanced draw per faction
 * colour), beams, muzzle flashes, impact flashes and shield ripples. All in
 * eye-relative render space (see WorldSpace) — added to the Scene, not the
 * world root.
 *
 * Look: 90s anime lasers are long, fat, white-cored streaks with a saturated
 * sheath; impacts are sharp four-point star flashes; shields show a brief
 * hexagon-lattice bubble lit around the hit point.
 *
 * Each gun family has its own bolt (Loadouts.ts GunSpec style/colour/size):
 * Directorate lasers are long cyan streaks, autocannon short fat amber
 * slugs, the Choir hymn a long magenta crystal shard, Rustwake scattershot
 * orange pellets.
 *
 * Shields are drawn on the shell they really are (ShieldGeometry): the sim's
 * ellipsoid on capitals, a tight skin on fighters. One shell mesh per ship
 * under fire carries up to six live hits at once: cel hexagon cells light
 * in rings spreading from each impact over the curved shell (Concord hex
 * cells; Choir long crystal facets shading magenta to violet-white; Rustwake
 * bent, holed scrap plates in amber and sulphur), tinted by
 * faction and damage type (harmonic crackles along the cell borders), and
 * brighter — and broken, cells dropping out — the weaker the facing. The
 * facing that took the hit glows faintly to its borders so a pilot can read
 * which one they're working on; a facing near collapse flickers. A failing
 * facing flashes white, then a ring folds in from its edge while the
 * lattice outside shatters; one coming back is redrawn by a sweep from its
 * centre. Beams on a shield keep a boiling splash at the contact point.
 * The number and layout of facings come from the damage model (1 = whole
 * bubble), never hard-coded here.
 */

const FLASH_POOL = 96;
/** Ships whose shield shell can be lit at once. */
const SHIELD_POOL = 16;
/** Live hit ripples per shell. */
const HITS = 6;
/** Beam contact points per shell. */
const BEAM_CONTACTS = 2;
const BEAM_POOL = 16;
/** Lifetimes (s): hit ripple (capital / fighter), facing collapse, regen sweep. */
const HIT_LIFE_CAP = 0.75;
const HIT_LIFE_FTR = 0.5;
const COLLAPSE_LIFE = 1.0;
const REGEN_LIFE = 1.3;
/** Seconds a facing stays outlined after a hit (longer when it's nearly gone). */
const LIT_HOLD = 0.55;
const LIT_HOLD_LOW = 1.6;
const TYPE_INDEX: Record<DamageType, number> = { kinetic: 0, laser: 1, harmonic: 2, explosive: 3 };

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _d = new Vector3();
const _s = new Vector3();
const _z = new Vector3(0, 0, 1);

interface Flash {
  sprite: Sprite;
  life: number;
  maxLife: number;
  size: number;
  universe: Vector3;
}

interface ShieldFx {
  mesh: Mesh;
  ship: ShipEntity | null;
  /** Per hit: shell-sphere direction xyz · age (s). */
  hits: Vector4[];
  /** Per hit: ripple radius (m) · damage type · gain · life (s). */
  hitB: Vector4[];
  /** Per facing: collapse age · regen age · strength 0..1 · outline level 0..1. */
  face: Vector4[];
  /** Per facing: centroid (hull-box space) · span. w = 0 for unused slots. */
  faceDir: Vector4[];
  /** Per beam contact: shell-sphere direction · intensity. */
  beams: Vector4[];
  /** Per beam contact (x, y): 1 = harmonic (crackles). Uniform value. */
  beamType: Vector3;
  nf: ShaderNode;
  scale: ShaderNode;
  warp: ShaderNode;
  tint: ShaderNode;
  cell: ShaderNode;
  gain: ShaderNode;
  /** Bubble collapse / regen origin (shell-sphere direction). */
  origin: ShaderNode;
  /** Shell style by faction: 0 Concord hex lattice, 1 Choir crystal facets, 2 Rustwake patched scrap. */
  style: ShaderNode;
  next: number;
}

interface BeamFx {
  core: Mesh;
  glow: Mesh;
}

export class WeaponVisuals {
  readonly group = new Group();
  /** One instanced mesh per gun (index = GUN_LIST index; null for beam guns). */
  private bolts: (InstancedMesh | null)[] = [];
  private flashes: Flash[] = [];
  private flashHead = 0;
  private shields: ShieldFx[] = [];
  private rng = 0x51f15e;
  private beams: BeamFx[] = [];
  private missileMesh: InstancedMesh;
  private counts = new Int32Array(GUN_LIST.length);

  constructor(
    public weapons: BoltSource,
    public missiles: MissileSource,
  ) {
    this.group.name = 'weapon-visuals';

    // ── bolts: one instanced draw per gun family ─────────────────────
    const geos: Record<BoltStyle, BufferGeometry> = {
      streak: new CylinderGeometry(0.22, 0.22, 1, 6, 1, false).rotateX(Math.PI / 2),
      // Slug: a blunt tracer with a tapered tail.
      slug: new CylinderGeometry(0.3, 0.12, 1, 6, 1, false).rotateX(-Math.PI / 2),
      // Shard: a long crystal diamond.
      shard: new OctahedronGeometry(0.5, 0).scale(0.55, 0.55, 1),
      pellet: new IcosahedronGeometry(0.5, 0),
    };
    for (const g of GUN_LIST) {
      if (g.beam) {
        this.bolts.push(null);
        continue;
      }
      const mat = new GlowMaterial({ color: g.color, core: g.core, intensity: g.style === 'streak' ? 7 : g.style === 'shard' ? 6 : 8, flicker: g.style === 'shard' ? 0.25 : 0 });
      const mesh = new InstancedMesh(geos[g.style], mat, BOLT_CAPACITY);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 20;
      this.bolts.push(mesh);
      this.group.add(mesh);
    }

    // ── flashes (muzzle + impact): 4-point star sprites ───────────────
    const flashTint: ShaderNode = uniform(new Color('#ffffff'));
    const flashMat = new SpriteNodeMaterial();
    flashMat.transparent = true;
    flashMat.depthWrite = false;
    flashMat.blending = AdditiveBlending;
    flashMat.colorNode = Fn(() => {
      const c = uv().sub(0.5).mul(2.0);
      const ax = abs(c.x);
      const ay = abs(c.y);
      const star = max(exp(ax.mul(-18.0)).mul(float(1).sub(ay)), exp(ay.mul(-18.0)).mul(float(1).sub(ax))).max(0);
      const core = float(1).sub(smoothstep(0.2, 0.45, length(c))).add(exp(length(c).mul(-6.0)));
      return vec3(flashTint).mul(star.mul(2.5).add(core.mul(3.0)));
    })();
    flashMat.mrtNode = noInkMRT();
    for (let i = 0; i < FLASH_POOL; i++) {
      const sprite = new Sprite(flashMat);
      sprite.visible = false;
      sprite.renderOrder = 25;
      sprite.frustumCulled = false;
      this.group.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 1, size: 1, universe: new Vector3() });
    }

    // ── shield shells (one per ship under fire) ────────────────────
    const shieldGeo = new IcosahedronGeometry(1, 4);
    for (let i = 0; i < SHIELD_POOL; i++) this.shields.push(this.makeShield(shieldGeo));

    // ── missile bodies: small hot glows (smoke trails come from the FX engine) ──
    const mGeo = new CylinderGeometry(0.35, 0.35, 1, 6, 1, false);
    mGeo.rotateX(Math.PI / 2);
    this.missileMesh = new InstancedMesh(mGeo, new GlowMaterial({ color: '#ffd27a', core: '#ffffff', intensity: 6, flicker: 0.3 }), MISSILE_CAPACITY);
    this.missileMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.missileMesh.frustumCulled = false;
    this.missileMesh.count = 0;
    this.missileMesh.renderOrder = 20;
    this.group.add(this.missileMesh);

    // ── beams ───────────────────────────────────────────────────────
    const beamGeo = new CylinderGeometry(0.5, 0.5, 1, 12, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 0.5); // origin at the emitter, extends +Z
    for (let i = 0; i < BEAM_POOL; i++) {
      const core = new Mesh(beamGeo, new GlowMaterial({ color: '#ffffff', core: '#ffffff', intensity: 6, flicker: 0.15 }));
      const glow = new Mesh(beamGeo, new GlowMaterial({ color: '#ff4fd8', core: '#ffc0f0', intensity: 2.5, flicker: 0.3 }));
      core.visible = glow.visible = false;
      core.renderOrder = glow.renderOrder = 21;
      core.frustumCulled = glow.frustumCulled = false;
      this.group.add(core, glow);
      this.beams.push({ core, glow });
    }
  }

  private flash(universe: Vector3, size: number, life: number): void {
    const f = this.flashes[this.flashHead];
    this.flashHead = (this.flashHead + 1) % FLASH_POOL;
    f.universe.copy(universe);
    f.size = size;
    f.life = f.maxLife = life;
    f.sprite.visible = true;
  }

  /** Visual-only dice (never the sim's stream). */
  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) | 0;
    return (this.rng >>> 0) / 4294967296;
  }

  /**
   * One pooled shield shell: an icosphere scaled to the ship's shell, whose
   * shader draws every live hit ripple, the facing outline, collapse / regen
   * and beam contacts from small uniform arrays (see the class notes).
   */
  private makeShield(geo: BufferGeometry): ShieldFx {
    const hits = Array.from({ length: HITS }, () => new Vector4(0, 0, 1, 99));
    const hitB = Array.from({ length: HITS }, () => new Vector4(1, 1, 0, 1));
    const face = Array.from({ length: MAX_FACINGS }, () => new Vector4(99, 99, 1, 0));
    const faceDir = Array.from({ length: MAX_FACINGS }, () => new Vector4(0, 0, 1, 0));
    const beams = Array.from({ length: BEAM_CONTACTS }, () => new Vector4(0, 0, 1, 0));
    const uHits: ShaderNode = uniformArray(hits, 'vec4');
    const uHitB: ShaderNode = uniformArray(hitB, 'vec4');
    const uFace: ShaderNode = uniformArray(face, 'vec4');
    const uFaceDir: ShaderNode = uniformArray(faceDir, 'vec4');
    const uBeams: ShaderNode = uniformArray(beams, 'vec4');
    const nf: ShaderNode = uniform(0);
    const scale: ShaderNode = uniform(new Vector3(1, 1, 1));
    const warp: ShaderNode = uniform(new Vector3(1, 1, 1));
    const tint: ShaderNode = uniform(new Color(0.35, 0.85, 1.0));
    const cell: ShaderNode = uniform(10);
    const gain: ShaderNode = uniform(1);
    const origin: ShaderNode = uniform(new Vector3(0, 0, 1));
    const beamHarm: ShaderNode = uniform(new Vector3(0, 0, 0));
    const style: ShaderNode = uniform(0);

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.colorNode = Fn(() => {
      const n = normalize(positionLocal).toVar();
      const pm = positionLocal.mul(scale).toVar(); // metres from the shell centre
      const m = normalize(n.mul(warp)).toVar(); // hull-box space (facing classification)
      const bubble = nf.lessThan(0.5);

      // ── facing under this fragment: nearest centroid (data-driven count) ──
      const best = float(-3).toVar();
      const second = float(-3).toVar();
      const fIdx = float(0).toVar();
      const fDir = vec3(0, 0, 1).toVar();
      const fSpan = float(1).toVar();
      for (let i = 0; i < MAX_FACINGS; i++) {
        const fd = uFaceDir.element(i);
        const dp = select(fd.w.greaterThan(0.01).and(float(i).lessThan(nf)), dot(m, fd.xyz), float(-3));
        const win = dp.greaterThan(best);
        second.assign(select(win, best, max(second, dp)));
        fIdx.assign(select(win, float(i), fIdx));
        fDir.assign(select(win, fd.xyz, fDir));
        fSpan.assign(select(win, fd.w, fSpan));
        best.assign(max(best, dp));
      }
      const fs = uFace.element(0).toVar();
      for (let i = 1; i < MAX_FACINGS; i++) fs.assign(select(fIdx.equal(float(i)), uFace.element(i), fs));
      // 0 at the facing centre … 1 at its edge (bubble: 0 at the origin … 1 opposite).
      const fdist = select(bubble, float(1).sub(dot(n, origin)).mul(0.5), float(1).sub(dot(m, fDir)).div(max(fSpan, 0.05))).toVar();
      const border = select(bubble, float(0), float(1).sub(smoothstep(0.0, 0.03, best.sub(second))));

      // ── cel hexagon lattice: cube-projected so cells keep their size over the shell ──
      const an = abs(n);
      const zDom = an.z.greaterThanEqual(max(an.x, an.y));
      const xDom = an.x.greaterThanEqual(an.y);
      const crystal = style.equal(1);
      const scrap = style.equal(2);
      const pr = select(zDom, pm.xy, select(xDom, pm.zy, pm.xz)).div(cell).toVar();
      // Choir: the lattice turned 30° and stretched 2.4× into long crystal facets.
      // Rustwake: the lattice bent into uneven, patched plates.
      const pc = vec2(pr.x.mul(0.866).sub(pr.y.mul(0.5)), pr.x.mul(0.5).add(pr.y.mul(0.866)).div(2.4));
      const ps = pr.add(vec2(sin(pr.y.mul(0.9)).add(sin(pr.x.mul(0.31)).mul(0.6)), sin(pr.x.mul(0.83).add(1.3)).add(sin(pr.y.mul(0.27)).mul(0.6))).mul(0.5));
      const p2 = select(crystal, pc, select(scrap, ps, pr)).toVar();
      const hx = fxHex({ p: p2 }).toVar();
      const d2 = vec2(hx.y, hx.z).sub(p2).toVar();
      // Back to the projection plane (crystal: undo the stretch, then the turn).
      const dy = d2.y.mul(2.4);
      const dc = vec2(d2.x.mul(0.866).add(dy.mul(0.5)), d2.x.mul(-0.5).add(dy.mul(0.866)));
      const off = select(crystal, dc, d2).mul(cell);
      // Cell centre back in 3D (the projection plane's two axes).
      const cellC = pm.add(select(zDom, vec3(off.x, off.y, 0), select(xDom, vec3(0, off.y, off.x), vec3(off.x, 0, off.y)))).toVar();
      const edge = hx.x.greaterThan(select(crystal, float(0.42), select(scrap, float(0.3), float(0.4))));
      const axisK = select(zDom, float(0.37), select(xDom, float(0.71), float(0.13)));
      const cellHash = fract(sin(dot(vec2(hx.y, hx.z), vec2(12.9898, 78.233)).add(axisK.mul(91.1))).mul(43758.5453)).toVar();
      const beat = floor(time.mul(24)); // crackle re-drawn on twos (at 24 fps)
      const crackHash = fract(sin(cellHash.mul(71.3).add(beat.mul(3.17))).mul(43758.5453)).toVar();

      // Weak facings break up: cells drop out of every ripple.
      const strength = fs.z;
      const intact = select(cellHash.greaterThan(strength.mul(1.9).add(0.18)), float(0.15), float(1)).toVar();
      // Rustwake plates have holes: a few cells never light.
      intact.mulAssign(select(scrap.and(cellHash.lessThan(0.1)), float(0), float(1)));
      // Per-cell colour: Choir facets shade from magenta to violet-white, Rustwake plates from amber to sulphur.
      const tintC = mix(vec3(tint), select(crystal, vec3(0.85, 0.75, 1.0), vec3(1.0, 0.9, 0.35)), select(style.greaterThan(0.5), cellHash.mul(0.65), float(0))).toVar();

      const typeCol = (k: ShaderNode): ShaderNode =>
        select(k.lessThan(0.5), vec3(1.0, 0.86, 0.55), select(k.lessThan(1.5), tintC, select(k.lessThan(2.5), vec3(0.92, 0.72, 1.0), vec3(1.0, 0.55, 0.22))));
      const acc = vec3(0, 0, 0).toVar();

      // ── hit ripples ──
      const hitAcc = vec3(0, 0, 0).toVar();
      for (let i = 0; i < HITS; i++) {
        const h = uHits.element(i);
        const hb = uHitB.element(i);
        const tt = h.w.div(hb.w);
        const live = tt.lessThan(1);
        const size = hb.x;
        const k = hb.y;
        const hitM = h.xyz.mul(scale);
        const dC = length(cellC.sub(hitM));
        const dF = length(pm.sub(hitM));
        const R = size.mul(float(1).sub(float(1).sub(tt).mul(float(1).sub(tt))).mul(0.95).add(0.05));
        const w = size.mul(0.16).add(cell.mul(0.55));
        const fadeT = float(1).sub(tt);
        const band = select(abs(dC.sub(R)).lessThan(w), fadeT, float(0)).mul(intact);
        const inside = select(dC.lessThan(R.add(w)), fadeT.mul(fadeT), float(0));
        const core = select(dC.lessThan(size.mul(0.22).mul(float(1).sub(tt.mul(2.5)))), float(2.2), float(0));
        const lines = select(edge, inside.mul(0.9), inside.mul(0.12)).mul(intact);
        const soft = exp(dF.div(size.mul(0.3)).negate()).mul(fadeT.mul(fadeT).mul(fadeT)).mul(1.4);
        const col = mix(tintC, typeCol(k), select(k.equal(1), float(0), float(0.55)));
        const lit = band.mul(select(edge, float(2.4), float(0.8))).add(core).add(lines).add(soft);
        // Harmonic: arcs crawl along the cell borders around the hit, flickering.
        const harm = select(k.greaterThan(1.5).and(k.lessThan(2.5)), float(1), float(0));
        const crackle = select(edge.and(crackHash.greaterThan(0.62)).and(dC.lessThan(R.mul(1.25).add(w))), float(3.0), float(0)).mul(harm).mul(fadeT);
        hitAcc.addAssign(select(live, col.mul(lit).add(vec3(0.95, 0.9, 1.0).mul(crackle)).mul(hb.z), vec3(0)));
      }
      // A salvo landing at once overlaps its ripples; cap the pile-up so it reads as many hits, not one white-out of the facing.
      const hitPeak = max(hitAcc.x, max(hitAcc.y, hitAcc.z));
      acc.addAssign(hitAcc.mul(min(float(1), float(3.2).div(max(hitPeak, 1e-3)))));

      // ── beam contacts: a boiling splash where a beam grinds on the shield ──
      for (let j = 0; j < BEAM_CONTACTS; j++) {
        const b = uBeams.element(j);
        const bm = b.xyz.mul(scale);
        const bs = cell.mul(3.2);
        const dB = length(pm.sub(bm));
        const dBc = length(cellC.sub(bm));
        const boil = fract(sin(cellHash.mul(13.7).add(beat.mul(1.93)).add(float(j * 5))).mul(43758.5453));
        const cells = select(dBc.lessThan(bs.mul(boil.mul(0.8).add(0.9))), select(edge, float(2.2), float(0.5)), float(0));
        const hot = exp(dB.div(bs.mul(0.45)).negate()).mul(3.5);
        const harmB = (j === 0 ? beamHarm.x : beamHarm.y).greaterThan(0.5);
        const arcs = select(edge.and(crackHash.greaterThan(0.55)).and(dBc.lessThan(bs.mul(2.2))).and(harmB), float(2.5), float(0));
        acc.addAssign(tintC.mul(cells.add(hot)).add(vec3(0.95, 0.9, 1.0).mul(arcs)).mul(b.w));
      }

      // ── facing outline: which facing is taking fire, to its borders ──
      const outline = fs.w;
      const low = smoothstep(0.35, 0.05, strength);
      const flick = fract(sin(floor(time.mul(14)).add(fIdx.mul(3.3)).mul(12.9898)).mul(43758.5453));
      const unstable = mix(float(1), flick.mul(1.6).add(0.1), low);
      const pops = select(crackHash.greaterThan(0.94), float(1.6), float(0)).mul(low);
      const faceGlow = select(edge, float(0.13), float(0.012)).mul(intact).add(border.mul(1.3)).add(pops).mul(outline).mul(unstable);
      acc.addAssign(tintC.mul(faceGlow));

      // ── collapse: white-hot flash, then a ring folds in from the edge while the lattice shatters ──
      const cT = fs.x.div(COLLAPSE_LIFE);
      const cLive = cT.lessThan(1);
      const flashA = float(1).sub(smoothstep(0.0, 0.14, cT));
      const ringPos = float(1.05).sub(smoothstep(0.08, 0.75, cT).mul(1.05));
      const foldRing = select(abs(fdist.sub(ringPos)).lessThan(0.09), float(1.7), float(0)).mul(float(1).sub(smoothstep(0.6, 0.8, cT)));
      // Shatter: the lattice the ring has passed breaks up cell by cell and is gone by a third of the way in
      // (lingering cells read as tiles falling off the ship).
      const shatter = select(fdist.greaterThan(ringPos).and(cellHash.lessThan(float(0.5).sub(cT.mul(1.6)))), select(edge, float(1.2), float(0.25)), float(0)).mul(float(1).sub(smoothstep(0.0, 0.3, cT)));
      // The fold ends in a small pinch at the facing centre (lattice lines only: a filled disc there whites out half a capital).
      const implode = select(fdist.lessThan(0.035), select(edge, float(1.8), float(0.2)), float(0)).mul(smoothstep(0.6, 0.72, cT)).mul(float(1).sub(smoothstep(0.72, 0.95, cT)));
      const collapse = select(edge, float(1.3), float(0.15)).mul(flashA).add(foldRing).add(shatter).add(implode).mul(select(fdist.lessThan(1.02), float(1), float(0)));
      acc.addAssign(select(cLive, mix(tintC, vec3(1, 1, 1), flashA.mul(0.4)).mul(collapse), vec3(0)));

      // ── regen: a sweep from the facing centre draws the lattice back in ──
      const rT = fs.y.div(REGEN_LIFE);
      const rLive = rT.lessThan(1);
      const front = smoothstep(0.0, 0.85, rT).mul(1.1);
      const sweep = select(abs(fdist.sub(front)).lessThan(0.06), float(2.2), float(0));
      const rebuilt = select(fdist.lessThan(front), select(edge, float(0.7), float(0.05)), float(0)).mul(float(1).sub(rT));
      const regen = sweep.mul(float(1).sub(smoothstep(0.8, 1.0, rT))).add(rebuilt).mul(select(fdist.lessThan(1.02), float(1), float(0)));
      acc.addAssign(select(rLive, tintC.mul(regen), vec3(0)));

      return min(acc.mul(gain), vec3(8));
    })();
    mat.mrtNode = noInkMRT();
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 22;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, ship: null, hits, hitB, face, faceDir, beams, beamType: beamHarm.value as Vector3, nf, scale, warp, tint, cell, gain, origin, style, next: 0 };
  }

  /** The shell slot lit for `ship` (claims a free one, else the quietest). */
  private shieldFor(ship: ShipEntity): ShieldFx {
    let free: ShieldFx | null = null;
    let quiet: ShieldFx | null = null;
    let quietAge = -1;
    for (const s of this.shields) {
      if (s.ship === ship) return s;
      if (!s.ship) free ??= s;
      else {
        let newest = 99;
        for (const h of s.hits) newest = Math.min(newest, h.w);
        if (newest > quietAge) {
          quietAge = newest;
          quiet = s;
        }
      }
    }
    const s = free ?? quiet ?? this.shields[0];
    this.bindShield(s, ship);
    return s;
  }

  private bindShield(s: ShieldFx, ship: ShipEntity): void {
    s.ship = ship;
    s.next = 0;
    for (const h of s.hits) h.w = 99;
    for (const f of s.face) f.set(99, 99, 1, 0);
    for (const b of s.beams) b.w = 0;
    s.beamType.set(0, 0, 0);
    const L = facingLayout(ship);
    s.nf.value = L.count;
    for (let f = 0; f < MAX_FACINGS; f++) {
      const o = f * 4;
      s.faceDir[f].set(L.dirs[o], L.dirs[o + 1], L.dirs[o + 2], f < L.count ? L.dirs[o + 3] : 0);
    }
    (s.warp.value as Vector3).copy(L.warp);
    const sc = shellScale(ship, s.scale.value as Vector3);
    const cap = ship.combat.dmg.capital;
    s.cell.value = Math.max(sc.x, sc.y, sc.z) * (cap ? 0.02 : 0.085);
    s.gain.value = cap ? 0.8 : 1.2;
    (s.tint.value as Color).set(ship.faction === 'choir' ? '#ff6fd0' : ship.faction === 'rustwake' ? '#ffc070' : ship.faction === 'concord' ? '#5fd8ff' : FACTIONS[ship.faction].livery.glow);
    s.style.value = ship.faction === 'choir' ? 1 : ship.faction === 'rustwake' ? 2 : 0;
    s.mesh.visible = true;
  }

  /** The facing a shield event lit (event's own, else by the drawn layout); 0 for a bubble. */
  private facingSlot(ship: ShipEntity, facing: number, dir: Vector3 | null): number {
    const n = facingLayout(ship).count;
    if (!n) return 0;
    if (facing >= 0 && facing < n) return facing;
    return dir ? Math.max(0, facingAt(ship, dir)) : 0;
  }

  /** A hit ripple on `ship`'s shell. `amount` scales its reach; weak facings flare brighter. */
  private shieldHit(ship: ShipEntity, pos: Vector3, facing: number, type: DamageType | undefined, amount: number, strength = -1): void {
    const s = this.shieldFor(ship);
    shellDir(ship, pos, _d);
    const cap = ship.combat.dmg.capital;
    const sc = s.scale.value as Vector3;
    const big = Math.max(sc.x, sc.y, sc.z);
    // Oldest slot gets the new ripple.
    let k = 0;
    for (let i = 1; i < HITS; i++) if (s.hits[i].w > s.hits[k].w) k = i;
    const n = facingLayout(ship).count;
    const f = this.facingSlot(ship, facing, _d);
    const frac = strength >= 0 ? strength : facingFrac(ship, n ? f : -1);
    const reach = cap ? Math.min(Math.max(28 + Math.sqrt(Math.max(amount, 1)) * 11, 34), big * 0.35) : big * (0.55 + Math.min(0.5, amount * 0.02));
    s.hits[k].set(_d.x, _d.y, _d.z, 0);
    s.hitB[k].set(reach, TYPE_INDEX[type ?? 'laser'], 1 + (1 - frac) * 1.8, cap ? HIT_LIFE_CAP : HIT_LIFE_FTR);
    const fs = s.face[f];
    fs.z = frac;
    fs.w = 1;
  }

  /** Continuous beam contact on a shield (refreshed every tick while it grinds). */
  private shieldBeam(ship: ShipEntity, pos: Vector3, facing: number, type: DamageType | undefined): void {
    const s = this.shieldFor(ship);
    shellDir(ship, pos, _d);
    // Same beam as last tick if close, else the weaker contact.
    let k = 0;
    let bd = -2;
    for (let i = 0; i < BEAM_CONTACTS; i++) {
      const b = s.beams[i];
      const dp = b.w > 0 ? b.x * _d.x + b.y * _d.y + b.z * _d.z : -1;
      if (dp > bd) {
        bd = dp;
        k = i;
      }
    }
    if (bd < 0.97) k = s.beams[0].w <= s.beams[1].w ? 0 : 1;
    s.beams[k].set(_d.x, _d.y, _d.z, 1);
    s.beamType.setComponent(k, type === 'harmonic' ? 1 : 0);
    const f = this.facingSlot(ship, facing, _d);
    s.face[f].w = Math.max(s.face[f].w, 0.7);
  }

  /** A facing (or the bubble) collapsing (`regen` false) or coming back. */
  private shieldFacing(ship: ShipEntity, pos: Vector3 | null, facing: number, regen: boolean): void {
    const s = this.shieldFor(ship);
    const n = facingLayout(ship).count;
    if (pos) shellDir(ship, pos, _d);
    else _d.set(0, 0, 1);
    if (!n) (s.origin.value as Vector3).copy(_d);
    const f = this.facingSlot(ship, facing, pos ? _d : null);
    const fs = s.face[f];
    if (regen) fs.y = 0;
    else {
      fs.x = 0;
      fs.y = 99;
    }
    fs.w = 0;
  }

  /** Age and pose every lit shell; release the idle ones. */
  private updateShields(eye: Vector3, dt: number): void {
    for (const s of this.shields) {
      const ship = s.ship;
      if (!ship) continue;
      if (!ship.alive) {
        s.ship = null;
        s.mesh.visible = false;
        continue;
      }
      let live = false;
      for (let i = 0; i < HITS; i++) {
        const h = s.hits[i];
        if (h.w < 50) h.w += dt;
        if (h.w < s.hitB[i].w) live = true;
      }
      for (const b of s.beams) {
        if (b.w <= 0) continue;
        b.w = Math.max(0, b.w - dt * 7);
        live = true;
      }
      const nf = facingLayout(ship).count;
      for (let f = 0; f < Math.max(1, nf); f++) {
        const fs = s.face[f];
        if (fs.x < 50) fs.x += dt;
        if (fs.y < 50) fs.y += dt;
        fs.z = facingFrac(ship, nf ? f : -1);
        if (fs.w > 0) fs.w = Math.max(0, fs.w - dt / (fs.z < 0.3 ? LIT_HOLD_LOW : LIT_HOLD));
        if (fs.x < COLLAPSE_LIFE || fs.y < REGEN_LIFE || fs.w > 0) live = true;
      }
      if (!live) {
        s.ship = null;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.visible = true;
      const st = ship.combat.dmg;
      // Shell around the hull centre, riding the render pose (predicted / kill-cam).
      const root = ship.model.root;
      s.mesh.position.set(st.cx, st.cy, st.cz).applyQuaternion(root.quaternion).add(root.position).sub(eye);
      s.mesh.quaternion.copy(root.quaternion);
      s.mesh.scale.copy(s.scale.value as Vector3);
    }
  }

  /**
   * Consume one sim tick's weapon + missile events (flashes, shield ripples).
   * Called after every tick — a frame may run several, or none.
   */
  consume(): void {
    const w = this.weapons;

    for (const e of w.events) {
      switch (e.kind) {
        case 'fire':
          // Muzzle flash sized to the gun (bolt width) and the mount: capital turrets fire big.
          this.flash(e.position, 3.5 * Math.max(1, (e.gun?.width ?? 1.6) / 1.6) * (e.shooter?.combat.dmg.capital ? 3 : 1), 0.06);
          break;
        case 'hit':
          this.flash(e.position, 9, 0.2);
          break;
        case 'shield':
        case 'shield-bleed':
          this.flash(e.position, e.ship?.combat.dmg.capital ? 9 : 6, 0.12);
          if (e.ship) this.shieldHit(e.ship, e.position, e.facing, e.type, e.amount ?? e.gun?.damage ?? 8, e.strength);
          break;
        case 'shield-down':
          this.flash(e.position, e.ship?.combat.dmg.capital ? 90 : 18, 0.25);
          if (e.ship) this.shieldFacing(e.ship, e.position, e.facing, false);
          break;
        case 'shield-up':
          if (e.ship) this.shieldFacing(e.ship, null, e.facing, true);
          break;
        case 'subsystem':
          this.flash(e.position, (e.sub?.radius ?? 20) * 3, 0.35);
          break;
        case 'beam-hit':
          if (e.shielded && e.ship) this.shieldBeam(e.ship, e.position, e.facing, e.type);
          if (this.rand() < 0.3) this.flash(e.position, 14, 0.12);
          break;
        case 'kill':
          this.flash(e.position, 60, 0.5);
          break;
      }
    }
    for (const e of this.missiles.events) {
      if (e.kind === 'detonate') {
        this.flash(e.position, 26, 0.3);
        // A warhead on a shield: a big explosive-tinted ripple on the shell.
        if (e.shielded && !e.intercepted && e.target?.alive) this.shieldHit(e.target, e.position, -1, 'explosive', e.spec.damage * 3);
      } else if (e.kind === 'launch') this.flash(e.position, 5, 0.08);
    }
  }

  /**
   * Draw everything relative to the eye. `lead` (seconds) extrapolates bolts
   * and missiles past the last sim tick, matching the ships' render
   * prediction (FlightScene.present) so shots stay on their muzzles.
   */
  update(world: WorldSpace, dt: number, lead = 0): void {
    const w = this.weapons;
    const eye = world.eye;

    // Bolts → instance matrices (render space), per gun family.
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < BOLT_CAPACITY; i++) {
      if (w.life[i] <= 0) continue;
      const gi = w.gun[i];
      const mesh = this.bolts[gi];
      if (!mesh) continue;
      const g = GUN_LIST[gi];
      _d.set(w.vx[i], w.vy[i], w.vz[i]);
      const speed = _d.length();
      _d.divideScalar(speed || 1);
      // Lasers stretch with speed; slugs, shards and pellets keep their shape.
      const len = g.style === 'streak' ? Math.min(g.length, speed * 0.028) : g.length;
      // Centre the bolt half a length behind the head.
      _p.set(w.px[i] + w.vx[i] * lead - eye.x, w.py[i] + w.vy[i] * lead - eye.y, w.pz[i] + w.vz[i] * lead - eye.z).addScaledVector(_d, -len * 0.5);
      _q.setFromUnitVectors(_z, _d);
      const wd = g.style === 'streak' ? g.width : g.width * 1.4;
      _s.set(wd, wd, len);
      mesh.setMatrixAt(counts[gi]++, _m.compose(_p, _q, _s));
    }
    for (let f = 0; f < this.bolts.length; f++) {
      const mesh = this.bolts[f];
      if (!mesh) continue;
      mesh.count = counts[f];
      mesh.instanceMatrix.needsUpdate = counts[f] > 0;
    }

    const m = this.missiles;
    let mc = 0;
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      if (!m.alive[i]) continue;
      _d.copy(m.vel[i]);
      const sp = _d.length() || 1;
      _d.divideScalar(sp);
      _p.subVectors(m.pos[i], eye).addScaledVector(m.vel[i], lead);
      _q.setFromUnitVectors(_z, _d);
      const body = m.spec[i].body;
      _s.set(body.width, body.width, (2.2 + Math.min(10, sp * 0.008)) * body.length);
      this.missileMesh.setMatrixAt(mc++, _m.compose(_p, _q, _s));
    }
    this.missileMesh.count = mc;
    this.missileMesh.instanceMatrix.needsUpdate = mc > 0;

    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      const k = f.life / f.maxLife;
      f.sprite.position.subVectors(f.universe, eye);
      f.sprite.scale.setScalar(f.size * (1.4 - 0.6 * k) * Math.min(1, k * 3));
    }

    this.updateShields(eye, dt);

    let bi = 0;
    for (const b of w.beams) {
      if (!b.active || bi >= BEAM_POOL) continue;
      const fx = this.beams[bi++];
      const len = b.origin.distanceTo(b.end);
      _q.setFromUnitVectors(_z, b.dir);
      _p.subVectors(b.origin, eye).addScaledVector(b.owner.flight.velocity, lead);
      const pulse = 0.85 + 0.15 * Math.sin(b.life * 60);
      const fade = Math.min(1, b.life * 4, (b.maxLife - b.life) * 8);
      for (const [mesh, wmul] of [
        [fx.core, 0.35],
        [fx.glow, 1.0],
      ] as const) {
        mesh.visible = true;
        mesh.position.copy(_p);
        mesh.quaternion.copy(_q);
        mesh.scale.set(b.width * wmul * pulse * fade, b.width * wmul * pulse * fade, len);
      }
      ((fx.glow.material as GlowMaterial).glowColor.value as Color).set(b.gun ? b.gun.color : FACTIONS[b.faction].livery.glow);
    }
    for (; bi < BEAM_POOL; bi++) this.beams[bi].core.visible = this.beams[bi].glow.visible = false;

  }
}
