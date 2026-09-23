import { Vector3 } from 'three';
import type { Livery } from '@/assets/Blueprint';
import type { EconFaction } from '@/game/economy';
import { emptyControls, faceAlong, type Fleet, type ShipEntity, type Team } from '@/sim/Fleet';
import { KESTREL_SPEC, type FlightSpec } from '@/sim/FlightModel';
import type { WeaponEvent } from '@/sim/Weapons';
import { brainOf, issueOrder, setFormation } from '@/sim/ai';
import { createPilotState, inFiringSolution, leadPoint, setSpeed, steerToward, type PilotState, type SteerGains } from '@/sim/ai/Pilot';
import { PAL, PK } from '@/fx/kinds';
import { makeSpawn } from '@/fx/spawn';
import type { Particles } from '@/fx/Particles';
import {
  TRAFFIC_ROLES,
  ambushOf,
  laneProgress,
  lanePoint,
  manifest,
  nextArrivals,
  sailingsAt,
  systemLanes,
  wingSize,
  type AmbushPlan,
  type Manifest,
  type Sailing,
  type TrafficLane,
  type TrafficRole,
} from '@/universe/traffic';
import { SYSTEM_OFFSET, type StarSystemView } from './StarSystemView';

/**
 * Ambient traffic (the living Reach). The timetable is pure data
 * (`universe/traffic.ts`); this materialises the sailings near the player as
 * real fleet ships — same FlightModel, same weapons, provokable — and flies
 * them:
 *
 *  - Haulers (freighters, tankers, liners, couriers, miners) follow their
 *    lane: slow off the node, lane cruise, slow approach, then vanish into a
 *    Lantern (jump flash) or a docking bay. Arrivals from a Lantern jump in
 *    with a flash on the timetable second.
 *  - Patrols fly wings of 2–4: the leader walks the lane, wingmen hold
 *    formation through the fighter AI; they break off to answer distress
 *    calls and hostiles, then re-form.
 *  - Rustwake raiders ambush haulers in lawless / border systems at a
 *    deterministic point on the lane: a visible event the player can join
 *    (bounty + standing via `onEvent`).
 *
 * Budget & LOD: at most `budget` ships at once, spawned inside `spawnRadius`
 * nearest-first and parked past `despawnRadius` (hysteresis). Ships near the
 * player are flown every frame; mid-range every 3rd; far ones are snapped to
 * their timetable position every 8th frame (no steering at all).
 *
 * Teams: haulers are 'neutral' (shoot one and it turns); patrols fly their
 * flag (Rustwake militia stay neutral and strafe raiders by script);
 * raiders are 'renegade' — hostile to everyone with a flag.
 */
export type TrafficState = 'lane' | 'dock' | 'mine' | 'evade' | 'respond' | 'engage' | 'raid' | 'fled';

export interface TrafficShip {
  ship: ShipEntity;
  role: TrafficRole;
  flag: EconFaction;
  sailing: Sailing | null;
  manifest: Manifest;
  state: TrafficState;
  pilot: PilotState;
  /** Patrol / raider band: the leader (itself for the leader). */
  leader: TrafficShip;
  wing: TrafficShip[];
  ambush: Ambush | null;
  plan: AmbushPlan | null;
  /** Off the timetable (fought, fled): never snapped back to the lane. */
  offSchedule: boolean;
  lod: number;
  since: number;
  poolKey: string;
  /** Raider strafing phase. */
  pass: 'attack' | 'extend';
  /** Destroyed (vs merely parked out of range). */
  dead: boolean;
  parked: boolean;
}

export interface Ambush {
  id: number;
  victim: TrafficShip;
  raiders: TrafficShip[];
  band: string;
  started: number;
  position: Vector3;
  playerKills: number;
  playerJoined: boolean;
  resolved: boolean;
}

export type TrafficEvent =
  | { kind: 'ambush'; ambush: Ambush }
  | { kind: 'repelled'; ambush: Ambush; saved: boolean }
  | { kind: 'lost'; ambush: Ambush }
  | { kind: 'raider-down'; ambush: Ambush; byPlayer: boolean }
  | { kind: 'jump-in' | 'jump-out'; ship: TrafficShip };

const GAINS: SteerGains = { kp: 3.2, kd: 0.35, bank: 0.7, authority: 0.75 };
const RAIDER_GAINS: SteerGains = { kp: 5.5, kd: 0.35, bank: 1, authority: 1 };

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _dir = new Vector3();
const _aim = new Vector3();

