import type { Object3D } from 'three';
import type { ShipEntity } from '@/sim/Fleet';
import { KESTREL_SPEC, type FlightSpec } from '@/sim/FlightModel';
import { flightSpecFor as simFlightSpec } from '@/sim/Combat';
import { rescaleStructure } from '@/sim/Structure';
import { flightSpecFor as yardFlightSpec } from '@/game/shipyard/flight';
import { buildShip } from '@/assets/ShipBuilder';
import type { Blueprint, Part } from '@/assets/Blueprint';
import type { CatalogEntry } from '@/game/shipyard/catalog';
import { baseStats, computeFit, slotSockets, slotsFor, stockFit, type Fit, type FitResult } from './fit';
import { item, SIZE_RANK, type GunItem, type MissileItem } from './items';
import { TRANSFER_RATE, setShieldCapacity, syncShield } from '@/sim/Damage';

/**
 * Runtime side of a fit: push hull + fit into a live ShipEntity — combat
 * stats, loadout (guns, missiles, turret mounts, point defence), damage
 * pools and the flight spec — and make the cheap visible changes on the
 * model: empty turret barbettes are hidden, non-stock guns and racks get a
 * pod on their socket. Livery is whatever the model was built with.
 *
 * Called at spawn and again after every refit (idempotent: everything is
 * recomputed from the catalogue, never from the ship's current numbers).
 */

/** The hull's undamaged, unfitted flight spec — the same one createCombat derives. */
export function hullFlightSpec(ship: ShipEntity, e: CatalogEntry): FlightSpec {
  if (!e.legacy) return yardFlightSpec(e, KESTREL_SPEC);
  return simFlightSpec(baseStats(e), ship.model.radius > 200);
}

export function applyFit(ship: ShipEntity, e: CatalogEntry, fit: Fit): FitResult {
  const r = computeFit(e, fit);
  const c = ship.combat;
  c.stats = r.stats;
  c.loadout = r.loadout;
  c.gun = Math.min(c.gun, Math.max(0, r.loadout.guns.length - 1));
  c.missile = Math.min(c.missile, Math.max(0, r.loadout.missiles.length - 1));
  // Flight: the hull's own spec × the fit's drive / mass multipliers.
  const b = hullFlightSpec(ship, e);
  const spec: FlightSpec = {
    ...b,
    maxSpeed: b.maxSpeed * r.flight.speed,
    boostSpeed: b.boostSpeed * r.flight.speed,
    mainAccel: b.mainAccel * r.flight.accel,
    boostAccel: b.boostAccel * r.flight.accel,
    lateralAccel: b.lateralAccel * r.flight.accel,
    pitchRate: b.pitchRate * r.flight.turn,
    yawRate: b.yawRate * r.flight.turn,
    rollRate: b.rollRate * r.flight.turn,
  };
  c.baseSpec = spec;
  Object.assign(ship.flight.spec, spec);
  // Pools: keep the hull fraction, refill shields (refits happen berthed).
  const hf = ship.hullMax > 0 ? ship.hull / ship.hullMax : 1;
  ship.hullMax = r.stats.hull;
  ship.hull = Math.max(1, hf * ship.hullMax);
  const d = c.dmg;
  d.shieldRegen = r.stats.shieldRegen;
  d.shieldDelay = r.stats.shieldDelay;
  d.transfer = (d.capital ? TRANSFER_RATE.capital : TRANSFER_RATE.small) * (r.stats.shieldTransfer ?? 1);
  d.zoneHp = r.stats.hull * 0.45;
  // Sections follow the fitted hull (keeping their damage fraction): the spine is a share of the hull.
  rescaleStructure(d.structure, r.stats.hull);
  // Re-size every facing, then fill them (the split follows the ship's shield trim).
  setShieldCapacity(d, ship, r.stats.shield);
  d.cooldown.fill(0);
  for (let i = 0; i < d.facings.length; i++) d.facings[i] = d.facingCap[i];
  d.down = 0;
  syncShield(d, ship);
  fitVisuals(ship, e, fit);
  return r;
}

