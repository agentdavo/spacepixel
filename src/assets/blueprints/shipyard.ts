import type { Blueprint } from '../Blueprint';
import { SUPER_KESTREL, GAUNTLET, BULWARK, RESOLUTE, VALIANT } from './directorate-line';
import { ARBITER } from './concord-warships';
import { SERAPH, CANTICLE } from './choir-line';
import { GAFF, KNUCKLEDUSTER, BULLDOG, MOTHER_LODE } from './rustwake-line';
import { LONGHAUL, UMBRA, MERIDIAN_STAR, TALLOW, SWALLOW } from './civilian';

export { SUPER_KESTREL, GAUNTLET, BULWARK, RESOLUTE, VALIANT, ARBITER, SERAPH, CANTICLE, GAFF, KNUCKLEDUSTER, BULLDOG, MOTHER_LODE };
export { LONGHAUL, UMBRA, MERIDIAN_STAR, TALLOW, SWALLOW };

/**
 * Shipyard designs: the Vanguard progression line (T2–T6), faction
 * alternates, Rustwake clan ships, civilian traffic and mid-tier warships.
 * Registered into `BLUEPRINTS` by ./index. Catalogue data (prices, tiers,
 * hardpoint layouts, stat hints) lives in src/game/shipyard/catalog.ts.
 */
export const SHIPYARD_ROSTER: Blueprint[] = [
  // Directorate progression line.
  SUPER_KESTREL,
  GAUNTLET,
  BULWARK,
  RESOLUTE,
  VALIANT,
  // Faction alternates.
  SERAPH,
  KNUCKLEDUSTER,
  // Rustwake clans.
  GAFF,
  BULLDOG,
  MOTHER_LODE,
  // Civilian traffic.
  SWALLOW,
  TALLOW,
  LONGHAUL,
  UMBRA,
  MERIDIAN_STAR,
  // Mid-tier warships.
  ARBITER,
  CANTICLE,
];