/** Flight specs per role: haulers are slow and ponderous; fighters keep theirs. */
function specFor(role: TrafficRole, base: FlightSpec): FlightSpec {
  const r = TRAFFIC_ROLES[role];
  if (role === 'patrol' || role === 'pirate') return { ...base, cruiseSpeed: Math.max(base.cruiseSpeed, r.laneSpeed) };
  const heavy = role === 'tanker' || role === 'freighter' || role === 'liner' || role === 'miner';
  return {
    ...KESTREL_SPEC,
    maxSpeed: r.speed * 1.6,
    boostSpeed: r.speed * 2.2,
    mainAccel: heavy ? 18 : 45,
    boostAccel: heavy ? 26 : 90,
    lateralAccel: heavy ? 14 : 40,
    pitchRate: heavy ? 0.32 : 1.2,
    yawRate: heavy ? 0.26 : 0.9,
    rollRate: heavy ? 0.5 : 2.4,
    rateResponse: heavy ? 3 : 10,
    cruiseSpeed: r.laneSpeed,
    cruiseAccel: heavy ? 140 : 380,
    cruiseSpool: 2.5,
  };
}

export class Traffic {
  readonly ships: TrafficShip[] = [];
  readonly ambushes: Ambush[] = [];
  /** Events since the last `update` (read them, or subscribe with `onEvent`). */
  readonly events: TrafficEvent[] = [];
  onEvent: ((e: TrafficEvent) => void) | null = null;
  budget = 22;
  spawnRadius = 24_000;
  despawnRadius = 32_000;
  enabled = true;
  /** Timetable clock (seconds). */
  clock = 0;
  lanes: TrafficLane[] = [];

  private view: StarSystemView | null = null;
  private sysId = '';
  private pool = new Map<string, ShipEntity[]>();
  private owned = new Set<ShipEntity>();
  /** Sailings that ended (arrived, destroyed) — never re-materialised. */
  private gone = new Set<string>();
  private live = new Map<string, TrafficShip>();
  private refreshIn = 0;
  private frame = 0;
  private ambushSerial = 0;
  private active: Sailing[] = [];
  private byShip = new Map<ShipEntity, TrafficShip>();
  private spawnDesc = makeSpawn();

  constructor(
    private fleet: Fleet,
    private fx: Particles | null,
    private hasBlueprint: (id: string) => boolean,
    private seed = 1994,
  ) {}

  /** Tracked traffic entry for a fleet ship (HUD hail, event hooks). */
  of(s: ShipEntity | null | undefined): TrafficShip | undefined {
    return s ? this.byShip.get(s) : undefined;
  }

  /** Point at a (new) system: parks everything, rebuilds the lane graph. */
  setSystem(view: StarSystemView): void {
    if (this.view === view) return;
    this.clear();
    this.view = view;
    this.sysId = view.system.id;
    this.lanes = systemLanes(this.seed, view.system);
    for (const l of this.lanes) {
      l.from.position.add(SYSTEM_OFFSET);
      l.to.position.add(SYSTEM_OFFSET);
    }
    this.gone.clear();
    this.refreshIn = 0;
  }

  /** Park every traffic ship (campaign episodes, system change). */
  clear(): void {
    for (const t of [...this.ships]) this.park(t);
    this.ambushes.length = 0;
    this.live.clear();
  }

  // ── per frame ───────────────────────────────────────────────────────

  update(dt: number, player: ShipEntity, weaponEvents: readonly WeaponEvent[]): void {
    this.events.length = 0;
    if (!this.view) return;
    if (!this.enabled) {
      if (this.ships.length) this.clear();
      return;
    }
    this.clock += dt;
    this.frame++;
    this.consume(weaponEvents, player);

    if ((this.refreshIn -= dt) <= 0) {
      this.refreshIn = 0.25;
      this.materialise(player);
    }
    const pp = player.flight.position;
    for (const t of [...this.ships]) {
      if (t.parked) continue;
      if (!t.ship.alive) {
        this.onDeath(t);
        continue;
      }
      t.since += dt;
      const d = t.ship.flight.position.distanceTo(pp);
      const busy = t.state === 'engage' || t.state === 'raid' || t.state === 'respond' || !!t.ambush;
      if (d > this.despawnRadius && !(busy && d < this.despawnRadius * 1.5)) {
        this.park(t);
        continue;
      }
      this.think(t, player, d, dt);
    }
    for (const a of this.ambushes) this.tickAmbush(a);
    for (const e of this.events) this.onEvent?.(e);
  }

  // ── materialisation ─────────────────────────────────────────────────

  private budgetUsed(): number {
    return this.ships.length;
  }

  private materialise(player: ShipEntity): void {
    const pp = player.flight.position;
    sailingsAt(this.sysId, this.lanes, this.clock, this.active);
    const cands: { s: Sailing; d: number }[] = [];
    for (const s of this.active) {
      if (this.live.has(s.key) || this.gone.has(s.key)) continue;
      const pr = laneProgress(s.lane, s.role, this.clock - s.depart);
      const d = lanePoint(s.lane, pr.dist, _a).distanceTo(pp);
      if (d < this.spawnRadius) cands.push({ s, d });
    }
    cands.sort((x, y) => x.d - y.d);
    for (const c of cands) {
      const need = c.s.role === 'patrol' ? wingSize(c.s) : 1;
      if (this.budgetUsed() + need > this.budget) break;
      this.spawnSailing(c.s);
    }
  }

  private hull(role: TrafficRole, flag: EconFaction): string {
    const list = TRAFFIC_ROLES[role].hulls[flag];
    return list.find((id) => this.hasBlueprint(id)) ?? list[list.length - 1];
  }

