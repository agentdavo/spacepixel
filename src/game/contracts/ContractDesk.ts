import { Vector3 } from 'three';
import type { ShipEntity, Team } from '@/sim/Fleet';
import { brainOf, flyToPoint, issueOrder, setAutopilot } from '@/sim/ai';
import { input } from '@/core/Input';
import { postFx } from '@/render/post/PostFx';
import { createSetPiece, type SetPiece, type SetPieceFrame } from '@/world/setpieces';
import { SYSTEM_OFFSET } from '@/world/StarSystemView';
import { Comms } from '@/ui/Comms';
import { ContractHud, type HudContract } from '@/ui/ContractHud';
import { bindContractsTab } from '@/ui/ContractsTab';
import { CAST } from '@/game/campaign/cast';
import { COMMODITIES, type TradeLedger } from '@/game/economy';
import { loadContracts, saveContracts, saveLedger } from '@/game/Profile';
import type { Character, SpawnSpec } from '@/game/campaign/types';
import { CampaignRunner, type CampaignHost } from '@/game/CampaignRunner';
import type { Universe } from '@/universe/Universe';
import type { FlightScene } from '@/world/scenes/FlightScene';
import {
  BOARD_PERIOD,
  CLIENTS,
  KIND_LABEL,
  MARK_CAST,
  abandonContract,
  acceptContract,
  boardEpoch,
  declineContract,
  failContract,
  findStation,
  formatClock,
  generateBoard,
  hops,
  markReady,
  nextSystem,
  openOffers,
  settleAt,
  shipTier,
  statusLine,
  tickBook,
  type Contract,
  type ContractBook,
  type ContractKind,
  type ReachMap,
  type Receipt,
  type V3,
} from './contracts';
import { buildOp, type OpBuild } from './ops';
import { NAMED_CLIENTS, namedContract } from './named';
import { HireDesk } from '@/game/HireDesk';
import { dialogHooks } from '@/dialog/state';

/**
 * Free-roam contracts at runtime: the board, the book, and the live
 * operations. Each accepted contract whose work is in the current system
 * gets a LiveOp — a CampaignRunner fed by a small host adapter (spawns,
 * set pieces, escorts, chatter) — alongside normal flight. The flight scene
 * calls, each frame:
 *
 *   updateAI → desk.preStep(dt) → fleet.step … weapons → desk.update(dt) → desk.draw()
 *
 * Suspended while a story episode runs (the campaign owns the sky).
 */
export interface LedgerIO {
  ledger(): TradeLedger;
  setLedger(l: TradeLedger): void;
}

export interface PriorityInfo {
  episode: number;
  title: string;
  tagline: string;
}

const _v = new Vector3();
const OFFSET: V3 = [SYSTEM_OFFSET.x, SYSTEM_OFFSET.y, SYSTEM_OFFSET.z];
const toU = (v: V3, out = new Vector3()) => out.set(v[0] + OFFSET[0], v[1] + OFFSET[1], v[2] + OFFSET[2]);

/** The Reach as the pure generator sees it. */
export function reachOf(u: Universe): ReachMap {
  const a = (v: Vector3): V3 => [v.x, v.y, v.z];
  return {
    systems: [...u.systems.values()].map((s) => ({
      id: s.id,
      name: s.name,
      faction: s.faction,
      threat: s.threat,
      stations: s.stations.map((st) => ({ id: st.id, name: st.name, kind: st.kind, faction: st.faction, pos: a(st.position), axis: a(st.axis), planet: st.planet })),
      gates: s.gates.map((g) => ({ to: g.to, pos: a(g.position), normal: a(g.normal) })),
    })),
  };
}

/** One contract's operation, live in this system. */
class LiveOp {
  readonly runner: CampaignRunner;
  readonly pieces: SetPiece[] = [];
  readonly ships: ShipEntity[] = [];
  private departing: { ship: ShipEntity; t: number }[] = [];
  private frame: SetPieceFrame;
  reported = false;

