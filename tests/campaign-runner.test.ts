import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import type { CampaignMission } from '../src/game/campaign/types.ts';

// Minimal ship stand-in with just the fields the runner reads.
function fakeShip(faction: string, pos: Vector3) {
  return { faction, alive: true, hull: 100, hullMax: 100, flight: { position: pos } } as never;
}

function host(): CampaignHost & { beats: string[]; codex: string[] } {
  const h = {
    playerPosition: new Vector3(),
    playerAlive: true,
    playerHull: 1,
    systemId: 'meridian',
    jumps: 0,
    beats: [] as string[],
    codex: [] as string[],
    ships: [] as never[],
    gatePosition: (i: number) => (i === 0 ? new Vector3(0, 0, 5000) : null),
    spawnShip: (s: { faction: string }, _i: number, p: Vector3) => {
      const ship = fakeShip(s.faction, p);
      (h.ships as unknown[]).push(ship);
      return ship;
    },
    spawnSetPiece: (s: { tag: string }, p: Vector3) => ({ tag: s.tag, position: p, radius: 10 }),
    playChatter: (b: { id: string }) => h.beats.push(b.id),
    unlockCodex: (id: string) => h.codex.push(id),
  };
  return h as never;
}

const MISSION: CampaignMission = {
  id: 't',
  chapter: 1,
  episode: 1,
  title: 'T',
  milestones: [6],
  system: 'meridian',
  briefing: '',
  tagline: '',
  debrief: '',
  codex: ['win'],
  codexOnStart: ['start'],
  spawns: [
    { blueprint: 'choir-cantor', faction: 'choir', count: 2, place: { at: 'gate', offset: [0, 0, 0] }, tag: 'bandit' },
    { blueprint: 'choir-cantor', faction: 'choir', count: 1, place: { at: 'player', offset: [0, 0, 100] }, tag: 'late', whenFlag: 'box-recovered' },
  ],
  setpieces: [{ kind: 'blackbox', tag: 'box', place: { at: 'tag', tag: 'bandit', offset: [0, 0, 10] } }],
  objectives: [
    { id: 'kill', text: 'kill', done: (c) => c.aliveCount('bandit') === 0 },
    { id: 'box', text: 'box', done: (c) => c.flag('box-recovered'), setsFlag: 'got-box' },
  ],
  chatter: [
    { id: 'hello', trigger: { on: 'start' }, lines: [] },
    { id: 'first-blood', trigger: { on: 'kills', faction: 'choir', count: 1 }, lines: [] },
    { id: 'box-next', trigger: { on: 'objective-active', objective: 'box' }, lines: [] },
    { id: 'won', trigger: { on: 'success' }, lines: [] },
  ],
};

test('runner: spawns, chatter, objectives, flags, codex', () => {
  const h = host();
  const r = new CampaignRunner(MISSION, h);
  r.begin();
  assert.deepEqual(h.codex, ['start']);
  assert.deepEqual(h.beats, ['hello']);
  assert.equal(r.ctx.aliveCount('bandit'), 2);
  // Set pieces placed relative to a tagged ship resolve after that ship spawns.
  assert.equal(r.ctx.alive('box'), true);
  assert.ok(r.ctx.distanceTo('box') > 4000);

  const [a, b] = h.ships as unknown as { alive: boolean; faction: 'choir' }[];
  a.alive = false;
  r.onKill(a as never);
  r.update(0.1);
  assert.ok(h.beats.includes('first-blood'));
  assert.equal(r.state[0], 'active');
  b.alive = false;
  r.onKill(b as never);
  r.update(0.1);
  assert.equal(r.state[0], 'done');
  assert.ok(h.beats.includes('box-next'));
  assert.equal(r.ctx.aliveCount('late'), 0, 'flag-gated spawn must wait');

  r.setFlag('box-recovered');
  r.update(0.1);
  assert.equal(r.ctx.aliveCount('late'), 1, 'flag-gated spawn released');
  assert.equal(r.outcome, 'success');
  assert.ok(r.flags.has('got-box'));
  assert.deepEqual(h.codex, ['start', 'win']);
  assert.equal(h.beats.filter((x) => x === 'won').length, 1, 'beats fire exactly once');
});

test('runner: player death fails the mission', () => {
  const h = host();
  const r = new CampaignRunner(MISSION, h);
  r.begin();
  h.playerAlive = false;
  r.update(0.1);
  assert.equal(r.outcome, 'failure');
});
