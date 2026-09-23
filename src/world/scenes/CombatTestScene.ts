import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { Fleet, faceAlong, type ShipEntity } from '@/sim/Fleet';
import { Weapons } from '@/sim/Weapons';
import { Missiles } from '@/sim/Missiles';
import { Capitals } from '@/sim/Capitals';
import { subsystemPosition, toUniverse } from '@/sim/Combat';
import { GUNS, MISSILES } from '@/sim/Loadouts';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { CombatHud } from '@/ui/CombatHud';

/**
 * Combat-depth test bed: `?scene=combat&stage=…` — staged, deterministic
 * set-ups for the damage model, weapon families and shields.
 *
 *   stage=capital   a Cathedral mid-battle: batteries, a spire lance, a hangar and
 *                   an engine destroyed (burning craters), the port shield facing
 *                   down, a Kestrel wing strafing; HUD sub-targets a battery
 *   stage=shield    a Choir Measure hammering an Indomitable's fore facing until
 *                   it collapses (the frame freezes on the pop)
 *   stage=smoke     a crippled Kestrel trailing black smoke, a Cantor on its six
 *   stage=weapons   every gun family firing at a Lantern Guard, a torpedo inbound
 *                   and its point defence shooting at it
 *   &ship=<id>      capital for stage=capital (default choir-cathedral)
 *   &freeze=S       stop the sim S seconds into the live section (screenshots)
 *   &cam=0..2       alternate framings
 *
 * The fight is fast-forwarded without FX to `pre` seconds, then runs live so
 * trails, smoke and craters build up on screen.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);
const DT = 1 / 60;

type Stage = 'capital' | 'shield' | 'smoke' | 'weapons';

interface Scripted {
  ship: ShipEntity;
  /** Aim point (universe) each frame; null = fly straight. */
  aim: () => Vector3 | null;
  speed: number;
  fire: (t: number) => boolean;
}

const _v = new Vector3();
const _w = new Vector3();
const _d = new Vector3();