  private acquire(bp: string, faction: EconFaction, livery: Partial<Livery> | undefined, key: string, pos: Vector3, fwd: Vector3, name: string): ShipEntity {
    const pool = this.pool.get(key);
    const s = pool?.pop();
    if (s) {
      s.flight.position.copy(pos);
      faceAlong(s.flight.orientation, fwd);
      s.flight.bodyRates.set(0, 0, 0);
      s.name = name;
      s.faction = faction;
      s.alive = true;
      s.model.root.visible = true;
      s.target = null;
      s.sinceHit = 99;
      Object.assign(s.controls, emptyControls());
      return s;
    }
    const e = this.fleet.spawn(bp, faction, pos, fwd, { name }, livery);
    this.owned.add(e);
    return e;
  }

  private make(role: TrafficRole, flag: EconFaction, s: Sailing | null, pos: Vector3, fwd: Vector3, name: string, team: Team, man: Manifest): TrafficShip {
    const def = TRAFFIC_ROLES[role];
    const bp = this.hull(role, flag);
    const livery = def.livery?.[flag];
    const key = `${bp}|${flag}|${role}`;
    const ship = this.acquire(bp, flag, livery, key, pos, fwd, name);
    ship.team = team;
    ship.flight.spec = specFor(role, ship.flight.spec);
    ship.flight.cruise = 'off';
    ship.flight.cruiseScale = 1;
    ship.flight.throttle = 0.6;
    const big = ship.radius > 30;
    ship.hullMax = ship.hull = big ? def.hull * 2 : def.hull;
    ship.shieldMax = ship.shield = def.shield;
    const b = brainOf(ship);
    b.scripted = true;
    b.order = 'engageAtWill';
    b.leader = null;
    const t: TrafficShip = {
      ship,
      role,
      flag,
      sailing: s,
      manifest: man,
      state: 'lane',
      pilot: createPilotState(),
      leader: null as unknown as TrafficShip,
      wing: [],
      ambush: null,
      plan: null,
      offSchedule: false,
      lod: (this.frame + ship.id) % 8,
      since: 0,
      poolKey: key,
      pass: 'attack',
      dead: false,
      parked: false,
    };
    t.leader = t;
    this.ships.push(t);
    this.byShip.set(ship, t);
    return t;
  }

  private spawnSailing(s: Sailing): void {
    const lane = s.lane;
    const tau = this.clock - s.depart;
    const pr = laneProgress(lane, s.role, tau);
    const pos = lanePoint(lane, pr.dist, new Vector3());
    const fwd = _dir.subVectors(lane.to.position, lane.from.position).normalize().clone();
    const man = manifest(s);
    const team: Team = s.role === 'patrol' ? (s.flag === 'rustwake' ? 'neutral' : s.flag) : 'neutral';
    // Departing a station early in the sailing: come out of the bay, not out of thin air.
    const st = lane.from.kind === 'station' && tau < 12 ? this.view?.stations.find((x) => x.site.id === lane.from.id) : undefined;
    if (st) pos.copy(st.bay).addScaledVector(st.axis, 200);
    const lead = this.make(s.role, s.flag, s, pos, fwd, `${man.name}`, team, man);
    lead.plan = ambushOf(this.view!.system, s);
    lead.ship.flight.velocity.copy(fwd).multiplyScalar(pr.speed * (pr.cruising ? 1 : 0.8));
    if (pr.cruising) {
      lead.ship.flight.cruise = 'on';
      lead.ship.flight.velocity.copy(fwd).multiplyScalar(Math.min(pr.speed, lead.ship.flight.spec.cruiseSpeed));
    }
    this.live.set(s.key, lead);
    if (lane.from.kind === 'gate' && tau < 1.5) this.jumpFlash(lead, 'jump-in');
    if (s.role === 'patrol') {
      const n = wingSize(s);
      const wing: ShipEntity[] = [];
      for (let i = 1; i < n; i++) {
        const off = _b.set((i % 2 ? -1 : 1) * 60 * Math.ceil(i / 2), 8 * i, -50 * i);
        const p = off.applyQuaternion(lead.ship.flight.orientation).add(pos).clone();
        const w = this.make('patrol', s.flag, null, p, fwd, `${man.name}-${i + 1}`, team, man);
        w.leader = lead;
        w.ship.flight.velocity.copy(lead.ship.flight.velocity);
        brainOf(w.ship).scripted = false;
        lead.wing.push(w);
        wing.push(w.ship);
      }
      setFormation(wing, 'fingerFour', 70);
      issueOrder(wing, 'formUp', lead.ship);
    }
  }

