import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSURANCE_CAP, INSURANCE_BASE, insuranceFee, rescueTerms, tugFor } from '../src/game/rescue.ts';
import { newLedger } from '../src/game/economy.ts';

test('rescue: insurance scales with the purse, capped, never more than you hold', () => {
  assert.equal(insuranceFee(0), INSURANCE_BASE);
  assert.ok(insuranceFee(10_000) > insuranceFee(2_000));
  assert.equal(insuranceFee(10_000_000), INSURANCE_CAP);
  const broke = rescueTerms({ ...newLedger(), credits: 90 });
  assert.equal(broke.fee, 90, 'a broke pilot pays what they have');
  assert.equal(broke.ledger.credits, 0);
});

test('rescue: loose cargo is lost, sealed consignments survive, nothing else changes', () => {
  const l = { ...newLedger(), credits: 5000, cargo: { ebon: 4, rations: 2, medical: 3 } };
  const t = rescueTerms(l, { medical: 2 });
  assert.equal(t.ledger.credits, 5000 - t.fee);
  assert.deepEqual(t.ledger.cargo, { medical: 2 });
  assert.deepEqual(
    t.lost.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'ebon', units: 4 },
      { id: 'medical', units: 1 },
      { id: 'rations', units: 2 },
    ],
  );
  assert.deepEqual(t.ledger.rep, l.rep);
  assert.equal(t.ledger.missiles, l.missiles);
  assert.deepEqual(l.cargo, { ebon: 4, rations: 2, medical: 3 }, 'input ledger untouched');
  assert.equal(rescueTerms({ ...l, cargo: {} }).lost.length, 0);
});

test('rescue: a tug for every kind of space', () => {
  for (const f of ['concord', 'choir', 'rustwake', 'contested', 'unknown']) assert.match(tugFor(f).name, /^TUG /);
});
