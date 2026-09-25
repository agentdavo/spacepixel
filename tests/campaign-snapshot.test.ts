import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CampaignRunner, type CampaignHost, type RunnerSnapshot } from '../src/game/CampaignRunner.ts';
import type { CampaignMission } from '../src/game/campaign/types.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';

const MISSION: CampaignMission = {
  id: 'snapshot', chapter: 1, episode: 1, title: 'Snapshot', milestones: [],
  system: 'meridian', briefing: '', tagline: '', debrief: '', codex: [], codexOnStart: ['intro'],
  spawns: [
    { blueprint: 'x', faction: 'concord', count: 2, tag: 'escort', role: 'escort', routeTo: 'dock', place: { at: 'player', offset: [0, 0, 100] } },
    { blueprint: 'x', faction: 'choir', count: 1, tag: 'late', whenFlag: 'go', delay: 5, place: { at: 'player', offset: [0, 0, 500] } },
  ],
  setpieces: [
    { kind: 'beacon', tag: 'dock', place: { at: 'player', offset: [0, 0, 4000] } },
    { kind: 'beacon', tag: 'survey', params: { hold: 10, radius: 100 }, place: { at: 'player', offset: [0, 0, 0] } },
  ],
  objectives: [
    { id: 'start', text: 'Start', done: (c) => c.flag('go') },
    { id: 'finish', text: 'Finish', done: (c) => c.flag('finish') },
  ],
  chatter: [
    { id: 'hello', trigger: { on: 'start' }, lines: [] },
    { id: 'go-beat', trigger: { on: 'flag', flag: 'go' }, lines: [] },
    { id: 'later', trigger: { on: 'time', at: 6 }, lines: [] },
  ],
};

function host(): CampaignHost & { calls: string[] } {
  const calls: string[] = [];
  const ships: ShipEntity[] = [];
  return {
    playerPosition: new Vector3(), playerAlive: true, playerHull: 1, systemId: 'meridian', jumps: 0,
    calls, ships,
    gatePosition: () => { calls.push('gate'); return null; },
    spawnShip: (spec, member, position) => {
      calls.push(`spawn:${spec.tag}:${member}`);
      const ship = { alive: true, faction: spec.faction, hull: 100, hullMax: 100,
        flight: { position: position.clone(), velocity: new Vector3() } } as ShipEntity;
      ships.push(ship);
      return ship;
    },
    spawnSetPiece: (spec, position) => {
      calls.push(`piece:${spec.tag}`);
      return { tag: spec.tag, position, radius: 10 };
    },
    playChatter: (beat) => { calls.push(`beat:${beat.id}`); },
    unlockCodex: (id) => { calls.push(`codex:${id}`); },
    command: (verb) => { calls.push(`command:${verb}`); },
  };
}

function running() {
  const h = host();
  const r = new CampaignRunner(MISSION, h);
  r.begin();
  r.update(1);
  r.setFlag('go');
  r.setFlag('halt:escort');
  const [survivor, dead] = r.shipsTagged('escort');
  survivor.flight.position.set(120, -30, 700);
  survivor.flight.velocity.set(2, -3, 4);
  survivor.hull = 55;
  dead.alive = false;
  dead.hull = -25;
  r.onKill(dead);
  r.update(2);
  return { r, h };
}

test('snapshot: fired:null cannot leak time/flags into the fresh-start fallback', () => {
  const h = host();
  const r = new CampaignRunner(MISSION, h);
  const before = r.snapshot();
  const bad = { ...running().r.snapshot(), time: 99, flags: [['wrong-save-flag', 12]], fired: null };
  assert.throws(() => r.restore(bad), /at fired:/);
  assert.deepEqual(r.snapshot(), before);
  assert.deepEqual(h.calls, []);
  r.begin();
  const freshHost = host();
  const fresh = new CampaignRunner(MISSION, freshHost);
  fresh.begin();
  assert.deepEqual(r.snapshot(), fresh.snapshot());
  assert.deepEqual(h.calls, freshHost.calls);
  assert.equal(r.ctx.aliveCount('late'), 0);
});