  private park(t: TrafficShip): void {
    if (t.parked) return;
    t.parked = true;
    const s = t.ship;
    s.alive = false;
    s.model.root.visible = false;
    s.target = null;
    s.controls.fire = false;
    s.flight.cruise = 'off';
    s.team = 'neutral';
    const b = brainOf(s);
    b.scripted = true;
    b.leader = null;
    const i = this.ships.indexOf(t);
    if (i >= 0) this.ships.splice(i, 1);
    this.byShip.delete(s);
    if (t.sailing && this.live.get(t.sailing.key) === t) this.live.delete(t.sailing.key);
    if (t.leader !== t) {
      const k = t.leader.wing.indexOf(t);
      if (k >= 0) t.leader.wing.splice(k, 1);
    }
    // A patrol leader leaving takes its wing with it.
    for (const w of [...t.wing]) if (w !== t) this.park(w);
    let pool = this.pool.get(t.poolKey);
    if (!pool) this.pool.set(t.poolKey, (pool = []));
    if (!pool.includes(s)) pool.push(s);
  }

  private onDeath(t: TrafficShip): void {
    t.dead = true;
    if (t.sailing) this.gone.add(t.sailing.key);
    // Wingmen of a dead leader: promote the next one to walk the lane.
    if (t.leader === t && t.wing.length) {
      const [next, ...rest] = t.wing;
      next.leader = next;
      next.wing = rest;
      next.sailing = t.sailing;
      next.offSchedule = true;
      for (const w of rest) w.leader = next;
      if (t.sailing) this.live.set(t.sailing.key, next);
      t.wing = [];
    }
    this.park(t);
  }

  // ── behaviour ──────────────────────────────────────────────────────

  private think(t: TrafficShip, player: ShipEntity, dPlayer: number, dt: number): void {
    const s = t.ship;
    const c = s.controls;
    if (t.role === 'pirate') return this.flyRaider(t, player, dt);
    if (t.role === 'patrol') {
      if (t.state === 'engage' && s.team === 'neutral') return this.flyMilitia(t, dt);
      if (t.leader !== t) return; // wingmen: fighter AI (formUp / engage)
      if (this.frame % 15 === t.lod) this.patrolAwareness(t);
      if (t.state === 'engage') return;
      if (t.state === 'respond' && t.ambush) {
        _a.subVectors(t.ambush.position, s.flight.position);
        const d = _a.length();
        if (d < 2500 || t.ambush.resolved) {
          this.engage(t);
          return;
        }
        steerToward(c, s.flight, _a.normalize(), null, t.pilot, dt, GAINS);
        setSpeed(c, s.flight, s.flight.spec.boostSpeed, true);
        return;
      }
    }
    // Haulers under attack run for it.
    if (t.state === 'evade' && t.ambush) return this.flyEvade(t, dt);
    if (t.state === 'fled') {
      s.flight.cruise = 'off';
      setSpeed(c, s.flight, s.flight.spec.boostSpeed, true);
      c.pitch = c.yaw = c.roll = 0;
      return;
    }
    if (t.state === 'dock') return this.flyDock(t, dt);
    if (t.state === 'mine') return this.flyMine(t, dt);
    if (t.state !== 'lane' || !t.sailing) return;

    const sl = t.sailing;
    const tau = this.clock - sl.depart;
    if (tau >= sl.duration) return this.arrive(t);
    const pr = laneProgress(sl.lane, sl.role, tau);
    // Ambush trigger (materialised haulers only).
    if (t.plan && !t.ambush && !t.offSchedule) {
      const nearStart = t.plan.at < sl.lane.length * 0.5;
      if (nearStart ? pr.dist >= t.plan.at : pr.dist >= t.plan.at) this.startAmbush(t, player);
    }
    // LOD: far ships ride the timetable; mid-range steer at a third of the rate.
    const band = dPlayer < 6000 ? 0 : dPlayer < 14_000 ? 1 : 2;
    if (band === 2 && !t.offSchedule) {
      if (this.frame % 8 !== t.lod) return;
      lanePoint(sl.lane, pr.dist, s.flight.position);
      _dir.subVectors(sl.lane.to.position, sl.lane.from.position).normalize();
      faceAlong(s.flight.orientation, _dir);
      s.flight.velocity.copy(_dir).multiplyScalar(pr.speed);
      s.flight.cruise = pr.cruising ? 'on' : 'off';
      c.pitch = c.yaw = c.roll = 0;
      c.throttleSet = pr.cruising ? 1 : Math.min(1, pr.speed / s.flight.spec.maxSpeed);
      return;
    }
    if (band === 1 && this.frame % 3 !== t.lod % 3) return;
    this.flyLane(t, pr, dt * (band === 1 ? 3 : 1));
  }

