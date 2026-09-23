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
  Quaternion,
  Sprite,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import {
  Fn,
  uniform,
  uv,
  vec3,
  float,
  abs,
  max,
  exp,
  length,
  dot,
  fract,
  smoothstep,
  normalize,
  normalLocal,
  positionLocal,
} from 'three/tsl';
import { GlowMaterial } from '@/render/materials/GlowMaterial';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { ShaderNode } from '@/render/tsl';
import type { WorldSpace } from '@/core/WorldSpace';
import { BOLT_CAPACITY, type Weapons } from '@/sim/Weapons';
import { MISSILE_CAPACITY, type Missiles } from '@/sim/Missiles';
import { FACTIONS } from '@/assets/Factions';
import type { FactionId } from '@/assets/Blueprint';

/**
 * Renders the weapons sim: laser bolts (one instanced draw per faction
 * colour), beams, muzzle flashes, impact flashes and shield ripples. All in
 * eye-relative render space (see WorldSpace) — added to the Scene, not the
 * world root.
 *
 * Look: 90s anime lasers are long, fat, white-cored streaks with a saturated
 * sheath; impacts are sharp four-point star flashes; shields show a brief
 * hexagon-lattice bubble lit around the hit point.
 */
const BOLT_COLORS: Record<FactionId, string> = {
  concord: '#4fd8ff',
  choir: '#ff3fb4',
  rustwake: '#ffb13f',
};

const FLASH_POOL = 96;
const SHIELD_POOL = 24;
const BEAM_POOL = 16;

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
  hitDir: ShaderNode;
  alpha: ShaderNode;
  life: number;
  ship: { flight: { position: Vector3 }; radius: number } | null;
}

interface BeamFx {
  core: Mesh;
  glow: Mesh;
}

export class WeaponVisuals {
  readonly group = new Group();
  private bolts: InstancedMesh[] = [];
  private flashes: Flash[] = [];
  private flashHead = 0;
  private shields: ShieldFx[] = [];
  private shieldHead = 0;
  private beams: BeamFx[] = [];
  private missileMesh: InstancedMesh;