  constructor(
    readonly contract: Contract,
    readonly build: OpBuild,
    private desk: ContractDesk,
    private scene: FlightScene,
  ) {
    const p = scene.player;
    const self = this;
    const host: CampaignHost = {
      get playerPosition() {
        return p.flight.position;
      },
      // Free-roam death is handled by the desk (tow home); it never fails a contract by itself.
      playerAlive: true,
      get playerHull() {
        return p.hull / p.hullMax;
      },
      get systemId() {
        return scene.currentSystemId();
      },
      jumps: 0,
      ships: scene.fleet.ships,
      gatePosition: (i) => scene.gatePosition(i),
      spawnShip: (spec, i, pos) => self.spawn(spec, i, pos),
      spawnSetPiece: (spec, pos) => {
        const piece = createSetPiece(spec, pos);
        // Resumed op: a flight core already taken aboard stays taken.
        if ('recovered' in piece && self.runner.flags.has(`${spec.tag}-recovered`)) {
          (piece as { recovered: boolean }).recovered = true;
          piece.group.visible = false;
        }
        scene.world.root.add(piece.group);
        self.pieces.push(piece);
        return piece;
      },
      playChatter: (beat) => desk.radio().play(beat),
      unlockCodex: () => {},
      command: (verb, ships) => {
        for (const s of ships) {
          if (verb === 'destroy') {
            s.alive = false;
            s.model.root.visible = false;
          } else {
            s.team = 'neutral';
            this.departing.push({ ship: s, t: 0 });
          }
        }
      },
    };
    this.runner = new CampaignRunner(build.mission, host);
    this.frame = {
      dt: 0,
      time: 0,
      eye: scene.world.eye,
      playerPos: p.flight.position,
      playerVel: p.flight.velocity,
      flags: this.runner.flags,
      setFlag: (f) => this.runner.setFlag(f),
      postFx,
      camera: scene.camera,
      scene: scene.scene,
    };
  }

  get system(): string {
    return this.contract.op!.system;
  }

  private spawn(spec: SpawnSpec, i: number, pos: Vector3): ShipEntity {
    const scene = this.scene;
    const p = scene.player;
    const ally = spec.role === 'wing' || spec.role === 'escort';
    const facing = ally ? this.routeDir(pos) : _v.subVectors(p.flight.position, pos).normalize().clone();
    const team: Team = ally ? p.team : spec.role === 'static' ? 'neutral' : spec.faction === p.faction ? 'renegade' : spec.faction;
    const name = spec.name ? (spec.count > 1 ? `${spec.name} ${i + 1}` : spec.name) : undefined;
    const s = scene.fleet.spawn(spec.blueprint, spec.faction, pos, facing, { name, team });
    if (spec.role === 'escort') {
      // Freighters are armoured barges: they soak a raid, not a whole war.
      s.hullMax *= 3;
      s.hull = s.hullMax;
    }
    if (spec.tag === 'mark') {
      s.hullMax *= 1.5 + 0.5 * this.contract.tier;
      s.hull = s.hullMax;
    }
    if (spec.role === 'wing') issueOrder([s], 'engageAtWill', p);
    this.ships.push(s);
    this.desk.owned.add(s);
    return s;
  }

  private routeDir(from: Vector3): Vector3 {
    const end = this.contract.op?.end;
    if (end) return toU(end).sub(from).normalize();
    return this.scene.player.flight.forward(new Vector3()).clone();
  }

  /** After AI, before physics: freighters fly their lane at a barge's pace. */
  preStep(dt: number): void {
    for (const e of this.runner.escorts) {
      for (const s of e.ships) {
        if (!s.alive || s.team === 'neutral') continue;
        const c = s.controls;
        c.fire = false;
        if (e.halted || !e.target) {
          c.throttleSet = 0;
          c.pitch = c.yaw = c.roll = 0;
          c.afterburner = false;
          continue;
        }
        flyToPoint(c, s.flight, e.target, 40, brainOf(s).pilot, dt);
        c.afterburner = false;
        c.throttleSet = Math.min(c.throttleSet ?? 0.62, 0.62);
      }
    }
    for (const d of this.departing) {
      const s = d.ship;
      if (!s.alive) continue;
      d.t += dt;
      s.controls.pitch = s.controls.yaw = s.controls.roll = 0;
      s.controls.afterburner = true;
      s.controls.fire = false;
      if (d.t > 3.5) {
        s.alive = false; // through the Lantern — not a kill
        s.model.root.visible = false;
        postFx.flash = Math.max(postFx.flash, 0.2);
      }
    }
  }

