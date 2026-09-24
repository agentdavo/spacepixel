import type { FactionId } from '@/assets/Blueprint';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { Fleet, faceAlong, type ShipEntity } from '@/sim/Fleet';
import { Weapons } from '@/sim/Weapons';
import { Missiles } from '@/sim/Missiles';
import { Capitals } from '@/sim/Capitals';
import { createRayHit, raycastShip, selectSubsystem, subsystemPosition, toUniverse } from '@/sim/Combat';
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
 *   stage=impacts   weapon impacts on an Indomitable's port side, per damage type:
 *                   a laser Kestrel, an autocannon Kestrel, a hymn Cantor, a lance
 *                   Cantor sweeping and a micro-missile salvo. &side=hull (port facing
 *                   down: molten spots, sparks, arcs, cut line, warheads) · shield
 *                   (port facing weak: ripples, facing outline, flicker) · collapse
 *                   (the facing fails; freezes &after=S later) · regen (a collapsed
 *                   facing comes back) · subsystem (a hangar and an engine blow)
 *   &ship=<id>      capital for stage=capital (default choir-cathedral) or
 *                   stage=impacts (default bb-indomitable; &faction=choir|rustwake
 *                   picks the shield shell style)
 *   &freeze=S       stop the sim S seconds into the live section (screenshots)
 *   &cam=0..2       alternate framings
 *
 * The fight is fast-forwarded without FX to `pre` seconds, then runs live so
 * trails, smoke and craters build up on screen.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);
const DT = 1 / 60;