  constructor(
    private weapons: Weapons,
    private missiles: Missiles,
  ) {
    this.group.name = 'weapon-visuals';

    // ── bolts ────────────────────────────────────────────────────────
    const boltGeo = new CylinderGeometry(0.22, 0.22, 1, 6, 1, false);
    boltGeo.rotateX(Math.PI / 2); // along Z, centred
    for (const f of ['concord', 'choir', 'rustwake'] as FactionId[]) {
      const mat = new GlowMaterial({ color: BOLT_COLORS[f], core: '#ffffff', intensity: 7, flicker: 0 });
      const mesh = new InstancedMesh(boltGeo, mat, BOLT_CAPACITY);
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

    // ── shield ripples ──────────────────────────────────────────────
    const shieldGeo = new IcosahedronGeometry(1, 3);
    for (let i = 0; i < SHIELD_POOL; i++) {
      const hitDir: ShaderNode = uniform(new Vector3(0, 0, 1));
      const alpha: ShaderNode = uniform(0);
      const mat = new MeshBasicNodeMaterial();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = AdditiveBlending;
      mat.colorNode = Fn(() => {
        const n = normalize(normalLocal);
        const toHit = dot(n, hitDir);
        const spot = smoothstep(0.35, 0.95, toHit);
        // Hex-ish lattice from three rotated stripe sets on the sphere.
        const p = positionLocal.mul(9.0);
        const l1 = abs(fract(p.x.add(p.y.mul(0.577))).sub(0.5));
        const l2 = abs(fract(p.x.sub(p.y.mul(0.577))).sub(0.5));
        const l3 = abs(fract(p.y.mul(1.155).add(p.z.mul(0.3))).sub(0.5));
        const lattice = smoothstep(0.42, 0.49, max(l1, max(l2, l3)));
        const ringPos = float(1).sub(alpha.oneMinus().mul(1.2)); // sweeps outward from the hit as alpha fades
        const ring = float(1).sub(smoothstep(0.0, 0.1, abs(toHit.sub(ringPos)))).mul(0.8);
        const glow = spot.mul(lattice.mul(0.9).add(0.25)).add(ring);
        return vec3(0.35, 0.85, 1.0).mul(glow).mul(alpha).mul(2.2);
      })();
      mat.mrtNode = noInkMRT();
      const mesh = new Mesh(shieldGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 22;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shields.push({ mesh, hitDir, alpha, life: 0, ship: null });
    }

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

  private shield(ship: ShieldFx['ship'], hitNormal: Vector3): void {
    if (!ship) return;
    const s = this.shields[this.shieldHead];
    this.shieldHead = (this.shieldHead + 1) % SHIELD_POOL;
    s.ship = ship;
    s.life = 0.45;
    (s.hitDir.value as Vector3).copy(hitNormal).normalize();
    s.mesh.visible = true;
  }

  /** Consume this frame's weapon events and draw everything relative to the eye. */
  update(world: WorldSpace, dt: number): void {
    const w = this.weapons;
    const eye = world.eye;

    for (const e of w.events) {
      switch (e.kind) {
        case 'fire':
          this.flash(e.position, 3.5, 0.06);
          break;
        case 'hit':
          this.flash(e.position, 9, 0.2);
          break;
        case 'shield':
          this.flash(e.position, 6, 0.15);
          if (e.ship) this.shield(e.ship, e.normal);
          break;
        case 'beam-hit':
          if (Math.random() < 0.3) this.flash(e.position, 14, 0.12);
          break;
        case 'kill':
          this.flash(e.position, 60, 0.5);
          break;
      }
    }

    // Bolts → instance matrices (render space). Streak length ∝ speed.
    const counts = [0, 0, 0];
    for (let i = 0; i < BOLT_CAPACITY; i++) {
      if (w.life[i] <= 0) continue;
      const fi = w.faction[i];
      const mesh = this.bolts[fi];
      _d.set(w.vx[i], w.vy[i], w.vz[i]);
      const speed = _d.length();
      _d.divideScalar(speed || 1);
      const len = Math.min(48, speed * 0.028);
      // Centre the streak half a length behind the head.
      _p.set(w.px[i] - eye.x, w.py[i] - eye.y, w.pz[i] - eye.z).addScaledVector(_d, -len * 0.5);
      _q.setFromUnitVectors(_z, _d);
      _s.set(1.6, 1.6, len);
      mesh.setMatrixAt(counts[fi]++, _m.compose(_p, _q, _s));
    }
    for (let f = 0; f < 3; f++) {
      this.bolts[f].count = counts[f];
      this.bolts[f].instanceMatrix.needsUpdate = counts[f] > 0;
    }

    const m = this.missiles;
    for (const e of m.events) {
      if (e.kind === 'detonate') this.flash(e.position, 26, 0.3);
      else if (e.kind === 'launch') this.flash(e.position, 5, 0.08);
    }
    let mc = 0;
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      if (!m.alive[i]) continue;
      _d.copy(m.vel[i]);
      const sp = _d.length() || 1;
      _d.divideScalar(sp);
      _p.subVectors(m.pos[i], eye);
      _q.setFromUnitVectors(_z, _d);
      _s.set(1, 1, 2.2 + Math.min(10, sp * 0.008));
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

    for (const s of this.shields) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0 || !s.ship) {
        s.mesh.visible = false;
        continue;
      }
      s.alpha.value = s.life / 0.45;
      s.mesh.position.subVectors(s.ship.flight.position, eye);
      s.mesh.scale.setScalar(s.ship.radius * 1.35);
    }

    let bi = 0;
    for (const b of w.beams) {
      if (!b.active || bi >= BEAM_POOL) continue;
      const fx = this.beams[bi++];
      const len = b.origin.distanceTo(b.end);
      _q.setFromUnitVectors(_z, b.dir);
      _p.subVectors(b.origin, eye);
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
      ((fx.glow.material as GlowMaterial).glowColor.value as Color).set(FACTIONS[b.faction].livery.glow);
    }
    for (; bi < BEAM_POOL; bi++) this.beams[bi].core.visible = this.beams[bi].glow.visible = false;

  }
}
