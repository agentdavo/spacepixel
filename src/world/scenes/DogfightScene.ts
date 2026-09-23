import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { input } from '@/core/Input';
import { flags } from '@/core/Flags';
import { Fleet, type ShipEntity } from '@/sim/Fleet';
import { ChaseCamera } from '@/sim/ChaseCamera';
import { CameraDirector, type Subject } from '@/sim/CameraDirector';
import {
  brainOf,
  issueOrder,
  PERSONALITIES,
  setAutopilot,
  setFormation,
  setPersonality,
  updateAI,
  type Order,
} from '@/sim/ai';
import { DebugGuns } from '@/sim/ai/DebugGuns';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from '../BlendedMRT';
import { postFx } from '@/render/post/PostFx';

/**
 * Milestones 13–14 demo: `?scene=dogfight`.
 *
 * The player's Kestrel with two wingmen in finger-four, against a flight of
 * four Choir Cantors, next to a parked Cathedral the AI must never fly into.
 * Every ship — the player's included — is flown through the same
 * ControlState → FlightModel path; the AI just writes the controls.
 *
 * Keys: F form up · G attack my target · H engage at will · J cover me ·
 * N break and attack · T next target · V camera · P autopilot.
 * `?demo=1` (or shot mode) hands the player's stick to the AI too.
 *
 * Shots are drawn as debug tracer lines from a stand-in gun model
 * (`DebugGuns`) until the M10 weapons system is wired in here.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);
const FWD = new Vector3(0, 0, 1);
const BACK = new Vector3(0, 0, -1);
const RESPAWN_DELAY = 4;
const TRACER_LEN = 45;

const ORDER_KEYS: Record<string, Order> = {
  KeyF: 'formUp',
  KeyG: 'attackMyTarget',
  KeyH: 'engageAtWill',
  KeyJ: 'coverMe',
  KeyN: 'breakAndAttack',
};
const ORDER_LABEL: Record<Order, string> = {
  formUp: 'FORM UP',
  attackMyTarget: 'ATTACK MY TARGET',
  engageAtWill: 'ENGAGE AT WILL',
  coverMe: 'COVER ME',
  breakAndAttack: 'BREAK AND ATTACK',
};

export class DogfightScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.3, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fleet = new Fleet(this.world.root);
  readonly chase = new ChaseCamera(this.camera);
  readonly director = new CameraDirector(this.camera, this.chase);
  readonly guns = new DebugGuns(1024, 10, 6);
  readonly player: ShipEntity;
  readonly wing: ShipEntity[] = [];
  readonly bandits: ShipEntity[] = [];
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private subjects = new Map<number, Subject>();
  private deadFor = new Map<number, number>();
  private order: Order = 'formUp';
  private merged = false;
  private simTime = 0;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private tracerGeo = new BufferGeometry();
  private overlay: HTMLDivElement | null = null;

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);

    // A parked Cathedral: scenery, and a hull the AI has to respect.
    const cathedral = this.fleet.spawn('choir-cathedral', 'choir', ORIGIN.clone().add(new Vector3(2600, -400, 3600)), new Vector3(1, 0, 0.35));
    cathedral.flight.throttle = 0;
    cathedral.flight.velocity.set(0, 0, 0);

    // Player + wingmen.
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN.clone(), FWD, { isPlayer: true });
    setPersonality(this.player, PERSONALITIES.ace);
    for (const p of [new Vector3(40, 0, -32), new Vector3(-40, 4, -32)]) {
      const s = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN.clone().add(p), FWD);
      setPersonality(s, PERSONALITIES.veteran);
      this.wing.push(s);
    }
    setFormation(this.wing, 'fingerFour', 40);
    issueOrder(this.wing, 'formUp', this.player);

    // Bandit flight, inbound.
    for (let i = 0; i < 4; i++) {
      const off = new Vector3([0, -40, 40, 80][i], 120 + (i % 2) * 6, 3400 + [0, 32, 32, 64][i]);
      const s = this.fleet.spawn('choir-cantor', 'choir', ORIGIN.clone().add(off), BACK);
      setPersonality(s, i === 0 ? PERSONALITIES.ace : PERSONALITIES.zealot);
      this.bandits.push(s);
    }
    setFormation(this.bandits.slice(1), 'fingerFour', 40);
    issueOrder(this.bandits.slice(1), 'formUp', this.bandits[0]);

    for (const s of this.fleet.ships) this.subjects.set(s.id, { position: s.flight.position, velocity: s.flight.velocity, radius: s.radius });

    if (flags.demo) setAutopilot(this.player, true);

    // Debug tracers (eye-relative, rebuilt each frame).
    const cap = this.guns.bolts.length;
    this.tracerPos = new Float32Array(cap * 6);
    this.tracerCol = new Float32Array(cap * 6);
    this.tracerGeo.setAttribute('position', new BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new BufferAttribute(this.tracerCol, 3));
    const mat = new LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
    mat.mrtNode = noInkMRT();
    const lines = new LineSegments(this.tracerGeo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    useBlendedMRT(lines);
    this.scene.add(lines);

    // Deterministic captures (?shot=1&t=N): fast-forward the fight N seconds.
    if (flags.shot && flags.startTime > 0) {
      for (let t = 0; t < flags.startTime; t += 1 / 60) this.simulate(1 / 60, t);
    }
    this.chase.snap(this.player.flight);

    window.addEventListener('keydown', (e) => this.onKey(e.code));
    if (flags.hud) {
      this.overlay = document.createElement('div');
      this.overlay.style.cssText =
        'position:absolute;left:16px;bottom:16px;font:12px "Share Tech Mono",monospace;color:#7dffb2;text-shadow:0 0 6px rgba(125,255,178,.6);pointer-events:none;white-space:pre';
      document.getElementById('ui-root')?.append(this.overlay);
    }
  }

  /** One fixed sim step: AI → physics → guns → respawns. */
  private simulate(dt: number, time: number): void {
    this.simTime = time;
    const p = this.player;
    const auto = brainOf(p).autopilot;
    if (!auto && p.alive) copyControls(input.state, p.controls);

    // Player target: keep one (wingmen's "attack my target" reads it).
    if (!auto && (!p.target || !p.target.alive)) p.target = this.nearestBandit(p);

    // Merge: the bandit leader calls the break; in demo the player's wing breaks too.
    const lead = this.bandits[0];
    if (!this.merged && p.flight.position.distanceTo(lead.flight.position) < 2500) {
      this.merged = true;
      issueOrder(this.bandits.slice(1), 'breakAndAttack', lead);
      if (auto) this.setOrder('breakAndAttack');
    }

    updateAI(this.fleet, dt, time);
    this.fleet.step(dt);
    this.guns.step(this.fleet, dt);
    this.respawn(dt);
  }

  update({ dt, time }: FrameContext): void {
    this.simulate(dt, time);

    const target = this.player.target && this.player.target.alive ? (this.subjects.get(this.player.target.id) ?? null) : null;
    this.director.update(this.player.flight, target, dt);
    this.world.eye.copy(this.director.eye);
    this.world.sync(this.camera);
    this.backdrop.follow(this.camera);
    this.updateTracers();

    postFx.boost = this.chase.boostAmount;
    postFx.speed = Math.min(1, this.player.flight.speed / this.player.flight.spec.boostSpeed);
    if (this.overlay) this.updateOverlay();
  }

  private nearestBandit(from: ShipEntity): ShipEntity | null {
    let best: ShipEntity | null = null;
    let bd = Infinity;
    for (const b of this.bandits) {
      if (!b.alive) continue;
      const d = b.flight.position.distanceToSquared(from.flight.position);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Endless furball: the dead come back after a few seconds, 2.5 km out. */
  private respawn(dt: number): void {
    for (const s of this.fleet.ships) {
      if (s.alive || s.radius > 60) continue;
      const t = (this.deadFor.get(s.id) ?? 0) + dt;
      this.deadFor.set(s.id, t);
      if (t < RESPAWN_DELAY) continue;
      this.deadFor.set(s.id, 0);
      const friendly = s.faction === this.player.faction;
      const anchor = friendly ? (this.player.alive ? this.player : this.wing.find((w) => w.alive)) : this.bandits.find((b) => b.alive);
      const centre = (anchor ?? this.player).flight.position;
      const a = this.simTime * 1.7 + s.id;
      const pos = _v.set(Math.cos(a) * 2500, Math.sin(a * 0.7) * 400, Math.sin(a) * 2500).add(centre);
      const facing = _w.subVectors(centre, pos).normalize();
      const f = s.flight;
      f.position.copy(pos);
      f.orientation.setFromUnitVectors(FWD, facing);
      f.velocity.copy(facing).multiplyScalar(f.spec.maxSpeed * 0.7);
      f.bodyRates.set(0, 0, 0);
      s.hull = s.hullMax;
      s.shield = s.shieldMax;
      s.alive = true;
      s.target = null;
      s.model.root.visible = true;
      const b = brainOf(s);
      if (s !== this.player && b.order === 'formUp' && !friendly) b.order = 'engageAtWill';
      b.nextThink = 0;
    }
  }

  private updateTracers(): void {
    const bolts = this.guns.bolts;
    const pos = this.tracerPos;
    const col = this.tracerCol;
    const eye = this.world.eye;
    let n = 0;
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      if (!b.active) continue;
      const k = n * 6;
      const hx = b.pos.x - eye.x;
      const hy = b.pos.y - eye.y;
      const hz = b.pos.z - eye.z;
      const inv = TRACER_LEN / Math.max(1, b.vel.length());
      pos[k] = hx;
      pos[k + 1] = hy;
      pos[k + 2] = hz;
      pos[k + 3] = hx - b.vel.x * inv;
      pos[k + 4] = hy - b.vel.y * inv;
      pos[k + 5] = hz - b.vel.z * inv;
      const c = b.owner && b.owner.faction === 'choir' ? CHOIR_TRACER : CONCORD_TRACER;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
      col[k + 3] = c.r * 0.15;
      col[k + 4] = c.g * 0.15;
      col[k + 5] = c.b * 0.15;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    (this.tracerGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as BufferAttribute).needsUpdate = true;
  }

  private updateOverlay(): void {
    const alive = (list: ShipEntity[]) => {
      let n = 0;
      for (const s of list) if (s.alive) n++;
      return n;
    };
    const tgt = this.player.target && this.player.target.alive ? this.player.target.name : '—';
    this.overlay!.textContent =
      `WING ${ORDER_LABEL[this.order]}  ·  wing ${alive(this.wing)}/2  bandits ${alive(this.bandits)}/4  ·  target ${tgt}` +
      `  ·  shots ${this.guns.shots} hits ${this.guns.hits} kills ${this.guns.kills}${brainOf(this.player).autopilot ? '  ·  AUTOPILOT' : ''}\n` +
      `[F] form up  [G] attack my target  [H] engage at will  [J] cover me  [N] break & attack  [T] target  [V] camera  [P] autopilot`;
  }

  private setOrder(order: Order): void {
    this.order = order;
    issueOrder(this.wing, order, this.player);
  }

  private onKey(code: string): void {
    const order = ORDER_KEYS[code];
    if (order) {
      this.setOrder(order);
      return;
    }
    if (code === 'KeyT') {
      const alive = this.bandits.filter((b) => b.alive);
      if (!alive.length) return;
      const i = this.player.target ? alive.indexOf(this.player.target) : -1;
      this.player.target = alive[(i + 1) % alive.length];
    } else if (code === 'KeyP') {
      setAutopilot(this.player, !brainOf(this.player).autopilot);
    } else if (code === 'KeyV') {
      const tgt = this.player.target ? (this.subjects.get(this.player.target.id) ?? null) : null;
      const order = ['chase', 'lock', 'orbit'] as const;
      const next = order[(order.indexOf(this.director.kind as (typeof order)[number]) + 1) % order.length];
      if (next === 'chase') {
        this.director.setBase('chase');
        this.director.cut('chase', null, Infinity);
      } else if (next === 'lock' && tgt) {
        this.director.setBase('lock', tgt);
        this.director.cut('lock', tgt, Infinity);
      } else if (tgt) {
        this.director.cut('orbit', tgt, 5);
      }
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    return `${this.director.label()} · WING ${ORDER_LABEL[this.order]}`;
  }

  cycleCamera(): void {
    this.onKey('KeyV');
  }
}

const _v = new Vector3();
const _w = new Vector3();
const CONCORD_TRACER = new Color('#6fe3ff').multiplyScalar(3);
const CHOIR_TRACER = new Color('#ff5fb4').multiplyScalar(3);

function copyControls(from: ShipEntity['controls'], to: ShipEntity['controls']): void {
  to.pitch = from.pitch;
  to.yaw = from.yaw;
  to.roll = from.roll;
  to.throttleDelta = from.throttleDelta;
  to.throttleSet = from.throttleSet;
  to.afterburner = from.afterburner;
  to.flightAssistToggle = from.flightAssistToggle;
  to.fire = from.fire;
}