// ── visible changes ──────────────────────────────────────────────────

const POD_TAG = 'outfit-pod';

/** Gun barrels / missile pods on sockets whose item isn't the hull's stock, and hidden empty turrets. */
export function fitVisuals(ship: ShipEntity, e: CatalogEntry, fit: Fit): void {
  const m = ship.model;
  // Clear previous pods.
  for (const o of m.sockets.values()) {
    for (const ch of [...o.children]) if (ch.userData.tag === POD_TAG) o.remove(ch);
  }
  const stock = stockFit(e);
  const k = Math.max(1, Math.pow(m.length / 17, 0.55));
  for (const s of slotsFor(e)) {
    const id = fit[s.id];
    if (s.kind === 'turret') {
      // Barbettes on a joint can be struck when the mount is empty.
      for (const j of [s.socket ?? '', `${s.socket}.L`]) {
        const a = m.articulations.get(j);
        if (a) a.node.visible = !!id;
      }
      continue;
    }
    if ((s.kind !== 'gun' && s.kind !== 'missile') || !id || id === stock[s.id]) continue;
    const it = item(id) as GunItem | MissileItem | undefined;
    if (!it) continue;
    for (const name of slotSockets(s)) {
      const sock = m.sockets.get(name);
      if (sock) sock.add(pod(it, k, e.faction === 'civil' ? 'concord' : e.faction));
    }
  }
}

const podCache = new Map<string, Blueprint>();

/** A small weapon pod: housing + barrel(s) for guns, a boxy launcher for racks. Built through the ship builder (cel material, ink). */
function pod(it: GunItem | MissileItem, k: number, faction: Blueprint['faction']): Object3D {
  const size = SIZE_RANK[it.size];
  const key = `${it.kind}:${size}:${faction}:${it.kind === 'gun' ? it.guns[0] : it.missiles[0]}`;
  let bp = podCache.get(key);
  if (!bp) {
    const s = 0.55 + size * 0.45;
    const parts: Part[] =
      it.kind === 'gun'
        ? [
            { name: 'pod', paint: 'secondary', pos: [0, 0, -0.4 * s], shape: { kind: 'box', w: 0.5 * s, h: 0.42 * s, d: 1.6 * s, c: 0.08 * s } },
            { name: 'band', paint: 'accent', pos: [0, 0, 0.1 * s], shape: { kind: 'box', w: 0.54 * s, h: 0.46 * s, d: 0.18 * s, c: 0.04 * s } },
            {
              name: 'barrel',
              paint: 'metal',
              pos: [0, 0, 0.4 * s + (it.guns[0] === 'railgun' || it.guns[0] === 'massdriver' ? 1.4 * s : 0.9 * s)],
              shape: { kind: 'cylinder', rFront: 0.07 * s, rBack: 0.1 * s, length: it.guns[0] === 'railgun' || it.guns[0] === 'massdriver' ? 2.8 * s : 1.8 * s, segments: 8 },
            },
          ]
        : [
            { name: 'launcher', paint: 'primary', pos: [0, 0, 0], shape: { kind: 'box', w: 0.7 * s, h: 0.5 * s, d: 1.9 * s, c: 0.1 * s } },
            { name: 'cells', paint: 'dark', pos: [0, 0, 0.96 * s], shape: { kind: 'box', w: 0.56 * s, h: 0.36 * s, d: 0.05 * s } },
            { name: 'stripe', paint: 'accent', pos: [0, 0.26 * s, 0.2 * s], shape: { kind: 'box', w: 0.72 * s, h: 0.04 * s, d: 0.5 * s } },
          ];
    bp = { id: `pod-${key}`, name: 'pod', designation: 'POD', faction, shipClass: 'interceptor', parts, engines: [] };
    podCache.set(key, bp);
  }
  const model = buildShip(bp);
  const mesh = model.hull;
  mesh.removeFromParent();
  mesh.scale.setScalar(k);
  mesh.userData.tag = POD_TAG;
  return mesh;
}