  private flyLane(t: TrafficShip, pr: { dist: number; speed: number; cruising: boolean }, dt: number): void {
    const s = t.ship;
    const f = s.flight;
    const c = s.controls;
    const lane = t.sailing!.lane;
    lanePoint(lane, pr.dist, _a);
    lanePoint(lane, Math.min(lane.length + 500, pr.dist + Math.max(500, pr.speed * 4)), _b);
    if (pr.dist + Math.max(500, pr.speed * 4) > lane.length) _b.copy(lane.to.position).addScaledVector(_dir.subVectors(lane.to.position, lane.from.position).normalize(), 600);
    _dir.subVectors(lane.to.position, lane.from.position).normalize();
    const along = _c.subVectors(_a, f.position).dot(_dir);
    _c.subVectors(_b, f.position).normalize();
    steerToward(c, f, _c, null, t.pilot, dt, GAINS);
    c.fire = false;
    const want = Math.max(20, pr.speed + Math.max(-0.5 * pr.speed, Math.min(0.6 * pr.speed, along * 0.25)));
    if (want > f.spec.boostSpeed * 1.1) {
      f.cruise = 'on';
      f.cruiseScale = want / f.spec.cruiseSpeed;
      c.throttleSet = 1;
      c.afterburner = false;
    } else {
      if (f.cruise !== 'off') f.cruise = 'off';
      f.cruiseScale = 1;
      setSpeed(c, f, want, false);
    }
  }

  /** End of the lane: into a Lantern (flash), a docking bay, or the belt. */
  private arrive(t: TrafficShip): void {
    const lane = t.sailing!.lane;
    if (lane.to.kind === 'gate') {
      this.jumpFlash(t, 'jump-out');
      this.gone.add(t.sailing!.key);
      this.park(t);
    } else if (lane.to.kind === 'station') {
      t.state = 'dock';
      t.since = 0;
    } else {
      t.state = 'mine';
      t.since = 0;
    }
  }

  private flyDock(t: TrafficShip, dt: number): void {
    const s = t.ship;
    const st = this.view?.stations.find((x) => x.site.id === t.sailing?.lane.to.id);
    if (!st || t.since > 45) {
      this.gone.add(t.sailing?.key ?? '');
      this.park(t);
      return;
    }
    _a.copy(st.bay).addScaledVector(st.axis, 60);
    const d = _a.distanceTo(s.flight.position);
    if (d < 140) {
      this.gone.add(t.sailing!.key);
      this.park(t);
      return;
    }
    _c.subVectors(_a, s.flight.position).normalize();
    steerToward(s.controls, s.flight, _c, null, t.pilot, dt, GAINS);
    s.flight.cruise = 'off';
    setSpeed(s.controls, s.flight, Math.min(TRAFFIC_ROLES[t.role].speed, 30 + d * 0.08), false);
  }

  private flyMine(t: TrafficShip, dt: number): void {
    const s = t.ship;
    const lane = t.sailing!.lane;
    // Loiter around the belt centre on a slow circle (the ore is where the rocks are).
    const a = t.since * 0.02 + (t.sailing!.k % 7);
    _a.copy(lane.to.position).add(_b.set(Math.cos(a) * 2600, Math.sin(a * 0.7) * 300, Math.sin(a) * 2600));
    _c.subVectors(_a, s.flight.position).normalize();
    steerToward(s.controls, s.flight, _c, null, t.pilot, dt, GAINS);
    s.flight.cruise = 'off';
    setSpeed(s.controls, s.flight, 45, false);
    if (t.since > 240) {
      this.gone.add(t.sailing!.key);
      this.park(t);
    }
  }

  // ── patrols ─────────────────────────────────────────────────────────

  private patrolAwareness(t: TrafficShip): void {
    const p = t.ship.flight.position;
    if (t.state === 'engage') {
      // Stand down when nothing hostile is within 8 km.
      const threat = this.fleet.ships.some((o) => o.alive && o !== t.ship && this.isFoe(t, o) && o.flight.position.distanceTo(p) < 8000);
      if (!threat) this.standDown(t);
      return;
    }
    // Distress: an unresolved ambush within 20 km.
    for (const a of this.ambushes) {
      if (a.resolved || a.position.distanceTo(p) > 20_000) continue;
      t.state = 'respond';
      t.ambush = a;
      t.offSchedule = true;
      return;
    }
    // Hostile fighters within 5 km.
    if (this.fleet.ships.some((o) => o.alive && o !== t.ship && this.isFoe(t, o) && o.flight.position.distanceTo(p) < 5000)) this.engage(t);
  }

  private isFoe(t: TrafficShip, o: ShipEntity): boolean {
    if (t.ship.team === 'neutral') return o.team === 'renegade';
    return o.team !== t.ship.team && o.team !== 'neutral';
  }

  private engage(t: TrafficShip): void {
    t.state = 'engage';
    t.offSchedule = true;
    const wing = [t, ...t.wing];
    if (t.ship.team === 'neutral') {
      // Rustwake militia: neutral flag, strafe raiders by script.
      for (const w of wing) {
        w.state = 'engage';
        brainOf(w.ship).scripted = true;
      }
      return;
    }
    for (const w of wing) {
      const b = brainOf(w.ship);
      b.scripted = false;
      b.leader = null;
      b.order = 'engageAtWill';
      b.nextThink = 0;
      w.ship.flight.cruise = 'off';
    }
  }

  private standDown(t: TrafficShip): void {
    t.state = 'lane';
    t.ambush = null;
    const b = brainOf(t.ship);
    b.scripted = true;
    const wing = t.wing.filter((w) => w.ship.alive);
    for (const w of wing) {
      w.state = 'lane';
      brainOf(w.ship).scripted = false;
    }
    if (wing.length) {
      setFormation(wing.map((w) => w.ship), 'fingerFour', 70);
      issueOrder(wing.map((w) => w.ship), 'formUp', t.ship);
    }
  }

