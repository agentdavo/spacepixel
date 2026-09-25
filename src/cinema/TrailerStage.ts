import { Color, Group, Matrix4, Quaternion, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import { disposeTree } from '@/core/dispose';
import { faceAlong, type Fleet, type ShipEntity } from '@/sim/Fleet';
import type { Weapons } from '@/sim/Weapons';
import type { Missiles } from '@/sim/Missiles';
import { CinemaGunnery } from './gunnery';
import { subsystemPosition, toUniverse } from '@/sim/Combat';
import { GUNS, MISSILES } from '@/sim/Loadouts';
import type { Subsystem } from '@/sim/Damage';
import { LightRig, LIGHT_PRESETS, type LightPreset } from '@/render/LightRig';
import { postFx } from '@/render/post/PostFx';
import type { Particles } from '@/fx/Particles';
import { PAL } from '@/fx/kinds';
import { generateUniverse } from '@/universe/generate';
import type { StarSystem } from '@/universe/Universe';
import { Backdrop, BACKDROPS, type BackdropPreset } from '@/world/Backdrop';
import { Planet, PLANETS } from '@/world/Planet';
import { LanternGate } from '@/world/LanternGate';
import { StarSystemView, type BodyInstance } from '@/world/StarSystemView';
import { BAY_INSIDE, type StationView } from '@/world/Station';
import { Monolith, type SetPiece, type SetPieceFrame } from '@/world/setpieces';
import type { CinemaStage } from './Cinema';
import type { Shot } from './timeline';
import { LightSheet } from './props';
import { TRAILER_PULSES, UI_SHOTS } from './trailer';
import { TrailerUi } from './TrailerUi';
import { LONG_DARK_SKY } from './PrologueStage';

/**
 * The trailer's sets — the prologue's machinery (sets thousands of km apart,
 * rigs, props posed as pure functions of the shot clock) plus live combat:
 * scripted fighters (kinematic paths, guns on a fire flag, scripted kills)
 * drive the real Weapons / Missiles sims, so bolts, beams,
 * shield ripples, missile spirals, section blasts and burning subsystems
 * are the game's own. The Reach set is the real Meridian system
 * (StarSystemView: Castellan and its rings, stations with hollow bays,
 * Lanterns) with kinematic lane traffic.
 *
 * Sims step once per frame with the frame's dt from the shot's start (a seek
 * replays them from the cut), so a shot rendered in one go is deterministic.
 */
type SetId = 'null' | 'lantern' | 'launch' | 'fight' | 'battle' | 'reach' | 'lineup' | 'broadside';

const BASE = new Vector3(2_400_000, 150_000, -1_100_000);
const KM = 1000;

interface SetDef {
  id: SetId;
  anchor: Vector3;
  group: Group;
  sky: string;
  light: LightPreset;
  pieces: SetPiece[];
  ships: ShipEntity[];
}

const _v = new Vector3();
const _w = new Vector3();
const _u = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
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

/** A local frame (position + orientation) that set-relative choreography is written in. */
class Frame {
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  /** Frame-local metres → universe. */
  at(x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x, y, z).applyQuaternion(this.quat).add(this.pos);
  }
  /** Frame-local direction → universe. */
  dir(x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x, y, z).applyQuaternion(this.quat).normalize();
  }
  static basis(pos: Vector3, x: Vector3, y: Vector3, z: Vector3): Frame {
    const f = new Frame();
    f.pos.copy(pos);
    f.quat.setFromRotationMatrix(_m.makeBasis(x, y, z));
    return f;
  }
}

export class TrailerStage implements CinemaStage {
  private readonly sets = new Map<SetId, SetDef>();
  private readonly skies = new Map<string, Backdrop>();
  private readonly flags = new Set<string>();
  private readonly frame: SetPieceFrame;
  private readonly ui: TrailerUi;
  private live: SetDef | null = null;
  private liveLight: LightPreset | null = null;
  private setClock = 0;
  /** Who is firing in the live shot ('k', 'c', 'k1', 'bk', 'measure'). */
  private readonly firing = new Set<string>();
  private simT = 0;
  private uiLocal = 0;

  // null
  private nullGate!: LanternGate;
  private nullSheet!: LightSheet;
  // lantern
  private lantern!: LanternGate;
  private ebon!: LightSheet;
  private ebonLight!: LightPreset;
  private titleWing: ShipEntity[] = [];
  // launch
  private carrier!: ShipEntity;
  private launchers: ShipEntity[] = [];
  private farLantern!: LanternGate;
  private farSheet!: LightSheet;
  // fight
  private K: ShipEntity[] = [];
  private C: ShipEntity[] = [];
  // battle
  private cathedral!: ShipEntity;
  private indomitable!: ShipEntity;
  private BK: ShipEntity[] = [];
  private measure: ShipEntity[] = [];
  private collapsed = false;
  // reach
  private view!: StarSystemView;
  private giant!: BodyInstance;
  private giantFrame!: Frame;
  private gateFrame!: Frame;
  private gateSheet!: LightSheet;
  private station!: StationView;
  private bayFrame!: Frame;
  private rk: ShipEntity[] = [];
  private haulers: ShipEntity[] = [];
  private liner!: ShipEntity;
  // lineup
  private row: ShipEntity[] = [];
  // broadside
  private valiant!: ShipEntity;
  private canticle!: ShipEntity;
  private valiantTurrets: string[] = [];
  private canticleTurrets: string[] = [];
  /** One authority for each capital's visible turret pose and projectile origin/direction. */
  private readonly gunnery = new CinemaGunnery();

