import type { ShipStats } from '@/sim/Loadouts';
import type { CatalogEntry } from './catalog';

/** Combat stats for a catalogued hull from its stat hints (flight comes from the catalogue spec). */
export function statsFromCatalog(e: CatalogEntry): ShipStats {
  const big = e.length >= 100;
  return {
    role: e.role,
    hull: e.stats.hull,
    shield: e.stats.shield,
    shieldRegen: big ? 0.05 : 0.12,
    shieldDelay: big ? 6 : 3,
    facings: big ? 4 : 1,
    mass: 1,
    agility: 1,
    speed: 1,
    signature: Math.min(30, Math.max(0.8, e.length / 17)),
  };
}