  // ── ambushes ────────────────────────────────────────────────────────

  /** Raiders drop out of the dark on a hauler (also used by ?reach=ambush). */
  startAmbush(victim: TrafficShip, player: ShipEntity, plan: AmbushPlan | null = victim.plan, range = 1600): Ambush | null {
    if (!plan || victim.ambush) return null;
    const vf = victim.ship.flight;
    const a: Ambush = {
      id: ++this.ambushSerial,
      victim,
      raiders: [],
      band: plan.band,
      started: this.clock,
      position: vf.position.clone(),
      playerKills: 0,
      playerJoined: false,
      resolved: false,
    };
    victim.ambush = a;
    victim.state = 'evade';
    victim.offSchedule = true;
    vf.cruise = 'off';
    vf.forward(_dir);
    for (let i = 0; i < plan.raiders; i++) {
      // Cold-coasting out of the hauler's blind side, 1.6–2.4 km off.
      const ang = i * 2.1 + victim.ship.id;
      _a.set(Math.cos(ang), 0.35 * Math.sin(ang * 1.7), Math.sin(ang)).normalize();
      const pos = vf.position.clone().addScaledVector(_a, range + i * range * 0.22).addScaledVector(_dir, range * 0.45);
      const fwd = _b.subVectors(vf.position, pos).normalize().clone();
      const man: Manifest = { name: `${plan.band} ${i + 1}`, registry: 'NO TRANSPONDER', cargo: [] };
      const r = this.make('pirate', 'rustwake', null, pos, fwd, man.name, 'renegade', man);
      r.state = 'raid';
      r.ambush = a;
      r.offSchedule = true;
      r.ship.flight.velocity.copy(fwd).multiplyScalar(260);
      brainOf(r.ship).scripted = true;
      a.raiders.push(r);
    }
    for (const r of a.raiders) {
      r.leader = a.raiders[0];
      if (r !== a.raiders[0]) a.raiders[0].wing.push(r);
    }
    this.ambushes.push(a);
    this.events.push({ kind: 'ambush', ambush: a });
    void player;
    return a;
  }

  private flyEvade(t: TrafficShip, dt: number): void {
    const s = t.ship;
    const a = t.ambush!;
    // Turn away from the nearest raider and burn; weave a little.
    let near: ShipEntity | null = null;
    let nd = Infinity;
    for (const r of a.raiders) {
      if (!r.ship.alive) continue;
      const d = r.ship.flight.position.distanceTo(s.flight.position);
      if (d < nd) {
        nd = d;
        near = r.ship;
      }
    }
    if (!near) {
      t.state = 'fled';
      return;
    }
    _c.subVectors(s.flight.position, near.flight.position).normalize();
    _c.x += Math.sin(t.since * 0.7) * 0.3;
    _c.y += Math.cos(t.since * 0.5) * 0.2;
    steerToward(s.controls, s.flight, _c.normalize(), null, t.pilot, dt, GAINS);
    setSpeed(s.controls, s.flight, s.flight.spec.boostSpeed, true);
  }

  private flyRaider(t: TrafficShip, player: ShipEntity, dt: number): void {
    const s = t.ship;
    const f = s.flight;
    const c = s.controls;
    const b = brainOf(s);
    const a = t.ambush;
    if (!b.scripted) return; // dogfighting under the fighter AI
    if (t.state === 'fled') {
      // Run for the dark, away from the fight.
      _dir.subVectors(f.position, a?.position ?? player.flight.position).normalize();
      steerToward(c, f, _dir, null, t.pilot, dt, RAIDER_GAINS);
      setSpeed(c, f, f.spec.boostSpeed, true);
      c.fire = false;
      return;
    }
    const victim = a?.victim.ship;
    // The prize first; turn and fight only when shot at, when the player has
    // joined in (or crowds us), or when a patrol closes in.
    const pd = player.alive ? player.flight.position.distanceTo(f.position) : Infinity;
    const shotAt = s.sinceHit < 1.5;
    let foeNear = shotAt || pd < 800 || (!!a?.playerJoined && pd < 3500);
    if (!foeNear)
      for (const o of this.fleet.ships)
        if (o.alive && o.team !== 'neutral' && o.team !== 'renegade' && o !== player && o.flight.position.distanceTo(f.position) < 1500) {
          foeNear = true;
          break;
        }
    if (foeNear || !victim || !victim.alive) {
      b.scripted = false;
      b.order = 'engageAtWill';
      b.nextThink = 0;
      t.state = 'engage';
      if (!victim?.alive && !foeNear) {
        // Prize gone and nobody to fight: run for the dark.
        t.state = 'fled';
        b.scripted = true;
      }
      return;
    }
    this.strafe(t, victim, dt);
  }

