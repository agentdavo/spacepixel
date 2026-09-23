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
