import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { POLITY_IDS } from '../src/content/civilizations.ts';
import { COMMODITIES, newLedger } from '../src/game/economy.ts';
import { generateBoard, makeOffer, hasContractClients, type ContractKind, type Tier } from '../src/game/contracts/contracts.ts';
import { LEGACY_BOARD_REACH } from './fixtures/legacy-contract-boards.ts';

test('polities without authored issuers cannot borrow a human contract client', () => {
  const legacy = new Set(['concord', 'choir', 'rustwake']);
  const kinds: ContractKind[] = ['courier', 'haul', 'escort', 'bounty', 'patrol', 'salvage', 'recon', 'sortie', 'priority'];
  for (const faction of POLITY_IDS.filter(p => !legacy.has(p))) {
    assert.equal(hasContractClients(faction), false);
    const reach = structuredClone(LEGACY_BOARD_REACH);
    reach.systems[0].faction = faction;
    for (const station of reach.systems[0].stations) {
      station.faction = faction;
      const input = { reach, station: station.id, clock: 901, rep: { ...newLedger().rep, [faction]: 100 }, tier: 3 as const, goods: COMMODITIES,
        priority: { episode: 3, title: 'Legacy priority', tagline: 'Continue the original campaign' } };
      assert.deepEqual(generateBoard(input), []);
      for (const kind of kinds) assert.equal(makeOffer(input, kind, 3, `${station.id}.${kind}`), null);
    }
  }
});

test('legacy board issuers, dialogue and RNG outputs match pre-fix snapshot', () => {
  const boards = [];
  const rep = { ...newLedger().rep, concord: 45, choir: 40, rustwake: 30 };
  for (const system of LEGACY_BOARD_REACH.systems) for (const station of system.stations) {
    assert.equal(hasContractClients(station.faction), true);
    for (const clock of [0, 901, 1800]) for (const tier of [1, 2, 3] as Tier[]) {
      boards.push(generateBoard({ reach: LEGACY_BOARD_REACH, station: station.id, clock, tier, rep, goods: COMMODITIES,
        priority: { episode: 3, title: 'Legacy priority', tagline: 'Continue the original campaign' } }));
    }
  }
  assert.equal(boards.length, 81); assert.equal(boards.flat().length, 399);
  // Captured on 0485121 before adding issuer guards: covers all three legacy polities.
  assert.equal(createHash('sha256').update(JSON.stringify(boards)).digest('hex'), 'cc9fff086f7fe4c1a9a6bb8df1926f501004c15b675733d401e15a92919954af');
});
