import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import { CAST } from '../src/game/campaign/cast.ts';
import { CODEX } from '../src/game/campaign/codex.ts';

/**
 * Smoke-runs every campaign mission through the real runner with a fake
 * host: begin() + 60 s of updates must not throw, spawns must resolve, and
 * every chatter speaker / codex id must exist.
 */
function fakeHost(): CampaignHost & { spawned: number; pieces: number } {
  const ships: unknown[] = [];
  const h = {
    playerPosition: new Vector3(),
    playerAlive: true,
    playerHull: 1,
    systemId: 'x',
    jumps: 0,
    spawned: 0,
    pieces: 0,
    ships: ships as never[],
    gatePosition: (i: number) => new Vector3(0, 0, 3000 + i * 1000),
    spawnShip: (s: { faction: string }, _i: number, p: Vector3) => {
      h.spawned++;
      const ship = { faction: s.faction, team: s.faction, alive: true, hull: 100, hullMax: 100, flight: { position: p.clone() } };
      ships.push(ship);
      return ship as never;
    },
    spawnSetPiece: (s: { tag: string; params?: Record<string, unknown> }, p: Vector3) => {
      h.pieces++;
      return { tag: s.tag, position: p, radius: typeof s.params?.radius === 'number' ? (s.params.radius as number) : 10 };
    },
    playChatter: () => {},
    unlockCodex: () => {},
    command: () => {},
  };
  return h as never;
}

test('campaign data: 20 missions, speakers and codex resolve', () => {
  assert.equal(MISSIONS.length, 20);
  const who = new Set(CAST.map((c) => c.id));
  const codex = new Set(CODEX.map((c) => c.id));
  for (const m of MISSIONS) {
    for (const b of m.chatter) for (const l of b.lines) assert.ok(who.has(l.who) || l.who === 'system', `${m.id}: unknown speaker ${l.who}`);
    for (const id of [...m.codex, ...(m.codexOnStart ?? [])]) assert.ok(codex.has(id), `${m.id}: unknown codex ${id}`);
  }
});

test('EP01 navigation follows active survey objectives and clears during combat and on resolution', () => {
  const m = MISSIONS.find((m) => m.id === 'ep01-the-long-dark')!;
  const h = fakeHost();
  const r = new CampaignRunner(m, h);
  r.begin();
  for (const tag of ['buoy1', 'buoy2', 'buoy3']) {
    const nav = r.navigation()!;
    assert.equal(nav.tag, tag);
    assert.match(nav.label, /Survey buoy/);
    h.playerPosition.copy(nav.position);
    r.update(0.1);
  }
  assert.equal(r.navigation(), undefined, 'combat has no destination marker');
  r.update(5); // release the flag-delayed scavengers
  for (const ship of h.ships) {
    if (ship.faction === 'rustwake') { ship.alive = false; r.onKill(ship); }
  }
  r.update(0.1);
  for (const tag of ['timetable', 'yards']) {
    assert.equal(r.navigation()?.tag, tag);
    h.playerPosition.copy(r.navigation()!.position);
    r.update(0.1);
  }
  assert.equal(r.outcome, 'success');
  assert.equal(r.navigation(), undefined);

  const failedHost = fakeHost();
  const failed = new CampaignRunner(m, failedHost);
  failed.begin();
  assert.equal(failed.navigation()?.tag, 'buoy1');
  failedHost.playerAlive = false;
  failed.update(0.1);
  assert.equal(failed.navigation(), undefined, 'failure clears the destination');
});

test('navigation ignores hidden or unresolved destinations and missions without metadata', () => {
  const base = MISSIONS[0];
  for (const objective of [
    { ...base.objectives[0], hidden: true },
    { ...base.objectives[0], navTag: 'missing' },
    { ...base.objectives[0], navTag: undefined },
  ]) {
    const runner = new CampaignRunner({ ...base, objectives: [objective] }, fakeHost());
    runner.begin();
    assert.equal(runner.navigation(), undefined);
  }
  for (const m of MISSIONS.slice(1)) {
    const runner = new CampaignRunner(m, fakeHost());
    runner.begin();
    assert.equal(runner.navigation(), undefined, m.id);
  }
});

test('campaign data: every mission runs 60 s in the runner without throwing', () => {
  for (const m of MISSIONS) {
    const h = fakeHost();
    const r = new CampaignRunner(m, h);
    assert.doesNotThrow(() => {
      r.begin();
      for (let i = 0; i < 600; i++) r.update(0.1);
    }, m.id);
    assert.ok(h.spawned > 0 || m.spawns.length === 0 || m.spawns.every((s) => s.whenFlag), `${m.id}: nothing spawned`);
  }
});
