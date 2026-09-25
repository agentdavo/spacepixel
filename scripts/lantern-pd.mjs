#!/usr/bin/env node
/** Reproduce the Lantern Guard mark anomaly using the real 60 Hz simulation. */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { fittedDuel, goodFit } = await server.ssrLoadModule('/src/sim/balance.ts');
  const seeds = [31, 47, 59, 73, 89, 97];
  for (const mark of [1, 2, 3, 4]) {
    const fit = goodFit('cr5-resolute');
    for (const slot in fit) fit[slot] = fit[slot]?.replace(/-mk\d$/, `-mk${mark}`) ?? null;
    const runs = seeds.map(seed => {
      const r = fittedDuel('cr5-resolute', fit, 'ffc-lantern-guard', 1500, 300, [seed]);
      return { seed, ...r, t: Number.isFinite(r.t) ? r.t : 'no-kill' };
    });
    console.log(JSON.stringify({ mode: 'duel', mark, runs }));
  }
  const { Group, Vector3 } = await server.ssrLoadModule('three');
  const { Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts');
  const { Weapons } = await server.ssrLoadModule('/src/sim/Weapons.ts');
  const { Missiles } = await server.ssrLoadModule('/src/sim/Missiles.ts');
  const { Capitals } = await server.ssrLoadModule('/src/sim/Capitals.ts');
  const { applyFit } = await server.ssrLoadModule('/src/game/outfitting/apply.ts');
  const { CATALOG_BY_ID } = await server.ssrLoadModule('/src/game/shipyard/catalog.ts');
  const { missileOf } = await server.ssrLoadModule('/src/sim/Combat.ts');
  function isolated(mark, seed, offset, fixedTiming) {
    const fleet = new Fleet(new Group(), seed);
    const weapons = new Weapons(fleet);
    const missiles = new Missiles(fleet);
    const capitals = new Capitals(fleet, weapons);
    const target = fleet.spawn('ffc-lantern-guard', 'concord', new Vector3(), new Vector3(1, 0, 0), { team: 'renegade' });
    capitals.register(target);
    const ship = fleet.spawn('cr5-resolute', 'concord', new Vector3(0, 180, 1500), new Vector3(0, 0, -1), { isPlayer: true });
    target.flight.velocity.set(0, 0, 0);
    ship.flight.velocity.set(0, 0, 0);
    const fit = goodFit('cr5-resolute');
    for (const slot in fit) if (slot.startsWith('msl:')) fit[slot] = fit[slot]?.replace(/-mk\d$/, `-mk${mark}`) ?? null;
    applyFit(ship, CATALOG_BY_ID['cr5-resolute'], fit);
    ship.combat.missile = ship.combat.loadout.missiles.indexOf('torpedo');
    const spec = missileOf(ship);
    // Keep the two hulls and their subsystems intact: only launch cadence changes.
    // Use real missile flight, intercept HP, turrets, bolts, seeded scatter and reloads.
    fleet.hit = () => ({ shielded: true, subsystem: null });
    const results = [];
    let launched = 0;
    const gap = fixedTiming ? 12 : spec.reload;
    for (let frame = 0; frame < Math.ceil((offset + gap * 5 + 24) * 60); frame++) {
      const t = frame / 60;
      if (launched < 6 && t + 1e-8 >= offset + gap * launched) {
        missiles.salvo(ship, target, spec);
        launched++;
      }
      capitals.step(1 / 60);
      weapons.step(1 / 60);
      missiles.step(1 / 60);
      for (const e of missiles.events) if (e.kind === 'detonate' || e.kind === 'expire') results.push(e.kind === 'expire' ? 'expire' : e.intercepted ? 'intercept' : 'hit');
    }
    assert.equal(results.length, 6, 'every torpedo must resolve within the observation window');
    return { mark, seed, offset, gap, results };
  }
  for (const fixedTiming of [true, false]) {
    for (const offset of [0, 0.25, 0.5, 1, 2]) {
      let reference;
      for (const mark of [1, 2, 3, 4]) {
        const runs = seeds.map(seed => isolated(mark, seed, offset, fixedTiming));
        if (fixedTiming) {
          const outcomes = runs.map(r => r.results);
          if (reference) assert.deepEqual(outcomes, reference, 'equal launch schedules must give equal interception outcomes across marks');
          reference = outcomes;
        }
        console.log(JSON.stringify({ mode: fixedTiming ? 'matched-launches' : 'mark-reload', mark, offset, gap: runs[0].gap, intercepted: runs.reduce((n, r) => n + r.results.filter(x => x === 'intercept').length, 0), total: runs.reduce((n, r) => n + r.results.length, 0), runs }));
      }
    }
  }
} finally {
  await server.close();
}


