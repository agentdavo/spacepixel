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
  type BufferGeometry,
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
  mix,
  sin,
  step,
  time,
} from 'three/tsl';
import { GlowMaterial } from '@/render/materials/GlowMaterial';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { ShaderNode } from '@/render/tsl';
import type { WorldSpace } from '@/core/WorldSpace';
import { BOLT_CAPACITY, type Weapons } from '@/sim/Weapons';
import { MISSILE_CAPACITY, type Missiles } from '@/sim/Missiles';
import { FACTIONS } from '@/assets/Factions';
import { GUN_LIST, type BoltStyle } from '@/sim/Loadouts';
import type { ShipEntity } from '@/sim/Fleet';

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
 * orange pellets. Capital shields are ellipsoid shells lit per facing; a
 * facing that fails flares and rings, and one that comes back shimmers.
 */

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
  /** Spot width: lower edge of smoothstep(dot(n, hitDir)); −1.6 = whole shell. */
  spot: ShaderNode;
  /** 0 hit ripple · 1 collapse flare · 2 regen shimmer. */
  mode: ShaderNode;
  tint: ShaderNode;
  /** Overall brightness (capital hit ripples are dimmer: many land at once). */
  gain: ShaderNode;
  life: number;
  maxLife: number;
  ship: ShipEntity | null;
}

