import { Vector3, type PerspectiveCamera } from 'three';
import { BLUEPRINTS } from '@/assets/blueprints';
import { KESTREL_SPEC } from '@/sim/FlightModel';
import type { ShipEntity } from '@/sim/Fleet';
import type { ChaseCamera } from '@/sim/ChaseCamera';
import { CATALOG_BY_ID, type CatalogEntry } from '@/game/shipyard/catalog';
import { bridgeFraming, chaseFraming, flightSpecFor, type ChaseFraming } from '@/game/shipyard/flight';

/**
 * `?ship=<blueprint id>` support for flight test scenes (dogfight): which
 * hull the player flies, and how to fly and frame it. Handling scales with
 * size through the catalogue (bigger = slower turns, more inertia) and the
 * chase camera distance scales with hull length; T6 hulls (and anything the
 * catalogue marks `camera: 'bridge'`) ride a bridge camera unless
 * `&bridge=0`.
 */

/** The requested player hull (defaults to the Kestrel). */
export function requestedShip(fallback = 'vf27-kestrel'): string {
  const id = new URLSearchParams(window.location.search).get('ship');
  return id && BLUEPRINTS[id] ? id : fallback;
}

export interface ShipyardFlightSetup {
  entry: CatalogEntry | undefined;
  framing: ChaseFraming;
  bridge: boolean;
}

/**
 * Apply catalogue handling + stat hints to a spawned player ship and scale
 * the chase camera to its length. Safe to call for any hull.
 */
export function applyShipyardFlight(ship: ShipEntity, chase: ChaseCamera, camera: PerspectiveCamera): ShipyardFlightSetup {
  const entry = CATALOG_BY_ID[ship.model.blueprint.id];
  const length = ship.model.length;
  if (entry && entry.id !== 'vf27-kestrel') {
    ship.flight.spec = flightSpecFor(entry, KESTREL_SPEC);
    ship.hullMax = ship.hull = entry.stats.hull;
    ship.shieldMax = ship.shield = entry.stats.shield;
  }
  const q = new URLSearchParams(window.location.search);
  const socket = ship.model.sockets.get('bridge');
  const bridge = !!socket && q.get('bridge') !== '0' && (q.get('bridge') === '1' || entry?.camera === 'bridge');
  const framing = bridge && socket ? bridgeFraming([socket.position.x, socket.position.y, socket.position.z], length) : chaseFraming(length);
  if (length > 20 || bridge) {
    const t = chase.tuning;
    t.offset.copy(new Vector3(...framing.offset));
    t.lookAhead = framing.lookAhead;
    t.speedPullback = framing.speedPullback;
    t.posSmooth = framing.posSmooth;
    t.lookSmooth = framing.lookSmooth;
    t.upSmooth = framing.upSmooth;
    t.shake = framing.shake;
    camera.near = Math.min(camera.near, framing.near);
    camera.updateProjectionMatrix();
  }
  return { entry, framing, bridge };
}