  update(dt: number, time: number): void {
    for (const e of this.scene.weapons.events) if (e.kind === 'kill' && e.ship) this.runner.onKill(e.ship);
    this.runner.update(dt);
    const f = this.frame;
    f.dt = dt;
    f.time = time;
    for (const p of this.pieces) p.update(f);
  }

  /** Where the nav marker goes: the current objective's tag. */
  target(): { pos: Vector3; label: string; text: string } | null {
    const m = this.build.mission;
    const st = this.runner.state;
    for (let i = 0; i < m.objectives.length; i++) {
      const o = m.objectives[i];
      if (o.hidden || st[i] !== 'active' || o.optional) continue;
      const tag = this.build.nav[o.id];
      if (!tag) return null;
      const pos = this.tagPos(tag);
      return pos ? { pos, label: this.build.labels[tag] ?? o.text.toUpperCase(), text: o.text } : null;
    }
    return null;
  }

  currentObjective(): string | null {
    const m = this.build.mission;
    const i = m.objectives.findIndex((o, k) => !o.hidden && !o.optional && this.runner.state[k] === 'active');
    return i >= 0 ? m.objectives[i].text : null;
  }

  tagPos(tag: string): Vector3 | null {
    const ship = this.runner.shipsTagged(tag).find((s) => s.alive);
    if (ship) return ship.flight.position;
    if (this.runner.shipsTagged(tag).length) return null; // all dead
    return this.runner.resolve({ at: 'tag', tag, offset: [0, 0, 0] });
  }

  dispose(): void {
    for (const p of this.pieces) {
      p.group.removeFromParent();
      p.dispose();
    }
    this.pieces.length = 0;
    for (const s of this.ships) {
      s.alive = false;
      s.model.root.visible = false;
      this.desk.owned.delete(s);
    }
  }
}

export class ContractDesk {
  book: ContractBook = loadContracts();
  readonly reach: ReachMap;
  /** Ships spawned by contracts (their deaths don't cost free-roam standing). */
  readonly owned = new WeakSet<ShipEntity>();
  /** Pending campaign episode; Directorate stations post it as priority orders. */
  priority: PriorityInfo | null = null;
  /** Called when the pilot accepts priority orders (main.ts starts the episode). */
  onPriority: (() => void) | null = null;
  tracked: string | null = null;
  private ops = new Map<string, LiveOp>();
  private comms: Comms | null = null;
  private hud: ContractHud;
  private deadFor = 0;
  private saveT = 0;
  /** Receipts from the last docking, for the dock screen / contracts tab. */
  lastReceipts: { station: string; receipts: Receipt[] } | null = null;
  private stage: { kind: ContractKind; phase: string } | null = null;
  private readonly sysNames = new Map<string, string>();
  private readonly cast: Character[] = [...CAST, ...CLIENTS, ...MARK_CAST, ...NAMED_CLIENTS];
  /** People signed on from conversations (mechanic, Magpie's Due). */
  readonly hires: HireDesk;

  constructor(private scene: FlightScene) {
    this.reach = reachOf(scene.universe);
    for (const s of this.reach.systems) this.sysNames.set(s.id, s.name);
    this.hud = new ContractHud(document.getElementById('ui-root')!);
    bindContractsTab(this);
    this.tracked = this.book.active[0]?.id ?? null;
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pagehide', () => this.saveAll());
    scene.starMap.overlay = (c, at, time) => this.drawMap(c, at, time);
    this.hires = new HireDesk(scene);
    // Work and hires offered in conversation (the concourse).
    dialogHooks.onContract = (id, stationId) => this.acceptNamed(id, stationId);
    dialogHooks.onRecruit = (id) => this.hires.recruit(id);
  }

  // ── Board & book ──────────────────────────────────────────────────────

  sysName = (id: string): string => this.sysNames.get(id) ?? id;

  hasBoard(stationId: string): boolean {
    return !!findStation(this.reach, stationId);
  }

  character(id: string): Character | undefined {
    return this.cast.find((c) => c.id === id);
  }

  tier(): 1 | 2 | 3 {
    return shipTier(this.scene.player.model.blueprint.id);
  }

