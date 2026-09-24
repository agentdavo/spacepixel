import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FighterCollisions, LAUNCH_GRACE } from '../src/sim/FighterCollisions.ts';
import { impactDamage } from '../src/sim/Collision.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';

/** Just the fields the collision world reads. */
function ship(id: number, team: string, pos: Vector3, vel: Vector3, radius = 5, mass = 1): ShipEntity {
  return {
    id,
    team,
    alive: true,
    radius,
    flight: { position: pos, velocity: vel, forward: (o: Vector3) => o.set(0, 0, 1) },
    combat: { stats: { mass } },
  } as unknown as ShipEntity;
}

const DT = 1 / 60;

function run(world: FighterCollisions, ships: ShipEntity[], seconds: number, hurt: Map<ShipEntity, number>): void {
  for (let t = 0; t < seconds; t += DT) {
    for (const s of ships) s.flight.position.addScaledVector(s.flight.velocity, DT);
    world.step(ships, DT, (s, d) => hurt.set(s, (hurt.get(s) ?? 0) + d));
  }
}

test('fighter collisions: head-on ram bounces both and hurts by closing speed', () => {
  const w = new FighterCollisions();
  const a = ship(1, 'concord', new Vector3(0, 0, -60), new Vector3(0, 0, 100));
  const b = ship(2, 'choir', new Vector3(0, 0, 60), new Vector3(0, 0, -100));
  const hurt = new Map<ShipEntity, number>();
  // Past the launch grace first (both were "just spawned").
  w.step([a, b], LAUNCH_GRACE + 0.1, () => {});
  a.flight.position.set(0, 0, -60);
  b.flight.position.set(0, 0, 60);
  run(w, [a, b], 1.2, hurt);
  assert.equal(w.contacts, 1, 'one contact');
  assert.equal(w.friendlyContacts, 0);
  assert.ok(a.flight.velocity.z < 0 && b.flight.velocity.z > 0, 'they bounce apart');
  const want = impactDamage(200);
  assert.ok(Math.abs((hurt.get(a) ?? 0) - want) < 1e-6, `damage ${hurt.get(a)} ≈ ${want}`);
  assert.equal(hurt.get(a), hurt.get(b));
  assert.ok(a.flight.position.distanceTo(b.flight.position) >= (a.radius + b.radius) * 0.8 - 1e-6, 'separated');
});

test('fighter collisions: a formation nudge is free; heavier ships move less', () => {
  const w = new FighterCollisions();
  const a = ship(1, 'concord', new Vector3(0, 0, 0), new Vector3(0, 0, 150), 5, 1);
  const b = ship(2, 'concord', new Vector3(9, 0, 0), new Vector3(-4, 0, 150), 5, 3);
  w.step([a, b], LAUNCH_GRACE + 0.1, () => {});
  const hurt = new Map<ShipEntity, number>();
  run(w, [a, b], 0.5, hurt);
  assert.equal(w.friendlyContacts, 1);
  assert.equal(hurt.size, 0, 'a 4 m/s touch does no damage');
  assert.ok(Math.abs(b.flight.velocity.x) < Math.abs(a.flight.velocity.x), 'the heavy ship takes less of the bounce');
});

test('fighter collisions: launch grace — spawned overlapping, no contact until the grace ends', () => {
  const w = new FighterCollisions();
  const a = ship(1, 'concord', new Vector3(0, 0, 0), new Vector3(0, 0, 0));
  const b = ship(2, 'concord', new Vector3(3, 0, 0), new Vector3(0, 0, 0));
  const hurt = new Map<ShipEntity, number>();
  run(w, [a, b], LAUNCH_GRACE * 0.9, hurt);
  assert.equal(w.contacts, 0, 'immune while launching');
  // A respawn (dead → alive) grants the grace again.
  run(w, [a, b], LAUNCH_GRACE * 0.2, hurt);
  assert.equal(w.contacts, 1, 'contact once the grace is over');
  b.alive = false;
  w.step([a, b], DT, () => {});
  b.alive = true;
  b.flight.position.set(2, 0, 0);
  const before = w.contacts;
  run(w, [a, b], 0.5, hurt);
  assert.equal(w.contacts, before, 'respawned ship is immune again');
  assert.ok(w.isImmune(b));
});

test('fighter collisions: skip() exempts ships (docking guidance) and capitals are ignored', () => {
  const w = new FighterCollisions();
  const a = ship(1, 'concord', new Vector3(0, 0, 0), new Vector3(0, 0, 50));
  const b = ship(2, 'choir', new Vector3(4, 0, 0), new Vector3(0, 0, -50));
  const cap = ship(3, 'choir', new Vector3(0, 0, 0), new Vector3(), 400);
  w.step([a, b, cap], LAUNCH_GRACE + 0.1, () => {});
  a.flight.position.set(0, 0, 0);
  b.flight.position.set(4, 0, 0);
  w.step([a, b, cap], DT, () => {}, (s) => s === a);
  assert.equal(w.contacts, 0);
});
