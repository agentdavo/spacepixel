/** Run: node --experimental-transform-types --no-warnings --test scripts/voice-pipeline.test.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectVoiceLines } from './voice-lines.ts';
import { runtimeSubsystemNames } from './voice-subsystems.mjs';
import { coverage } from './voices.mjs';
import { barkLine } from '../src/dialog/barks.ts';
import { ROSTER, EXTRAS } from '../src/dialog/people.ts';
import { ARC_GUESTS, RIVAL_GUESTS } from '../src/game/npc/people.ts';
import { clipKey, neuralVoiceFor } from '../src/audio/voice/neural.ts';

test('all runtime mount barks use actual subsystem names and have recorded clips', async () => {
  const names = await runtimeSubsystemNames();
  assert.ok(names.includes('Turret 3'));
  assert.ok(names.includes('Port emitter'));
  assert.ok(names.includes('Shield gen'));
  const catalog = collectVoiceLines(names);
  const keys = new Set(catalog.lines.map((l) => l.key));
  for (const who of ['kade', 'jackpot', 'candle', 'sparrow', 'salt']) {
    for (const kind of ['mount-player', 'mount-wing'] as const) {
      for (const name of names) for (let n = 0; n < 32; n++) {
        const text = barkLine(kind, who, n, { name });
        assert.ok(keys.has(clipKey(neuralVoiceFor(who, 'm')!, text)), `${who}: ${text}`);
      }
    }
  }
  assert.ok(catalog.lines.some((l) => l.text === "Turret 3's down. Good. Next mount on that side."));
  assert.ok(!catalog.lines.some((l) => l.text === "JACKPOT's down. Good. Next mount on that side."));
  assert.ok(catalog.lines.every((l) => /[\p{L}\p{N}]/u.test(l.text) && !l.text.includes('{')));
  for (const person of [...ROSTER, ...EXTRAS, ...ARC_GUESTS, ...RIVAL_GUESTS]) {
    if (!/[\p{L}\p{N}]/u.test(person.greeting)) continue;
    const voice = neuralVoiceFor(person.id, person.voice.sex);
    if (voice) assert.ok(keys.has(clipKey(voice, person.greeting)), `Missing greeting: ${person.id}`);
  }
  const report = coverage(catalog);
  assert.deepEqual(report.missing, [], 'run npm run voices to record missing authored lines');
  for (const reason of ['unspoken', 'synth-only', 'dynamic-text', 'dynamic-speaker']) {
    assert.ok(catalog.excluded.some((l) => l.reason === reason), reason);
  }
});

test('coverage fails for missing/empty files and invalid durations while retaining legacy clips', () => {
  const out = mkdtempSync(join(tmpdir(), 'voice-coverage-test-'));
  try {
    const catalog = { lines: ['ok', 'absent', 'empty', 'zero', 'no-duration'].map((key) => ({ key })), excluded: [], subsystemNames: [] };
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ok: 1, absent: 1, empty: 1, zero: 0, legacy: 2 }));
    for (const key of ['ok', 'zero', 'no-duration', 'legacy']) writeFileSync(join(out, `${key}.mp3`), 'fixture');
    writeFileSync(join(out, 'empty.mp3'), '');
    const report = coverage(catalog, out);
    assert.equal(report.covered, 1);
    assert.deepEqual(report.missing.map((l) => l.key), ['absent', 'empty', 'zero', 'no-duration']);
    assert.deepEqual(report.retained, ['legacy']);
    assert.deepEqual(report.unindexed, ['no-duration.mp3']);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
