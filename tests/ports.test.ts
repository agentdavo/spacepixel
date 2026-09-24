import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { surfacePorts, terrainFor } from '../src/universe/surfacePorts.ts';
import { APRON_RADIUS, groundAt, type GroundSpec } from '../src/world/surface/terrain.ts';
import { approachEase, approachProfile, berthClassFor, carrierBerth } from '../src/world/berths/classes.ts';
import { bestHold, type SimMarket } from '../src/game/econSim.ts';
import { KIND_LABEL, marketBoard, newLedger, quote, stance } from '../src/game/economy.ts';
import type { StationSite } from '../src/universe/Universe.ts';

/**
 * Docking for every hull size (berth classes, approach numbers) and
 * planetary ports (surface-port placement, ground, market character).
 * The geometric berth checks against real station models are in
 * tests/berths.test.ts.
 */

// ── berth classes ─────────────────────────────────────────────────────

test('berth class by hull length: fighters bay, gunships/corvettes clamp, frigates moor', () => {
  assert.equal(berthClassFor(17), 'bay'); // Kestrel
  assert.equal(berthClassFor(35), 'bay'); // Warhorse
  assert.equal(berthClassFor(40), 'bay');
  assert.equal(berthClassFor(56), 'clamp'); // Bulwark T4
  assert.equal(berthClassFor(177), 'clamp'); // Resolute T5
  assert.equal(berthClassFor(200), 'clamp');
  assert.equal(berthClassFor(256), 'mooring'); // Longhaul
  assert.equal(berthClassFor(380), 'mooring'); // Valiant T6
});

test('approach numbers scale with length: longer corridor, slower final, bounded window', () => {
  const bay = approachProfile('bay', 17);
  assert.equal(bay.autoRange, 1000, 'the fighter bay is unchanged');
  assert.equal(bay.lateralTol, 700);
  assert.equal(bay.tAuto, 7);
  const bulwark = approachProfile('clamp', 56);
  const resolute = approachProfile('clamp', 177);
  const valiant = approachProfile('mooring', 380);
  assert.ok(resolute.autoRange > bulwark.autoRange && valiant.autoRange > resolute.autoRange, 'guidance reaches further for bigger hulls');
  assert.ok(resolute.tAuto > bulwark.tAuto && valiant.tAuto > resolute.tAuto, 'slower approach for bigger hulls');
  assert.ok(resolute.maxClosing < bulwark.maxClosing && valiant.maxClosing <= resolute.maxClosing, 'closing-speed cap tightens');
  assert.ok(resolute.lateralTol > bulwark.lateralTol && valiant.lateralTol <= 1500, 'capture window widens, bounded');
  assert.ok(valiant.corridorScale > resolute.corridorScale && resolute.corridorScale > 1, 'corridor gates spread out');
  for (const p of [bulwark, resolute, valiant]) {
    assert.ok(p.minOut > 0 && p.minOut < p.autoRange);
    assert.ok(p.tAttach > 0 && p.tRelease > 0 && p.launchRun > 560);
  }
  // Big hulls arrive on a cubic ease: slower over the last 15 % of the time.
  assert.ok(approachEase('clamp', 0.85).dedu < approachEase('bay', 0.85).dedu);
  assert.equal(approachEase('mooring', 1).e, 1);
  assert.equal(approachEase('clamp', 0).e, 0);
});

test('carriers take fighters in the hangar, corvettes alongside, frigates nowhere', () => {
  assert.equal(carrierBerth('bay'), 'hangar');
  assert.equal(carrierBerth('clamp'), 'alongside');
  assert.equal(carrierBerth('mooring'), null);
});

// ── surface ports ─────────────────────────────────────────────────────

function station(id: string, kind: StationSite['kind'], planet: number | undefined, axis: Vector3): StationSite {
  return { id, name: id, kind, faction: 'concord', position: new Vector3(), axis: axis.clone().normalize(), up: new Vector3(0, 1, 0), planet, seed: 7, risk: 0.2 };
}

function sys(id: string, kinds: ('gas' | 'ocean' | 'desert' | 'ice' | 'rocky')[]) {
  const planets = kinds.map((k, i) => ({ preset: { name: `${id} ${i + 1}`, kind: k, radius: 40_000 + i * 5000 }, position: new Vector3(200_000 * (i + 1), 1000, -50_000) }));
  const stations = [
    station(`${id}-orbital-0`, 'orbital', 0, new Vector3(-1, 0.1, 0.2)),
    station(`${id}-bastion-1`, 'bastion', undefined, new Vector3(0, 0, 1)),
    station(`${id}-refinery-2`, 'refinery', planets.length > 1 ? 1 : 0, new Vector3(0.3, 0.2, -1)),
  ];
  if (planets.length > 1) stations.push(station(`${id}-orbital-3`, 'orbital', 1, new Vector3(0.2, -1, 0.1)));
  return { id, name: id, planets, stations };
}

