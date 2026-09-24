import { Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Particles } from '@/fx/Particles';
import { makeSpawn, resetSpawn } from '@/fx/spawn';
import { PAL, PK, type ParticlePalette } from '@/fx/kinds';
import { createDamageMarks, DAMAGE_MARKS, type DamageMarks } from '@/render/materials/CelMaterial';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import type { WeaponEvent } from '@/sim/Weapons';
import type { Subsystem } from '@/sim/Damage';
import type { WreckPiece } from '@/sim/Destruction';
import { shockwaveSpec } from '@/sim/Structure';
import { toUniverse } from '@/sim/Combat';
import { DebrisField } from './destruction/DebrisField';
import { MountWrecks } from './destruction/MountWrecks';
import { splitHull, splitSide } from './destruction/HullSplit';

/**
 * How ships die on screen (the sim decides that and when: Subsystems.ts,
 * Destruction.ts). Reads weapon events and the fleet's wreck list:
 *
 * - **Mounts**: a rigged turret that is knocked out is posed by the sim
 *   (TurretRig.wreckDrive: house skewed, guns drooped; Capitals / ShipTurrets
 *   run it) — nothing to do here. An overkill (`sub.wreck === 'blown'`)
 *   throws its gun house off the ring: the rig's joint meshes are hidden and
 *   a copy tumbles away trailing smoke. Unrigged mounts (lances, launchers,
 *   rigid turrets) are wrecked by surgery on the merged hull (MountWrecks).
 *   The blast itself is CombatFx.subsystemDeath's. Engines, bridges and
 *   hangars vent atmosphere in white jets; a critical reactor strobes and
 *   bleeds plasma while its crew vents it.
 * - **Kill paths**: hull depletion rolls a chain of blasts along the hull
 *   and ends in blasts at the section joints where she comes apart;
 *   structural failure tears across the broken section in a line of fire;
 *   a reactor goes in a white flash and a shock ring the size of the sim's
 *   shockwave (it reaches ships when the ring does); a struck ship just goes
 *   dark with a last pop on the bridge.
 * - **Wrecks**: each sim wreck piece gets its own mesh cut from the dead
 *   hull (a ragged tear, lights out, the old scorch marks plus glowing
 *   craters along the break), posed from the sim every frame, burning at the
 *   break while it burns, with secondary pops.
 * - **Fighters**: the wing that took the most damage shears off and
 *   tumbles away smoking.
 * - Debris: instanced, ink-outlined shards (DebrisField) from every big blast.
 *
 * All visual dice are local (never the sim's streams).
 */
interface Chain {
  ship: ShipEntity;
  /** Universe points still to pop, in order, with delays (s). */
  at: Vector3[];
  sizes: number[];
  gaps: number[];
  t: number;
  next: number;
  i: number;
  palette: ParticlePalette;
}

interface WreckView {
  piece: WreckPiece;
  root: Group;
  mesh: Mesh;
  marks: DamageMarks;
  edge: Vector3[];
  fireT: number;
  popT: number;
  smokeFrom: Vector3[];
}

const _p = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _w = new Vector3();
const _inv = new Matrix4();
const _mm = new Matrix4();
const d = makeSpawn();

/** Capitals die by their kill path here (sections, wreck pieces); everything else is CombatFx's fireball. */
export function hasKillPaths(s: ShipEntity): boolean {
  return s.combat.dmg.capital && s.combat.dmg.structure.sections.length > 0;
}

function paletteOf(s: ShipEntity): ParticlePalette {
  return s.faction === 'choir' ? PAL.MAGENTA : PAL.WARM;
}

export class DestructionFx {
  /** Render-space group (scene child): wreck meshes, debris. */
  readonly group = new Group();
  readonly debris = new DebrisField();
  private mounts = new MountWrecks();
  private chains: Chain[] = [];
  private wrecks = new Map<number, WreckView>();
  /** Wrecked mounts per ship (to put back on repair / respawn). */
  private wrecked = new Map<ShipEntity, Set<Subsystem>>();
  private seed = 0x0d1e;
  private ventT = 0;
  /** 0..1 white-out for the HUD after a reactor detonation in view (decays). */
  screenFlash = 0;
  /** Universe point of the last detonation (HUD / camera shake). */
  readonly lastBlast = new Vector3();

