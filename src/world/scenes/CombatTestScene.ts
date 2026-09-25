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
import { CAPITAL_LANCE, CAPITAL_LANCE_GUN, GUNS, MISSILES, type GunId, type MissileId } from '@/sim/Loadouts';
import { BLUEPRINTS } from '@/assets/blueprints';
import { resetDamage, syncShield } from '@/sim/Damage';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { CombatHud } from '@/ui/CombatHud';
import { getAudio, type AudioFrame } from '@/audio';

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
 *   stage=kill      a capital dying by one kill path (Structure.ts / Destruction.ts),
 *                   &path=reactor (the white flash and shock ring reaching her
 *                   escort) · structural (the spine snaps, two burning halves
 *                   spin apart) · bridge (she strikes: the whole hull dark and
 *                   drifting) · hull (the rolling chain, then three sections).
 *                   &t=S (or &kt=S, for record.mjs which owns &t) seconds after the death at capture (default per path;
 *                   under 0.7 the death plays live, else it happens in the
 *                   fast-forward and the wreck burns live); &ship=<id>
 *                   (default choir-cathedral)
 *   &ship=<id>      capital for stage=capital (default choir-cathedral) or
 *                   stage=impacts (default bb-indomitable; &faction=choir|rustwake
 *                   picks the shield shell style)
 *   &freeze=S       stop the sim S seconds into the live section (screenshots)
 *   &firefor=S      impacts: stop firing after S live seconds (inspect cooling marks)
 *   &cam=0..2       alternate framings
 *
 * The fight is fast-forwarded without FX to `pre` seconds, then runs live so
 * trails, smoke and craters build up on screen.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);
const DT = 1 / 60;

type Stage = 'capital' | 'shield' | 'smoke' | 'weapons' | 'impacts' | 'kill' | 'audition';
type KillStagePath = 'reactor' | 'structural' | 'bridge' | 'hull';

