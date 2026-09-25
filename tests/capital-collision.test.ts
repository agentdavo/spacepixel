import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Quaternion, Vector3 } from 'three';
import { CapitalCollisions } from '../src/sim/CapitalCollisions.ts';
import { FlightModel } from '../src/sim/FlightModel.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';

const DT = 1 / 60;
function ship(id: number, x = 0, z = 0, vx = 0, vz = 0, size = 1): ShipEntity {
  const flight = new FlightModel();
  flight.position.set(x, 0, z);
  flight.velocity.set(vx, 0, vz);
  return { id, alive: true, radius: 160 * size, hull: 20000, hullMax: 20000, flight,
    model: { hull: { geometry: new BoxGeometry(100 * size, 60 * size, 300 * size) } },
  } as unknown as ShipEntity;
}
function advance(ships: ShipEntity[], dt: number): void {
  for (const s of ships) {
    s.flight.position.addScaledVector(s.flight.velocity, dt);
    const r = s.flight.bodyRates;
    const w = new Vector3(-r.x, r.y, r.z);
    const speed = w.length();
    if (speed > 0) s.flight.orientation.multiply(new Quaternion().setFromAxisAngle(w.divideScalar(speed), speed * dt)).normalize();
  }
}
function energy(w: CapitalCollisions, ships: ShipEntity[]): number {
  return ships.reduce((sum, s) => {
    const shape = w.bodyFor(s).shape, r = s.flight.bodyRates;
    return sum + 0.5 * shape.mass * s.flight.velocity.lengthSq() + 0.5 * (shape.inertia.x * r.x ** 2 + shape.inertia.y * r.y ** 2 + shape.inertia.z * r.z ** 2);
  }, 0);
}
function momentum(w: CapitalCollisions, ships: ShipEntity[]): Vector3 {
  return ships.reduce((v, s) => v.addScaledVector(s.flight.velocity, w.bodyFor(s).shape.mass), new Vector3());
}
function run(ships: ShipEntity[], seconds = 4, dt = DT, reconstruct = false) {
  let w = new CapitalCollisions();
  const hits: { closing: number; damage: number; point: number[]; energy: number }[] = [];
  const amounts = new Map<number, number>();
  for (let t = 0; t < seconds - dt / 2; t += dt) {
    advance(ships, dt);
    w.step(ships, dt, (s, d) => amounts.set(s.id, (amounts.get(s.id) ?? 0) + d));
    for (const e of w.events) if (e.energy) hits.push({ closing: e.closing, damage: e.damageA + e.damageB, point: e.point.toArray(), energy: e.energy });
    if (reconstruct) w = new CapitalCollisions();
  }
  return { w, hits, amounts, state: ships.map(s => [s.id, ...s.flight.position.toArray(), ...s.flight.velocity.toArray(), ...s.flight.bodyRates.toArray(), ...s.flight.orientation.toArray()]) };
}

test('large hull bow impact conserves momentum, dissipates energy and damages once', () => {
  const ships = [ship(1, 0, -260, 0, 100), ship(2, 0, 260, 0, -100)];
  const w = new CapitalCollisions(), before = energy(w, ships), p = momentum(w, ships);
  const r = run(ships);
  assert.equal(r.hits.length, 1);
  assert.ok(momentum(w, ships).distanceTo(p) < 1e-7);
  assert.ok(energy(w, ships) < before * 0.002, 'crushing, not pinball restitution');
  assert.ok((r.amounts.get(1) ?? 0) > 19000, 'serious equal-mass 200m/s impact');
  assert.equal(r.amounts.get(1), r.amounts.get(2));
  assert.ok(ships.every(s => s.flight.bodyRates.length() < 1e-9), 'symmetric impact has no arbitrary torque');
});