  /** Open offers at a station (priority orders first). */
  offers(stationId: string): Contract[] {
    const board = generateBoard({
      reach: this.reach,
      station: stationId,
      clock: this.book.clock,
      rep: this.scene.ledger.rep,
      tier: this.tier(),
      goods: COMMODITIES,
      priority: this.onPriority ? this.priority : null,
    });
    return openOffers(board, this.book);
  }

  repostIn(): number {
    return (boardEpoch(this.book.clock) + 1) * BOARD_PERIOD - this.book.clock;
  }

  jumpsTo(system: string): number {
    return hops(this.reach, this.scene.currentSystemId()).get(system) ?? -1;
  }

  accept(k: Contract, io: LedgerIO): string | null {
    if (k.kind === 'priority') {
      saveContracts(this.book);
      this.onPriority?.();
      return null;
    }
    const r = acceptContract(this.book, io.ledger(), k);
    if (r.error) return r.error;
    this.setBook(r.book);
    io.setLedger(r.ledger);
    this.track(k.id);
    this.hud.toast(`CONTRACT ACCEPTED · ${k.title.toUpperCase()}`, '#ffb347');
    return null;
  }

  /**
   * Accept an offer by id from a station's current board (dialog effects:
   * "take the job" from a conversation). Returns an error line or null.
   */
  acceptById(stationId: string, id: string, io: LedgerIO = this.sceneLedger()): string | null {
    const k = this.offers(stationId).find((x) => x.id === id);
    return k ? this.accept(k, io) : 'OFFER NOT ON THE BOARD';
  }

  /**
   * "Take the job" in a conversation: build the named contract (named.ts)
   * as offered at `stationId` now and book it. Returns the dock-log line.
   */
  acceptNamed(key: string, stationId: string, io: LedgerIO = this.sceneLedger()): { text: string; ok: boolean } {
    const k = namedContract(key, { reach: this.reach, station: stationId, clock: this.book.clock, rep: this.scene.ledger.rep, tier: this.tier() });
    if (!k) return { text: 'NO SUCH WORK FROM HERE', ok: false };
    const open = this.book.active.find((x) => x.named === key);
    if (open) return { text: `ALREADY ON YOUR BOOK · ${open.title.toUpperCase()}`, ok: false };
    const err = this.accept(k, io);
    return err ? { text: `CONTRACT · ${err}`, ok: false } : { text: `CONTRACT ACCEPTED · ${k.title.toUpperCase()} · ${k.reward.toLocaleString('en-US')} sh`, ok: true };
  }

  private sceneLedger(): LedgerIO {
    return { ledger: () => this.scene.ledger, setLedger: (l) => ((this.scene.ledger = l), saveLedger(l)) };
  }

  decline(k: Contract): void {
    this.setBook(declineContract(this.book, k.id));
  }

  abandon(k: Contract, io: LedgerIO): Receipt | null {
    const r = abandonContract(this.book, io.ledger(), k.id);
    if (r.error) return null;
    this.teardown(k.id);
    this.setBook(r.book);
    io.setLedger(r.ledger);
    if (this.tracked === k.id) this.tracked = this.book.active[0]?.id ?? null;
    return r.receipts?.[0] ?? null;
  }

  /** Pay out everything deliverable at `stationId` (or just `only`). */
  turnIn(stationId: string, io: LedgerIO, only?: string): Receipt[] {
    const r = settleAt(this.book, io.ledger(), stationId, only);
    const receipts = r.receipts ?? [];
    if (!receipts.length) return [];
    for (const x of receipts) this.teardown(x.id);
    this.setBook(r.book);
    io.setLedger(r.ledger);
    if (this.tracked && !this.book.active.some((k) => k.id === this.tracked)) this.tracked = this.book.active[0]?.id ?? null;
    this.lastReceipts = { station: stationId, receipts: [...(this.lastReceipts?.station === stationId ? this.lastReceipts.receipts : []), ...receipts] };
    return receipts;
  }