/** Default seconds after the death for each path's capture. */
const KILL_T: Record<KillStagePath, number> = { reactor: 0.45, structural: 18, bridge: 6, hull: 12 };

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
  /** …and at fast-forward times (s). */
  private preTimed: { at: number; fn: () => void }[] = [];
  private killPath: KillStagePath | null = null;
  /** Keep fast-forwarding while this holds (bounded by 4 × pre). */
  private preUntil: (() => boolean) | null = null;
  /** &hud=0: no combat HUD (clean captures). */
  private hudOn = new URLSearchParams(location.search).get('hud') !== '0';
  /** &fx=0: no particles (inspect the hull paint alone). */
  private fxOn = new URLSearchParams(location.search).get('fx') !== '0';
  private audio = getAudio();
  private audioFrame!: AudioFrame;
  private auditionStep: (() => void) | null = null;
  private auditionPanel: HTMLElement | null = null;
  private audioMeter: HTMLOutputElement | null = null;

  constructor() {
    const q = new URLSearchParams(location.search);
    this.combatFx.fx.enabled = this.fxOn;
    this.stage = (['capital', 'shield', 'smoke', 'weapons', 'impacts', 'kill', 'audition'] as const).find((s) => s === q.get('stage')) ?? 'capital';
    this.freeze = Number(q.get('freeze') ?? NaN);
    this.camMode = Number(q.get('cam') ?? 0) || 0;
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group, this.visuals.group, this.combatFx.fx.object);
    this.hud = new CombatHud(document.getElementById('ui-root')!);

    let pre = 0;
    if (this.stage === 'audition') pre = this.setupAudition(q);
    else if (this.stage === 'capital') pre = this.setupCapital(q.get('ship') ?? 'choir-cathedral');
    else if (this.stage === 'shield') pre = this.setupShield();
    else if (this.stage === 'smoke') pre = this.setupSmoke();
    else if (this.stage === 'kill') {
      const path = (['reactor', 'structural', 'bridge', 'hull'] as const).find((x) => x === q.get('path')) ?? 'reactor';
      pre = this.setupKill(path, Number(q.get('kt') ?? q.get('t') ?? KILL_T[path]), q.get('ship') ?? 'choir-cathedral');
    } else if (this.stage === 'impacts') pre = this.setupImpacts(q.get('side') ?? 'hull', Number(q.get('after') ?? 0.1), q.get('ship') ?? 'bb-indomitable', (q.get('faction') ?? 'concord') as FactionId);
    else pre = this.setupWeapons();

    this.audioFrame = {
      dt: 0, eye: this.world.eye, camera: this.camera.quaternion,
      player: { position: this.player.flight.position, velocity: this.player.flight.velocity, throttle: 0, boosting: false, cruise: 'off', lockProgress: 0, locked: false, incomingMissile: false, alive: false },
      weaponEvents: [], missileEvents: [], beams: [], jumpPhase: 'none', combatIntensity: 0,
    };

    // Fast-forward (no FX): the fight settles into shape.
    for (let t = 0; t < pre || (this.preUntil?.() && t < pre * 8); t += DT) {
      for (let i = this.preTimed.length - 1; i >= 0; i--) {
        if (t < this.preTimed[i].at) continue;
        this.preTimed[i].fn();
        this.preTimed.splice(i, 1);
      }
      this.step(DT, false);
    }
    window.__VANGUARD__ = { ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '', hooks: { ...window.__VANGUARD__?.hooks, scene: this } };
  }

  // ── stages ───────────────────────────────────────────────────────────

  private setupAudition(q: URLSearchParams): number {
    const hull = q.get('ship') ?? 'vf27-kestrel';
    const bp = BLUEPRINTS[hull] ?? BLUEPRINTS['vf27-kestrel'];
    const weapon = q.get('weapon') ?? 'laser';
    const gun = GUNS[weapon as GunId];
    const missile = MISSILES[weapon as MissileId];
    const charge = Math.max(0, Math.min(1, Number(q.get('charge') ?? 1) || 0));
    const distance = Math.max(60, Math.min(3000, Number(q.get('distance') ?? 300) || 300));
    const listener = Math.max(30, Math.min(4000, Number(q.get('listener') ?? 100) || 100));
    const target = this.fleet.spawn(bp.id, bp.faction, ORIGIN.clone(), new Vector3(0,0,1), { name: bp.name, team: 'renegade', plotArmour: true });
    target.flight.velocity.set(0,0,0); target.controls.throttleSet = 0;
    const st = target.combat.dmg;
    st.trimAuto = false;
    const restore = () => { resetDamage(st,target); target.combat.damaged=false; st.facings.fill(st.facingMax * charge); st.cooldown.fill(1e6); syncShield(st,target); target.sinceHit=0; };
    restore();
    const aim = toUniverse(target,st.cx,st.cy,st.cz,new Vector3());
    const start = aim.clone().add(new Vector3(0,0,target.combat.shell.z+distance));
    const shooter = this.fleet.spawn('vf27-kestrel','concord',start,new Vector3(0,0,-1),{isPlayer:q.get('listenerMode')==='cockpit',plotArmour:true});
    shooter.combat.loadout = { guns: gun ? [gun.id] : [], missiles: [] };
    this.scripted.push({ship:shooter,aim:()=>aim,speed:0,fire:()=>!!gun});
    this.player=shooter; this.target=target; shooter.target=target;
    let next=0.3;
    this.auditionStep=()=>{
      target.flight.velocity.set(0,0,0); target.sinceHit=0;
      if (this.simT < next) return;
      if (missile) { this.missiles.salvo(shooter,target,missile); next=this.simT+Math.max(2,missile.reload); }
      else if (weapon==='capital-lance') {
        const b=CAPITAL_LANCE_GUN.beam!;
        const beam=this.weapons.fireBeam(shooter,null,b.length,b.width,b.duration,st.capital ? CAPITAL_LANCE.dpsCapital : CAPITAL_LANCE.dpsFighter,'harmonic');
        this.weapons.muzzleFlash(beam.origin,beam.dir,shooter.flight.velocity,shooter,CAPITAL_LANCE_GUN);
        next=this.simT+4;
      }
    };
    this.eyeFn=(_t,eye,look)=>{ look.copy(aim);eye.copy(aim).add(new Vector3(target.combat.shell.x+listener, target.combat.shell.y+listener*0.3,target.combat.shell.z+listener)); };
    const panel=document.createElement('details');panel.open=true;
    panel.style.cssText='position:fixed;right:12px;top:58px;z-index:70;background:#071323ed;color:#d8efff;border:1px solid #79cee0;padding:12px;width:290px;font:12px ui-monospace,monospace;pointer-events:auto';
    const title=document.createElement('summary');title.textContent='Combat audition';panel.append(title);
    const form=document.createElement('form');panel.append(form);
    const choices=(key:string,labelText:string,entries:[string,string][],value:string)=>{
      const label=document.createElement('label');label.textContent=labelText;label.style.cssText='display:flex;justify-content:space-between;margin:9px 0;gap:8px';
      const select=document.createElement('select');select.name=key;select.setAttribute('aria-label',labelText);select.style.maxWidth='175px';
      for(const [v,name] of entries){const option=document.createElement('option');option.value=v;option.textContent=name;select.append(option);}select.value=value;label.append(select);form.append(label);
    };
    choices('ship','Target',Object.values(BLUEPRINTS).map(b=>[b.id,b.name]),bp.id);
    choices('weapon','Weapon',[...Object.values(GUNS).map(g=>[g.id,g.name] as [string,string]),...Object.values(MISSILES).map(m=>[m.id,m.name] as [string,string]),['capital-lance','CAPITAL LANCE']],weapon);
    choices('charge','Initial shields',[['1','Full'],['0.05','Weak (5%)'],['0','Hull exposed']],String(charge));
    choices('distance','Firing distance',[['100','100 m'],['300','300 m'],['1000','1 km'],['2500','2.5 km']],String(distance));
    choices('listener','Camera stand-off',[['40','40 m'],['100','100 m'],['500','500 m'],['2000','2 km']],String(listener));
    choices('listenerMode','Gun sound',[['external','At emitter'],['cockpit','In cockpit']],q.get('listenerMode')??'external');
    const apply=document.createElement('button');apply.textContent='Apply / restart';form.append(apply);
    const reset=document.createElement('button');reset.type='button';reset.textContent='Restore target';reset.addEventListener('click',restore);form.append(reset);
    form.addEventListener('submit',event=>{event.preventDefault();const next=new URLSearchParams({scene:'combat',stage:'audition'});for(const [key,value] of new FormData(form))next.set(key,String(value));location.search=next.toString();});
    panel.addEventListener('keydown',e=>e.stopPropagation());panel.addEventListener('pointerdown',e=>e.stopPropagation());
    this.audioMeter=document.createElement('output');this.audioMeter.style.cssText='display:block;margin-top:12px;line-height:1.6';panel.append(this.audioMeter);
    document.getElementById('ui-root')!.append(panel);this.auditionPanel=panel;
    return 0;
  }

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
    const fireFor = Number(new URLSearchParams(location.search).get('firefor') ?? Infinity);
    lineUp.forEach(([bp, gun, z, sweep], i) => {
      const at = toUniverse(cap, st.cx + st.halfW + 600, st.cy + st.halfH * (0.3 + i * 0.25), st.cz + st.halfL * z, new Vector3());
      const s = this.fleet.spawn(bp, bp.startsWith('choir') ? 'choir' : 'concord', at, new Vector3(-1, 0, 0), { name: `${bp} ${i}`, plotArmour: true });
      s.team = 'concord';
      s.combat.gun = gun;
      this.scripted.push({
        ship: s,
        aim: () => plating(z + sweep(this.simT), new Vector3()),
        speed: 0,
        fire: (t) => fire && this.liveT < fireFor && (gun === 1 && bp === 'choir-cantor' ? t % 0.8 < 0.5 : true),
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
      // Exercise the actual wreck drive and event consumers with exposed mounts.
      st.facings.fill(0);
      st.cooldown.fill(1e3);
      cap.shield = 0;
      this.capitals.register(cap);
      for (const gun of this.capitals.list[0].guns) gun.cooldown = Infinity;
      const blow = (kind: string, at: number, droop = false) => {
        this.timed.push({ at, fn: () => {
          const sub = st.subsystems.find((x) => x.kind === kind && !x.destroyed && (kind !== 'turret' || x.x > st.cx));
          if (!sub) return;
          if (droop) sub.hp = sub.hpMax * 0.05;
          this.fleet.hit(cap, droop ? sub.hpMax * 0.1 : sub.hpMax * 3, droop ? 'kinetic' : 'explosive', subsystemPosition(cap, sub, new Vector3()), null, null, sub);
        } });
      };
      blow('hangar', 0.05);
      blow('engine', 0.35);
      blow('turret', 0.6);
      blow('turret', 0.8, true);
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
    // One-shot FX must happen in the live section, where the visual consumers run.
    return side === 'regen' || side === 'subsystem' || side === 'collapse' ? 0 : 0.7;
  }

  /**
   * stage=kill: a capital, shields down, dies by `path` `after` seconds
   * before the capture. A Kestrel wing (the player's) stands off her flank;
   * a Vesper escorts her (the reactor's shockwave reaches it).
   */
  private setupKill(path: KillStagePath, after: number, id: string): number {
    this.killPath = path;
    const cap = this.fleet.spawn(id, 'choir', ORIGIN.clone(), new Vector3(1, 0, 0.25).normalize(), { name: 'Cathedral Ascendant' });
    cap.flight.velocity.set(0, 0, 0);
    cap.controls.throttleSet = 0;
    this.target = cap;
    const st = cap.combat.dmg;
    const L = st.halfL;
    const escort = this.fleet.spawn('choir-vesper', 'choir', toUniverse(cap, st.cx - st.halfW * 4, st.cy, st.cz + L * 0.4, new Vector3()), new Vector3(0, 0, 1).applyQuaternion(cap.flight.orientation), { name: 'Vesper' });
    escort.flight.velocity.set(0, 0, 0);
    this.scripted.push({ ship: escort, aim: () => null, speed: 0, fire: () => false });
    const start = toUniverse(cap, st.cx + st.halfW * 4, st.cy + st.halfH * 1.5, st.cz + L * 0.2, new Vector3());
    const wing = this.spawnWing('vf27-kestrel', 'concord', 4, start, new Vector3(-1, -0.2, 0).normalize().applyQuaternion(cap.flight.orientation), 70);
    wing.forEach((s) => this.scripted.push({ ship: s, aim: () => (cap.alive ? cap.flight.position : null), speed: 20, fire: () => false }));
    this.player = wing[0];
    this.player.isPlayer = true;
    this.player.target = cap;
    // The shields are long gone; a few mounts already wrecked.
    const drop = () => {
      st.facings.fill(0);
      st.cooldown.fill(1e3);
      cap.shield = 0;
      cap.sinceHit = 0;
    };
    drop();
    const by = this.player;
    const at = (x: number, y: number, z: number) => toUniverse(cap, x, y, z, new Vector3());
    const hitSub = (kind: string) => {
      const sub = st.subsystems.find((x) => x.kind === kind && !x.destroyed);
      if (sub) this.fleet.hit(cap, sub.hp / 1.6 + 1, 'explosive', subsystemPosition(cap, sub, new Vector3()), null, by, sub);
    };
    const kill = () => {
      drop();
      if (path === 'structural') {
        const mid = st.structure.sections[1];
        mid.hp = mid.hpMax * 0.02;
        for (let i = 0; i < 40 && cap.alive; i++) this.fleet.hit(cap, 900, 'explosive', at(st.cx + st.halfW * 0.5, st.cy, st.cz + ((i % 5) - 2) * 30), null, by);
      } else if (path === 'reactor') {
        hitSub('reactor');
        // The fuse is nearly out (the wing kept the core under fire).
        st.structure.reactor.t = Math.min(st.structure.reactor.t, 0.05);
      } else if (path === 'bridge') {
        cap.hull = cap.hullMax * 0.3;
        hitSub('bridge');
      } else {
        cap.hull = cap.hullMax * 0.004;
        for (let i = 0; i < 8 && cap.alive; i++) this.fleet.hit(cap, cap.hullMax * 0.01, 'kinetic', at(st.cx + st.halfW, st.cy, st.cz + (i - 4) * L * 0.1), null, by);
      }
    };
    // Earlier battle damage (visible on the wreck): two batteries and a hangar.
    this.preTimed.push({
      at: 0,
      fn: () => {
        for (const k of ['turret', 'turret', 'hangar']) hitSub(k);
      },
    });
    let pre = 0.2;
    if (after < 0.7) {
      this.timed.push({ at: 0.02, fn: kill });
      this.freeze = 0.02 + after;
    } else {
      pre = after;
      this.preTimed.push({ at: 0.1, fn: kill });
    }
    // Broadside, far enough to hold the whole hull (and the pieces as they part).
    const far = path === 'structural' || path === 'hull' ? 2.6 : path === 'reactor' ? 2.4 : 1.8;
    this.eyeFn = (_t, eye, look) => {
      if (this.camMode === 1) {
        toUniverse(cap, st.cx + L * far * 0.7, st.cy - L * 0.35, st.cz + L * far * 0.7, eye);
      } else toUniverse(cap, st.cx + L * far, st.cy + L * 0.45, st.cz + L * 0.15, eye);
      look.copy(cap.flight.position);
    };
    return pre;
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
    this.auditionStep?.();
    for (const sc of this.scripted) sc.ship.flight.velocity.copy(sc.ship.flight.forward(_v)).multiplyScalar(sc.speed);
    this.weapons.step(dt);
    this.missiles.step(dt);
    // Weapons.step clears its event list: staged hits must run afterwards so
    // their collapse / subsystem / kill events reach the same frame's FX.
    if (fx) for (let i = this.timed.length - 1; i >= 0; i--) {
      if (this.liveT < this.timed[i].at) continue;
      this.timed[i].fn();
      this.timed.splice(i, 1);
    }
    if (fx) this.combatFx.consume(dt);
    this.hud.consume(this.weapons.events, this.player, this.simT);
    if (fx) for (const e of this.weapons.events) this.tally[e.kind] = (this.tally[e.kind] ?? 0) + 1;
    if (this.freezeOnCollapse && fx && this.weapons.events.some((e) => e.kind === 'shield-down') && !Number.isFinite(this.freeze)) this.freeze = this.liveT + this.collapseAfter;
  }

  update({ dt }: FrameContext): void {
    const advanced = !this.frozen;
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
    if (advanced) this.visuals.consume();
    this.visuals.update(this.world, vdt);
    this.combatFx.update(vdt, this.world.eye);
    this.audioFrame.dt = dt;
    this.audioFrame.weaponEvents = advanced ? this.weapons.events : [];
    this.audioFrame.missileEvents = advanced ? this.missiles.events : [];
    this.audioFrame.beams = advanced ? this.weapons.beams : [];
    this.audio.update(this.audioFrame);
    if (this.audioMeter) {
      const e=this.audio.engine;
      this.audioMeter.textContent=`${e.running ? e.outputMode : 'Click Audio to enable sound'} · voices ${e.activeVoices()}/40 · dropped ${e.metrics.dropped} · stolen ${e.metrics.stolen} · compression ${Math.abs(e.compressor?.reduction ?? 0).toFixed(1)} dB`;
    }
    if (this.hudOn) {
      const blast = this.combatFx.destruction;
      this.hud.flash = blast.screenFlash * Math.max(0, 1 - blast.lastBlast.distanceTo(this.world.eye) / 9000);
      this.hud.draw(this.player, this.target, this.camera, this.world, this.simT, this.stage !== 'smoke' && this.stage !== 'weapons');
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  dispose(): void { this.auditionPanel?.remove(); this.audio.sfx.updateBeams([],this.world.eye); }

  cameraLabel(): string {
    const t = this.tally;
    const n = this.stage === 'impacts' ? ` · hit ${t.hit ?? 0} · shield ${t.shield ?? 0} · beam ${t['beam-hit'] ?? 0} · ${this.combatFx.decals.count} marks` : '';
    const k = this.killPath ? ` · ${this.killPath.toUpperCase()} · ${this.fleet.destruction.wrecks.length} wreck pieces` : '';
    return `COMBAT · ${this.stage.toUpperCase()}${n}${k}${this.frozen ? ' · FROZEN' : ''}`;
  }
}