  /** Rustwake militia: neutral flag, so no fighter AI — strafe the nearest raider by script. */
  private flyMilitia(t: TrafficShip, dt: number): void {
    const p = t.ship.flight.position;
    let best: ShipEntity | null = null;
    let bd = 7000;
    for (const o of this.fleet.ships) {
      if (!o.alive || o.team !== 'renegade') continue;
      const d = o.flight.position.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) {
      if (t.leader === t) this.standDown(t);
      else {
        t.state = 'lane';
        brainOf(t.ship).scripted = false;
        issueOrder([t.ship], 'formUp', t.leader.ship);
      }
      return;
    }
    this.strafe(t, best, dt);
  }

  /** Slashing gun passes: lead-pursue and fire, overshoot, extend, come round again. */
  private strafe(t: TrafficShip, victim: ShipEntity, dt: number): void {
    const s = t.ship;
    const f = s.flight;
    const c = s.controls;
    const tf = victim.flight;
    const d = tf.position.distanceTo(f.position);
    if (t.pass === 'attack' && d < 220) t.pass = 'extend';
    else if (t.pass === 'extend' && d > 1100) t.pass = 'attack';
    if (t.pass === 'attack') {
      leadPoint(f.position, f.velocity, tf.position, tf.velocity, null, _aim);
      _dir.subVectors(_aim, f.position).normalize();
      steerToward(c, f, _dir, null, t.pilot, dt, RAIDER_GAINS);
      setSpeed(c, f, d > 1400 ? f.spec.boostSpeed : tf.velocity.length() + 90, d > 1400);
      c.fire = d < 1300 && inFiringSolution(f, _aim, d, victim.radius, 0.012);
    } else {
      f.forward(_dir);
      _c.subVectors(f.position, tf.position).normalize();
      _dir.multiplyScalar(1.3).add(_c).normalize();
      steerToward(c, f, _dir, null, t.pilot, dt, RAIDER_GAINS);
      setSpeed(c, f, f.spec.boostSpeed, true);
      c.fire = false;
    }
  }

  private tickAmbush(a: Ambush): void {
    if (a.resolved) return;
    const alive = a.raiders.filter((r) => !r.parked && r.ship.alive);
    const v = a.victim;
    if (!v.parked) a.position.copy(v.ship.flight.position);
    if (v.parked && !v.dead) {
      // Out of range (nobody watching): the timetable settles it off-screen.
      a.resolved = true;
    } else if (v.dead) {
      a.resolved = true;
      this.events.push({ kind: 'lost', ambush: a });
      // Raiders peel off to salvage and run.
      for (const r of alive) if (brainOf(r.ship).scripted) r.state = 'fled';
    } else if (!alive.length) {
      a.resolved = true;
      a.victim.state = 'fled';
      this.events.push({ kind: 'repelled', ambush: a, saved: true });
    }
    if (a.resolved) {
      const i = this.ambushes.indexOf(a);
      if (i >= 0) this.ambushes.splice(i, 1);
    }
  }

  /** Weapon events from the previous step: provocation fix-ups, ambush tallies. */
  private consume(events: readonly WeaponEvent[], player: ShipEntity): void {
    for (const e of events) {
      if (!e.ship) continue;
      const victim = this.byShip.get(e.ship);
      const shooter = e.shooter ? this.byShip.get(e.shooter) : undefined;
      if (e.kind === 'hit' || e.kind === 'shield' || e.kind === 'beam-hit') {
        // Raider fire on a hauler: it stays a civilian (no flag to fight for), just runs.
        if (victim && shooter?.role === 'pirate' && victim.role !== 'patrol') {
          e.ship.team = 'neutral';
          if (victim.ambush === null && shooter.ambush) {
            victim.ambush = shooter.ambush;
            victim.state = 'evade';
          }
        }
        if (victim?.role === 'pirate' && e.shooter === player && victim.ambush) victim.ambush.playerJoined = true;
      }
      if (e.kind === 'kill' && victim?.role === 'pirate' && victim.ambush) {
        const byPlayer = e.shooter === player;
        if (byPlayer) {
          victim.ambush.playerKills++;
          victim.ambush.playerJoined = true;
        }
        this.events.push({ kind: 'raider-down', ambush: victim.ambush, byPlayer });
      }
    }
  }