  /** Docking hook (FlightScene.berthed): settle, and put finished operations away. */
  onDocked(stationId: string): { text: string; cls?: string }[] {
    for (const [id, op] of this.ops) if (op.runner.outcome !== 'running') this.teardown(id);
    this.lastReceipts = null;
    const paid = this.turnIn(stationId, this.sceneLedger());
    const notes = paid.map((r) => ({ text: `CONTRACT SETTLED · ${r.title.toUpperCase()} · +${r.amount.toLocaleString('en-US')} sh · STANDING +${r.rep}`, cls: 'ok' }));
    const waiting = this.book.active.filter((k) => k.payAt === stationId && k.kind === 'haul' && k.state === 'active');
    for (const k of waiting) notes.push({ text: `CONSIGNMENT SHORT: ${k.cargo!.units} × ${k.cargo!.name.toUpperCase()} REQUIRED FOR ${k.title.toUpperCase()}`, cls: 'err' });
    if (this.onPriority && this.priority && findStation(this.reach, stationId)?.station.faction === 'concord')
      notes.push({ text: `PRIORITY ORDERS WAITING — EPISODE ${String(this.priority.episode).padStart(2, '0')}. SEE CONTRACTS.`, cls: 'ok' });
    if (this.stage?.phase === 'board' || this.stage?.phase === 'pay') window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' })), 30);
    return notes;
  }

  private setBook(b: ContractBook): void {
    this.book = b;
    saveContracts(b);
  }

  radio(): Comms {
    this.comms ??= new Comms(document.getElementById('ui-root')!, this.cast);
    return this.comms;
  }

  track(id: string | null): void {
    this.tracked = id;
    const k = this.book.active.find((x) => x.id === id);
    if (!k) return;
    const sys = nextSystem(k);
    this.scene.starMap.destination = sys === this.scene.currentSystemId() ? null : sys;
  }

  // ── Frame ─────────────────────────────────────────────────────────────

  preStep(dt: number): void {
    if (this.scene.campaign) return;
    for (const op of this.ops.values()) op.preStep(dt);
  }

  update(dt: number, time: number): void {
    const s = this.scene;
    if (s.campaign) {
      // A story episode owns the sky: put everything away (contracts keep, clocks pause).
      if (this.ops.size) for (const id of [...this.ops.keys()]) this.teardown(id);
      this.comms?.clear();
      return;
    }
    const frozen = s.docking.frozen;
    if (!frozen && dt > 0) {
      const r = tickBook(this.book, s.ledger, dt);
      if (r.receipts?.length) {
        s.ledger = r.ledger;
        saveLedger(r.ledger);
        this.setBook(r.book);
        for (const x of r.receipts) {
          this.teardown(x.id);
          this.hud.toast(`CONTRACT LAPSED · ${x.title.toUpperCase()} · ${x.amount.toLocaleString('en-US')} sh`, '#ff5f7a');
        }
      } else this.book = r.book;
      this.saveT += dt;
      if (this.saveT > 10) {
        this.saveT = 0;
        this.saveAll();
      }
    }

    // Free-roam death: a salvage tug tows airframe 0413 home.
    if (!s.player.alive) {
      if (this.ops.size) for (const id of [...this.ops.keys()]) this.teardown(id);
      this.deadFor += dt;
      if (this.deadFor > 4) {
        this.deadFor = 0;
        const home = s.ledger.lastDock && findStation(this.reach, s.ledger.lastDock) ? s.ledger.lastDock : this.homeStation();
        s.berthAt(home, 0.35);
        this.hud.toast('AIRFRAME 0413 RECOVERED BY A SALVAGE TUG', '#ffb347');
      }
      return;
    }
    this.deadFor = 0;

    const sys = s.currentSystemId();
    let left = false;
    for (const [id, op] of this.ops)
      if (op.system !== sys || !this.book.active.some((k) => k.id === id)) {
        this.teardown(id);
        left = true;
      }
    if (left) saveContracts(this.book);
    if (!frozen && !s.docking.busy) for (const k of this.book.active) if (!this.ops.has(k.id) && this.wantsOp(k, sys)) this.startOp(k);

    for (const [id, op] of this.ops) {
      op.update(dt, time);
      if (op.reported || op.runner.outcome === 'running') continue;
      op.reported = true;
      const k = op.contract;
      if (op.runner.outcome === 'success') {
        if (op.build.completes) {
          this.setBook(markReady(this.book, id));
          this.hud.toast(`CONTRACT COMPLETE · RETURN TO ${k.payAtName.toUpperCase()} FOR PAYMENT`, '#7dffb2');
          if (this.tracked === id) this.track(id);
        }
      } else {
        const r = failContract(this.book, s.ledger, id);
        s.ledger = r.ledger;
        saveLedger(r.ledger);
        this.setBook(r.book);
        this.hud.toast(`CONTRACT FAILED · ${k.title.toUpperCase()} · ${(r.receipts?.[0]?.amount ?? 0).toLocaleString('en-US')} sh`, '#ff5f7a');
      }
    }
    this.comms?.update(dt);

    // Keep the tracked job's route on the star map.
    const t = this.book.active.find((k) => k.id === this.tracked) ?? null;
    if (t && s.starMap.destination === null) {
      const next = nextSystem(t);
      if (next !== sys) s.starMap.destination = next;
    }
  }