export class CombatTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.3, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fleet = new Fleet(this.world.root);
  readonly weapons = new Weapons(this.fleet);
  readonly missiles = new Missiles(this.fleet);
  readonly capitals = new Capitals(this.fleet, this.weapons);
  private visuals = new WeaponVisuals(this.weapons, this.missiles);
  private combatFx = new CombatFx(this.weapons, this.missiles);
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private hud: CombatHud;
  private stage: Stage;
  private scripted: Scripted[] = [];
  private player!: ShipEntity;
  private target: ShipEntity | null = null;
  private simT = 0;
  private liveT = 0;
  private freeze: number;
  private frozen = false;
  private camMode: number;
  private eyeFn: (t: number, eye: Vector3, look: Vector3) => void = () => {};
  private freezeOnCollapse = false;

  constructor() {
    const q = new URLSearchParams(location.search);
    this.stage = (['capital', 'shield', 'smoke', 'weapons'] as const).find((s) => s === q.get('stage')) ?? 'capital';
    this.freeze = Number(q.get('freeze') ?? NaN);
    this.camMode = Number(q.get('cam') ?? 0) || 0;
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group, this.visuals.group, this.combatFx.fx.object);
    this.hud = new CombatHud(document.getElementById('ui-root')!);

    let pre = 0;
    if (this.stage === 'capital') pre = this.setupCapital(q.get('ship') ?? 'choir-cathedral');
    else if (this.stage === 'shield') pre = this.setupShield();
    else if (this.stage === 'smoke') pre = this.setupSmoke();
    else pre = this.setupWeapons();

    // Fast-forward (no FX): the fight settles into shape.
    for (let t = 0; t < pre; t += DT) this.step(DT, false);
    window.__VANGUARD__ = { ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '', hooks: { ...window.__VANGUARD__?.hooks, scene: this } };
  }

  // ── stages ───────────────────────────────────────────────────────────

  private spawnWing(bp: string, faction: 'concord' | 'choir' | 'rustwake', n: number, at: Vector3, dir: Vector3, spacing = 40): ShipEntity[] {
    const out: ShipEntity[] = [];
    _w.set(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < n; i++) {
      const p = at.clone().addScaledVector(_w, (i - (n - 1) / 2) * spacing).add(new Vector3(0, (i % 2) * 12, -Math.abs(i - (n - 1) / 2) * 20));
      out.push(this.fleet.spawn(bp, faction, p, dir.clone(), { name: `${bp.split('-').pop()!.toUpperCase()} ${i + 1}` }));
    }
    return out;
  }

  private setupCapital(id: string): number {
    const cap = this.fleet.spawn(id, 'choir', ORIGIN.clone(), new Vector3(1, 0, 0.25).normalize(), { name: 'Cathedral Ascendant' });
    cap.flight.velocity.set(0, 0, 0);
    this.capitals.register(cap, { launchBlueprint: null });
    this.target = cap;
    const st = cap.combat.dmg;
    // Battle damage: wreck a handful of subsystems, chew on others, scar the plating.
    const wreck = (pred: (id: string, kind: string) => boolean, n: number, frac = 1) => {
      let k = 0;
      for (const s of st.subsystems) {
        if (k >= n || !pred(s.id, s.kind)) continue;
        k++;
        this.fleet.hit(cap, (s.hpMax / 1.6) * frac + 1, 'explosive', subsystemPosition(cap, s, _v), null, null);
        cap.shield = cap.combat.dmg.facings.reduce((a, b) => a + b, 0);
      }
    };
    // Shields off first so the hits reach the hull.
    st.facings.fill(0);
    wreck((sid) => /battery-(2|3)$/.test(sid), 2);
    wreck((sid) => sid === 'battery-5.L', 1);
    wreck((sid) => sid === 'spire-2', 1);
    wreck((sid) => sid === 'hangar', 1);
    wreck((sid) => sid === 'engine-0', 1);
    wreck((sid) => /battery-(6|7)$/.test(sid), 2, 0.55);
    wreck((sid) => sid === 'bridge', 1, 0.5);
    for (let i = 0; i < 18; i++) {
      const z = st.cz + (i / 17 - 0.5) * st.halfL * 1.6;
      const x = st.cx + (i % 2 ? 1 : -1) * st.halfW * 0.5;
      toUniverse(cap, x, st.cy + st.halfH * 0.3, z, _v);
      this.fleet.hit(cap, cap.hullMax * 0.004 * (1 + (i % 3)), 'kinetic', _v, null, null);
    }
    // Shields back up except the port facing (collapsed).
    st.facings.fill(st.facingMax * 0.7);
    st.facings[2] = 0;
    st.down = 0b0100;
    cap.shield = st.facings.reduce((a, b) => a + b, 0);
    cap.sinceHit = 0;

    // A Kestrel wing strafing the port side, low over the nave.
    const side = new Vector3(0, 0, 1).applyQuaternion(cap.flight.orientation); // nose
    const port = new Vector3(1, 0, 0).applyQuaternion(cap.flight.orientation);
    const start = toUniverse(cap, st.cx + st.halfW * 3.2, st.cy + st.halfH * 0.9, st.cz - st.halfL * 0.7, new Vector3());
    const wing = this.spawnWing('vf27-kestrel', 'concord', 4, start, side.clone().addScaledVector(port, -0.35).normalize(), 55);
    const aimAt = st.subsystems.find((s) => s.id === 'battery-4') ?? st.subsystems[0];
    wing.forEach((s, i) => {
      s.combat.gun = i % 2; // lasers and autocannon
      this.scripted.push({ ship: s, aim: () => subsystemPosition(cap, st.subsystems[(st.subsystems.indexOf(aimAt) + i) % st.subsystems.length], new Vector3()), speed: 190, fire: (t) => t % 1.6 < 1.1 });
    });
    this.player = wing[0];
    this.player.isPlayer = true;
    this.player.target = cap;
    this.player.combat.subTarget = st.subsystems.indexOf(aimAt);
    this.eyeFn = (t, eye, look) => {
      const L = st.halfL;
      if (this.camMode === 1) toUniverse(cap, st.cx + st.halfW * 3.4, st.cy + st.halfH * 2.2, st.cz - L * 0.2 + t * 12, eye);
      else toUniverse(cap, st.cx + st.halfW * 2.9, st.cy + st.halfH * 1.35, st.cz - L * 1.05 + t * 14, eye);
      toUniverse(cap, st.cx + st.halfW * 0.1, st.cy + st.halfH * 0.05, st.cz - L * 0.25, look);
    };
    return 4;
  }

  private setupShield(): number {
    const cap = this.fleet.spawn('bb-indomitable', 'concord', ORIGIN.clone(), new Vector3(0, 0, 1), { name: 'Indomitable' });
    cap.flight.velocity.set(0, 0, 0);
    this.capitals.register(cap, { launchBlueprint: null, gunInterval: 5 });
    this.target = cap;
    const st = cap.combat.dmg;
    // The fore facing is nearly spent.
    st.facings[0] = st.facingMax * 0.1;
    cap.shield = st.facings.reduce((a, b) => a + b, 0);
    const nose = toUniverse(cap, st.cx, st.cy + st.halfH * 0.3, st.cz + st.halfL * 2.2, new Vector3());
    const wing = this.spawnWing('choir-cantor', 'choir', 5, nose, new Vector3(0, -0.08, -1).normalize(), 45);
    wing.forEach((s, i) => {
      s.combat.gun = i === 2 ? 1 : 0; // one lance among the hymns
      this.scripted.push({ ship: s, aim: () => toUniverse(cap, st.cx + (i - 2) * 30, st.cy + st.halfH * 0.2, st.cz + st.halfL * 0.6, new Vector3()), speed: 150, fire: () => true });
    });
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', toUniverse(cap, st.cx + st.halfW * 4, st.cy + st.halfH * 2, st.cz + st.halfL * 1.4, new Vector3()), new Vector3(-1, 0, 0), { name: 'Vanguard 1', isPlayer: true });
    this.player.target = cap;
    this.scripted.push({ ship: this.player, aim: () => null, speed: 0, fire: () => false });
    this.freezeOnCollapse = true;
    this.eyeFn = (_t, eye, look) => {
      toUniverse(cap, st.cx + st.halfW * 3.6, st.cy + st.halfH * 1.1, st.cz + st.halfL * 1.75, eye);
      toUniverse(cap, st.cx, st.cy + st.halfH * 0.2, st.cz + st.halfL * 0.95, look);
    };
    return 0.5;
  }

  private setupSmoke(): number {
    const fwd = new Vector3(0, 0, 1);
    const k = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN.clone(), fwd, { name: 'Vanguard 3' });
    const st = k.combat.dmg;
    // Crippled: port wing and engines shot up, shields gone, hull at 18%.
    st.zones[1] = 0.85;
    st.zones[3] = 0.65;
    st.zones[0] = 0.3;
    st.version++;
    k.shield = 0;
    k.hull = k.hullMax * 0.18;
    k.combat.damaged = true;
    k.sinceHit = 0;
    const bandit = this.fleet.spawn('choir-cantor', 'choir', ORIGIN.clone().add(new Vector3(18, 10, -260)), fwd, { name: 'Cantor 2' });
    this.scripted.push({ ship: k, aim: () => null, speed: 170, fire: () => false });
    this.scripted.push({ ship: bandit, aim: () => _d.copy(k.flight.position).addScaledVector(k.flight.velocity, 0.12).add(_w.set(Math.sin(this.simT * 3) * 6, 4, 0)), speed: 175, fire: (t) => t % 0.9 < 0.5 });
    this.player = k;
    this.player.isPlayer = true;
    this.player.target = bandit;
    this.eyeFn = (_t, eye, look) => {
      const p = k.flight.position;
      if (this.camMode === 1) eye.copy(p).add(_v.set(-26, 9, 34));
      else eye.copy(p).add(_v.set(34, 8, -46));
      look.copy(p).add(_v.set(0, 0, -30));
    };
    return 1.5;
  }

  private setupWeapons(): number {
    const lg = this.fleet.spawn('ffc-lantern-guard', 'concord', ORIGIN.clone().add(new Vector3(0, 0, 1400)), new Vector3(1, 0, 0), { name: 'Lantern Guard' });
    lg.team = 'renegade';
    lg.flight.velocity.set(0, 0, 0);
    this.capitals.register(lg, { launchBlueprint: null });
    this.target = lg;
    const line: [string, 'concord' | 'choir' | 'rustwake', number][] = [
      ['vf27-kestrel', 'concord', 0],
      ['vf27-kestrel', 'concord', 1],
      ['choir-cantor', 'choir', 0],
      ['choir-cantor', 'choir', 1],
      ['rw-scrapjack', 'rustwake', 0],
      ['sb9-warhorse', 'concord', 0],
    ];
    const ships = line.map(([bp, f, gun], i) => {
      const s = this.fleet.spawn(bp, f, ORIGIN.clone().add(new Vector3((i - 2.5) * 70, (i % 2) * 20, i === 4 ? 780 : 0)), new Vector3(0, 0, 1), { name: `${bp} ${i}` });
      s.team = 'concord';
      s.combat.gun = gun;
      this.scripted.push({ ship: s, aim: () => toUniverse(lg, (i - 2.5) * 6, 0, 0, new Vector3()), speed: 0, fire: () => bp !== 'sb9-warhorse' });
      return s;
    });
    const wh = ships[5];
    wh.combat.subTarget = -1;
    this.missiles.salvo(wh, lg, MISSILES.torpedo);
    this.player = ships[0];
    this.player.isPlayer = true;
    this.player.target = lg;
    this.eyeFn = (_t, eye, look) => {
      eye.copy(ORIGIN).add(_v.set(420, 120, 560));
      look.copy(ORIGIN).add(_v.set(-40, 0, 700));
    };
    void GUNS;
    return 0.9;
  }

  // ── sim ──────────────────────────────────────────────────────────────

  private step(dt: number, fx: boolean): void {
    this.simT += dt;
    for (const sc of this.scripted) {
      const s = sc.ship;
      if (!s.alive) continue;
      const c = s.controls;
      c.pitch = c.yaw = c.roll = 0;
      c.throttleDelta = 0;
      c.throttleSet = null;
      c.afterburner = false;
      const aim = sc.aim();
      if (aim) faceAlong(s.flight.orientation, _d.subVectors(aim, s.flight.position).normalize());
      s.flight.bodyRates.set(0, 0, 0);
      s.flight.velocity.copy(s.flight.forward(_v)).multiplyScalar(sc.speed);
      c.fire = sc.fire(this.simT);
    }
    this.capitals.step(dt);
    this.fleet.step(dt);
    for (const sc of this.scripted) sc.ship.flight.velocity.copy(sc.ship.flight.forward(_v)).multiplyScalar(sc.speed);
    this.weapons.step(dt);
    this.missiles.step(dt);
    if (fx) this.combatFx.consume(dt);
    if (this.freezeOnCollapse && fx && this.weapons.events.some((e) => e.kind === 'shield-down') && !Number.isFinite(this.freeze)) this.freeze = this.liveT + 0.1;
  }

  update({ dt }: FrameContext): void {
    if (!this.frozen) {
      this.liveT += dt;
      this.step(dt, true);
      if (Number.isFinite(this.freeze) && this.liveT >= this.freeze) this.frozen = true;
    }
    const look = _w;
    this.eyeFn(this.simT, this.world.eye, look);
    this.world.sync(this.camera);
    this.camera.lookAt(look.sub(this.world.eye));
    this.backdrop.follow(this.camera);
    const vdt = this.frozen ? 0 : dt;
    this.visuals.update(this.world, vdt);
    this.combatFx.update(vdt, this.world.eye);
    this.hud.draw(this.player, this.target, this.camera, this.world, this.simT, this.stage === 'capital' || this.stage === 'shield');
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  cameraLabel(): string {
    return `COMBAT · ${this.stage.toUpperCase()}${this.frozen ? ' · FROZEN' : ''}`;
  }
}