  constructor(
    private fleet: Fleet,
    private fx: Particles,
  ) {
    this.group.name = 'destruction-fx';
    this.group.add(this.debris.group);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  // ── events ──────────────────────────────────────────────────────────

  /** One weapon event (called from CombatFx.consume for every event this tick). */
  consume(e: WeaponEvent): void {
    const s = e.ship;
    if (!s) return;
    if (e.kind === 'subsystem' && e.sub) this.mountDied(s, e.sub);
    else if (e.kind === 'reactor-critical') this.criticalFlash(s);
    else if (e.kind === 'reactor-vented') this.vented(s);
    else if (e.kind === 'kill') {
      if (hasKillPaths(s)) this.bigDeath(s);
      else if (s.radius < 25) this.fighterDeath(s);
    }
  }

  private mountDied(s: ShipEntity, sub: Subsystem): void {
    if (!sub.wreck || !(sub.kind === 'turret' || sub.kind === 'launcher' || sub.kind === 'lance')) return;
    let set = this.wrecked.get(s);
    if (!set) this.wrecked.set(s, (set = new Set()));
    set.add(sub);
    const seed = hashStr(`${s.id}:${sub.id}`);
    const rig = s.model.turrets.get(sub.id);
    if (rig) {
      // The sim poses a knocked-out rig (wreckDrive); only an overkill needs us.
      if (sub.wreck === 'blown') this.blowRig(s, sub);
      return;
    }
    const cut = this.mounts.wreck(s, sub, sub.wreck, seed);
    if (cut) this.throwHouse(s, cut.geometry, cut.origin, cut.up, sub.radius);
  }

  /** A rigged turret blown off its ring: hide its joints, throw a copy of the house and guns. */
  private blowRig(s: ShipEntity, sub: Subsystem): void {
    const model = s.model;
    const art = model.articulations.get(sub.id);
    const rig = model.turrets.get(sub.id);
    if (!art || !rig || !art.node.visible) return;
    model.root.updateMatrixWorld(true);
    _inv.copy(model.root.matrixWorld).invert();
    const hull = new Set<unknown>(model.meshes);
    const geos: BufferGeometry[] = [];
    art.node.traverse((o) => {
      if (!hull.has(o)) return;
      const g = (o as Mesh).geometry.clone();
      g.applyMatrix4(_mm.multiplyMatrices(_inv, o.matrixWorld));
      geos.push(g);
    });
    art.node.visible = false;
    if (!geos.length) return;
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    if (!merged) return;
    merged.translate(-rig.base.x, -rig.base.y, -rig.base.z);
    merged.computeBoundingSphere();
    this.throwHouse(s, merged, rig.base, rig.up, sub.radius);
  }

  /** The gun house goes up off its ring (root-local `origin` / `up`), tumbling, trailing smoke; it pops a few seconds later. */
  private throwHouse(s: ShipEntity, geometry: BufferGeometry, origin: Vector3, up: Vector3, r: number): void {
    const v = s.flight.velocity;
    const pal = paletteOf(s);
    const mesh = new Mesh(geometry, s.model.hull.material as Material);
    toUniverse(s, origin.x, origin.y, origin.z, _p);
    _n.copy(up).applyQuaternion(s.flight.orientation);
    const size = geometry.boundingSphere?.radius ?? r * 0.5;
    // Thrown hard enough to read as blown off (≈ a house-height a tenth of a second), not lifted.
    const kick = Math.min(110, 40 + size * 1.6);
    _v.copy(v)
      .addScaledVector(_n, kick * (0.8 + this.rand() * 0.4))
      .add(_w.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(kick * 0.6));
    const spin = new Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(3.2);
    const piece = this.debris.addRigid(mesh, _p, s.flight.orientation, _v, spin, 6 + this.rand() * 3);
    piece.smoke = 0.12;
    piece.onEnd = (at) => this.fx.explosion(at, v, size * 0.8, pal);
  }

  private criticalFlash(s: ShipEntity): void {
    const core = s.combat.dmg.subsystems.find((x) => x.kind === 'reactor');
    if (!core) return;
    toUniverse(s, core.x, core.y, core.z, _p);
    resetSpawn(d);
    d.kind = PK.FLASH;
    d.palette = PAL.PLASMA;
    d.pos.copy(_p);
    d.baseVel.copy(s.flight.velocity);
    d.count = 1;
    d.size0 = d.size1 = core.radius * 2.2;
    d.lifeMin = d.lifeMax = 0.25;
    this.fx.emit(d);
  }

  private vented(s: ShipEntity): void {
    const core = s.combat.dmg.subsystems.find((x) => x.kind === 'reactor');
    if (!core) return;
    // The cold is let out: a long white plume off the core.
    toUniverse(s, core.x, core.y, core.z, _p);
    _n.set(core.x - s.combat.dmg.cx, core.y - s.combat.dmg.cy, 0).normalize().applyQuaternion(s.flight.orientation);
    this.jet(_p, _n, s.flight.velocity, core.radius * 1.4, 26, 3.5);
  }

  private bigDeath(s: ShipEntity): void {
    const st = s.combat.dmg;
    const S = st.structure;
    const cause = S.death ?? 'hull';
    const pal = paletteOf(s);
    const v = s.flight.velocity;
    const L = s.model.length;
    const pts: Vector3[] = [];
    const sizes: number[] = [];
    const gaps: number[] = [];
    const onHull = (x: number, y: number, z: number) => toUniverse(s, x, y, z, new Vector3());
    if (cause === 'reactor') {
      const core = st.subsystems.find((x) => x.kind === 'reactor');
      const c = core ? onHull(core.x, core.y, core.z) : s.flight.position.clone();
      const sw = shockwaveSpec(L, s.hullMax);
      this.lastBlast.copy(c);
      this.screenFlash = 1;
      // White flash, a plasma fireball swallowing the midships, and the shock ring riding the sim's front.
      resetSpawn(d);
      d.kind = PK.FLASH;
      d.palette = PAL.PLASMA;
      d.pos.copy(c);
      d.baseVel.copy(v);
      d.count = 1;
      d.size0 = L * 0.55;
      d.size1 = L * 0.8;
      d.lifeMin = d.lifeMax = 0.5;
      this.fx.emit(d);
      this.fx.explosion(c, v, L * 0.22, PAL.PLASMA);
      this.fx.explosion(c, v, L * 0.14, pal);
      for (const k of [0, 1]) {
        resetSpawn(d);
        d.kind = PK.RING;
        d.palette = PAL.PLASMA;
        d.pos.copy(c);
        d.baseVel.copy(v);
        d.count = 1;
        if (k === 1) d.dir.set(0, 1, 0).applyQuaternion(s.flight.orientation);
        d.size0 = L * 0.1;
        d.size1 = sw.radius;
        d.lifeMin = d.lifeMax = sw.radius / sw.speed;
        this.fx.emit(d);
      }
      this.debris.burst(c, v, 70, Math.max(3, L * 0.012), Math.min(700, L * 0.35));
      return;
    }
    if (cause === 'structural') {
      // A line of fire across the broken section, then the pieces go.
      const z = S.breakZ;
      for (let i = 0; i < 6; i++) {
        const x = st.cx + (i / 5 - 0.5) * st.halfW * 1.6;
        const y = st.cy + (this.rand() - 0.5) * st.halfH;
        pts.push(onHull(x, y, z + (this.rand() - 0.5) * L * 0.03));
        sizes.push(Math.max(st.halfW, st.halfH) * (0.45 + this.rand() * 0.3));
        gaps.push(i === 0 ? 0 : 0.07 + this.rand() * 0.08);
      }
      const mid = onHull(st.cx, st.cy, z);
      this.debris.burst(mid, v, 50, Math.max(2, L * 0.01), Math.min(260, L * 0.12));
      this.lastBlast.copy(mid);
    } else if (cause === 'bridge') {
      // Struck: a last pop on the command deck, then she goes dark.
      const b = st.subsystems.find((x) => x.kind === 'bridge');
      if (b) {
        pts.push(onHull(b.x, b.y, b.z));
        sizes.push(b.radius * 0.8);
        gaps.push(0);
      }
    } else {
      // Hull depletion: blasts walk the hull (the mounts and plating), then the section joints go.
      const subs = [...st.subsystems].sort((a, b) => b.z - a.z);
      const n = Math.min(9, subs.length);
      for (let i = 0; i < n; i++) {
        const sb = subs[Math.floor((i / n) * subs.length + this.rand() * (subs.length / n))] ?? subs[i];
        pts.push(onHull(sb.x, sb.y, sb.z));
        sizes.push(Math.max(sb.radius, L * 0.02) * (0.9 + this.rand() * 0.8));
        gaps.push(0.18 + this.rand() * 0.22);
      }
      for (const sec of S.sections.slice(0, 2)) {
        for (let k = 0; k < 2; k++) {
          pts.push(onHull(st.cx + (this.rand() - 0.5) * st.halfW, st.cy + (this.rand() - 0.2) * st.halfH, sec.z0));
          sizes.push(Math.max(st.halfW, st.halfH) * 0.7);
          gaps.push(k === 0 ? 0.25 : 0.06);
        }
      }
      if (!S.sections.length) {
        pts.push(s.flight.position.clone());
        sizes.push(s.model.radius * 0.35);
        gaps.push(0.2);
      }
    }
    this.chains.push({ ship: s, at: pts, sizes, gaps, t: 0, next: gaps[0] ?? 0, i: 0, palette: pal });
  }

  private fighterDeath(s: ShipEntity): void {
    const st = s.combat.dmg;
    // The wing that took the most shears off; the rest goes up in the fireball.
    const side = st.zones[1] >= st.zones[2] ? 1 : -1;
    if (Math.max(st.zones[1], st.zones[2]) < 0.05 && this.rand() < 0.4) return;
    const geo = splitSide(s.model, side * st.halfW * 0.38, s.id);
    if (!geo.getAttribute('position').count) return;
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const mesh = new Mesh(geo, s.model.hull.material as Material);
    toUniverse(s, c.x, c.y, c.z, _p);
    _n.set(side, 0.4, -0.3).normalize().applyQuaternion(s.flight.orientation);
    _v.copy(s.flight.velocity).multiplyScalar(0.8).addScaledVector(_n, 25 + this.rand() * 20);
    const spin = new Vector3(this.rand() - 0.5, this.rand() - 0.5, (this.rand() - 0.5) * 3).multiplyScalar(5);
    const piece = this.debris.addRigid(mesh, _p, s.flight.orientation, _v, spin, 3 + this.rand() * 1.5);
    piece.smoke = 0.06;
    const pal = paletteOf(s);
    piece.onEnd = (at, p) => this.fx.explosion(at, p.vel, 4, pal);
  }

  // ── per tick / frame ────────────────────────────────────────────────

  /** Chains, venting and critical cores (sim-rate: call once per tick after consume). */
  step(dt: number): void {
    const fx = this.fx;
    for (let k = this.chains.length - 1; k >= 0; k--) {
      const c = this.chains[k];
      c.t += dt;
      while (c.i < c.at.length && c.t >= c.next) {
        const p = c.at[c.i];
        const size = c.sizes[c.i];
        fx.explosion(p, c.ship.flight.velocity, size, c.palette);
        if (size > 20) this.debris.burst(p, c.ship.flight.velocity, Math.round(Math.min(18, 4 + size * 0.08)), Math.max(1.5, size * 0.05), size * 1.8);
        c.i++;
        c.next = c.t + (c.gaps[c.i] ?? 0);
      }
      if (c.i >= c.at.length) this.chains.splice(k, 1);
    }
    // Venting atmosphere from breaches and the critical cores' strobe, a few times a second.
    this.ventT -= dt;
    if (this.ventT > 0) return;
    this.ventT = 0.25;
    for (const s of this.fleet.ships) {
      if (!s.alive) continue;
      const st = s.combat.dmg;
      if (!st.capital) continue;
      const R = st.structure.reactor;
      for (const sub of st.subsystems) {
        if (!sub.destroyed) continue;
        if (sub.kind === 'reactor' && R.phase === 'critical') {
          // Strobing core; the vent plume grows as the crew gets the cold out.
          toUniverse(s, sub.x, sub.y, sub.z, _p);
          resetSpawn(d);
          d.kind = PK.FLASH;
          d.palette = PAL.PLASMA;
          d.pos.copy(_p);
          d.baseVel.copy(s.flight.velocity);
          d.count = 1;
          const beat = 1 - R.t / Math.max(1, R.fuse);
          d.size0 = d.size1 = sub.radius * (0.9 + beat * 1.6);
          d.lifeMin = d.lifeMax = 0.12;
          fx.emit(d);
          _n.set(sub.x - st.cx, sub.y - st.cy, 0).normalize().applyQuaternion(s.flight.orientation);
          this.jet(_p, _n, s.flight.velocity, sub.radius * (0.4 + R.vent), 6, 1.4);
          fx.impact(_p, _n, s.flight.velocity, PAL.PLASMA);
        } else if ((sub.kind === 'bridge' || sub.kind === 'hangar' || sub.kind === 'engine' || sub.kind === 'shieldGen') && this.rand() < 0.5) {
          toUniverse(s, sub.x, sub.y, sub.z, _p);
          _n.set(sub.x - st.cx, (sub.y - st.cy) * 1.5, 0).normalize().applyQuaternion(s.flight.orientation);
          this.jet(_p, _n, s.flight.velocity, sub.radius * 0.35, 3, 1.1);
        }
      }
    }
  }

  /** A white jet of venting atmosphere (ink-outlined puffs) along `dir`. */
  private jet(pos: Vector3, dir: Vector3, vel: Vector3, size: number, count: number, life: number): void {
    resetSpawn(d);
    d.kind = PK.PUFF;
    d.palette = PAL.WARM;
    d.pos.copy(pos);
    d.baseVel.copy(vel);
    d.dir.copy(dir);
    d.spread = 0.12;
    d.count = count;
    d.speedMin = size * 1.5;
    d.speedMax = size * 3.5;
    d.drag = 0.4;
    d.size0 = size * 0.25;
    d.size1 = size * 0.9;
    d.sizeJitter = 0.4;
    d.jitter = size * 0.1;
    d.lifeMin = life * 0.6;
    d.lifeMax = life;
    this.fx.emit(d);
  }

  /** Once per frame after the eye is final: wreck meshes, fire at the breaks, debris. */
  update(dt: number, eye: Vector3): void {
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.6);
    this.syncWrecks(dt, eye);
    // Rigid pieces trail smoke.
    for (const p of this.debris.rigid) {
      if (!p.smoke) continue;
      p.smokeT -= dt;
      if (p.smokeT > 0) continue;
      p.smokeT = p.smoke;
      const r = p.mesh.geometry.boundingSphere?.radius ?? 5;
      resetSpawn(d);
      d.kind = this.rand() < 0.3 ? PK.FIRE : PK.SMOKE;
      d.palette = PAL.WARM;
      d.pos.copy(p.pos);
      d.baseVel.copy(p.vel).multiplyScalar(0.2);
      d.count = 1;
      d.jitter = r * 0.3;
      d.size0 = r * 0.25;
      d.size1 = r * 0.7;
      d.lifeMin = 0.8;
      d.lifeMax = 1.6;
      this.fx.emit(d);
    }
    this.debris.update(dt, eye);
    // Repaired / respawned ships get their mounts back (rigs: the joints reappear; surgery: undone, the rest re-wrecked).
    for (const [s, set] of this.wrecked) {
      let surgery = false;
      for (const sub of set) {
        if (sub.destroyed) continue;
        set.delete(sub);
        const art = s.model.turrets.has(sub.id) ? s.model.articulations.get(sub.id) : undefined;
        if (art) art.node.visible = true;
        else surgery = true;
      }
      if (surgery) {
        this.mounts.restore(s);
        for (const sub of set) if (!s.model.turrets.has(sub.id)) this.mounts.wreck(s, sub, 'droop', hashStr(`${s.id}:${sub.id}`));
      }
      if (!set.size) this.wrecked.delete(s);
    }
  }

