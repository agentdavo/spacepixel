import type { PerspectiveCamera } from 'three';
import { BLUEPRINTS } from '@/assets/blueprints';
import { KESTREL_SPEC } from '@/sim/FlightModel';
import type { ShipEntity } from '@/sim/Fleet';
import type { ChaseCamera } from '@/sim/ChaseCamera';
import { CATALOG_BY_ID, type CatalogEntry } from '@/game/shipyard/catalog';
import { applyFraming, cameraOverride, flightSpecFor, framingFor, viewFor, type ChaseFraming, type ShipView } from '@/game/shipyard/flight';

/**
 * `?ship=<blueprint id>` support for flight test scenes (dogfight): which
 * hull the player flies, and how to fly and frame it. Handling scales with
 * size through the catalogue (bigger = slower turns, more inertia) and the
 * chase camera distance scales with hull length; T6 hulls (and anything the
 * catalogue marks `camera: 'bridge'`) ride a bridge camera unless
 * `&bridge=0` (`&bridge=1` forces it on any hull with a bridge socket,
 * `&bridge=bow` starts on the bow camera).
 */

/** The requested player hull (defaults to the Kestrel). */
export function requestedShip(fallback = 'vf27-kestrel'): string {
  const id = new URLSearchParams(window.location.search).get('ship');
  return id && BLUEPRINTS[id] ? id : fallback;
}

export interface ShipyardFlightSetup {
  entry: CatalogEntry | undefined;
  /** Null: a fighter-sized hull on the default chase cam. */
  framing: ChaseFraming | null;
  view: ShipView;
}

/** Frame the chase camera for the ship: its bridge (or bow, with `bow`) on bridge hulls, else behind it. */
export function frameShipyardFlight(ship: ShipEntity, chase: ChaseCamera, camera: PerspectiveCamera, bow = cameraOverride() === 'bow'): ShipyardFlightSetup {
  const entry = CATALOG_BY_ID[ship.model.blueprint.id];
  const view = viewFor(ship.model, entry, bow, cameraOverride());
  const framing = framingFor(ship.model, entry, view);
  applyFraming(chase, camera, framing);
  return { entry, framing, view };
}

/**
 * Apply catalogue handling + stat hints to a spawned player ship and scale
 * the chase camera to its length. Safe to call for any hull.
 */
export function applyShipyardFlight(ship: ShipEntity, chase: ChaseCamera, camera: PerspectiveCamera, bow?: boolean): ShipyardFlightSetup {
  const entry = CATALOG_BY_ID[ship.model.blueprint.id];
  if (entry && entry.id !== 'vf27-kestrel') {
    ship.flight.spec = flightSpecFor(entry, KESTREL_SPEC);
    ship.hullMax = ship.hull = entry.stats.hull;
    ship.shieldMax = ship.shield = entry.stats.shield;
  }
  return frameShipyardFlight(ship, chase, camera, bow);
}
