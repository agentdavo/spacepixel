import { Vector3, type PerspectiveCamera } from 'three';
import type { Livery } from '@/assets/Blueprint';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import type { ChaseCamera } from '@/sim/ChaseCamera';
import { applyFraming, cameraOverride, framingFor, viewFor, type ShipView } from '@/game/shipyard/flight';
import { CATALOG_BY_ID, type CatalogEntry } from '@/game/shipyard/catalog';
import { loadHangar, saveHangar, saveLedger } from '@/game/Profile';
import type { TradeLedger } from '@/game/economy';
import { applyFit } from './apply';
import { computeFit, stockFit, type Fit, type FitResult } from './fit';
import { activeShip, entryOf, normaliseHangar, syncHold, type Hangar, type OwnedShip, type ShopResult } from './hangar';
import type { ShipTurrets } from './turrets';

/**
 * The flight scene's side of the shipyard: owns the persisted hangar, spawns
 * the active hull with its fit (and frames the camera for it — chase distance
 * scales with length, T6 rides the bridge), refits it in place after
 * outfitting, and swaps the player onto another hull after a purchase or a
 * transfer. The dock tabs talk to this through `bindOutfitter`.
 */
export interface OutfitHost {
  readonly fleet: Fleet;
  readonly chase: ChaseCamera;
  readonly camera: PerspectiveCamera;
  readonly turrets: ShipTurrets;
  player: ShipEntity;
  ledger: TradeLedger;
  /** True while a story episode runs (the fleet issues the ship). */
  inEpisode(): boolean;
  /** Put `next` in the pilot's seat at the old ship's pose. */
  swapPlayer(next: ShipEntity): void;
}

/** Story episodes are flown in a fighter: bigger hulls stay in the hangar. */
const EPISODE_MAX_LENGTH = 40;

export class Outfitter {
  hangar: Hangar = loadHangar();
  private host: OutfitHost | null = null;
  /** Hull + fit the player entity was built from. */
  private flying: { uid: string; hull: string; fit: Fit } | null = null;
  private livery: Partial<Livery> = {};
  /** A story episode is running (set by settle(true / false)). */
  private episode = false;
  /** Bridge hulls ride the bow camera instead of the bridge (`?bridge=bow` starts there). */
  bowView = cameraOverride() === 'bow';
  /** The chase framing the flying ship got at its last frame(). */
  view: ShipView = 'chase';

  constructor() {
    // ?own=<hull id>: own (and fly) that hull with its stock fit — captures, balance checks.
    const own = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('own') : null;
    const e = own ? CATALOG_BY_ID[own] : undefined;
    if (e?.flyable && !this.hangar.ships.some((s) => s.hull === e.id)) {
      const uid = `s${this.hangar.seq + 1}`;
      this.hangar = normaliseHangar({ ...this.hangar, seq: this.hangar.seq + 1, active: uid, ships: [...this.hangar.ships, { uid, hull: e.id, fit: stockFit(e), condition: 1 }] });
    } else if (e) this.hangar = { ...this.hangar, active: this.hangar.ships.find((s) => s.hull === e.id)!.uid };
  }

  bind(host: OutfitHost): void {
    this.host = host;
  }

  active(): OwnedShip {
    return activeShip(this.hangar);
  }

  entry(): CatalogEntry {
    return entryOf(this.active());
  }

  /** What the player entity currently carries (null before spawn). */
  current(): FitResult | null {
    const f = this.flying;
    return f ? computeFit(CATALOG_BY_ID[f.hull], f.fit) : null;
  }

  /** The hull the pilot flies now: the active one, or a fleet Kestrel during story episodes if the active hull is too big. */
  private seat(): { uid: string; hull: string; fit: Fit; condition: number } {
    const a = this.active();
    if (!(this.episode || this.host?.inEpisode()) || entryOf(a).length <= EPISODE_MAX_LENGTH) return a;
    const own = this.hangar.ships.find((s) => entryOf(s).length <= EPISODE_MAX_LENGTH);
    if (own) return own;
    const k = CATALOG_BY_ID['vf27-kestrel'];
    return { uid: 'fleet', hull: k.id, fit: stockFit(k), condition: 1 };
  }