  private syncWrecks(dt: number, eye: Vector3): void {
    const live = this.fleet.destruction.wrecks;
    const seen = new Set<number>();
    for (const w of live) {
      seen.add(w.id);
      let view = this.wrecks.get(w.id);
      if (!view) view = this.makeWreck(w);
      const root = view.root;
      // Pose: the pivot's universe position, relative to the eye; the mesh sits −pivot inside.
      root.position.subVectors(w.position, eye);
      root.quaternion.copy(w.orientation);
      this.burnWreck(view, dt);
    }
    for (const [id, view] of this.wrecks) {
      if (seen.has(id)) continue;
      this.group.remove(view.root);
      view.mesh.geometry.dispose();
      this.wrecks.delete(id);
    }
  }

  private makeWreck(w: WreckPiece): WreckView {
    const s = w.ship;
    const st = s.combat.dmg;
    const amp = Math.max(2, s.model.length * 0.025);
    const piece = splitHull(s.model, w.z0, w.z1, amp, w.id * 7.31);
    const mesh = new Mesh(piece.geometry, s.model.hull.material as Material);
    mesh.position.copy(w.pivot).negate();
    mesh.frustumCulled = false;
    // Scorch marks carried over from the living hull, glowing craters along the tear.
    const marks = createDamageMarks(st.capital ? 60 / Math.max(st.halfL, st.halfW) : 0.9);
    const old = s.model.hull.userData.dmg as DamageMarks | undefined;
    let k = 0;
    const edge = piece.edge;
    const craters = Math.min(edge.length, w.cause === 'bridge' ? 0 : 6);
    for (let i = 0; i < craters; i++) {
      const e = edge[Math.floor((i / craters) * edge.length)];
      marks.marks[k].set(e.x, e.y, e.z, Math.max(st.halfW, st.halfH) * 0.45);
      setLevel(marks, k++, 2);
    }
    if (old) {
      for (let i = 0; i < DAMAGE_MARKS && k < DAMAGE_MARKS; i++) {
        if (old.marks[i].w <= 0) continue;
        marks.marks[k].copy(old.marks[i]);
        setLevel(marks, k++, Math.min(1, getLevel(old, i)));
      }
    }
    // A wreck is scorched all over.
    for (; k < DAMAGE_MARKS && edge.length; k++) {
      const e = edge[k % edge.length];
      marks.marks[k].set(st.cx + (this.rand() - 0.5) * st.halfW * 2, st.cy + st.halfH * 0.6, Math.min(w.z1, Math.max(w.z0, e.z + (this.rand() - 0.5) * st.halfL)), Math.max(st.halfW, st.halfH) * 0.7);
      setLevel(marks, k, 0.6 + this.rand() * 0.4);
    }
    marks.any = true;
    mesh.userData.dmg = marks;
    mesh.userData.dmgOffset = new Vector3();
    const root = new Group();
    root.add(mesh);
    this.group.add(root);
    const smokeFrom = st.subsystems.filter((x) => x.destroyed && x.z >= w.z0 && x.z < w.z1).slice(0, 6).map((x) => new Vector3(x.x, x.y, x.z));
    const view: WreckView = { piece: w, root, mesh, marks, edge, fireT: 0, popT: 1 + this.rand() * 2, smokeFrom };
    this.wrecks.set(w.id, view);
    return view;
  }

