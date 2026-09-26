import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatFeedback, impactLabel } from '../src/ui/CombatFeedback.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';
import type { WeaponEvent } from '../src/sim/Weapons.ts';
import type { MissileEvent } from '../src/sim/Missiles.ts';

const own = {} as ShipEntity, target = {} as ShipEntity;
const hit = (kind: WeaponEvent['kind'], extras = {}) => ({ kind, ship: own, facing: 0, hullDamage: 0, shieldDamage: 0, ...extras }) as WeaponEvent;
const missile = (extras = {}) => ({ kind: 'detonate', target: own, shielded: true, shieldDamage: 4, hullDamage: 0, intercepted: false, ...extras }) as MissileEvent;

test('shield absorption, bleed, collapse and hull readouts use damage truth for guns and beams', () => {
  for (const [event, state] of [
    [hit('shield', { shieldDamage: 8 }), 'absorbed'],
    [hit('shield', { shieldDamage: 8, hullDamage: 2 }), 'bleed'],
    [hit('beam-hit', { shielded: true, shieldDamage: 1 }), 'absorbed'],
    [hit('beam-hit', { shielded: true, shieldDamage: 1, hullDamage: 0.1 }), 'bleed'],
    [hit('hit', { hullDamage: 8 }), 'hull'],
    [hit('shield-down'), 'collapse'],
  ] as const) {
    const f = new CombatFeedback(); f.consume([event], [], 1);
    assert.equal(f.get(own, 1)?.state, state);
    assert.equal(f.get(target, 1), null);
    assert.equal(f.get(own, 3), null);
  }
});

test('collapse and hull cue survives event ordering, remote hits, and weaker sparks without an endless hold', () => {
  for (const events of [[hit('shield-down'), hit('shield', { hullDamage: 2 })], [hit('shield', { hullDamage: 2 }), hit('shield-down')]]) {
    const f = new CombatFeedback(); f.consume(events, [], 1);
    assert.equal(impactLabel(f.get(own, 1)!), 'SHIELD DOWN · HULL HIT');
    events[0].facing = 5; // pooled source mutation must not change the readout
    f.consume([hit('shield', { ship: target, shieldDamage: 2 }), hit('shield', { facing: 1, shieldDamage: 2 })], [], 1.1);
    assert.equal(f.get(own, 1.1)?.state, 'collapse');
    assert.equal(f.get(own, 1.1)?.facing, 0);
    assert.equal(f.get(target, 1.1)?.state, 'absorbed');
    assert.equal(f.get(own, 2.5), null);
    f.consume([hit('hit', { hullDamage: 3 })], [], 3);
    assert.equal(f.get(own, 3)?.state, 'hull');
    f.consume([], [], 0); assert.equal(f.get(own, 0), null, 'rewind resets stale cues');
  }
});

test('intercepted and harmless missiles cannot report a target hit; warheads retain both layers', () => {
  for (const [event, state] of [[missile({ intercepted: true }), null], [missile({ shieldDamage: 0 }), null], [missile(), 'absorbed'], [missile({ hullDamage: 2 }), 'bleed'], [missile({ shielded: false, hullDamage: 4 }), 'hull']] as const) {
    const f = new CombatFeedback(); f.consume([], [event], 1);
    assert.equal(f.get(own, 1)?.state ?? null, state);
  }
});