test('surface ports: one per orbital port, under its tether, on the planet surface', () => {
  const s = sys('testsys', ['ocean', 'gas']);
  const ports = surfacePorts(1994, s);
  assert.equal(ports.length, 2, 'two orbital ports → two cities (refineries and bastions get none)');
  for (const p of ports) {
    const st = s.stations.find((x) => x.id === p.orbital)!;
    assert.equal(st.kind, 'orbital');
    assert.equal(p.kind, 'surface');
    assert.equal(p.planet, st.planet);
    const pl = s.planets[p.planet];
    assert.ok(Math.abs(p.position.distanceTo(pl.position) - pl.preset.radius) < 1e-6, 'on the surface');
    assert.ok(p.position.clone().sub(pl.position).normalize().dot(st.axis) > 0.999999, 'straight under the tether');
    assert.equal(p.faction, st.faction);
    assert.equal(p.risk, st.risk);
    assert.ok(p.name.length > 3 && p.description.length > 20);
    assert.ok(p.heading >= 0 && p.heading < Math.PI * 2);
  }
  assert.equal(ports[0].terrain, 'ocean');
  assert.equal(ports[1].terrain, 'cloud', 'a gas giant gets a floating city over the cloud sea');
  assert.notEqual(ports[0].name, ports[1].name);
  assert.deepEqual(surfacePorts(1994, s), ports, 'deterministic from the seed');
  assert.notDeepEqual(surfacePorts(7, s).map((p) => p.seed), ports.map((p) => p.seed), 'another seed, other cities');
});

test('surface ports: key worlds keep their names; kinds map to terrain', () => {
  assert.equal(surfacePorts(1994, sys('meridian', ['gas']))[0].name, 'Castellan Low City');
  assert.equal(surfacePorts(1994, sys('hesper', ['ocean']))[0].name, 'The Spire');
  assert.equal(terrainFor('ice-giant'), 'cloud');
  assert.equal(terrainFor('burning'), 'volcanic');
  assert.equal(terrainFor(undefined), 'rocky');
  assert.equal(terrainFor('desert'), 'desert');
});

test('ground: the apron is flat, the sea is wet, the cloud sea lies far below the platform', () => {
  for (const terrain of ['rocky', 'desert', 'ice', 'volcanic', 'ocean', 'lantern'] as const) {
    const g: GroundSpec = { terrain, seed: 1234, seaLevel: 0.515, apron: 60 };
    for (let a = 0; a < 6.28; a += 0.7) {
      const s = groundAt(g, Math.cos(a) * APRON_RADIUS * 0.8, Math.sin(a) * APRON_RADIUS * 0.8);
      assert.ok(Math.abs(s.h - 60) < 1e-6, `${terrain}: apron flat`);
      assert.ok(s.h01 > 0 && s.h01 < 1);
    }
    const far = groundAt(g, 12_000, -9000);
    assert.deepEqual(groundAt(g, 12_000, -9000), far, 'deterministic');
  }
  const sea: GroundSpec = { terrain: 'ocean', seed: 99, seaLevel: 0.515, apron: 24 };
  let wet = 0;
  for (let i = 0; i < 400; i++) {
    const s = groundAt(sea, Math.cos(i * 1.3) * (4000 + i * 60), Math.sin(i * 1.3) * (4000 + i * 60));
    if (s.wet > 0) {
      wet++;
      assert.equal(s.h, 0, 'water sits at sea level');
      assert.ok(s.h01 < 0.515, 'and paints from the sea part of the ramp');
    }
  }
  assert.ok(wet > 40, `a shelf-sea has water (${wet}/400)`);
  const gas: GroundSpec = { terrain: 'cloud', seed: 5, apron: 0 };
  for (let i = 0; i < 50; i++) assert.ok(groundAt(gas, i * 500 - 12_000, i * 300).h < -800, 'cloud sea well below the floating city');
});

// ── economy ───────────────────────────────────────────────────────────

test('surface ports: a city market — pays for food, medicine and luxuries, sells spares and charges', () => {
  const l = newLedger();
  const city = { id: 'x-surface-0', kind: 'surface' as const, faction: 'concord' as const, risk: 0.1 };
  assert.equal(KIND_LABEL.surface, 'SURFACE PORT · PLANETFALL');
  assert.equal(stance(city, 'medical'), 'demand');
  assert.equal(stance(city, 'rations'), 'demand');
  assert.equal(stance(city, 'luxury'), 'demand');
  assert.equal(stance(city, 'spares'), 'surplus');
  assert.equal(stance(city, 'munitions'), 'surplus');
  assert.equal(marketBoard(city, l).length, 8, 'a city trades everything');
  const orbital = { ...city, id: 'x-orbital-0', kind: 'orbital' as const };
  // Down the tether pays: the city bids more for medical than the highport asks.
  assert.ok(quote(city, 'medical', l)!.sell > quote(orbital, 'medical', l)!.buy);
  // …but an in-system tether run is a modest living, not a jackpot.
  const a: SimMarket = { ...orbital, name: 'Highport', system: 'x' };
  const b: SimMarket = { ...city, name: 'City', system: 'x' };
  const run = bestHold(a, b, { ...l, clock: 600 }, 16);
  assert.ok(run.profit > 0 && run.profit < 2500, `orbital → surface hold: ${run.profit} sh`);
});