  /** Fire and smoke at the tear while it burns, smoke off dead mounts, the odd secondary pop. */
  private burnWreck(view: WreckView, dt: number): void {
    const w = view.piece;
    if (w.delay > 0) return;
    view.fireT -= dt;
    if (view.fireT > 0) return;
    view.fireT = 0.2;
    const st = w.ship.combat.dmg;
    const pal = paletteOf(w.ship);
    const hot = w.burning > 0;
    if (hot && view.edge.length) {
      const e = view.edge[Math.floor(this.rand() * view.edge.length)];
      this.piecePoint(w, e, _p);
      const r = Math.max(st.halfW, st.halfH) * 0.35;
      resetSpawn(d);
      d.kind = PK.FIRE;
      d.palette = pal;
      d.pos.copy(_p);
      d.baseVel.copy(w.velocity);
      d.count = 2;
      d.jitter = r * 0.4;
      d.radial = true;
      d.speedMin = r * 0.1;
      d.speedMax = r * 0.4;
      d.drag = 1.5;
      d.size0 = r * 0.25;
      d.size1 = r * 0.6;
      d.lifeMin = 0.5;
      d.lifeMax = 1.0;
      this.fx.emit(d);
      resetSpawn(d);
      d.kind = PK.SMOKE;
      d.palette = pal;
      d.pos.copy(_p);
      d.baseVel.copy(w.velocity);
      d.count = 1;
      d.jitter = r * 0.5;
      d.radial = true;
      d.speedMin = r * 0.1;
      d.speedMax = r * 0.3;
      d.drag = 0.5;
      d.size0 = r * 0.4;
      d.size1 = r * 1.1;
      d.lifeMin = 2;
      d.lifeMax = 3.5;
      this.fx.emit(d);
      view.popT -= 0.2;
      if (view.popT <= 0) {
        view.popT = 1.5 + this.rand() * 4;
        this.fx.explosion(_p, w.velocity, r * (0.5 + this.rand() * 0.6), pal);
        this.debris.burst(_p, w.velocity, 5, Math.max(1.5, r * 0.08), r * 1.5);
      }
    }
    if (view.smokeFrom.length && w.age < 240 && this.rand() < 0.35) {
      const e = view.smokeFrom[Math.floor(this.rand() * view.smokeFrom.length)];
      this.piecePoint(w, e, _p);
      const r = Math.max(st.halfW, st.halfH) * 0.25;
      resetSpawn(d);
      d.kind = PK.SMOKE;
      d.palette = PAL.WARM;
      d.pos.copy(_p);
      d.baseVel.copy(w.velocity);
      d.count = 1;
      d.jitter = r * 0.3;
      d.size0 = r * 0.3;
      d.size1 = r * 0.9;
      d.lifeMin = 2.5;
      d.lifeMax = 4;
      this.fx.emit(d);
    }
  }

  /** Universe position of a ship-root-local point on a wreck piece. */
  private piecePoint(w: WreckPiece, local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).sub(w.pivot).applyQuaternion(w.orientation).add(w.position);
  }

  /** Clear debris and wreck meshes (scene change); the sim's wreck list is the fleet's. */
  clear(): void {
    this.chains.length = 0;
    this.debris.clear();
    for (const view of this.wrecks.values()) {
      this.group.remove(view.root);
      view.mesh.geometry.dispose();
    }
    this.wrecks.clear();
  }
}

function setLevel(m: DamageMarks, i: number, v: number): void {
  const l = m.levels[i >> 2];
  if ((i & 3) === 0) l.x = v;
  else if ((i & 3) === 1) l.y = v;
  else if ((i & 3) === 2) l.z = v;
  else l.w = v;
}

function getLevel(m: DamageMarks, i: number): number {
  const l = m.levels[i >> 2];
  return (i & 3) === 0 ? l.x : (i & 3) === 1 ? l.y : (i & 3) === 2 ? l.z : l.w;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