  /** Spawn the pilot's ship (scene start). */
  spawn(fleet: Fleet, position: Vector3, facing: Vector3, livery: Partial<Livery>, opts: Partial<ShipEntity>): ShipEntity {
    this.livery = livery;
    const s = this.seat();
    return this.build(fleet, s, position, facing, opts);
  }

  private build(fleet: Fleet, s: { uid: string; hull: string; fit: Fit; condition: number }, position: Vector3, facing: Vector3, opts: Partial<ShipEntity>): ShipEntity {
    const e = CATALOG_BY_ID[s.hull];
    const ship = fleet.spawn(e.blueprint, e.faction === 'civil' ? 'concord' : e.faction, position, facing, { isPlayer: true, ...opts }, this.livery);
    // Owned hulls fly with the pilot's colours whatever yard built them.
    ship.faction = 'concord';
    ship.team = opts.team ?? 'concord';
    applyFit(ship, e, s.fit);
    ship.hull = Math.max(1, ship.hullMax * s.condition);
    this.flying = { uid: s.uid, hull: s.hull, fit: { ...s.fit } };
    return ship;
  }

  /**
   * Chase framing scaled to the hull; T6 (catalogue camera 'bridge') rides the
   * bridge, or the bow while `bowView` is set (V toggles it; it survives hull
   * swaps). Records the view the ship got in `view`.
   */
  frame(ship: ShipEntity, chase: ChaseCamera, camera: PerspectiveCamera): ShipView {
    const e = CATALOG_BY_ID[ship.model.blueprint.id];
    this.view = viewFor(ship.model, e, this.bowView, cameraOverride());
    applyFraming(chase, camera, framingFor(ship.model, e, this.view));
    return this.view;
  }

  /** Hangar complement + hold for the ship now flying. */
  private sync(ship: ShipEntity): void {
    const h = this.host;
    if (!h) return;
    h.turrets.setHangar(ship, this.current()?.hangar ?? []);
    h.ledger = syncHold(this.hangar, h.ledger);
    if (this.flying?.uid === 'fleet') h.ledger = { ...h.ledger, capacity: 16 };
  }

  /**
   * Make the flying ship match the hangar: refit in place when only the fit
   * changed, rebuild (swap) when the active hull changed. Call after any
   * shop operation, and when an episode starts or ends.
   */
  settle(episode?: boolean): void {
    if (episode !== undefined) this.episode = episode;
    const h = this.host;
    if (!h) return;
    const want = this.seat();
    const cur = this.flying;
    if (cur && cur.uid === want.uid && cur.hull === want.hull) {
      if (JSON.stringify(cur.fit) !== JSON.stringify(want.fit)) {
        applyFit(h.player, CATALOG_BY_ID[want.hull], want.fit);
        this.flying = { ...cur, fit: { ...want.fit } };
      }
      this.sync(h.player);
      return;
    }
    // Store the old hull's condition before it goes to the hangar.
    const old = this.hangar.ships.find((s) => s.uid === cur?.uid);
    if (old && h.player.hullMax > 0) {
      old.condition = Math.max(0.05, Math.min(1, h.player.hull / h.player.hullMax));
      saveHangar(this.hangar);
    }
    const p = h.player;
    const next = this.build(h.fleet, want, p.flight.position.clone(), p.flight.forward(new Vector3()), { name: p.name, team: p.team });
    h.swapPlayer(next);
    this.frame(next, h.chase, h.camera);
    this.sync(next);
  }

  /** Apply a shop result: ledger + hangar persist, the flying ship follows. */
  commit(r: ShopResult): void {
    const h = this.host;
    if (r.error || !h) return;
    this.hangar = r.hangar;
    saveHangar(this.hangar);
    h.ledger = r.ledger;
    this.settle();
    saveLedger(h.ledger);
  }

  /** Current hull condition 0..1 of the flying ship. */
  condition(): number {
    const p = this.host?.player;
    return p && p.hullMax > 0 ? p.hull / p.hullMax : 1;
  }

  /** Station context for the dock tabs. */
  get ledger(): TradeLedger {
    return this.host!.ledger;
  }
}

let bound: Outfitter | null = null;
export function bindOutfitter(o: Outfitter): void {
  bound = o;
}
export function outfitter(): Outfitter | null {
  return bound;
}