type Stage = 'capital' | 'shield' | 'smoke' | 'weapons' | 'impacts';

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
  /** Seconds past a facing collapse to freeze at (freezeOnCollapse). */
  private collapseAfter = 0.1;
  /** Live-section weapon event counts (label readout). */
  private tally: Record<string, number> = {};
  /** Scripted one-offs at live-section times (s). */
  private timed: { at: number; fn: () => void }[] = [];
  /** Keep fast-forwarding while this holds (bounded by 4 × pre). */
  private preUntil: (() => boolean) | null = null;
  /** &hud=0: no combat HUD (clean captures). */
  private hudOn = new URLSearchParams(location.search).get('hud') !== '0';
  /** &fx=0: no particles (inspect the hull paint alone). */
  private fxOn = new URLSearchParams(location.search).get('fx') !== '0';

  constructor() {
    const q = new URLSearchParams(location.search);
    this.stage = (['capital', 'shield', 'smoke', 'weapons', 'impacts'] as const).find((s) => s === q.get('stage')) ?? 'capital';
    this.freeze = Number(q.get('freeze') ?? NaN);
    this.camMode = Number(q.get('cam') ?? 0) || 0;
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group, this.visuals.group, this.combatFx.fx.object);
    this.hud = new CombatHud(document.getElementById('ui-root')!);

    let pre = 0;
    if (this.stage === 'capital') pre = this.setupCapital(q.get('ship') ?? 'choir-cathedral');
    else if (this.stage === 'shield') pre = this.setupShield();
    else if (this.stage === 'smoke') pre = this.setupSmoke();
    else if (this.stage === 'impacts') pre = this.setupImpacts(q.get('side') ?? 'hull', Number(q.get('after') ?? 0.1), q.get('ship') ?? 'bb-indomitable', (q.get('faction') ?? 'concord') as FactionId);
    else pre = this.setupWeapons();

    // Fast-forward (no FX): the fight settles into shape.
    for (let t = 0; t < pre || (this.preUntil?.() && t < pre * 8); t += DT) this.step(DT, false);
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
    st.cooldown[2] = 1e3; // stays down: no regen, no charge shunted back in (Damage.ts)
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
    selectSubsystem(this.player, cap, st.subsystems.indexOf(aimAt));
    // Close on the wrecked port batteries and hangar (z ≈ −200…−450 m), looking down and aft.
    this.eyeFn = (t, eye, look) => {
      if (this.camMode === 1) {
        toUniverse(cap, 1500, 1200, 300 + t * 10, eye);
        toUniverse(cap, 0, 150, -500, look);
      } else {
        toUniverse(cap, 1250, 700, 250 + t * 8, eye);
        toUniverse(cap, 60, 120, -380, look);
      }
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
    // 700 m off the fore shell: well inside hymn range.
    const nose = toUniverse(cap, st.cx + 60, st.cy + st.halfH * 0.2, st.cz + cap.combat.shell.z + 700, new Vector3());
    const wing = this.spawnWing('choir-cantor', 'choir', 5, nose, new Vector3(0, -0.08, -1).normalize(), 45);
    wing.forEach((s, i) => {
      s.combat.gun = i === 2 ? 1 : 0; // one lance among the hymns
      this.scripted.push({ ship: s, aim: () => toUniverse(cap, st.cx + (i - 2) * 30, st.cy + st.halfH * 0.2, st.cz + st.halfL * 0.6, new Vector3()), speed: 150, fire: () => true });
    });
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', toUniverse(cap, st.cx + st.halfW * 4, st.cy + st.halfH * 2, st.cz + st.halfL * 1.4, new Vector3()), new Vector3(-1, 0, 0), { name: 'Vanguard 1', isPlayer: true });
    this.player.target = cap;
    this.scripted.push({ ship: this.player, aim: () => null, speed: 0, fire: () => false });
    this.freezeOnCollapse = true;
    this.preUntil = () => st.facings[0] > st.facingMax * 0.012;
    this.eyeFn = (_t, eye, look) => {
      toUniverse(cap, st.cx + st.halfW * 5.5, st.cy + st.halfH * 0.7, st.cz + st.halfL * 1.55, eye);
      toUniverse(cap, st.cx, st.cy, st.cz + st.halfL * 0.85, look);
    };
    return 0.5;
  }

  private setupSmoke(): number {
    const fwd = new Vector3(0, 0, 1);
    // Plot armour: the Cantor's hymn can't finish it (hull floors at 15%).
    const k = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN.clone(), fwd, { name: 'Vanguard 3', plotArmour: true });
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
      if (this.camMode === 2) {
        // Plan view from above: the zone scorch pattern.
        eye.copy(p).add(_v.set(0, 34, -4));
        look.copy(p);
        return;
      }
      if (this.camMode === 1) eye.copy(p).add(_v.set(-26, 9, 34));
      else eye.copy(p).add(_v.set(58, 14, -18));
      look.copy(p).add(_v.set(0, 0, -26));
    };
    return 1.5;
  }

  private setupWeapons(): number {
    const lg = this.fleet.spawn('ffc-lantern-guard', 'concord', ORIGIN.clone().add(new Vector3(0, 30, 720)), new Vector3(1, 0, 0), { name: 'Lantern Guard' });
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
      const s = this.fleet.spawn(bp, f, ORIGIN.clone().add(new Vector3((i - 2.5) * 30, (i % 2) * 9, -Math.abs(i - 2.5) * 8)), new Vector3(0, 0, 1), { name: `${bp} ${i}` });
      s.team = 'concord';
      s.combat.gun = gun;
      this.scripted.push({ ship: s, aim: () => toUniverse(lg, (i - 2.5) * 12, 0, 0, new Vector3()), speed: 0, fire: () => bp !== 'sb9-warhorse' });
      return s;
    });
    const wh = ships[5];
    selectSubsystem(wh, lg, -1);
    this.missiles.salvo(wh, lg, MISSILES.torpedo);
    this.player = ships[0];
    this.player.isPlayer = true;
    this.player.target = lg;
    this.eyeFn = (_t, eye, look) => {
      // Behind the firing line: bolts of every family stream away to the corvette.
      eye.copy(ORIGIN).add(_v.set(-62, 20, -52));
      look.copy(ORIGIN).add(_v.set(18, 0, 220));
    };
    void GUNS;
    return 0.9;
  }

  private setupImpacts(side: string, after: number, id: string, faction: FactionId): number {
    const cap = this.fleet.spawn(id, faction, ORIGIN.clone(), new Vector3(0, 0, 1), { name: 'Target' });
    cap.team = 'renegade';
    cap.flight.velocity.set(0, 0, 0);
    cap.plotArmour = true;
    this.target = cap;
    const st = cap.combat.dmg;
    const PORT = 2;
    const setFacing = (f: number, frac: number) => {
      st.facings[f] = st.facingMax * frac;
      if (frac <= 0) st.down |= 1 << f;
      cap.shield = st.facings.reduce((a, b) => a + b, 0);
    };
    if (side === 'hull' || side === 'subsystem') setFacing(PORT, 0);
    else if (side === 'shield') setFacing(PORT, 0.3);
    else if (side === 'collapse') setFacing(PORT, 0.04);
    else if (side === 'regen') {
      setFacing(PORT, 0);
      cap.sinceHit = 99;
    }
    // The strike line, 600 m off the port side, each gun on its own patch of
    // plating: aim points are found by raycasting the hull from that side.
    const lineUp: [string, number, number, (t: number) => number][] = [
      ['vf27-kestrel', 0, 0.3, () => 0], // laser
      ['vf27-kestrel', 1, 0.12, () => 0], // autocannon
      ['choir-cantor', 0, -0.06, () => 0], // hymn (harmonic)
      ['choir-cantor', 1, -0.24, (t) => Math.sin(t * 2.4) * 0.07], // beam lance, sweeping
    ];
    const probeHit = createRayHit();
    const plating = (z: number, out: Vector3): Vector3 => {
      const from = toUniverse(cap, st.cx + st.halfW * 4, st.cy - st.halfH * 0.4, st.cz + st.halfL * z, new Vector3());
      const dir = new Vector3(-st.halfW * 8, 0, 0).applyQuaternion(cap.flight.orientation);
      const facings = st.facings.slice();
      st.facings.fill(0); // probe the plating, not the shell
      const hit = raycastShip(cap, from, dir, 0, probeHit);
      st.facings.splice(0, facings.length, ...facings);
      return hit ? out.copy(probeHit.point) : toUniverse(cap, st.cx, st.cy, st.cz + st.halfL * z, out);
    };
    const mid = plating(0.03, new Vector3());
    const fire = side !== 'regen' && side !== 'subsystem';
    lineUp.forEach(([bp, gun, z, sweep], i) => {
      const at = toUniverse(cap, st.cx + st.halfW + 600, st.cy + st.halfH * (0.3 + i * 0.25), st.cz + st.halfL * z, new Vector3());
      const s = this.fleet.spawn(bp, bp.startsWith('choir') ? 'choir' : 'concord', at, new Vector3(-1, 0, 0), { name: `${bp} ${i}`, plotArmour: true });
      s.team = 'concord';
      s.combat.gun = gun;
      this.scripted.push({
        ship: s,
        aim: () => plating(z + sweep(this.simT), new Vector3()),
        speed: 0,
        fire: (t) => fire && (gun === 1 && bp === 'choir-cantor' ? t % 0.8 < 0.5 : true),
      });
      if (i === 0) this.player = s;
    });
    this.player.isPlayer = true;
    this.player.target = cap;
    if (fire) {
      // A micro-missile swarm from further out (explosive).
      const wh = this.fleet.spawn('sb9-warhorse', 'concord', toUniverse(cap, st.cx + st.halfW + 900, st.cy + st.halfH * 2.5, st.cz - st.halfL * 0.1, new Vector3()), new Vector3(-1, 0, 0), { name: 'Warhorse', plotArmour: true });
      wh.team = 'concord';
      this.scripted.push({ ship: wh, aim: () => cap.flight.position, speed: 0, fire: () => false });
      this.missiles.salvo(wh, cap, MISSILES.micro);
    }
    if (side === 'collapse') {
      this.freezeOnCollapse = true;
      this.collapseAfter = after;
    }
    if (side === 'subsystem') {
      const blow = (kind: string, at: number) => {
        const sub = st.subsystems.find((x) => x.kind === kind && !x.destroyed);
        if (sub) this.timed.push({ at, fn: () => this.fleet.hit(cap, sub.hpMax * 3, 'explosive', subsystemPosition(cap, sub, new Vector3()), null, null) });
      };
      blow('hangar', 0.05);
      blow('engine', 0.35);
      blow('turret', 0.6);
    }
    const view = Number(new URLSearchParams(location.search).get('cam') ?? 0) || 0;
    const side3 = new Vector3(1, 0.35, 0.25).applyQuaternion(cap.flight.orientation).normalize();
    this.eyeFn = (_t, eye, look) => {
      if (view === 1) {
        // Close on the struck plating.
        eye.copy(mid).addScaledVector(side3, 330);
        look.copy(mid);
      } else if (view === 2) {
        // Over the stern (engines, hangar).
        toUniverse(cap, st.cx + st.halfW * 3.2, st.cy + st.halfH * 3.5, st.cz - st.halfL * 1.5, eye);
        toUniverse(cap, st.cx, st.cy, st.cz - st.halfL * 0.45, look);
      } else {
        eye.copy(mid).addScaledVector(side3, 900);
        look.copy(mid);
      }
    };
    return side === 'regen' || side === 'subsystem' ? 0.02 : 0.7;
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
    if (fx && this.fxOn) this.combatFx.consume(dt);
    this.hud.consume(this.weapons.events, this.player, this.simT);
    if (fx) for (const e of this.weapons.events) this.tally[e.kind] = (this.tally[e.kind] ?? 0) + 1;
    if (this.freezeOnCollapse && fx && this.weapons.events.some((e) => e.kind === 'shield-down') && !Number.isFinite(this.freeze)) this.freeze = this.liveT + this.collapseAfter;
  }

  update({ dt }: FrameContext): void {
    if (!this.frozen) {
      this.liveT += dt;
      for (let i = this.timed.length - 1; i >= 0; i--) {
        if (this.liveT < this.timed[i].at) continue;
        this.timed[i].fn();
        this.timed.splice(i, 1);
      }
      this.step(dt, true);
      if (Number.isFinite(this.freeze) && this.liveT >= this.freeze) this.frozen = true;
    }
    const look = _w;
    this.eyeFn(this.simT, this.world.eye, look);
    this.world.sync(this.camera);
    this.camera.lookAt(look.sub(this.world.eye));
    this.backdrop.follow(this.camera);
    const vdt = this.frozen ? 0 : dt;
    this.visuals.consume();
    this.visuals.update(this.world, vdt);
    this.combatFx.update(vdt, this.world.eye);
    if (this.hudOn) this.hud.draw(this.player, this.target, this.camera, this.world, this.simT, this.stage === 'capital' || this.stage === 'shield' || this.stage === 'impacts');
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  cameraLabel(): string {
    const t = this.tally;
    const n = this.stage === 'impacts' ? ` · hit ${t.hit ?? 0} · shield ${t.shield ?? 0} · beam ${t['beam-hit'] ?? 0} · ${this.combatFx.decals.count} marks` : '';
    return `COMBAT · ${this.stage.toUpperCase()}${n}${this.frozen ? ' · FROZEN' : ''}`;
  }
}