/** Shell-local axis of each capital facing (fore, aft, port, starboard — see Damage.FACING). */
const FACING_DIR = [new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(-1, 0, 0)];

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
  private shieldHead = 0;
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

    // ── shield ripples ──────────────────────────────────────────────
    const shieldGeo = new IcosahedronGeometry(1, 3);
    for (let i = 0; i < SHIELD_POOL; i++) {
      const hitDir: ShaderNode = uniform(new Vector3(0, 0, 1));
      const alpha: ShaderNode = uniform(0);
      const spot: ShaderNode = uniform(0.35);
      const mode: ShaderNode = uniform(0);
      const tint: ShaderNode = uniform(new Color(0.35, 0.85, 1.0));
      const gain: ShaderNode = uniform(2.2);
      const mat = new MeshBasicNodeMaterial();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = AdditiveBlending;
      mat.colorNode = Fn(() => {
        const n = normalize(normalLocal);
        const toHit = dot(n, hitDir);
        const patch = smoothstep(spot, spot.add(0.6), toHit);
        // Hex-ish lattice from three rotated stripe sets on the sphere (cel-hard edges).
        const p = positionLocal.mul(9.0);
        const l1 = abs(fract(p.x.add(p.y.mul(0.577))).sub(0.5));
        const l2 = abs(fract(p.x.sub(p.y.mul(0.577))).sub(0.5));
        const l3 = abs(fract(p.y.mul(1.155).add(p.z.mul(0.3))).sub(0.5));
        const lattice = smoothstep(0.42, 0.46, max(l1, max(l2, l3)));
        // Hit: ripple ring sweeping outward from the impact as alpha fades.
        const ringPos = float(1).sub(alpha.oneMinus().mul(1.2));
        const ring = float(1).sub(smoothstep(0.0, 0.08, abs(toHit.sub(ringPos)))).mul(0.9);
        const hit = patch.mul(lattice.mul(0.9).add(0.2)).add(ring.mul(smoothstep(-0.2, 0.3, toHit)));
        // Collapse: the whole patch flares white-hot then breaks up into lattice shards.
        const shards = lattice.mul(step(0.35, fract(p.x.mul(0.37).add(p.z.mul(0.51)).add(alpha.mul(1.7)))));
        const collapse = patch.mul(mix(shards.mul(1.3).add(lattice.mul(0.25)), float(1.0), smoothstep(0.9, 0.98, alpha))).add(ring.mul(1.4));
        // Regen: a scanning band climbs the shell, drawing the lattice back in.
        const band = float(1).sub(smoothstep(0.0, 0.14, abs(toHit.sub(float(1).sub(alpha.mul(2.2)))))).mul(patch.add(0.15));
        const regen = band.mul(lattice.mul(1.1).add(0.15)).add(patch.mul(lattice).mul(0.25).mul(sin(time.mul(40.0)).mul(0.5).add(0.5)));
        const glow = mode.lessThan(0.5).select(hit, mode.lessThan(1.5).select(collapse, regen));
        return vec3(tint).mul(glow).mul(alpha).mul(gain);
      })();
      mat.mrtNode = noInkMRT();
      const mesh = new Mesh(shieldGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 22;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shields.push({ mesh, hitDir, alpha, spot, mode, tint, gain, life: 0, maxLife: 0.45, ship: null });
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

  /**
   * Light a ship's shield. `mode` 0 = hit ripple at `hitPos`, 1 = a facing
   * collapsing, 2 = a facing regenerating. For capitals the shell is an
   * ellipsoid fitted to the hull and `facing` picks the patch that lights.
   */
  private shield(ship: ShipEntity | null, hitPos: Vector3 | null, mode: 0 | 1 | 2, facing: number): void {
    if (!ship) return;
    const cap = ship.combat.dmg.capital;
    // A capital under fire would churn the pool with ripples: one live ripple per ship.
    let s = mode === 0 && cap ? this.shields.find((x) => x.life > 0 && x.ship === ship && (x.mode.value as number) === 0) : undefined;
    if (!s) {
      s = this.shields[this.shieldHead];
      this.shieldHead = (this.shieldHead + 1) % SHIELD_POOL;
    }
    s.ship = ship;
    s.maxLife = s.life = mode === 0 ? 0.45 : mode === 1 ? 0.7 : 1.1;
    s.mode.value = mode;
    s.gain.value = mode === 0 && cap ? 1.2 : 2.2;
    const dir = s.hitDir.value as Vector3;
    if (mode === 0 && hitPos) {
      // Direction to the hit in shell-local unit-sphere space.
      this.shellLocal(ship, hitPos, dir);
      s.spot.value = cap ? 0.8 : 0.35;
    } else if (cap && facing >= 0) {
      dir.copy(FACING_DIR[facing]);
      s.spot.value = mode === 1 ? 0.3 : 0.15;
    } else {
      dir.set(0, 1, 0);
      s.spot.value = -1.6; // whole bubble
    }
    (s.tint.value as Color).set(ship.faction === 'choir' ? '#ff6fd0' : ship.faction === 'rustwake' ? '#ffc070' : '#5fd8ff');
    s.mesh.visible = true;
  }

  private shellLocal(ship: ShipEntity, universe: Vector3, out: Vector3): Vector3 {
    const st = ship.combat.dmg;
    _q.copy(ship.flight.orientation).invert();
    out.subVectors(universe, ship.flight.position).applyQuaternion(_q);
    if (st.capital) {
      const sh = ship.combat.shell;
      out.set((out.x - st.cx) / sh.x, (out.y - st.cy) / sh.y, (out.z - st.cz) / sh.z);
    }
    return out.normalize();
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
          this.flash(e.position, 3.5, 0.06);
          break;
        case 'hit':
          this.flash(e.position, 9, 0.2);
          break;
        case 'shield':
          this.flash(e.position, e.ship?.combat.dmg.capital ? 9 : 6, 0.12);
          if (e.ship) this.shield(e.ship, e.position, 0, e.facing);
          break;
        case 'shield-down':
          this.flash(e.position, e.ship?.combat.dmg.capital ? 90 : 18, 0.25);
          if (e.ship) this.shield(e.ship, e.position, 1, e.facing);
          break;
        case 'shield-up':
          if (e.ship) this.shield(e.ship, null, 2, e.facing);
          break;
        case 'subsystem':
          this.flash(e.position, (e.sub?.radius ?? 20) * 3, 0.35);
          break;
        case 'beam-hit':
          if (Math.random() < 0.3) this.flash(e.position, 14, 0.12);
          break;
        case 'kill':
          this.flash(e.position, 60, 0.5);
          break;
      }
    }
    for (const e of this.missiles.events) {
      if (e.kind === 'detonate') this.flash(e.position, 26, 0.3);
      else if (e.kind === 'launch') this.flash(e.position, 5, 0.08);
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

    for (const s of this.shields) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0 || !s.ship || !s.ship.alive) {
        s.mesh.visible = false;
        s.life = 0;
        continue;
      }
      s.alpha.value = s.life / s.maxLife;
      const ship = s.ship;
      const st = ship.combat.dmg;
      if (st.capital) {
        // Ellipsoid shell around the hull centre, riding the ship's orientation.
        s.mesh.position.set(st.cx, st.cy, st.cz).applyQuaternion(ship.model.root.quaternion).add(ship.model.root.position).sub(eye); // render pose (predicted / kill-cam)
        s.mesh.quaternion.copy(ship.model.root.quaternion);
        s.mesh.scale.copy(ship.combat.shell);
      } else {
        s.mesh.position.subVectors(ship.model.root.position, eye);
        s.mesh.quaternion.copy(ship.model.root.quaternion);
        s.mesh.scale.setScalar(ship.radius * 1.35);
      }
    }

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
