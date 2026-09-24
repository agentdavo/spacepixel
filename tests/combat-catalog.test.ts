import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsFromCatalog } from '../src/game/shipyard/combatStats.ts';
import { CATALOG, PROGRESSION, catalogEntry } from '../src/game/shipyard/catalog.ts';
import { SHIP_STATS } from '../src/sim/Loadouts.ts';

test('every catalogued hull without a combat-table entry gets catalogue combat stats', () => {
  for (const e of CATALOG) {
    if (SHIP_STATS[e.id] || e.legacy) continue;
    const s = statsFromCatalog(e);
    assert.equal(s.hull, e.stats.hull, e.id);
    assert.equal(s.shield, e.stats.shield, e.id);
    assert.equal(s.facings, e.length >= 400 ? 6 : e.length >= 100 ? 4 : 2, e.id);
  }
});

test('the progression line gets tougher tier by tier', () => {
  const hulls = PROGRESSION.map((id) => {
    const e = catalogEntry(id)!;
    return SHIP_STATS[id]?.hull ?? statsFromCatalog(e).hull;
  });
  for (let i = 1; i < hulls.length; i++) assert.ok(hulls[i] > hulls[i - 1], `${PROGRESSION[i]} hull ${hulls[i]} > ${hulls[i - 1]}`);
});
