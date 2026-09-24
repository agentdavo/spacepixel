import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BANTER, BARK_LINES } from '../src/dialog/barks.ts';
import { CAST_VOICES, npcVoice } from '../src/audio/voice/voices.ts';
import { NEURAL_CAST, SYNTH_ONLY, clipKey, neuralVoiceFor, profileSex, spokenText } from '../src/audio/voice/neural.ts';

const manifest: Record<string, number> = JSON.parse(readFileSync(new URL('../public/voice/manifest.json', import.meta.url), 'utf8'));

test('recorded voices: every speaking cast member is cast; machines stay synthetic', () => {
  for (const id of Object.keys(CAST_VOICES)) {
    if (SYNTH_ONLY.has(id)) assert.equal(neuralVoiceFor(id, 'm'), null, id);
    else assert.ok(NEURAL_CAST[id], `${id} has no recorded voice`);
  }
  // A person's synth profile and their data agree on who records them.
  for (const sex of ['f', 'm'] as const)
    for (const age of ['young', 'adult', 'old'] as const)
      for (let seed = 0; seed < 40; seed++) assert.equal(profileSex(npcVoice(seed, { sex, age, faction: 'concord', temper: seed % 2 ? 'nervous' : 'weary' })), sex);
  // Radio ids are voiced from the id alone (their profile is rolled per ship).
  assert.deepEqual(neuralVoiceFor('enemy:choir:3', 'f'), neuralVoiceFor('enemy:choir:3', 'm'));
  assert.equal(spokenText('(sung) Out of the dust—'), 'Out of the dust—');
  assert.equal(clipKey(NEURAL_CAST.kade, 'Copy.'), clipKey(NEURAL_CAST.kade, 'Copy.'));
  assert.notEqual(clipKey(NEURAL_CAST.kade, 'Copy.'), clipKey(NEURAL_CAST.salt, 'Copy.'));
});

test('recorded voices: every wing bark and banter line has a clip on disk', () => {
  const wing = ['kade', 'jackpot', 'candle', 'sparrow', 'salt'];
  const lines: [string, string][] = [];
  for (const table of Object.values(BARK_LINES)) for (const w of wing) for (const t of (table as Record<string, string[]>)[w] ?? []) if (!t.includes('{')) lines.push([w, t]);
  for (const ex of BANTER) for (const l of ex) lines.push(l);
  for (const [who, text] of lines) {
    const key = clipKey(neuralVoiceFor(who, 'm')!, text);
    assert.ok(manifest[key] > 0.2 && manifest[key] < 12, `${who}: "${text}" not recorded (npm run voices)`);
    assert.ok(existsSync(new URL(`../public/voice/${key}.mp3`, import.meta.url)), key);
  }
});