test('snapshot: malformed fields are all rejected before mutation or any host call', () => {
  const valid = running().r.snapshot();
  const cases: [string, (s: any) => unknown][] = [
    ['snapshot', () => null], ['snapshot', () => []],
    ['time', (s) => ({ ...s, time: Infinity })], ['time', (s) => ({ ...s, time: -1 })],
    ['flags', (s) => ({ ...s, flags: null })],
    ['flags[0]', (s) => ({ ...s, flags: [['go']] })],
    ['flags[0][0]', (s) => ({ ...s, flags: [[7, 0]] })],
    ['flags[0][1]', (s) => ({ ...s, flags: [['go', NaN]] })],
    ['flags[1][0]', (s) => ({ ...s, flags: [['go', 0], ['go', 1]] })],
    ['state', (s) => ({ ...s, state: null })], ['state', (s) => ({ ...s, state: [] })],
    ['state[1]', (s) => ({ ...s, state: ['done', 'bogus'] })],
    ['fired', (s) => ({ ...s, fired: null })], ['fired[0]', (s) => ({ ...s, fired: [5] })],
    ['fired[1]', (s) => ({ ...s, fired: ['hello', 'hello'] })],
    ['kills', (s) => ({ ...s, kills: {} })],
    ['kills[0][1]', (s) => ({ ...s, kills: [['choir', -1]] })],
    ['kills[0][1]', (s) => ({ ...s, kills: [['choir', 1.5]] })],
    ['kills[0][1]', (s) => ({ ...s, kills: [['choir', Infinity]] })],
    ['dwells', (s) => ({ ...s, dwells: null })],
    ['dwells[0][1]', (s) => ({ ...s, dwells: [['survey', -0.1]] })],
    ['dwells[0][1]', (s) => ({ ...s, dwells: [['survey', 1.1]] })],
    ['dwells[0][1]', (s) => ({ ...s, dwells: [['survey', NaN]] })],
    ['released', (s) => ({ ...s, released: null })],
    ...[-1, 0.5, 2, Infinity, '0'].map((n): [string, (s: any) => unknown] => ['released[0]', (s) => ({ ...s, released: [n] })]),
    ['released[1]', (s) => ({ ...s, released: [0, 0] })],
    ['ships', (s) => ({ ...s, ships: null })],
    ['ships[1]', (s) => { s.ships[1] = null; return s; }],
    ['ships[1].spawn', (s) => { s.ships[1].spawn = 2; return s; }],
    ['ships[1].spawn', (s) => { s.ships[1].spawn = 1; s.ships[1].member = 0; return s; }],
    ...[-1, 0.5, 2, NaN].map((n): [string, (s: any) => unknown] => ['ships[1].member', (s) => { s.ships[1].member = n; return s; }]),
    ['ships[1]', (s) => { s.ships[1].member = 0; return s; }],
    ['ships[1].alive', (s) => { s.ships[1].alive = 'false'; return s; }],
    ['ships[1].pos', (s) => { s.ships[1].pos = [0, 0]; return s; }],
    ['ships[1].pos[2]', (s) => { s.ships[1].pos[2] = Infinity; return s; }],
    ['ships[1].vel', (s) => { s.ships[1].vel = null; return s; }],
    ['ships[1].vel[1]', (s) => { s.ships[1].vel[1] = '1'; return s; }],
    ['ships[1].hull', (s) => { s.ships[1].hull = NaN; return s; }],
  ];
  for (const [path, corrupt] of cases) {
    const h = host();
    const r = new CampaignRunner(MISSION, h);
    const before = r.snapshot();
    const bad = corrupt(structuredClone(valid));
    assert.throws(() => r.restore(bad), (e: Error) => e instanceof TypeError && e.message.includes(`at ${path}:`), path);
    assert.deepEqual(r.snapshot(), before, path);
    assert.deepEqual(h.calls, [], path);
    // Check pending spawns/pieces and private state through fresh-start behaviour.
    r.begin();
    r.update(6);
    const cleanHost = host();
    const clean = new CampaignRunner(MISSION, cleanHost);
    clean.begin();
    clean.update(6);
    assert.deepEqual(r.snapshot(), clean.snapshot(), path);
    assert.deepEqual(h.calls, cleanHost.calls, path);
  }
});

test('snapshot: JSON restore preserves timers, survivors, velocity, objectives, chatter and dwell continuity', () => {
  const original = running();
  const snap: RunnerSnapshot = JSON.parse(JSON.stringify(original.r.snapshot()));
  const unchanged = structuredClone(snap);
  const h = host();
  const r = new CampaignRunner(MISSION, h);
  r.restore(snap);
  assert.deepEqual(snap, unchanged, 'validation and restore leave the input untouched');
  assert.deepEqual(h.calls, ['spawn:escort:0'], 'flags restore silently and dead members stay dead');
  r.begin();
  assert.equal(r.time, 3);
  assert.deepEqual(r.state, ['done', 'active']);
  assert.equal(r.ctx.kills('concord'), 1);
  assert.equal(r.shipsTagged('escort').length, 1);
  const survivor = r.shipsTagged('escort')[0];
  assert.deepEqual(survivor.flight.position.toArray(), [120, -30, 700]);
  assert.deepEqual(survivor.flight.velocity.toArray(), [2, -3, 4]);
  assert.ok(Math.abs(survivor.hull - 55) < 1e-10);
  assert.equal(r.dwells[0].progress, original.r.dwells[0].progress);
  assert.ok(!h.calls.some((c) => c.startsWith('beat:')));
  h.calls.length = 0;
  original.h.calls.length = 0;
  for (const dt of [2.5, 0.5, 4]) {
    original.r.update(dt);
    r.update(dt);
    assert.equal(r.ctx.aliveCount('late'), original.r.ctx.aliveCount('late'));
    assert.deepEqual(r.state, original.r.state);
    assert.deepEqual([...r.flags], [...original.r.flags]);
    assert.equal(r.dwells[0].progress, original.r.dwells[0].progress);
    assert.equal(r.escorts[0].halted, true);
  }
  assert.deepEqual(h.calls, original.h.calls);
  assert.equal(r.ctx.aliveCount('late'), 1);
  assert.ok(r.flags.has('survey-held'));
  assert.deepEqual(h.calls.filter((c) => c.startsWith('beat:')), ['beat:later']);
  // A subsequent save omits the dead member; indices remain stable on re-entry.
  const again = new CampaignRunner(MISSION, host());
  again.restore(JSON.parse(JSON.stringify(r.snapshot())));
  again.begin();
  assert.equal(again.shipsTagged('escort').length, 1);
  assert.equal(again.ctx.aliveCount('late'), 1);
});

test('snapshot: validation does not promise rollback when a host callback throws', () => {
  const h = host();
  h.spawnShip = () => { throw new Error('host unavailable'); };
  const r = new CampaignRunner(MISSION, h);
  const snap = running().r.snapshot();
  assert.throws(() => r.restore(snap), /host unavailable/);
  assert.equal(r.time, snap.time, 'valid data was applied before the host failure');
});