  private wantsOp(k: Contract, sys: string): boolean {
    if (!k.op || k.op.system !== sys || k.state !== 'active') return false;
    if (k.kind === 'courier' || k.kind === 'haul') return !k.ambushed;
    return true;
  }

  private startOp(k: Contract): void {
    const build = buildOp(k, OFFSET, { stage: !!this.stage });
    if (!build) return;
    if (k.kind === 'courier' || k.kind === 'haul') {
      const b = { ...this.book, active: this.book.active.map((x) => (x.id === k.id ? { ...x, ambushed: true } : x)) };
      this.setBook(b);
    }
    const op = new LiveOp(k, build, this, this.scene);
    this.ops.set(k.id, op);
    let resumed = false;
    if (k.progress) {
      try {
        op.runner.restore(k.progress);
        resumed = true;
      } catch {
        /* a malformed save: start the operation fresh */
      }
    }
    op.runner.begin();
    if (resumed) this.hud.toast(`OPERATION RESUMED · ${k.title.toUpperCase()}`, '#ffb347');
  }

  /**
   * Put an operation away. A still-running one (the pilot jumped out, or was
   * towed home) keeps its progress in the book and resumes on return.
   */
  private teardown(id: string): void {
    const op = this.ops.get(id);
    if (!op) return;
    this.keepProgress(op);
    op.dispose();
    this.ops.delete(id);
  }

  private keepProgress(op: LiveOp): void {
    if (op.runner.outcome !== 'running') return;
    const id = op.contract.id;
    if (!this.book.active.some((k) => k.id === id)) return;
    const snap = op.runner.snapshot();
    this.book = { ...this.book, active: this.book.active.map((k) => (k.id === id ? { ...k, progress: snap } : k)) };
  }

  /** Save the book with every live operation's progress (periodic save, page hide). */
  private saveAll(): void {
    for (const op of this.ops.values()) this.keepProgress(op);
    saveContracts(this.book);
  }

  /** Was this ship spawned by a contract? (free-roam kills of it don't cost standing) */
  owns(ship: ShipEntity): boolean {
    return this.owned.has(ship);
  }

  /** Nearest Directorate station (for tows and free-flight starts). */
  homeStation(from = this.scene.currentSystemId()): string {
    const h = hops(this.reach, from);
    let best: string | null = null;
    let bd = Infinity;
    for (const sys of this.reach.systems) {
      const d = h.get(sys.id);
      if (d === undefined) continue;
      for (const st of sys.stations) {
        if (st.faction !== 'concord') continue;
        if (d < bd) {
          bd = d;
          best = st.id;
        }
      }
    }
    return best ?? 'meridian-orbital-0';
  }

  // ── HUD ───────────────────────────────────────────────────────────────

