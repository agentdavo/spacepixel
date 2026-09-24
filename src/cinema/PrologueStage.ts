import { Color, Group, Quaternion, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import { disposeTree } from '@/core/dispose';
import type { Livery } from '@/assets/Blueprint';
import { faceAlong, type Fleet, type ShipEntity } from '@/sim/Fleet';
import type { Weapons } from '@/sim/Weapons';
import { LightRig, LIGHT_PRESETS, type LightPreset } from '@/render/LightRig';
import { postFx } from '@/render/post/PostFx';
import type { Particles } from '@/fx/Particles';
import { PAL } from '@/fx/kinds';
import { LIVERY_PRESETS } from '@/game/Profile';
import { generateUniverse } from '@/universe/generate';
import { Backdrop, BACKDROPS, type BackdropPreset } from '@/world/Backdrop';
import { Planet, PLANETS } from '@/world/Planet';
import { LanternGate } from '@/world/LanternGate';
import { Monolith, MegaGate, Derelict, Wreckage, Beacon, type SetPiece, type SetPieceFrame } from '@/world/setpieces';
import type { CinemaStage } from './Cinema';
import type { Shot } from './timeline';
import { LightSheet, StarGlint } from './props';
import { SIGNAL_PULSES } from './prologue';

/**
 * The prologue's sets, built once and switched on cuts. Every set sits
 * thousands of kilometres from the others (and ~2 600 km from the universe
 * origin, so float64 rebasing is exercised exactly as in flight). Props are
 * posed as pure functions of the set's clock, so a seek reproduces playback.
 *
 * Scale, in the prologue's own units: the Nexus-class gate is 24 km across
 * its outer ring; a relit Lantern 3.8 km; capital ships 1–2 km; a Kestrel 18 m.
 */
type SetId = 'void' | 'gate' | 'graveyard' | 'lantern' | 'treaty' | 'launch' | 'null';

const BASE = new Vector3(2_400_000, 150_000, -1_100_000);
const KM = 1000;

/** Golden-age (Timetable Era) liner paint: ivory, gilt, teal. */
const TIMETABLE: Partial<Livery> = { primary: '#efe9da', secondary: '#c9a24a', accent: '#2f8f9d', dark: '#3a3530', glow: '#ffe2a0', plumeCore: '#fff6e0' };

/** The long dark: almost no nebula, a thin cold band, sparse stars — so a relit Lantern reads as the only light. */
export const LONG_DARK_SKY: BackdropPreset = {
  name: 'The Long Dark',
  nebula: [
    { at: 0.0, color: '#010104' },
    { at: 0.5, color: '#03030a' },
    { at: 0.66, color: '#080814' },
    { at: 0.8, color: '#141026' },
    { at: 0.92, color: '#2a1d44' },
  ],
  wisp: '#10222c',
  bandNormal: new Vector3(0.3, 0.85, -0.4).normalize(),
  seed: 23.1,
  starTint: '#c8d4ff',
};

interface SetDef {
  id: SetId;
  anchor: Vector3;
  group: Group;
  sky: string | null;
  light: LightPreset;
  pieces: SetPiece[];
}

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _dir = new Vector3();
const _z = new Vector3(0, 0, 1);
const FAR = new Vector3(1e12, 1e12, 1e12);

function smooth(a: number, b: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** Deterministic hash noise in [-1, 1]. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function withLight(base: LightPreset, patch: Partial<LightPreset>): LightPreset {
  return { ...base, ...patch, name: `${base.name}*` };
}

export class PrologueStage implements CinemaStage {
  private readonly sets = new Map<SetId, SetDef>();
  private readonly skies = new Map<string, Backdrop>();
  private readonly glint = new StarGlint('#e6eeff');
  private readonly flags = new Set<string>();
  private readonly frame: SetPieceFrame;
  private live: SetDef | null = null;
  private liveLight: LightPreset | null = null;
  private clockOffset = new Map<string, number>();
  private setClock = 0;

  // gate
  private nexus!: MegaGate;
  private nexusSheet!: LightSheet;
  private shards!: Wreckage;
  private liners: ShipEntity[] = [];
  private readonly linerPath: { x: number; y: number; z0: number }[] = [
    { x: 0.9, y: -0.4, z0: 3.735 },
    { x: -2.4, y: 1.2, z0: 10.5 },
    { x: 3.1, y: 0.3, z0: 16.5 },
    { x: -0.8, y: -1.9, z0: 23.5 },
    { x: -6.8, y: -3.6, z0: 36.5 },
  ];
  private gateDim!: LightPreset;
  // graveyard
  private warden!: ShipEntity;
  // lantern
  private lantern!: LanternGate;
  private ebon!: LightSheet;
  private titleWing: ShipEntity[] = [];
  private ebonLight!: LightPreset;
  // treaty
  private indomitable!: ShipEntity;
  private dawn!: ShipEntity;
  private guardA!: ShipEntity;
  private guardB!: ShipEntity;
  private cathedral!: ShipEntity;
  private vesperA!: ShipEntity;
  private vesperB!: ShipEntity;
  private treatyHome = new Map<ShipEntity, { pos: Vector3; fwd: Vector3 }>();
  // launch
  private carrier!: ShipEntity;
  private kestrels: ShipEntity[] = [];
  private farLantern!: LanternGate;
  private farSheet!: LightSheet;
  // null
  private nullGate!: LanternGate;
  private nullSheet!: LightSheet;

  constructor(
    private readonly scene: Scene,
    world: WorldSpace,
    private readonly fleet: Fleet,
    private readonly weapons: Weapons,
    private readonly fx: Particles,
    private readonly camera: PerspectiveCamera,
    shots: readonly Shot[],
  ) {
    const u = generateUniverse(1994);
    const sys = (id: string) => u.systems.get(id)!;
    const skies: Record<string, BackdropPreset> = {
      meridian: BACKDROPS.meridian,
      dark: LONG_DARK_SKY,
      tessaly: sys('tessaly').backdrop,
      null: sys('null').backdrop,
    };
    for (const [k, p] of Object.entries(skies)) {
      const b = new Backdrop(p);
      b.group.visible = false;
      this.skies.set(k, b);
      scene.add(b.group);
    }
    this.glint.sprite.visible = false;
    scene.add(this.glint.sprite);

    const mk = (id: SetId, i: number, sky: string | null, light: LightPreset): SetDef => {
      const s: SetDef = { id, anchor: BASE.clone().add(new Vector3(i * 6_000 * KM, 0, 0)), group: new Group(), sky, light, pieces: [] };
      s.group.name = `prologue:${id}`;
      s.group.visible = false;
      world.root.add(s.group);
      this.sets.set(id, s);
      return s;
    };
    const tessalyLight = sys('tessaly').light;
    const nullLight = withLight(sys('null').light, { keyIntensity: 0.55 });
    mk('void', 0, null, LIGHT_PRESETS.meridian);
    this.buildGate(mk('gate', 1, 'meridian', LIGHT_PRESETS.meridian));
    this.buildGraveyard(mk('graveyard', 2, 'dark', sys('anchorage').light));
    this.buildLantern(mk('lantern', 3, 'dark', sys('anchorage').light));
    this.buildTreaty(mk('treaty', 4, 'tessaly', tessalyLight));
    this.buildLaunch(mk('launch', 5, 'meridian', LIGHT_PRESETS.meridian));
    this.buildNull(mk('null', 7, 'null', nullLight));

    // Set clocks run across consecutive shots on the same set (gate: 2 → 3).
    for (let i = 0; i < shots.length; i++) {
      const prev = shots[i - 1];
      this.clockOffset.set(shots[i].id, prev && prev.set === shots[i].set ? (this.clockOffset.get(prev.id) ?? 0) + prev.dur : 0);
    }

    const self = this;
    this.frame = {
      dt: 0,
      time: 0,
      eye: world.eye,
      playerPos: FAR,
      playerVel: new Vector3(),
      flags: this.flags,
      setFlag(f: string) {
        self.flags.add(f);
      },
      postFx,
      camera,
      scene,
    };
  }

  // ── builders ───────────────────────────────────────────────────────

  private ship(set: SetDef, blueprint: string, faction: 'concord' | 'choir', livery?: Partial<Livery>): ShipEntity {
    const s = this.fleet.spawn(blueprint, faction, set.anchor, _z, { name: `${set.id}:${blueprint}`, plotArmour: true }, livery);
    set.group.add(s.model.root); // universe-positioned; the set group sits at the root origin
    return s;
  }

  private piece<T extends SetPiece>(set: SetDef, p: T): T {
    set.group.add(p.group);
    set.pieces.push(p);
    return p;
  }

  private buildGate(set: SetDef): void {
    this.nexus = this.piece(set, new MegaGate('prologue-nexus', set.anchor.clone(), { radius: 12_000, state: 'dormant' }));
    this.nexus.awake = 1;
    this.nexusSheet = new LightSheet('#bff4ff', '#2f7cff');
    this.nexusSheet.mesh.scale.setScalar(12_000 * 0.586 * 0.985);
    this.nexusSheet.mesh.position.copy(set.anchor).add(_v.set(0, 0, 40));
    set.group.add(this.nexusSheet.mesh);
    this.shards = this.piece(set, new Wreckage('prologue-shards', set.anchor.clone().add(new Vector3(0, -500, 2500)), { radius: 7000, count: 900, hulks: 3, hulk: 'cvs07-hesperus-dawn', tint: '#e8e0cc' }));
    const kinds = ['cvs07-hesperus-dawn', 'bb-indomitable', 'ffc-lantern-guard', 'cvs07-hesperus-dawn', 'bb-indomitable'];
    this.liners = kinds.map((k) => this.ship(set, k, 'concord', TIMETABLE));
    this.gateDim = withLight(LIGHT_PRESETS.meridian, { keyIntensity: 0.55, rimIntensity: 0.35, keyColor: new Color('#cdd8ff') });
    console.info(`[prologue] liner lengths: ${this.liners.map((s) => `${s.model.blueprint.id}=${s.model.length.toFixed(0)}m`).join(' ')}`);
  }

  private buildGraveyard(set: SetDef): void {
    const a = set.anchor;
    this.piece(set, new Derelict('prologue-derelict', a.clone(), { length: 1600, tumble: 0.4 }));
    this.piece(set, new Wreckage('prologue-graveyard', a.clone().add(new Vector3(-1600, -350, 1800)), { radius: 2600, count: 700, hulks: 3, hulk: 'ffc-lantern-guard' }));
    this.piece(set, new Beacon('prologue-beacon', a.clone().add(new Vector3(-1100, 250, 1900)), { label: 'TIMETABLE BEACON', color: '#ffd23a' }));
    const dead = new LanternGate(420);
    dead.setGlow(0);
    dead.group.scale.setScalar(5);
    dead.group.position.copy(a).add(_v.set(5500, 1600, -8000));
    dead.group.rotation.set(0.1, -0.45, 0.2);
    set.group.add(dead.group);
    this.warden = this.ship(set, 'vf27-kestrel', 'concord', LIVERY_PRESETS.find((p) => p.name === 'ENGINE-WARDEN')?.livery);
  }

  private buildLantern(set: SetDef): void {
    this.lantern = new LanternGate(420);
    this.lantern.setGlow(0);
    this.lantern.group.scale.setScalar(4.5);
    this.lantern.group.position.copy(set.anchor);
    set.group.add(this.lantern.group);
    this.ebon = new LightSheet('#c58bff', '#4a1f9a');
    this.ebon.mesh.scale.setScalar(420 * 0.9 * 4.5);
    this.ebon.mesh.position.copy(set.anchor).add(_v.set(0, 0, 12));
    set.group.add(this.ebon.mesh);
    for (let i = 0; i < 3; i++) this.titleWing.push(this.ship(set, 'vf27-kestrel', 'concord'));
    this.ebonLight = withLight(set.light, { rimColor: new Color('#b56bff'), rimIntensity: 1.25, shadowTint: new Color('#2a1a4a') });
  }

  private buildTreaty(set: SetDef): void {
    const home = (s: ShipEntity, x: number, y: number, z: number, fx: number, fz: number) => {
      this.treatyHome.set(s, { pos: new Vector3(x, y, z).multiplyScalar(KM).add(set.anchor), fwd: new Vector3(fx, 0, fz).normalize() });
    };
    this.indomitable = this.ship(set, 'bb-indomitable', 'concord');
    this.dawn = this.ship(set, 'cvs07-hesperus-dawn', 'concord');
    this.guardA = this.ship(set, 'ffc-lantern-guard', 'concord');
    this.guardB = this.ship(set, 'ffc-lantern-guard', 'concord');
    this.cathedral = this.ship(set, 'choir-cathedral', 'choir');
    this.vesperA = this.ship(set, 'choir-vesper', 'choir');
    this.vesperB = this.ship(set, 'choir-vesper', 'choir');
    this.guardA.plotArmour = false;
    home(this.indomitable, -3.2, 0, 0, 1, -0.35);
    home(this.dawn, -4.5, 0.65, -2.6, 1, -0.2);
    home(this.guardA, -2.6, -0.5, 2.3, 1, -0.4);
    home(this.guardB, -3.5, 0.9, -5.0, 1, 0);
    home(this.cathedral, 3.4, 0.35, -0.8, -1, 0.3);
    home(this.vesperA, 2.7, -0.6, 2.2, -1, 0.1);
    home(this.vesperB, 3.2, 1.0, -3.9, -1, 0.2);
    console.info(`[prologue] treaty lengths: ${[...this.treatyHome.keys()].map((s) => `${s.model.blueprint.id}=${s.model.length.toFixed(0)}m`).join(' ')}`);
  }

  private buildLaunch(set: SetDef): void {
    this.carrier = this.ship(set, 'cvs07-hesperus-dawn', 'concord');
    this.pose(this.carrier, set.anchor, _z);
    for (let i = 0; i < 6; i++) this.kestrels.push(this.ship(set, 'vf27-kestrel', 'concord'));
    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(set.anchor).add(_v.set(46_000, -30_000, 380_000));
    planet.group.rotation.set(0.1, 0.4, 0.28);
    set.group.add(planet.group);
    this.farLantern = new LanternGate(420);
    this.farLantern.setGlow(0);
    this.farLantern.group.scale.setScalar(4);
    this.farLantern.group.position.copy(set.anchor).add(_v.set(-2500, 1200, 42_000));
    set.group.add(this.farLantern.group);
    this.farSheet = new LightSheet('#bff4ff', '#2f7cff');
    this.farSheet.mesh.scale.setScalar(420 * 0.9 * 4);
    this.farSheet.mesh.position.copy(this.farLantern.group.position);
    set.group.add(this.farSheet.mesh);
  }

  private buildNull(set: SetDef): void {
    this.piece(set, new Monolith('prologue-anchor', set.anchor.clone(), { radius: 1_600_000, spin: 0.0006 }));
    this.nullGate = new LanternGate(420);
    this.nullGate.setGlow(0);
    this.nullGate.group.scale.setScalar(4);
    this.nullGate.group.position.copy(set.anchor).add(_v.set(0, 0, 5_000 * KM));
    this.nullGate.group.rotation.set(0, 0, 0.3);
    set.group.add(this.nullGate.group);
    this.nullSheet = new LightSheet('#c58bff', '#3a1470');
    this.nullSheet.mesh.scale.setScalar(420 * 0.9 * 4);
    this.nullSheet.mesh.position.copy(this.nullGate.group.position).add(_v.set(0, 0, 10));
    set.group.add(this.nullSheet.mesh);
  }

  // ── CinemaStage ────────────────────────────────────────────────────

  anchor(set: string): Vector3 {
    return this.sets.get(set as SetId)?.anchor ?? BASE;
  }

  enter(shot: Shot): void {
    const set = this.sets.get(shot.set as SetId) ?? null;
    this.live = set;
    for (const s of this.sets.values()) s.group.visible = s === set;
    const sky = shot.id === 'title' ? 'meridian' : (set?.sky ?? null);
    for (const [k, b] of this.skies) b.group.visible = k === sky;
    this.glint.sprite.visible = shot.set === 'void';
    this.flags.clear();
    this.applyLight(set?.light ?? LIGHT_PRESETS.meridian);
    // Every shot starts clean: no beams or bolts in flight; the doomed picket lives again (loops, seeks).
    this.clearWeapons();
    this.guardA.alive = true;
    this.guardA.model.root.visible = true;
  }

  private applyLight(l: LightPreset): void {
    if (this.liveLight === l) return;
    this.liveLight = l;
    LightRig.apply(l);
  }

  animate(shot: Shot, local: number, _dt: number, seeking: boolean): void {
    const set = this.live;
    if (!set) return;
    const t = (this.clockOffset.get(shot.id) ?? 0) + local;
    this.setClock = t;
    switch (set.id) {
      case 'void':
        return this.animateVoid(local, shot.dur);
      case 'gate':
        return this.animateGate(set, t);
      case 'graveyard':
        return this.animateGraveyard(set, t);
      case 'lantern':
        return this.animateLantern(set, shot, local);
      case 'treaty':
        return this.animateTreaty(t);
      case 'launch':
        return this.animateLaunch(set, local);
      case 'null':
        return this.animateNull(shot, local, seeking);
    }
  }

  private pose(s: ShipEntity, pos: Vector3, fwd: Vector3, roll = 0, speed = 0): void {
    const f = s.flight;
    f.position.copy(pos);
    faceAlong(f.orientation, fwd);
    if (roll) f.orientation.multiply(_q.setFromAxisAngle(_z, roll));
    f.velocity.copy(fwd).normalize().multiplyScalar(speed);
    s.model.root.position.copy(pos);
    s.model.root.quaternion.copy(f.orientation);
  }

  private animateVoid(local: number, dur: number): void {
    // One star; it swells as the cut to the golden age approaches.
    const swell = smooth(dur - 0.9, dur, local);
    const tw = 1 + 0.12 * Math.sin(local * 5.3) + 0.06 * Math.sin(local * 13.1);
    this.glint.place(_v.set(0.075, 0.042, -1), (0.022 + 0.05 * swell) * tw, (0.7 + 2.5 * swell) * smooth(0.2, 1.6, local));
  }

  /** The Shattering happens at this set-clock time (gates-sang 6.5 s + 1.8 s). */
  private static readonly SHATTER = 8.3;

  private animateGate(set: SetDef, t: number): void {
    const S = PrologueStage.SHATTER;
    const after = t >= S;
    // The bell: lights stutter in the 1.5 s before the break.
    const bell = smooth(S - 1.95, S - 1.6, t) * (after ? 0 : 1);
    const stutter = bell > 0 ? (hash(Math.floor(t * 18)) > 0.1 ? 1 : 0.15) : 1;
    this.nexus.awake = after ? Math.max(0, 1 - (t - S) * 3) : 1;
    this.nexus.lightGain = after ? (t - S < 0.6 && hash(Math.floor(t * 24)) > 0.3 ? 0.4 : 0.04) : stutter;
    this.nexusSheet.update(t, after ? 0 : 1, after ? 0 : (0.62 + 0.4 * bell) * stutter);
    this.shards.group.visible = after;
    this.applyLight(after ? this.gateDim : set.light);
    for (let i = 0; i < this.liners.length; i++) {
      const s = this.liners[i];
      const p = this.linerPath[i];
      const v = after ? 0.45 * S + 0.08 * (t - S) : 0.45 * t; // the survivors coast, dead
      _w.set(p.x, p.y, p.z0 - v).multiplyScalar(KM).add(set.anchor);
      const gone = after && i < 2; // in the throat when it broke: never seen again
      s.model.root.visible = !gone;
      s.alive = !gone;
      this.pose(s, _w, _v.set(0, 0, -1), after ? (t - S) * 0.02 * (i % 2 ? 1 : -1) : 0, 450);
      s.model.setThrottle(after ? 0 : 0.9);
    }
  }

  private animateGraveyard(set: SetDef, t: number): void {
    _w.set(-0.52, 0.16, 1.5).multiplyScalar(KM).add(set.anchor).add(_v.set(0, 0, -130 * t));
    this.pose(this.warden, _w, _v.set(0.04, 0, -1), Math.sin(t * 0.6) * 0.12, 130);
    this.warden.model.setThrottle(0.55);
  }

  private animateLantern(set: SetDef, shot: Shot, local: number): void {
    const title = shot.id === 'title';
    const form = title ? 1 : smooth(2.5, 4.3, local);
    this.ebon.update(local, form, title ? 1.0 : 1.25 + 0.6 * (1 - smooth(3.2, 4.4, local)) * form);
    this.lantern.setGlow(form > 0.99 ? 0.25 : 0);
    this.applyLight(form > 0.2 ? this.ebonLight : set.light);
    for (let i = 0; i < this.titleWing.length; i++) {
      const s = this.titleWing[i];
      s.model.root.visible = title;
      if (!title) continue;
      const off = [
        [0, 0, 0],
        [-42, -9, -34],
        [46, -6, -40],
      ][i];
      // Three Kestrels running for the lit ring, 1–3 km ahead of the lens.
      _w.set(0.3, -0.19, 9.7).multiplyScalar(KM).add(set.anchor);
      const dir = _dir.set(0.02, 0.24, 0).multiplyScalar(KM).add(set.anchor).sub(_w).normalize();
      _w.addScaledVector(dir, 300 * local).add(_v.set(off[0], off[1], off[2]));
      this.pose(s, _w, dir, Math.sin(local * 0.7 + i) * 0.1, 300);
      s.model.setThrottle(1.3);
    }
  }

  private animateTreaty(t: number): void {
    for (const [s, h] of this.treatyHome) {
      if (s === this.guardA && !s.alive) continue;
      _w.copy(h.pos).addScaledVector(h.fwd, 15 * t).add(_v.set(0, Math.sin(t * 0.4 + s.id) * 8, 0));
      this.pose(s, _w, h.fwd, 0, 15);
      s.model.setThrottle(0.35);
    }
  }

  /** Kestrel launch run: catapult stroke then burner. */
  private static stroke(tau: number): number {
    if (tau <= 0) return 0;
    if (tau < 1.1) return 0.5 * 240 * tau * tau;
    const t2 = tau - 1.1;
    return 145.2 + 264 * t2 + 0.5 * 140 * t2 * t2;
  }

  private animateLaunch(set: SetDef, local: number): void {
    const K = this.kestrels;
    this.farSheet.update(local, 1, 1);
    this.farLantern.setGlow(0.25);
    if (local < 2.2) {
      // Deck: two cat shots, V1 then V2.
      const cats = ['catapult', 'catapult.L'];
      for (let i = 0; i < K.length; i++) {
        const s = K[i];
        const on = i < 2;
        s.model.root.visible = on;
        if (!on) continue;
        this.weapons.socketPosition(this.carrier, this.carrier.model.sockets.has(cats[i]) ? cats[i] : 'catapult', _w);
        _w.y += 2.6;
        const d = PrologueStage.stroke(local - (i === 0 ? 0.35 : 1.0));
        _w.z += d;
        this.pose(s, _w, _z, 0, 0);
        s.model.setThrottle(d > 0 ? 1.55 : 0.4);
        s.model.setWingSweep(Math.min(1, d / 400));
      }
      return;
    }
    const flyby = local < 4.4;
    // Lead path: past a planted camera (flyby), then a chase toward the far Lantern.
    const dir = flyby ? _v.set(0.25, 0.02, 1).normalize() : _v.set(-0.05, 0.02, 1).normalize();
    const lead = _w.set(0, 1.2, 3.0).multiplyScalar(KM).add(set.anchor);
    if (flyby) lead.addScaledVector(dir, 400 * (local - 3.3));
    else lead.set(0.2, 1.6, 8).multiplyScalar(KM).add(set.anchor).addScaledVector(dir, 450 * (local - 4.4));
    const leadPos = lead.clone();
    const fwd = dir.clone();
    const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize().negate();
    const upv = new Vector3().crossVectors(right, fwd).negate().normalize();
    const slots = flyby
      ? [0, 1, 2, 3, 4, 5].map((i) => [i * 24, -i * 4, -i * 28])
      : [
          [0, 0, 0],
          [-28, -3, -26],
          [28, -3, -26],
          [-56, -6, -52],
          [56, -6, -52],
          [0, -9, -70],
        ];
    for (let i = 0; i < K.length; i++) {
      const s = K[i];
      s.model.root.visible = true;
      const o = slots[i];
      const p = leadPos.clone().addScaledVector(right, -o[0]).addScaledVector(upv, o[1]).addScaledVector(fwd, o[2]);
      p.addScaledVector(upv, Math.sin(local * 1.7 + i * 1.3) * 1.5);
      this.pose(s, p, fwd, (flyby ? -0.35 : 0) + Math.sin(local * 0.9 + i) * 0.06, flyby ? 400 : 450);
      s.model.setThrottle(1.55);
      s.model.setWingSweep(1);
    }
  }

  private animateNull(shot: Shot, local: number, _seeking: boolean): void {
    if (local > 3.3) this.flags.add('oracle-broadcast');
    let hum = 0;
    for (const at of SIGNAL_PULSES) {
      const d = local - at;
      if (d >= 0) hum = Math.max(hum, Math.exp(-d * 3.5));
    }
    this.nullSheet.update(local, 1, 0.12 + 0.55 * hum);
    this.nullGate.setGlow(0.1 + 0.4 * hum);
    void shot;
  }

  rig(name: string, pos: Vector3, quat: Quaternion): boolean {
    const f = (s: ShipEntity) => {
      pos.copy(s.flight.position);
      quat.copy(s.flight.orientation);
      return true;
    };
    switch (name) {
      case 'liner0':
        return f(this.liners[0]);
      case 'warden':
        return f(this.warden);
      case 'lead':
        return f(this.kestrels[0]);
      case 'deck':
        this.weapons.socketPosition(this.carrier, 'catapult', pos);
        quat.copy(this.carrier.flight.orientation);
        return true;
    }
    return false;
  }

  event(id: string, _shot: Shot, seeking: boolean): void {
    const W = this.weapons;
    switch (id) {
      case 'shatter': {
        if (seeking) return;
        const set = this.sets.get('gate')!;
        const a = set.anchor;
        const zero = new Vector3();
        this.fx.explosion(_w.copy(a).add(_v.set(0, 0, 200)), zero, 5000, PAL.PLASMA);
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2 + 0.2;
          _w.set(Math.cos(ang) * 7000, Math.sin(ang) * 7000, 100).add(a);
          this.fx.explosion(_w, zero, 900 + 300 * hash(i), i % 2 ? PAL.PLASMA : PAL.WARM);
        }
        for (let i = 0; i < 2; i++) {
          const s = this.liners[i];
          this.fx.explosion(s.flight.position, zero, 700, PAL.WARM);
          this.fx.debris(s.flight.position, zero, 260, 30);
        }
        return;
      }
      case 'vesper-lance': {
        const b = W.fireBeam(this.vesperA, 'lance', 9000, 18, 1.5, 0);
        b.aimTarget = this.guardB;
        return;
      }
      case 'cathedral-lance': {
        const b = W.fireBeam(this.cathedral, 'lance', 9000, 42, 2.6, 0);
        b.aimTarget = this.indomitable;
        return;
      }
      case 'broadside': {
        // Directorate particle cannons answer from every turret; flak rakes the Cathedral's shield.
        const turrets = [...this.indomitable.model.sockets.entries()].filter(([, o]) => o.userData.kind === 'turret').map(([k]) => k);
        turrets.slice(0, 4).forEach((k) => {
          const b = W.fireBeam(this.indomitable, k, 9000, 12, 0.9, 0);
          b.aimTarget = this.cathedral;
        });
        const c = this.cathedral.flight.position;
        for (let i = 0; i < 14; i++) {
          W.socketPosition(this.indomitable, turrets[i % Math.max(1, turrets.length)] ?? 'hull', _w);
          _v.subVectors(c, _w).normalize().add(new Vector3(hash(i) * 0.03, hash(i + 7) * 0.03, hash(i + 13) * 0.03)).normalize().multiplyScalar(2600);
          W.spawnBolt(_w, _v, 3.2, 1, this.indomitable);
        }
        return;
      }
      case 'kill-lance': {
        const b = W.fireBeam(this.vesperB, 'lance', 9000, 22, 1.0, 0);
        b.aimTarget = this.guardA;
        return;
      }
      case 'guard-dies': {
        const g = this.guardA;
        g.alive = false;
        g.model.root.visible = false;
        if (seeking) return;
        this.fx.explosion(g.flight.position, g.flight.velocity, 220, PAL.WARM);
        this.fx.debris(g.flight.position, g.flight.velocity, 90, 24);
        _w.copy(g.flight.position).add(_v.set(40, 20, -60));
        this.fx.explosion(_w, g.flight.velocity, 130, PAL.WARM);
        return;
      }
    }
  }

  settle(_shot: Shot, _local: number, dt: number, seeking: boolean): void {
    const set = this.live;
    const f = this.frame;
    f.dt = dt;
    f.time = this.setClock;
    if (set) for (const p of set.pieces) if (p.group.visible) p.update(f);
    if (set?.id === 'treaty') this.weapons.step(dt);
    for (const b of this.skies.values()) if (b.group.visible) b.follow(this.camera);
    void seeking;
    void this.scene;
  }

  /** Beams/bolts belong to the treaty set only; clear them when leaving it. */
  clearWeapons(): void {
    for (const b of this.weapons.beams) b.active = false;
    this.weapons.life.fill(0);
  }

  dispose(): void {
    for (const s of this.sets.values()) {
      for (const p of s.pieces) p.dispose();
      disposeTree(s.group);
      s.group.removeFromParent();
    }
    for (const b of this.skies.values()) {
      disposeTree(b.group);
      this.scene.remove(b.group);
    }
    disposeTree(this.glint.sprite);
    this.scene.remove(this.glint.sprite);
  }
}
