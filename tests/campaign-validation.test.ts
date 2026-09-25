import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCampaign, validateMission } from '../src/game/campaign/validate.ts';
import type { CampaignMission, SetPieceSpec } from '../src/game/campaign/types.ts';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import { CAST } from '../src/game/campaign/cast.ts';
import { CODEX } from '../src/game/campaign/codex.ts';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const point = { at: 'player' as const, offset: [0, 0, 100] as [number, number, number] };
const buoy = (tag: string): SetPieceSpec => ({ kind: 'beacon', tag, place: point });
function fixture(): CampaignMission {
  return {
    id: 'test-escort', episode: 42, chapter: 1, title: 'Escort', tagline: '', briefing: '', debrief: '', system: 'meridian', milestones: [], codex: [],
    objectives: [{ id: 'arrive', text: 'Reach the buoy', navTag: 'arrival', done: () => { throw Error('Validation must never execute mission predicates'); } }],
    spawns: [{ blueprint: 'test-fighter', faction: 'concord', count: 2, tag: 'convoy-wave', place: point, role: 'escort', routeTo: 'arrival', whenFlag: 'future-leg' }],
    setpieces: [buoy('arrival')],
    chatter: [{ id: 'greeting', trigger: { on: 'objective-done', objective: 'arrive' }, lines: [{ who: 'system', text: 'Arrived' }] }],
  };
}

test('all story episodes pass catalog/reference validation without executing predicates', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
    assert.deepEqual(validateCampaign({ title: 'Vanguard', missions: MISSIONS, cast: CAST, codex: CODEX }, { blueprints: new Set(Object.keys(BLUEPRINTS)) }), []);
  } finally { await server.close(); }
});

test('broken mission links identify the exact mission and authoring field', () => {
  const m = fixture();
  m.objectives[0].navTag = 'convoy-wave'; // a ship group cannot be a navigation set piece
  m.spawns[0].routeTo = 'missing-end';
  m.spawns[0].place = { at: 'tag', tag: 'missing-start', offset: [0, 0, 0] };
  m.chatter.push({ id: 'near', trigger: { on: 'near', tag: 'missing-buoy', distance: 10 }, lines: [] });
  m.chatter[0].trigger = { on: 'objective-active', objective: 'missing-objective' };
  const issues = validateMission(m);
  assert.deepEqual(issues.map(i => [i.code, i.path]), [
    ['unknown-nav-tag', 'objectives[0].navTag'],
    ['unknown-tag', 'spawns[0].place.tag'],
    ['unknown-tag', 'spawns[0].routeTo'],
    ['unknown-objective', 'chatter[0].trigger.objective'],
    ['unknown-tag', 'chatter[1].trigger.tag'],
  ]);
  assert.ok(issues.every(i => i.missionId === m.id && i.severity === 'error'));
});

test('group prefixes, numbered members, deferred declarations and host tags resolve', () => {
  const m = fixture();
  m.spawns[0].routeTo = 'convoy';
  m.setpieces.push({ ...buoy('later'), place: { at: 'tag', tag: 'convoy-wave-2', offset: [0, 0, 0] }, params: { whenFlag: 'future-leg' } });
  m.chatter.push({ id: 'host', trigger: { on: 'near', tag: 'station', distance: 300 }, lines: [{ who: 'contract-giver', text: 'Here' }] });
  const catalogs = { externalTags: ['station-main'], speakers: new Set(['contract-giver']) };
  const before = JSON.stringify(m);
  assert.deepEqual(validateMission(m, catalogs), []);
  assert.equal(JSON.stringify(m), before, 'Validation does not reorder or mutate content');
  m.setpieces[1].place = { at: 'tag', tag: 'convoy-wave-3', offset: [0, 0, 0] };
  assert.equal(validateMission(m, catalogs)[0].code, 'unknown-tag', 'Out-of-range group member is not a declared ship');
});

test('duplicate IDs and unknown catalog entries fail before running a mission', () => {
  const m = fixture();
  m.objectives.push({ ...m.objectives[0] });
  m.chatter.push({ ...m.chatter[0], lines: [{ who: 'typo', text: 'Hello' }] });
  m.codex = ['lost-entry'];
  const issues = validateMission(m, { blueprints: new Set(), speakers: new Set(), codex: new Set() });
  assert.deepEqual(issues.map(i => i.code), ['duplicate-id', 'duplicate-id', 'unknown-blueprint', 'unknown-speaker', 'unknown-codex']);
});

test('invalid coordinates, counts and dwell timing receive actionable diagnostics', () => {
  const m = fixture();
  m.spawns[0].count = 1.5;
  m.spawns[0].delay = Infinity;
  m.spawns[0].place = { at: 'point', point: [0, NaN, 0], offset: [0, 0, 0] };
  m.setpieces[0].params = { hold: 0 };
  assert.deepEqual(validateMission(m).map(i => i.path), ['spawns[0].count', 'spawns[0].delay', 'spawns[0].place.point', 'setpieces[0].params.hold']);
});

test('story episode order is checked separately from generated mission metadata', () => {
  const m = fixture();
  assert.deepEqual(validateMission(m), [], 'Generated operations need not start at episode one');
  const issues = validateCampaign({ title: 'Story', cast: [], codex: [], missions: [{ ...m, episode: 1 }, { ...m, episode: 1 }] });
  assert.deepEqual(issues.map(i => [i.code, i.path]), [['duplicate-mission', 'missions[1].id'], ['episode-order', 'missions[1].episode']]);
});