  /** Objective panel, nav markers, dwell rings, toasts (after the flight HUD). */
  draw(time: number, visible: boolean): void {
    const s = this.scene;
    const hud = this.hud;
    hud.begin();
    if (!visible || s.campaign || !s.player.alive) return;
    const sys = s.currentSystemId();
    const cam = s.camera;
    const world = s.world;
    const pp = s.player.flight.position;
    const rows: HudContract[] = [];
    for (const k of this.book.active) {
      const op = this.ops.get(k.id);
      const tracked = k.id === this.tracked;
      const objective = op && op.runner.outcome === 'running' ? op.currentObjective() : null;
      const left = k.state === 'active' && k.due !== undefined ? k.due - this.book.clock : null;
      rows.push({
        kind: KIND_LABEL[k.kind],
        title: k.title,
        status: objective ?? statusLine(k, sys, this.sysName),
        timer: left !== null ? formatClock(left) : k.state === 'ready' ? 'DONE' : '',
        urgent: left !== null && left < 60,
        tracked,
      });
      // Markers: the op's current objective, or the station to deliver to / be paid at.
      let target: { pos: Vector3; label: string } | null = null;
      if (op && op.runner.outcome === 'running') target = op.target();
      if (!target && (k.state === 'ready' || k.kind === 'courier' || k.kind === 'haul') && k.payAtSystem === sys) {
        const st = findStation(this.reach, k.payAt)?.station;
        if (st) target = { pos: toU(st.pos, new Vector3()), label: `${k.state === 'ready' ? 'PAYMENT' : 'DELIVER'} · ${k.payAtName.toUpperCase()}` };
      }
      if (target) hud.marker(target.pos, target.label, KIND_LABEL[k.kind], pp, cam, world, time, tracked);
      if (op) for (const d of op.runner.dwells) hud.dwell(d.position, d.radius, d.progress, cam, world);
    }
    if (rows.length) hud.panel(rows, this.book.active.length > 1);
    hud.drawToasts();
  }

  // ── Star map ──────────────────────────────────────────────────────────

  private drawMap(c: CanvasRenderingContext2D, at: (id: string) => { x: number; y: number } | null, time: number): void {
    c.save();
    c.font = '12px "Share Tech Mono", monospace';
    // One tag per contract at the system it points to.
    const stacked = new Map<string, number>();
    for (const k of this.book.active) {
      const sys = nextSystem(k);
      const p = at(sys);
      if (!p) continue;
      const n = stacked.get(sys) ?? 0;
      stacked.set(sys, n + 1);
      const tracked = k.id === this.tracked;
      const x = p.x - 14;
      const y = p.y - 16 - n * 15;
      c.fillStyle = tracked ? '#ffb347' : 'rgba(255,179,71,0.65)';
      c.strokeStyle = c.fillStyle;
      const r = tracked ? 5 + Math.sin(time * 5) : 4;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.fill();
      c.textAlign = 'right';
      c.fillText(`${KIND_LABEL[k.kind]}${k.state === 'ready' ? ' · PAY' : ''}`, x - 9, y + 4);
      c.textAlign = 'left';
    }
    // Side list.
    // Under the map header (top-left): the systems start further in.
    let y = 112;
    const x0 = 40;
    if (this.book.active.length || this.priority) {
      c.fillStyle = '#ffb347';
      c.font = '700 13px "Oxanium", sans-serif';
      c.fillText('CONTRACTS // [C] TRACK NEXT', x0, y);
      c.font = '12px "Share Tech Mono", monospace';
      y += 18;
      for (const k of this.book.active) {
        const j = this.jumpsTo(nextSystem(k));
        c.fillStyle = k.id === this.tracked ? '#ffffff' : 'rgba(255,179,71,0.8)';
        c.fillText(`${k.id === this.tracked ? '▶' : ' '} ${KIND_LABEL[k.kind]} · ${this.sysName(nextSystem(k)).toUpperCase()} · ${j <= 0 ? 'HERE' : `${j} JUMP${j > 1 ? 'S' : ''}`}`, x0, y);
        y += 15;
      }
      if (this.priority && this.onPriority) {
        y += 6;
        c.fillStyle = (time * 1.5) % 1 < 0.7 ? '#ff7a1c' : '#ffffff';
        c.fillText(`★ PRIORITY ORDERS · EPISODE ${String(this.priority.episode).padStart(2, '0')}`, x0, y);
        y += 15;
        c.fillStyle = 'rgba(255,255,255,0.75)';
        c.fillText(`  ${this.priority.title} — any Directorate station · [P] plot`, x0, y);
      }
    }
    c.restore();
  }

  private onKey(e: KeyboardEvent): void {
    const s = this.scene;
    if (s.campaign || s.docking.frozen) return;
    if (e.code === 'KeyC' && this.book.active.length) {
      const i = this.book.active.findIndex((k) => k.id === this.tracked);
      const next = this.book.active[(i + 1) % this.book.active.length];
      s.starMap.destination = null;
      this.track(next.id);
      this.hud.toast(`TRACKING · ${next.title.toUpperCase()}`, '#ffb347');
    } else if (e.code === 'KeyP' && s.starMap.open && this.priority && this.onPriority) {
      const home = findStation(this.reach, this.homeStation());
      if (home) s.starMap.destination = home.system.id === s.currentSystemId() ? null : home.system.id;
    }
  }