test('glancing contact retains tangential velocity and has much less damage', () => {
  const head = run([ship(1, -80, 0, 100, 0), ship(2, 80, 0, -100, 0)]);
  const a = ship(1, -55, -10, 10, 100), b = ship(2, 55, 10, -10, -100);
  const glancing = run([a, b], 0.6);
  assert.equal(glancing.hits.length, 1);
  assert.ok(glancing.hits[0].damage < head.hits[0].damage * 0.03);
  assert.equal(a.flight.velocity.z, 100);
  assert.equal(b.flight.velocity.z, -100);
});

test('swept hulls catch a 60km/s crossing whose endpoints do not overlap', () => {
  const a = ship(1, -400, 0, 30000), b = ship(2, 400, 0, -30000);
  advance([a, b], DT);
  const w = new CapitalCollisions();
  w.step([a, b], DT, () => {});
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].closing, 60000);
  assert.ok(a.flight.position.x < b.flight.position.x, 'never swap sides');
});

test('unequal geometric masses exchange momentum; handling mass is irrelevant', () => {
  const a = ship(1, -110, 0, 80), b = ship(2, 110, 0, -20, 0, 2);
  const w = new CapitalCollisions();
  const p = momentum(w, [a, b]), before = energy(w, [a, b]);
  assert.equal(w.bodyFor(b).shape.mass / w.bodyFor(a).shape.mass, 8);
  const r = run([a, b], 1);
  assert.ok(momentum(w, [a, b]).distanceTo(p) < 1e-7);
  assert.ok(energy(w, [a, b]) <= before);
  assert.ok(Math.abs(a.flight.velocity.x - 80) > 7.9 * Math.abs(b.flight.velocity.x + 20));
  assert.ok((r.amounts.get(1) ?? 0) > 7.9 * (r.amounts.get(2) ?? 0));
});

test('off-centre collision produces angular response without adding total energy', () => {
  const a = ship(1, -70, -100, 100), b = ship(2, 70, 100, -100);
  const w = new CapitalCollisions(), before = energy(w, [a, b]);
  run([a, b], 0.25);
  assert.ok(a.flight.bodyRates.length() > 0.001);
  assert.ok(b.flight.bodyRates.length() > 0.001);
  assert.ok(energy(w, [a, b]) <= before + 1e-5);
});

test('stationary spawn overlap settles without damage, velocity or NaNs', () => {
  const a = ship(1), b = ship(2, 15, 0);
  const r = run([a, b], 3);
  assert.equal(r.hits.length, 0);
  assert.equal(r.amounts.size, 0);
  assert.equal(energy(r.w, [a, b]), 0);
  assert.ok(r.state.flat().every(Number.isFinite));
  r.w.step([a, b], DT, () => assert.fail('resting overlap damaged'));
  assert.equal(r.w.events.length, 0, 'compound hulls fully separated');
});

test('separating spawn overlap does not charge damage or reverse velocity', () => {
  const a = ship(1, -45, 0, -30), b = ship(2, 45, 0, 30);
  const r = run([a, b], 1);
  assert.equal(r.hits.length, 0);
  assert.equal(a.flight.velocity.x, -30);
  assert.equal(b.flight.velocity.x, 30);
});

test('persistent gentle thrust against a hull never repeatedly charges damage', () => {
  const a = ship(1, -50, 0), b = ship(2, 50, 0);
  const w = new CapitalCollisions();
  for (let i = 0; i < 600; i++) {
    a.flight.velocity.x += 3 * DT; b.flight.velocity.x -= 3 * DT;
    advance([a, b], DT);
    const supplied = energy(w, [a, b]);
    w.step([a, b], DT, () => assert.fail('repeated frame damage'));
    assert.ok(energy(w, [a, b]) <= supplied + 1e-6, 'contact does not add energy');
  }
  assert.ok(a.flight.speed < 1 && b.flight.speed < 1, 'resting thrust stays bounded');
});

test('parallel narrow hulls pass inside broad spheres without a false collision', () => {
  const r = run([ship(1, -60, -500, 0, 300), ship(2, 60, 500, 0, -300)]);
  assert.equal(r.hits.length, 0);
  assert.equal(r.amounts.size, 0);
});