  constructor(
    private readonly scene: Scene,
    world: WorldSpace,
    private readonly fleet: Fleet,
    private readonly weapons: Weapons,
    private readonly missiles: Missiles,
    private readonly fx: Particles,
    private readonly camera: PerspectiveCamera,
    uiRoot: HTMLElement,
  ) {
    const u = generateUniverse(1994);
    const sys = (id: string) => u.systems.get(id)!;
    const meridian: StarSystem = sys('meridian');
    const skies: Record<string, BackdropPreset> = {
      meridian: BACKDROPS.meridian,
      hesper: BACKDROPS.hesper,
      tessaly: sys('tessaly').backdrop,
      null: sys('null').backdrop,
      dark: LONG_DARK_SKY,
    };
    for (const [k, p] of Object.entries(skies)) {
      const b = new Backdrop(p);
      b.group.visible = false;
      this.skies.set(k, b);
      scene.add(b.group);
    }

    const mk = (id: SetId, i: number, sky: string, light: LightPreset): SetDef => {
      const s: SetDef = { id, anchor: BASE.clone().add(new Vector3(i * 6_000 * KM, 0, 0)), group: new Group(), sky, light, pieces: [], ships: [] };
      s.group.name = `trailer:${id}`;
      s.group.visible = false;
      world.root.add(s.group);
      this.sets.set(id, s);
      return s;
    };
    this.buildReach(mk('reach', 0, 'reach', meridian.light), meridian, [...u.systems.values()]);
    this.buildNull(mk('null', 1, 'null', withLight(sys('null').light, { keyIntensity: 0.55 })));
    this.buildLantern(mk('lantern', 2, 'dark', sys('anchorage').light));
    this.buildLaunch(mk('launch', 3, 'meridian', LIGHT_PRESETS.meridian));
    this.buildFight(mk('fight', 4, 'meridian', LIGHT_PRESETS.meridian));
    this.buildBattle(mk('battle', 5, 'tessaly', sys('tessaly').light));
    this.buildLineup(mk('lineup', 6, 'meridian', LIGHT_PRESETS.meridian));
    this.buildBroadside(mk('broadside', 7, 'hesper', LIGHT_PRESETS.hesper));

    this.ui = new TrailerUi(uiRoot, this.station.site, meridian.name, [...u.systems.values()].flatMap((s) => s.stations));

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

  private ship(set: SetDef, blueprint: string, faction: 'concord' | 'choir' | 'rustwake'): ShipEntity {
    const s = this.fleet.spawn(blueprint, faction, set.anchor, _z, { name: `${set.id}:${blueprint}`, plotArmour: true });
    s.flight.velocity.set(0, 0, 0);
    set.group.add(s.model.root);
    set.ships.push(s);
    return s;
  }

  private piece<T extends SetPiece>(set: SetDef, p: T): T {
    set.group.add(p.group);
    set.pieces.push(p);
    return p;
  }

  private buildReach(set: SetDef, system: StarSystem, _all: StarSystem[]): void {
    const view = new StarSystemView(system, this.scene, set.group);
    this.view = view;
    view.backdrop.group.visible = false;
    this.skies.set('reach', view.backdrop);
    // Castellan: the ringed giant, in a frame looking at its terminator from the ring plane.
    this.giant = view.bodies.find((b) => b.site.preset.ring) ?? view.bodies[0];
    const ring = view.ringFrame(this.giant);
    const n = ring ? ring.normal.clone() : new Vector3(0, 1, 0);
    const L = system.light.keyDirection.clone().normalize();
    const perp = new Vector3().crossVectors(n, L).normalize();
    const zdir = L.clone().multiplyScalar(0.45).addScaledVector(perp, 0.9);
    zdir.addScaledVector(n, -zdir.dot(n)).normalize();
    const xdir = new Vector3().crossVectors(n, zdir).normalize();
    this.giantFrame = Frame.basis(this.giant.position, xdir, n, zdir);
    // The first Lantern: +Z out of its face.
    const g = view.gates[0];
    const gz = g.link.normal.clone().normalize();
    const gx = new Vector3(0, 1, 0).cross(gz).normalize();
    this.gateFrame = Frame.basis(g.center, gx, new Vector3().crossVectors(gz, gx), gz);
    this.gateSheet = new LightSheet('#bff4ff', '#2f7cff');
    this.gateSheet.mesh.scale.setScalar(420 * 0.9);
    this.gateSheet.mesh.position.copy(g.center).addScaledVector(gz, 3);
    this.gateSheet.mesh.quaternion.copy(this.gateFrame.quat);
    set.group.add(this.gateSheet.mesh);
    // The orbital port over the giant (hollow bay, landing tether), else the first station.
    this.station = view.stations.find((s) => s.site.kind === 'orbital') ?? view.stations[0];
    this.bayFrame = new Frame();
    this.bayFrame.pos.copy(this.station.bay);
    this.bayFrame.quat.copy(this.station.quaternion);
    for (let i = 0; i < 3; i++) this.rk.push(this.ship(set, 'vf27-kestrel', 'concord'));
    for (const bp of ['civ-longhaul', 'civ-umbra', 'civ-longhaul', 'civ-swallow']) this.haulers.push(this.ship(set, bp, 'concord'));
    for (const h of this.haulers) h.team = 'neutral';
    this.liner = this.ship(set, 'civ-meridian-star', 'concord');
    this.liner.team = 'neutral';
    console.info(`[trailer] reach: ${system.name} · giant ${this.giant.name} r=${(this.giant.radius / 1000).toFixed(0)} km · station ${this.station.site.name} (${this.station.site.kind}) · gate → ${g.link.to}`);
  }

  private buildNull(set: SetDef): void {
    this.piece(set, new Monolith('trailer-anchor', set.anchor.clone(), { radius: 1_600_000, spin: 0.0006 }));
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

  private buildLaunch(set: SetDef): void {
    this.carrier = this.ship(set, 'cvs07-hesperus-dawn', 'concord');
    this.pose(this.carrier, set.anchor, _z);
    for (let i = 0; i < 6; i++) this.launchers.push(this.ship(set, 'vf27-kestrel', 'concord'));
    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(set.anchor).add(_v.set(46_000, -30_000, 380_000));
    planet.group.rotation.set(0.1, 0.4, 0.28);
    set.group.add(planet.group);
    this.farLantern = new LanternGate(420);
    this.farLantern.setGlow(0.25);
    this.farLantern.group.scale.setScalar(4);
    this.farLantern.group.position.copy(set.anchor).add(_v.set(-2500, 1200, 42_000));
    set.group.add(this.farLantern.group);
    this.farSheet = new LightSheet('#bff4ff', '#2f7cff');
    this.farSheet.mesh.scale.setScalar(420 * 0.9 * 4);
    this.farSheet.mesh.position.copy(this.farLantern.group.position);
    set.group.add(this.farSheet.mesh);
  }

  private buildFight(set: SetDef): void {
    for (let i = 0; i < 3; i++) this.K.push(this.ship(set, 'vf27-kestrel', 'concord'));
    for (let i = 0; i < 4; i++) this.C.push(this.ship(set, 'choir-cantor', 'choir'));
    this.K.forEach((k, i) => (k.combat.gun = i === 1 ? 1 : 0)); // Jackpot flies the autocannon
    // A giant and a far Cathedral for scale.
    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(set.anchor).add(_v.set(-60_000, -20_000, 330_000));
    planet.group.rotation.set(0.25, 0.9, 0.35);
    set.group.add(planet.group);
    const cath = this.ship(set, 'choir-cathedral', 'choir');
    this.pose(cath, _w.set(-6000, 900, 14_000).add(set.anchor), _v.set(1, 0, 0.3).normalize());
  }

  private buildBattle(set: SetDef): void {
    const I = this.ship(set, 'bb-indomitable', 'concord');
    const C = this.ship(set, 'choir-cathedral', 'choir');
    this.indomitable = I;
    this.cathedral = C;
    this.pose(I, set.anchor, _z);
    this.pose(C, _w.set(3200, 150, 900).add(set.anchor), _z);
    for (let i = 0; i < 4; i++) this.BK.push(this.ship(set, 'vf27-kestrel', 'concord'));
    this.BK.forEach((k, i) => (k.combat.gun = i % 2));
    for (let i = 0; i < 5; i++) this.measure.push(this.ship(set, 'choir-cantor', 'choir'));
    this.measure.forEach((s, i) => (s.combat.gun = i === 2 ? 1 : 0));
    // The Cathedral is already mid-battle: batteries, a spire lance, a hangar and an engine gone; plating scarred.
    const st = C.combat.dmg;
    st.facings.fill(0);
    const wreck = (re: RegExp, n: number, frac = 1) => {
      let k = 0;
      for (const s of st.subsystems) {
        if (k >= n || !re.test(s.id)) continue;
        k++;
        this.fleet.hit(C, (s.hpMax / 1.6) * frac + 1, 'explosive', subsystemPosition(C, s, _v), null, null);
      }
    };
    wreck(/battery-(2|3)$/, 2);
    wreck(/^spire-2$/, 1);
    wreck(/^hangar$/, 1);
    wreck(/^engine-0$/, 1);
    wreck(/battery-(6|7)$/, 2, 0.55);
    for (let i = 0; i < 18; i++) {
      const z = st.cz + (i / 17 - 0.5) * st.halfL * 1.6;
      const x = st.cx + (i % 2 ? 1 : -1) * st.halfW * 0.5;
      toUniverse(C, x, st.cy + st.halfH * 0.3, z, _v);
      this.fleet.hit(C, C.hullMax * 0.004 * (1 + (i % 3)), 'kinetic', _v, null, null);
    }
    st.facings.fill(st.facingMax * 0.7);
    st.facings[2] = 0;
    st.down = 0b0100;
    st.cooldown[2] = 1e3; // stays down: no regen, no charge shunted back in (Damage.ts)
    console.info(`[trailer] battle: indomitable ${I.model.length.toFixed(0)} m (half ${st.halfL.toFixed(0)}), cathedral ${C.model.length.toFixed(0)} m, subsystems ${st.subsystems.map((s) => s.id).join(',')}`);
  }

  private buildLineup(set: SetDef): void {
    const ids = ['vf27-kestrel', 'vf40-gauntlet', 'gs12-bulwark', 'cr5-resolute', 'ffl3-valiant'];
    const xs = [0, 30, 80, 190, 420];
    const fwd = new Vector3(0.8, 0, 0.6).normalize();
    ids.forEach((id, i) => {
      const s = this.ship(set, id, 'concord');
      this.row.push(s);
      this.pose(s, _w.set(xs[i], 0, 0).add(set.anchor), fwd);
      s.model.setThrottle(0.3);
    });
    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(set.anchor).add(_v.set(-40_000, -22_000, -230_000));
    planet.group.rotation.set(0.15, 0.5, 0.3);
    set.group.add(planet.group);
    console.info(`[trailer] lineup lengths: ${this.row.map((s) => `${s.model.blueprint.id}=${s.model.length.toFixed(0)}m`).join(' ')}`);
  }

  private buildBroadside(set: SetDef): void {
    this.valiant = this.ship(set, 'ffl3-valiant', 'concord');
    this.canticle = this.ship(set, 'choir-canticle', 'choir');
    this.pose(this.valiant, set.anchor, _z);
    this.pose(this.canticle, _w.set(1300, -60, 700).add(set.anchor), _z);
    this.valiantTurrets = [...this.valiant.model.sockets.entries()].filter(([, o]) => o.userData.kind === 'turret').map(([k]) => k);
    this.canticleTurrets = [...this.canticle.model.sockets.entries()].filter(([, o]) => o.userData.kind === 'turret').map(([k]) => k);
    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(set.anchor).add(_v.set(120_000, -40_000, 300_000));
    planet.group.rotation.set(-0.2, 1.2, 0.2);
    set.group.add(planet.group);
    console.info(`[trailer] broadside: valiant ${this.valiant.model.length.toFixed(0)} m, ${this.valiantTurrets.length} turrets; canticle ${this.canticle.model.length.toFixed(0)} m`);
  }

  // ── CinemaStage ────────────────────────────────────────────────────

  anchor(set: string): Vector3 {
    return this.sets.get(set as SetId)?.anchor ?? BASE;
  }

  enter(shot: Shot): void {
    const set = this.sets.get(shot.set as SetId) ?? null;
    this.live = set;
    for (const s of this.sets.values()) s.group.visible = s === set;
    const sky = set?.sky ?? null;
    for (const [k, b] of this.skies) b.group.visible = k === sky;
    this.flags.clear();
    this.firing.clear();
    this.simT = 0;
    this.applyLight(set?.light ?? LIGHT_PRESETS.meridian);
    // Every shot starts clean: no bolts, beams or missiles in flight; everyone alive; nobody firing.
    this.clearWeapons();
    for (const s of set?.ships ?? []) {
      s.alive = true;
      s.model.root.visible = true;
      s.controls.fire = false;
      s.hull = s.hullMax;
    }
    if (set?.id === 'battle') {
      this.resetShields();
      this.cathedral.flight.orientation.identity();
      this.cathedral.model.root.quaternion.identity();
      if (shot.id === 'lance') {
        faceAlong(this.cathedral.flight.orientation, _v.subVectors(this.indomitable.flight.position, this.cathedral.flight.position));
        this.cathedral.model.root.quaternion.copy(this.cathedral.flight.orientation);
      }
    }
    this.ui.show(UI_SHOTS[shot.id] ?? null);
  }

  private applyLight(l: LightPreset): void {
    if (this.liveLight === l) return;
    this.liveLight = l;
    LightRig.apply(l);
  }

  animate(shot: Shot, local: number, dt: number, _seeking: boolean): void {
    // Non-combat sets do not step Weapons; never replay the last combat frame.
    this.weapons.events.length = 0;
    this.missiles.events.length = 0;
    const set = this.live;
    if (!set) return;
    this.frame.dt = dt;
    this.setClock = local;
    this.uiLocal = local;
    switch (set.id) {
      case 'null':
        return this.animateNull(local);
      case 'lantern':
        return this.animateLantern(set, shot, local);
      case 'launch':
        return this.animateLaunch(set, local);
      case 'fight':
        this.animateFight(set, shot, local);
        break;
      case 'battle':
        this.animateBattle(shot, local);
        break;
      case 'reach':
        return this.animateReach(shot, local, dt);
      case 'lineup':
        return this.animateLineup(local);
      case 'broadside':
        this.animateBroadside(local, dt);
        break;
    }
    if (dt > 0) this.stepSims(set, dt, _seeking);
  }

  /** Weapons (+ missiles, capital turrets) for the live combat set. */
  private stepSims(_set: SetDef, dt: number, seeking: boolean): void {
    this.simT += dt;
    this.weapons.step(dt);
    this.missiles.step(dt);
    // The missile circus: the first warhead to reach a Cantor finishes it.
    for (const e of this.missiles.events) {
      if (e.kind !== 'detonate' || !e.target || !this.C.includes(e.target) || !e.target.alive) continue;
      this.kill(e.target, seeking, 1.6);
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

  /** Pose a fighter and point its nose (guns) at `aim` (universe). */
  private fly(s: ShipEntity, pos: Vector3, aim: Vector3 | null, fwd: Vector3, roll: number, speed: number, throttle = 1.2): void {
    const dir = aim ? _u.subVectors(aim, pos) : _u.copy(fwd);
    if (dir.lengthSq() < 1e-6) dir.copy(fwd);
    this.pose(s, pos, dir, roll, speed);
    s.flight.velocity.copy(fwd).normalize().multiplyScalar(speed);
    s.model.setThrottle(throttle);
    s.model.setWingSweep(Math.min(1, Math.max(0, (speed - 140) / 320)));
  }

  private park(s: ShipEntity): void {
    s.model.root.visible = false;
    s.controls.fire = false;
    this.pose(s, _w.copy(this.live?.anchor ?? BASE).add(_v.set(0, -80_000, 0)), _z);
  }

  private kill(s: ShipEntity, seeking: boolean, scale = 1): void {
    if (!s.alive) return;
    s.alive = false;
    s.model.root.visible = false;
    s.controls.fire = false;
    if (seeking) return;
    this.fx.explosion(s.flight.position, s.flight.velocity, Math.max(10, s.radius * 1.6) * scale, s.faction === 'choir' ? PAL.MAGENTA : PAL.WARM);
    this.fx.debris(s.flight.position, s.flight.velocity, s.radius, 14);
  }

  // ── cold open / title sets (as the prologue) ───────────────────────

  private animateNull(local: number): void {
    let hum = 0;
    for (const at of TRAILER_PULSES) {
      const d = local - at;
      if (d >= 0) hum = Math.max(hum, Math.exp(-d * 3.5));
    }
    this.nullSheet.update(local, 1, 0.12 + 0.55 * hum);
    this.nullGate.setGlow(0.1 + 0.4 * hum);
  }

  private animateLantern(set: SetDef, shot: Shot, local: number): void {
    const lit = shot.id !== 'long-dark';
    const form = lit ? 1 : smooth(2.3, 3.8, local);
    this.ebon.update(local, form, lit ? 1.0 : 1.25 + 0.6 * (1 - smooth(3.0, 4.4, local)) * form);
    this.lantern.setGlow(form > 0.99 ? 0.25 : 0);
    this.applyLight(form > 0.2 ? this.ebonLight : set.light);
    for (let i = 0; i < this.titleWing.length; i++) {
      const s = this.titleWing[i];
      s.model.root.visible = shot.id === 'title';
      if (shot.id !== 'title') continue;
      const off = [
        [0, 0, 0],
        [-42, -9, -34],
        [46, -6, -40],
      ][i];
      _w.set(0.3, -0.19, 9.7).multiplyScalar(KM).add(set.anchor);
      const dir = _v.set(0.02, 0.24, 0).multiplyScalar(KM).add(set.anchor).sub(_w).normalize();
      _w.addScaledVector(dir, 300 * local).add(_u.set(off[0], off[1], off[2]));
      this.pose(s, _w, dir.clone(), Math.sin(local * 0.7 + i) * 0.1, 300);
      s.model.setThrottle(1.3);
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
    const K = this.launchers;
    this.farSheet.update(local, 1, 1);
    if (local < 2.2) {
      const cats = ['catapult', 'catapult.L'];
      for (let i = 0; i < K.length; i++) {
        const s = K[i];
        const on = i < 2;
        s.model.root.visible = on;
        if (!on) continue;
        this.weapons.socketPosition(this.carrier, this.carrier.model.sockets.has(cats[i]) ? cats[i] : 'catapult', _w);
        _w.y += 2.6;
        const d = TrailerStage.stroke(local - (i === 0 ? 0.35 : 1.0));
        _w.z += d;
        this.pose(s, _w, _z, 0, 0);
        s.model.setThrottle(d > 0 ? 1.55 : 0.4);
        s.model.setWingSweep(Math.min(1, d / 400));
      }
      return;
    }
    // Flyby: the flight streaks past a planted lens toward the far Lantern.
    const dir = _v.set(0.25, 0.02, 1).normalize();
    const lead = _w.set(0, 1.2, 3.0).multiplyScalar(KM).add(set.anchor).addScaledVector(dir, 400 * (local - 3.3));
    const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize().negate();
    const upv = new Vector3().crossVectors(right, dir).negate().normalize();
    for (let i = 0; i < K.length; i++) {
      const s = K[i];
      s.model.root.visible = true;
      const p = lead.clone().addScaledVector(right, -i * 24).addScaledVector(upv, -i * 4).addScaledVector(dir, -i * 28);
      p.addScaledVector(upv, Math.sin(local * 1.7 + i * 1.3) * 1.5);
      this.pose(s, p, dir, -0.35 + Math.sin(local * 0.9 + i) * 0.06, 400);
      s.model.setThrottle(1.55);
      s.model.setWingSweep(1);
    }
  }

  // ── FIGHT ──────────────────────────────────────────────────────────

  private animateFight(set: SetDef, shot: Shot, t: number): void {
    const A = set.anchor;
    const [k0, k1, k2] = this.K;
    const [c0, c1, c2, c3] = this.C;
    const at = (x: number, y: number, z: number) => new Vector3(x, y, z).add(A);
    const fk = this.firing.has('k');
    const fc = this.firing.has('c');
    for (const s of [...this.K, ...this.C]) s.controls.fire = false;
    switch (shot.id) {
      case 'fight-card':
      case 'merge': {
        const tt = shot.id === 'merge' ? t : 0;
        const kz = -600 + 250 * tt;
        const cz = 600 - 250 * tt;
        const weave = (i: number) => Math.sin(tt * 1.3 + i) * 4;
        const kp = [at(0, weave(0), kz), at(-38, -6 + weave(1), kz - 30), at(40, 5 + weave(2), kz - 40)];
        const cp = [at(14, 22 + weave(3), cz), at(-40, 10 + weave(4), cz + 40), at(55, 34, cz + 60), at(-10, 55 + weave(5), cz + 100)];
        this.K.forEach((s, i) => {
          this.fly(s, kp[i], null, _v.set(0, 0, 1), Math.sin(tt * 0.8 + i) * 0.08, 250);
          s.controls.fire = fk && s.alive;
        });
        this.C.forEach((s, i) => {
          this.fly(s, cp[i], i < 3 ? kp[i] : null, _v.set(0, 0, -1), Math.sin(tt * 1.1 + i) * 0.12, 250);
          s.controls.fire = fc && s.alive && i < 3;
        });
        return;
      }
      case 'chase': {
        // The Cantor jinks down a corridor; the lead rides its old path 0.55 s behind, guns on it.
        const P = (tt: number, out: Vector3) => out.set(70 * Math.sin(1.3 * tt), 28 * Math.sin(1.9 * tt + 0.6), 200 + 240 * tt).add(A);
        const cpos = P(t, new Vector3());
        const cnext = P(t + 0.05, new Vector3());
        this.fly(c0, cpos, null, cnext.sub(cpos), -0.7 * Math.cos(1.3 * t), 240);
        const kpos = P(t - 0.55, new Vector3()).add(_w.set(0, -3, 0));
        const knext = P(t - 0.5, new Vector3()).add(_w.set(0, -3, 0));
        this.fly(k0, kpos, cpos.clone().addScaledVector(c0.flight.velocity, 0.12), knext.sub(kpos), -0.6 * Math.cos(1.3 * (t - 0.55)), 240);
        k0.controls.fire = fk && c0.alive;
        // In the distance: Jackpot on another Cantor, crossing the frame.
        const Q = (tt: number) => new Vector3(-420 + 240 * tt, 90 + 25 * Math.sin(tt), 800 + 60 * Math.sin(1.1 * tt)).add(A);
        const qp = Q(t);
        this.fly(c1, qp, null, Q(t + 0.05).sub(qp), 0.5, 240);
        const kp = Q(t - 0.6);
        this.fly(k1, kp, qp, Q(t - 0.55).sub(kp), 0.4, 240);
        k1.controls.fire = fk;
        for (const s of [k2, c2, c3]) this.park(s);
        return;
      }
      case 'break': {
        // The lead rolls and breaks left; a Cantor on its six; Jackpot dives in from the right.
        const brk = Math.max(0, t - 0.8);
        const kpos = at(-26 * brk * brk, 4 * brk, 240 * t);
        this.fly(k0, kpos, null, _v.set(-52 * brk, 4, 240), 1.1 * smooth(0.6, 1.4, t), 240);
        const cpos = at(22 - 12 * brk * brk, 11, 240 * t - 125);
        this.fly(c2, cpos, kpos.clone().add(_w.set(9, 7, 45)), _v.set(-20 * brk, 0, 240), 0.2 * Math.sin(t * 3), 240);
        c2.controls.fire = fc && c2.alive;
        const jpos = at(200 - 110 * t, 40 - 12 * t, 240 * t - 260 + 40 * t);
        this.fly(k1, jpos, cpos, _v.set(-110, -12, 280), -0.6, 280);
        k1.controls.fire = this.firing.has('k1') && c2.alive;
        for (const s of [k2, c0, c1, c3]) this.park(s);
        return;
      }
      case 'itano': {
        const kp = [at(0, 0, 200 * t), at(-35, -5, 200 * t - 30), at(35, 4, 200 * t - 36)];
        this.K.forEach((s, i) => this.fly(s, kp[i], null, _v.set(0, 0, 1), Math.sin(t * 0.7 + i) * 0.06, 200));
        const cp = [at(-250 + 150 * t, 60, 1500 + 60 * t), at(-300 + 150 * t, 30, 1560 + 60 * t), at(-190 + 150 * t, 95, 1620 + 60 * t), at(-350 + 150 * t, 80, 1480 + 60 * t)];
        this.C.forEach((s, i) => this.fly(s, cp[i], null, _v.set(150, Math.sin(t * 2 + i) * 20, 60), 0.4 + Math.sin(t * 1.5 + i) * 0.2, 162));
        return;
      }
    }
  }

  // ── BATTLE ─────────────────────────────────────────────────────────

  private resetShields(): void {
    const I = this.indomitable;
    const st = I.combat.dmg;
    st.facings.fill(st.facingMax * 0.7);
    st.facings[0] = st.facingMax * 0.35;
    st.down = 0;
    I.shield = st.facings.reduce((a, b) => a + b, 0);
    this.collapsed = false;
  }

  private animateBattle(shot: Shot, t: number): void {
    const C = this.cathedral;
    const I = this.indomitable;
    for (const s of [...this.BK, ...this.measure]) s.controls.fire = false;
    const mounts = (ship: ShipEntity) => [...ship.model.turrets.keys()];
    for (const [ship, target] of [[I, C], [C, I]]) {
      const sockets = mounts(ship);
      this.gunnery.traverse(ship, sockets, target.flight.position, t / 1.2);
      if (t > 1.2 && Math.floor(t / 0.48) !== Math.floor((t - this.frame.dt) / 0.48)) {
        const ready = this.gunnery.ready(ship, sockets, target.flight.position);
        this.boltVolley(ship, ready, target, ready.length, ship === I ? GUNS.railgun : GUNS.battery);
      }
    }
    const cs = C.combat.dmg;
    const is = I.combat.dmg;
    if (shot.id === 'capital') {
      // A Kestrel wing strafing the Cathedral's burning port side, guns on its batteries.
      const subs = cs.subsystems.filter((s) => !s.destroyed);
      this.BK.forEach((k, i) => {
        const x = cs.cx + cs.halfW * 2.6 + i * 26;
        const y = cs.cy + cs.halfH * 0.8 + (i % 2) * 14;
        const z = cs.cz - cs.halfL * 0.75 + 230 * t - i * 34;
        toUniverse(C, x, y, z, _w);
        const sub = subs.length ? subs[(i * 3 + Math.floor(t * 0.8)) % subs.length] : null;
        const aim = sub ? subsystemPosition(C, sub, new Vector3()) : null;
        toUniverse(C, 0, 0, 1, _v).sub(C.flight.position);
        this.fly(k, _w.clone(), aim, _v.clone(), Math.sin(t + i) * 0.1, 230);
        k.controls.fire = this.firing.has('bk') && (i + Math.floor(t * 3)) % 3 !== 0;
      });
      for (const s of this.measure) this.park(s);
      return;
    }
    if (shot.id === 'shield') {
      // A Choir Measure 700 m off the bow shell, hymns on the fore facing.
      const shellZ = is.cz + I.combat.shell.z;
      this.measure.forEach((s, i) => {
        toUniverse(I, is.cx + (i - 2) * 48, is.cy + is.halfH * 0.25 + (i % 2) * 20, shellZ + 700 - 12 * t, _w);
        const aim = toUniverse(I, is.cx + (i - 2) * 30, is.cy + is.halfH * 0.2, is.cz + is.halfL * 0.6, new Vector3());
        toUniverse(I, 0, 0, -1, _v).sub(I.flight.position);
        this.fly(s, _w.clone(), aim, _v.clone(), 0, 12, 0.6);
        s.controls.fire = this.firing.has('measure');
      });
      // The facing holds (and ripples) until the script breaks it.
      if (!this.collapsed) is.facings[0] = Math.max(is.facings[0], is.facingMax * 0.3);
      for (const s of this.BK) this.park(s);
      return;
    }
    // lance: the line of battle; the wing stays out of it.
    for (const s of [...this.BK, ...this.measure]) this.park(s);
  }

  // ── REACH ──────────────────────────────────────────────────────────

  private animateReach(shot: Shot, t: number, dt: number): void {
    const [k0, k1, k2] = this.rk;
    for (const s of this.rk) s.controls.fire = false;
    const parkAll = (keep: ShipEntity[]) => {
      for (const s of [...this.rk, ...this.haulers, this.liner]) if (!keep.includes(s)) this.park(s);
    };
    const G = this.giantFrame;
    this.gateSheet.update(t, shot.id === 'lane' ? 1 : 0, 0.8);
    this.view.gates[0].gate.setGlow(shot.id === 'lane' ? 0.25 : 0);
    let curtainShip: Vector3 | null = null;
    switch (shot.id) {
      case 'trade-card':
      case 'giant': {
        // Skimming the ring plane, 220 m up, toward the giant.
        const fwd = G.dir(-0.35, -0.004, -1, new Vector3());
        const p0 = G.at(6_000, 220, 80_000, new Vector3()).addScaledVector(fwd, 420 * t);
        this.fly(k0, p0, null, fwd, Math.sin(t * 0.8) * 0.12, 420, 1.4);
        const r = G.dir(1, 0, 0, new Vector3());
        this.fly(k1, p0.clone().addScaledVector(r, -45).addScaledVector(fwd, -40).add(G.dir(0, 1, 0, _v).multiplyScalar(-6)), null, fwd, 0.1, 420, 1.4);
        this.fly(k2, p0.clone().addScaledVector(r, 48).addScaledVector(fwd, -52).add(G.dir(0, 1, 0, _v).multiplyScalar(5)), null, fwd, -0.08, 420, 1.4);
        parkAll([k0, k1, k2]);
        break;
      }
      case 'lane': {
        const F = this.gateFrame;
        const lateral = [0, 26, -34, 12];
        this.haulers.forEach((h, i) => {
          const z = 282 + i * 430 - 120 * t;
          const gone = i === 0 && t >= 2.35;
          h.model.root.visible = !gone;
          F.at(lateral[i], Math.sin(i * 1.7) * 18, z, _w);
          this.pose(h, _w, F.dir(0, 0, -1, _v), 0, 120);
          h.model.setThrottle(0.8);
        });
        // A patrol pair riding the lane out.
        F.at(-160, 70, 900 + 180 * t, _w);
        this.fly(k1, _w.clone(), null, F.dir(0.05, 0.02, 1, _v).clone(), 0.2, 180);
        F.at(-110, 58, 870 + 180 * t, _w);
        this.fly(k2, _w.clone(), null, F.dir(0.05, 0.02, 1, _v).clone(), 0.2, 180);
        parkAll([...this.haulers, k1, k2]);
        break;
      }
      case 'liner': {
        const fwd = G.dir(-0.18, -0.02, -1, new Vector3());
        const p = G.at(34_000, 5_200, 150_000, new Vector3()).addScaledVector(fwd, 90 * t);
        this.pose(this.liner, p, fwd, 0, 90);
        this.liner.model.setThrottle(0.7);
        // Escort pair off the bow.
        const lq = this.liner.flight.orientation;
        this.fly(k1, _w.set(-70, 26, 170).applyQuaternion(lq).add(p).clone(), null, fwd, 0.05, 90, 0.8);
        this.fly(k2, _w.set(72, 34, 120).applyQuaternion(lq).add(p).clone(), null, fwd, -0.05, 90, 0.8);
        parkAll([this.liner, k1, k2]);
        break;
      }
      case 'dock': {
        // Down the corridor at ~120 m/s, braking through the curtain to the berth.
        const z = t < 2.2 ? 430 - 127 * t : 150 - (150 + BAY_INSIDE) * (1 - Math.pow(1 - Math.min(1, (t - 2.2) / 2.2), 2.2));
        const B = this.bayFrame;
        B.at(0, -8, z, _w);
        this.pose(k0, _w, B.dir(0, 0, -1, _v), 0, 100);
        k0.model.setThrottle(0.35);
        k0.model.setWingSweep(0.2);
        curtainShip = new Vector3(0, -8, z + 4);
        parkAll([k0]);
        break;
      }
      default: {
        // Berthed (UI shots).
        const B = this.bayFrame;
        B.at(0, -8, -BAY_INSIDE, _w);
        this.pose(k0, _w, B.dir(0, 0, -1, _v), 0, 0);
        k0.model.setThrottle(0.1);
        parkAll([k0]);
      }
    }
    this.station.curtain.setShip(curtainShip, dt);
  }

  // ── RISE ───────────────────────────────────────────────────────────

  private animateLineup(t: number): void {
    // Idle drift so the row breathes (engines at idle, a slow bob).
    this.row.forEach((s, i) => {
      const r = s.model.root;
      r.position.copy(s.flight.position).add(_v.set(0, Math.sin(t * 0.8 + i) * s.model.length * 0.004, 0));
      s.model.setThrottle(0.3);
    });
  }

  private animateBroadside(t: number, dt: number): void {
    const V = this.valiant;
    const X = this.canticle;
    const A = this.live!.anchor;
    this.pose(V, _w.set(0, 0, 25 * t).add(A), _z, 0, 25);
    this.pose(X, _w.set(1300, -60, 700 + 25 * t).add(A), _z, 0, 25);
    V.model.setThrottle(0.6);
    X.model.setThrottle(0.6);
    this.gunnery.traverse(V, this.valiantTurrets, X.flight.position, t / 0.8);
    this.gunnery.traverse(X, this.canticleTurrets, V.flight.position, t / 1.1);
    // Both sides use the pose actually displayed; no ideal-aim proxy or hull-origin fallback.
    if (t > 1.1 && Math.floor(t * 3) !== Math.floor((t - dt) * 3)) {
      const ready = this.gunnery.ready(X, this.canticleTurrets, V.flight.position);
      this.boltVolley(X, ready, V, ready.length, GUNS.battery);
    }
  }

  // ── rigs & events ──────────────────────────────────────────────────

  rig(name: string, pos: Vector3, quat: Quaternion): boolean {
    const f = (s: ShipEntity) => {
      pos.copy(s.flight.position);
      quat.copy(s.flight.orientation);
      return true;
    };
    const fr = (F: Frame) => {
      pos.copy(F.pos);
      quat.copy(F.quat);
      return true;
    };
    switch (name) {
      case 'deck':
        this.weapons.socketPosition(this.carrier, 'catapult', pos);
        quat.copy(this.carrier.flight.orientation);
        return true;
      case 'lead':
        return f(this.launchers[0]);
      case 'k0':
        return f(this.K[0]);
      case 'k1':
        return f(this.K[1]);
      case 'c0':
        return f(this.C[0]);
      case 'cathedral':
        return f(this.cathedral);
      case 'indomitable':
        return f(this.indomitable);
      case 'bk0':
        return f(this.BK[0]);
      case 'giant':
        return fr(this.giantFrame);
      case 'lantern':
        return fr(this.gateFrame);
      case 'bay':
        return fr(this.bayFrame);
      case 'liner':
        return f(this.liner);
      case 'kestrel':
        return f(this.rk[0]);
      case 'row':
        pos.copy(this.sets.get('lineup')!.anchor);
        quat.identity();
        return true;
      case 'valiant':
        return f(this.valiant);
      case 'canticle':
        return f(this.canticle);
    }
    return false;
  }

  event(id: string, _shot: Shot, seeking: boolean): void {
    const [name, arg] = id.split(':');
    switch (name) {
      case 'fire':
        this.firing.add(arg);
        return;
      case 'cease':
        this.firing.clear();
        return;
      case 'kill': {
        const s = { c0: this.C[0], c1: this.C[1], c2: this.C[2], c3: this.C[3] }[arg];
        if (s) this.kill(s, seeking);
        return;
      }
      case 'salvo': {
        const i = Number(arg);
        const shooter = this.K[i];
        this.missiles.salvo(shooter, this.C[i], MISSILES.micro);
        if (i === 2) this.missiles.salvo(shooter, this.C[3], MISSILES.micro);
        return;
      }
      case 'sub': {
        const C = this.cathedral;
        const subs = C.combat.dmg.subsystems;
        const re = arg === 'battery' ? /battery-(4|5)$/ : /^(spire|lance)-?1$/;
        const s: Subsystem | undefined = subs.find((x) => re.test(x.id)) ?? subs.find((x) => !x.destroyed);
        if (!s) return;
        subsystemPosition(C, s, _w);
        if (!s.destroyed) this.fleet.hit(C, s.hpMax * 2 + 1, 'explosive', _w, null, null);
        if (!seeking) {
          this.fx.explosion(_w, C.flight.velocity, s.radius * 1.3 + 20, PAL.MAGENTA);
          this.fx.debris(_w, C.flight.velocity, s.radius * 0.5 + 6, 16);
        }
        return;
      }
      case 'collapse': {
        const I = this.indomitable;
        const st = I.combat.dmg;
        this.collapsed = true;
        const hit = toUniverse(I, st.cx, st.cy + st.halfH * 0.2, st.cz + I.combat.shell.z * 0.98, new Vector3());
        this.fleet.hit(I, st.facings[0] + 50, 'harmonic', hit, _v.set(0, 0, 1).applyQuaternion(I.flight.orientation), this.measure[2]);
        st.facings[0] = 0;
        return;
      }
      case 'broadside':
        return this.broadside(seeking);
      case 'great-lance': {
        const C = this.cathedral;
        const sock = ['lance', 'harp', 'spire-1'].find((n) => C.model.sockets.has(n)) ?? null;
        const b = this.weapons.fireBeam(C, sock, 9000, 42, 1.4, 0);
        // The fixed bow lance follows the ship's nose. The lance shot turns
        // the Cathedral toward its opponent before the camera begins.
        b.aimTarget = null;
        return;
      }
      case 'detonate': {
        if (seeking) return;
        const C = this.cathedral;
        const st = C.combat.dmg;
        for (let i = 0; i < 7; i++) {
          toUniverse(C, st.cx - st.halfW * (0.4 + 0.5 * Math.abs(hash(i))), st.cy + st.halfH * 0.5 * hash(i + 4), st.cz + st.halfL * 0.8 * hash(i + 9), _w);
          this.fx.explosion(_w, C.flight.velocity, 110 + 90 * Math.abs(hash(i + 2)), i % 2 ? PAL.MAGENTA : PAL.WARM);
          if (i % 2 === 0) this.fx.debris(_w, C.flight.velocity, 40, 18);
        }
        return;
      }
      case 'hits': {
        if (seeking) return;
        const X = this.canticle;
        const st = X.combat.dmg;
        for (let i = 0; i < 5; i++) {
          toUniverse(X, st.cx - st.halfW * 0.7, st.cy + st.halfH * 0.6 * hash(i + 1), st.cz + st.halfL * 0.7 * hash(i + 5), _w);
          this.fx.explosion(_w, X.flight.velocity, 45 + 30 * Math.abs(hash(i)), PAL.MAGENTA);
          this.fx.debris(_w, X.flight.velocity, 16, 12);
        }
        return;
      }
      case 'jump': {
        if (seeking) return;
        const h = this.haulers[0];
        this.fx.explosion(h.flight.position, _v.set(0, 0, 0), 520, PAL.PLASMA);
        return;
      }
    }
  }

  /** A broadside uses only mounts already laid on target, firing along their barrels. */
  private broadside(seeking: boolean): void {
    const from = this.live?.id === 'battle' ? this.indomitable : this.valiant;
    const target = this.live?.id === 'battle' ? this.cathedral : this.canticle;
    const sockets = [...from.model.turrets.keys()];
    const ready = this.gunnery.ready(from, sockets, target.flight.position);
    this.boltVolley(from, ready, target, ready.length * 2, GUNS.railgun);
    void seeking;
  }

  private boltVolley(from: ShipEntity, sockets: string[], target: ShipEntity, n: number, gun: (typeof GUNS)[keyof typeof GUNS]): void {
    if (!sockets.length) return;
    void target;
    for (let i = 0; i < n; i++) {
      const k = sockets[i % Math.max(1, sockets.length)];
      this.gunnery.muzzle(from, k, _w);
      this.gunnery.direction(from, k, _v).multiplyScalar(Math.max(1600, gun.speed));
      this.weapons.spawnBolt(_w, _v, 3.2, 2, from, gun);
      this.weapons.muzzleFlash(_w, _v.clone().normalize(), from.flight.velocity, from, gun);
    }
  }

  settle(_shot: Shot, _local: number, dt: number, _seeking: boolean): void {
    const set = this.live;
    const f = this.frame;
    f.dt = dt;
    f.time = this.setClock;
    if (set) for (const p of set.pieces) if (p.group.visible) p.update(f);
    if (set?.id === 'reach') this.view.update(this.setClock + 400, this.frame.eye);
    for (const b of this.skies.values()) if (b.group.visible) b.follow(this.camera);
    this.ui.update(this.uiLocal);
  }

  /** No bolts, beams or missiles carry across a cut. */
  clearWeapons(): void {
    for (const b of this.weapons.beams) b.active = false;
    this.weapons.life.fill(0);
    this.missiles.clear();
  }

  dispose(): void {
    this.ui.dispose();
    disposeTree(this.view.group); // before the view unhooks its group from the set
    this.view.dispose();
    for (const s of this.sets.values()) {
      for (const p of s.pieces) p.dispose();
      disposeTree(s.group);
      s.group.removeFromParent();
    }
    for (const b of this.skies.values()) {
      disposeTree(b.group);
      this.scene.remove(b.group);
    }
  }
}