  // ── Captures ──────────────────────────────────────────────────────────

  /**
   * ?contract=<kind>&cphase=board|op|pay|map — stage a contract for
   * screenshots: `board` berths at the posting station with the CONTRACTS
   * tab open; `op` accepts it and puts you in the middle of the operation
   * (spawn delays compressed); `pay` completes it and docks at the paying
   * station; `map` opens the star map with the route plotted.
   */
  stageFromQuery(): void {
    const q = new URLSearchParams(location.search);
    const kind = q.get('contract') as ContractKind | null;
    if (!kind) return;
    const phase = q.get('cphase') ?? 'op';
    this.stage = { kind, phase };
    const s = this.scene;
    setAutopilot(s.player, false);
    input.override = null;
    s.quiet();
    this.book = { ...this.book, active: [], seen: [] };
    s.ledger = { ...s.ledger, credits: Math.max(s.ledger.credits, 6400), rep: { concord: 42, choir: -24, rustwake: 12 } };
    const sys = s.currentSystemId();
    const here = this.reach.systems.find((x) => x.id === sys)!;
    const stations = q.get('cstation') ? [q.get('cstation')!] : here.stations.map((st) => st.id);
    // Find a board (station × epoch) posting this kind, with its work in this system for ops.
    let found: Contract | null = null;
    for (let e = 0; e < 80 && !found; e++) {
      this.book.clock = e * BOARD_PERIOD + 1;
      for (const st of stations) {
        const offers = generateBoard({ reach: this.reach, station: st, clock: this.book.clock, rep: s.ledger.rep, tier: kind === 'sortie' ? 2 : this.tier(), goods: COMMODITIES, priority: null });
        found =
          offers.find(
            (k) =>
              k.kind === kind &&
              (phase !== 'op' || !k.op || k.op.system === sys) &&
              (phase !== 'map' || nextSystem(k) !== sys) &&
              (kind !== 'courier' || k.tier >= 2 || phase !== 'op'),
          ) ?? null;
        if (found) break;
      }
    }
    if (!found) return;
    if (phase === 'board') {
      s.berthAt(found.origin, 0.8);
      return;
    }
    const io: LedgerIO = { ledger: () => s.ledger, setLedger: (l) => (s.ledger = l) };
    this.accept(found, io);
    const k = this.book.active[0];
    // Extra jobs so the panel shows a board's worth of work.
    for (const st of here.stations) {
      for (const extra of generateBoard({ reach: this.reach, station: st.id, clock: this.book.clock, rep: s.ledger.rep, tier: 1, goods: COMMODITIES, priority: null })) {
        if (this.book.active.length >= 3) break;
        if (extra.kind !== kind && !extra.op && extra.kind === 'courier') this.accept(extra, io);
      }
    }
    this.tracked = k.id;
    if (phase === 'pay') {
      if (k.kind !== 'courier' && k.kind !== 'haul') this.book = markReady(this.book, k.id);
      s.berthAt(k.payAt, 0.7);
      return;
    }
    if (phase === 'map') {
      this.track(k.id);
      if (!s.starMap.open) s.starMap.toggle();
      return;
    }
    // op: fly into the middle of it.
    const op = k.op;
    if (!op) return;
    const pf = s.player.flight;
    const anchor = toU(op.start ?? op.center);
    const dir = op.end ? toU(op.end).sub(anchor).normalize() : new Vector3(0.3, 0, 1).normalize();
    if (k.kind === 'escort') {
      // Off the freighter's quarter, so the chase camera frames her past the nose.
      const side = new Vector3(-dir.z, 0, dir.x).normalize();
      pf.position.copy(anchor).addScaledVector(dir, -650).addScaledVector(side, 260).add(_v.set(0, 60, 0));
      const aim = anchor.clone().addScaledVector(dir, 900);
      dir.subVectors(aim, pf.position).normalize();
    } else {
      pf.position.copy(anchor).addScaledVector(dir, -2600).add(_v.set(0, 300, 0));
      dir.subVectors(anchor, pf.position).normalize();
    }
    s.placePlayer(pf.position, dir, 150);
  }
}