test('docking-owned ships and fighters stay out of the capital solver', () => {
  const a = ship(1), b = ship(2), w = new CapitalCollisions();
  w.step([a, b], DT, () => assert.fail(), s => s.id === 1);
  assert.equal(w.events.length, 0);
  b.radius = 40;
  w.step([a, b], DT, () => assert.fail());
  assert.equal(w.events.length, 0);
});

test('repeat, reversed ship insertion order and reconstructed solver are identical', () => {
  const make = () => [ship(1, -150, -75, 90), ship(2, 150, 75, -90)];
  const a = run(make()), b = run(make()), c = run(make().reverse()), d = run(make(), 4, DT, true);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.state, c.state.reverse());
  assert.deepEqual(a.state, d.state);
  assert.deepEqual(a.hits, d.hits);
});

test('linear contact damage and final pose agree at 30, 60 and 120Hz', () => {
  const make = () => [ship(1, 0, -267, 0, 100), ship(2, 0, 267, 0, -100)];
  const runs = [1 / 30, 1 / 60, 1 / 120].map(dt => run(make(), 3, dt));
  for (const r of runs) {
    assert.equal(r.hits.length, 1);
    assert.ok(Math.abs(r.hits[0].damage - runs[0].hits[0].damage) < 1e-6);
    r.state.flat().forEach((x, i) => assert.ok(Math.abs(x - runs[0].state.flat()[i]) < 1e-6));
  }
});

test('200 separated large hulls have bounded cheap pair checks and zero narrow-phase checks', () => {
  const ships = Array.from({ length: 200 }, (_, i) => ship(i + 1, i * 1000, 0, 2));
  const w = new CapitalCollisions();
  w.step(ships, DT, () => {}); // warm geometry cache
  const t = performance.now();
  for (let i = 0; i < 120; i++) w.step(ships, DT, () => {});
  console.log(JSON.stringify({ capitalContactCost: { ships: 200, ticks: 120, msPerTick: (performance.now() - t) / 120, pairTests: w.pairTests, boxTests: w.boxTests } }));
  assert.equal(w.pairTests, 19900);
  assert.equal(w.boxTests, 0);
});

test('rotated touching hulls remain finite and impulses do not create energy', () => {
  for (let i = 0; i < 24; i++) {
    const a = ship(1, -60, -30, 40 + i), b = ship(2, 60, 30, -30 - i);
    a.flight.orientation.setFromAxisAngle(new Vector3(0, 1, 0), i * 0.13);
    b.flight.orientation.setFromAxisAngle(new Vector3(1, 0, 0), i * 0.09);
    a.flight.bodyRates.set(0.01, -0.02, 0.015);
    const w = new CapitalCollisions();
    for (let t = 0; t < 30; t++) {
      advance([a, b], DT);
      const before = energy(w, [a, b]);
      w.step([a, b], DT, () => {});
      assert.ok(energy(w, [a, b]) <= before + 1e-5);
      assert.ok([...a.flight.position.toArray(), ...b.flight.position.toArray(), ...a.flight.bodyRates.toArray(), ...b.flight.bodyRates.toArray()].every(Number.isFinite));
    }
  }
});

test('200 close but non-touching capital hulls have bounded narrow-phase cost', () => {
  const shared = new BoxGeometry(100, 60, 300);
  const ships = Array.from({ length: 200 }, (_, i) => {
    const s = ship(i + 1, (i % 20) * 120, Math.floor(i / 20) * 350);
    s.model.hull.geometry = shared;
    return s;
  });
  const w = new CapitalCollisions();
  w.step(ships, DT, () => {});
  const start = performance.now();
  for (let tick = 0; tick < 120; tick++) w.step(ships, DT, () => assert.fail('clear hull damaged'));
  console.log(JSON.stringify({ capitalCloseCost: { ships: 200, ticks: 120, msPerTick: (performance.now() - start) / 120, pairTests: w.pairTests, boxTests: w.boxTests } }));
  assert.equal(w.events.length, 0);
  assert.ok(w.boxTests > 0 && w.boxTests <= 200 * 4 * 36);
});