  private jumpFlash(t: TrafficShip, kind: 'jump-in' | 'jump-out'): void {
    this.events.push({ kind, ship: t });
    const fx = this.fx;
    if (!fx) return;
    const d = this.spawnDesc;
    const p = t.ship.flight.position;
    const r = Math.max(30, t.ship.radius * 3);
    const set = (k: number, count: number, size: number, life: number) => {
      d.kind = k as typeof d.kind;
      d.palette = PAL.PLASMA;
      d.count = count;
      d.pos.copy(p);
      d.to = null;
      d.baseVel.copy(t.ship.flight.velocity).multiplyScalar(0.3);
      d.dir.set(0, 0, 0);
      d.spread = 1;
      d.speedMin = 0;
      d.speedMax = 0;
      d.lifeMin = d.lifeMax = life;
      d.size0 = size;
      d.size1 = size * 1.8;
      d.sizeJitter = 0;
      d.drag = 1;
      d.delay = 0;
      d.jitter = 0;
      d.radial = false;
      d.ageA = d.ageB = 0;
      fx.emit(d);
    };
    set(PK.FLASH, 1, r * 1.6, 0.35);
    set(PK.RING, 1, r * 0.8, 0.7);
    // Streaks along the lane: the Lattice letting go.
    t.ship.flight.forward(_dir);
    d.kind = PK.SPARK;
    d.palette = PAL.PLASMA;
    d.count = 18;
    d.dir.copy(_dir).multiplyScalar(kind === 'jump-in' ? -1 : 1);
    d.spread = 0.25;
    d.speedMin = 200;
    d.speedMax = 900;
    d.lifeMin = 0.2;
    d.lifeMax = 0.5;
    d.size0 = d.size1 = r * 0.05;
    d.drag = 2;
    fx.emit(d);
  }

  // ── capture staging (?reach=ambush | lane) ─────────────────────────

  /** A hauler 1.5 km off the nose, crossing, with raiders already on her. */
  stageAmbush(player: ShipEntity): Ambush | null {
    if (!this.view) return null;
    const pf = player.flight;
    const fwd = pf.forward(new Vector3());
    const right = new Vector3(-1, 0, 0).applyQuaternion(pf.orientation);
    const up = new Vector3(0, 1, 0).applyQuaternion(pf.orientation);
    const pos = pf.position.clone().addScaledVector(fwd, 1500).addScaledVector(right, 180).addScaledVector(up, 70);
    const heading = right.clone().multiplyScalar(-1).addScaledVector(fwd, 0.35).normalize();
    const f = this.view.system.faction;
    const flag: EconFaction = f === 'concord' || f === 'choir' ? f : 'rustwake';
    const man: Manifest = {
      name: flag === 'choir' ? 'Glass Canticle' : flag === 'rustwake' ? 'Barter Queen' : 'Honest Weight',
      registry: 'FV-2231',
      cargo: [
        { id: 'rations', label: 'rations', tons: 44 },
        { id: 'medical', label: 'medical stores', tons: 9 },
      ],
    };
    const v = this.make('freighter', flag, null, pos, heading, man.name, 'neutral', man);
    v.ship.flight.velocity.copy(heading).multiplyScalar(110);
    const a = this.startAmbush(v, player, { at: 0, raiders: 3, band: 'Blackwake' }, 420);
    for (const r of a?.raiders ?? []) r.ship.flight.velocity.subVectors(v.ship.flight.position, r.ship.flight.position).normalize().multiplyScalar(240);
    faceAlong(pf.orientation, _dir.subVectors(pos, pf.position).normalize());
    pf.velocity.copy(_dir).multiplyScalar(140);
    return a;
  }

  /** Wind the timetable so the next arrival through `gateTo` jumps in now. */
  stageArrival(player: ShipEntity, gateTo: string): void {
    const next = nextArrivals(this.sysId, this.lanes, gateTo, this.clock, 1)[0];
    if (next) this.clock = next.depart + 0.05;
    this.refreshIn = 0;
    this.materialise(player);
  }

  // ── HUD helpers ────────────────────────────────────────────────────

  /** Next arrivals through a Lantern (by destination id) — the arrivals board. */
  arrivals(gateTo: string, n = 2): { eta: number; role: TrafficRole; name: string }[] {
    return nextArrivals(this.sysId, this.lanes, gateTo, this.clock, n).map((s) => ({ eta: s.depart - this.clock, role: s.role, name: manifest(s).name }));
  }

  /** The traffic ship nearest the nose within `cone` radians and `range` metres. */
  hailTarget(from: ShipEntity, range = 12_000, cone = 0.2): TrafficShip | null {
    const f = from.flight;
    f.forward(_dir);
    let best: TrafficShip | null = null;
    let bs = Infinity;
    for (const t of this.ships) {
      if (!t.ship.alive) continue;
      _a.subVectors(t.ship.flight.position, f.position);
      const d = _a.length();
      if (d > range || d < 1) continue;
      const ang = Math.acos(Math.min(1, _dir.dot(_a) / d));
      if (ang > cone + Math.atan2(t.ship.radius, d)) continue;
      const score = ang * 4000 + d * 0.2;
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  /** Where the sailing is headed, for the hail card. */
  destination(t: TrafficShip): string {
    const s = t.sailing;
    if (!s) return t.role === 'pirate' ? 'unlisted' : 'on station';
    const to = s.lane.to;
    return to.kind === 'gate' ? `Lantern to ${to.id}` : to.kind === 'belt' ? 'the belt' : to.name;
  }

  origin(t: TrafficShip): string {
    const s = t.sailing;
    if (!s) return '—';
    const f = s.lane.from;
    return f.kind === 'gate' ? `Lantern from ${f.id}` : f.kind === 'belt' ? 'the belt' : f.name;
  }

  /** Ships we own (never touched by anything but traffic). */
  owns(s: ShipEntity): boolean {
    return this.owned.has(s);
  }
}
