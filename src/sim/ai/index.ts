import type { Fleet, ShipEntity } from '../Fleet';
import type { Obstacle } from './Avoid';
import { fly, perceive, think } from './Brain';
import { brainOf, isBrain, isCapital, rand } from './state';

/**
 * AI entry point (M13 wingmen + M14 enemy AI).
 *
 * Call once per frame BEFORE `fleet.step(dt)`: it writes `controls` for every
 * living non-player fighter (and for the player's ship when its brain has
 * `autopilot` set); the fleet then flies everyone with the same physics.
 */
const NO_OBSTACLES: readonly Obstacle[] = [];

export function updateAI(fleet: Pick<Fleet, 'ships'>, dt: number, time: number, obstacles: readonly Obstacle[] = NO_OBSTACLES): void {
  const ships = fleet.ships;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive || isCapital(s)) continue;
    if (s.isPlayer && !(isBrain(s.brain) && s.brain.autopilot)) continue;
    const b = brainOf(s);
    if (b.scripted) continue;
    if (time >= b.nextThink) {
      think(s, b, ships);
      b.nextThink = time + b.personality.reaction * (0.75 + 0.5 * rand(b));
    }
    perceive(s, b, dt);
    fly(s, b, ships, obstacles, dt, time);
  }
}

/** Let the AI fly (or stop flying) a player-controlled ship — demo mode / autopilot. */
export function setAutopilot(s: ShipEntity, on: boolean): void {
  brainOf(s).autopilot = on;
}

export { brainOf, setPersonality, PERSONALITIES, type Brain, type Order, type FormationKind, type Maneuver, type Personality } from './state';
export { issueOrder, setFormation, formationSlot, slotWorld, findChaser } from './Squadron';
export { pickTarget, findThreat } from './Brain';
export { avoidance, capitalCapsule, type Obstacle } from './Avoid';
export * from './Pilot';
export * from './Turret';
