import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import {
  EPISODE_SCORES,
  FACTION_SCORES,
  SCORE_IDS,
  SCORE_INFO,
  SOUNDTRACK_SETTINGS,
  SYSTEM_SCORES,
  describeSoundtrack,
  isScoreId,
  scoreFor,
  variantOf,
  variantShape,
} from '../src/audio/score/catalog.ts';

test('every campaign episode has its own score', () => {
  for (const m of MISSIONS) {
    const id = EPISODE_SCORES[m.episode];
    assert.ok(isScoreId(id), `episode ${m.episode} (${m.title}) has a score`);
    const pick = scoreFor({ system: m.system, faction: 'concord', episode: m.episode });
    assert.equal(pick.id, id);
    assert.equal(pick.reason, 'episode');
  }
});

test('episodes that share a score still get their own tunes (distinct variants)', () => {
  const seen = new Map<string, number>();
  for (const m of MISSIONS) {
    const { id, variant } = scoreFor({ episode: m.episode });
    const key = `${id}:${variant}`;
    assert.ok(!seen.has(key), `episode ${m.episode} repeats episode ${seen.get(key)}'s arrangement`);
    seen.set(key, m.episode);
  }
});

test('resolution order: pinned soundtrack > episode > special system > faction > original', () => {
  assert.equal(scoreFor({ system: 'tessaly', faction: 'choir', episode: 1 }, 'rustwake').id, 'rustwake');
  assert.equal(scoreFor({ system: 'tessaly', faction: 'choir', episode: 1 }, 'rustwake').reason, 'user');
  assert.equal(scoreFor({ system: 'monolith', faction: 'unknown', episode: 1 }).id, 'concord');
  assert.equal(scoreFor({ system: 'monolith', faction: 'unknown' }).id, 'monolith');
  assert.equal(scoreFor({ system: 'nexus', faction: 'unknown' }).reason, 'system');
  assert.equal(scoreFor({ system: 'null', faction: 'unknown' }).id, 'deadzone');
  assert.equal(scoreFor({ system: 'some-procgen', faction: 'rustwake' }).id, 'rustwake');
  assert.equal(scoreFor({ system: 'some-procgen', faction: 'contested' }).reason, 'faction');
  assert.equal(scoreFor({ system: 'x', faction: 'unknown' }).id, 'deadzone');
  assert.deepEqual(scoreFor({}), { id: 'classic', variant: 0, reason: 'default' });
  // 'auto' and junk settings fall through to the game's choice.
  assert.equal(scoreFor({ system: 'x', faction: 'choir' }, 'auto').id, 'choir');
  assert.equal(scoreFor({ system: 'x', faction: 'choir' }, 'not-a-score').id, 'choir');
});

test('every faction a system can have maps to a score', () => {
  for (const f of ['concord', 'choir', 'rustwake', 'contested', 'unknown']) assert.ok(isScoreId(FACTION_SCORES[f]), f);
  for (const [sys, id] of Object.entries(SYSTEM_SCORES)) assert.ok(isScoreId(id), sys);
});

test('variants are stable, per place, and stay in a musical range', () => {
  assert.equal(variantOf('sys:anchorage'), variantOf('sys:anchorage'));
  assert.notEqual(variantOf('sys:anchorage'), variantOf('sys:meridian'));
  assert.equal(scoreFor({ system: 'anchorage', faction: 'concord' }).variant, scoreFor({ system: 'anchorage', faction: 'concord' }).variant);
  assert.deepEqual(variantShape(0), { transpose: 0, tempo: 1, seed: 0 });
  const keys = new Set<number>();
  for (let i = 0; i < 400; i++) {
    const v = variantOf(`sys:proc-${i}`);
    assert.ok(v >= 0 && v <= 0x7fffffff);
    const sh = variantShape(v);
    assert.ok(sh.transpose >= -2 && sh.transpose <= 3, `transpose ${sh.transpose}`);
    assert.ok(sh.tempo >= 0.959 && sh.tempo <= 1.041, `tempo ${sh.tempo}`);
    keys.add(sh.transpose);
  }
  assert.equal(keys.size, 6, 'variants spread over every key shift');
});

test('soundtrack settings and labels cover every score', () => {
  assert.equal(SOUNDTRACK_SETTINGS[0], 'auto');
  assert.deepEqual(SOUNDTRACK_SETTINGS.slice(1), [...SCORE_IDS]);
  for (const id of SCORE_IDS) {
    const i = SCORE_INFO[id];
    assert.ok(i.title && i.jp && i.blurb, id);
    assert.match(describeSoundtrack(id), new RegExp(i.title.toUpperCase()));
  }
  assert.equal(describeSoundtrack('auto', 'choir'), 'SOUNDTRACK AUTO · CATHEDRAL LITURGY');
});
