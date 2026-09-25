import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakerGains } from '../src/audio/spatial.ts';

test('surround azimuth pans continuously at constant power without full-band LFE', () => {
  for (let angle = -180; angle <= 180; angle++) {
    const a = angle * Math.PI / 180;
    const v = speakerGains(Math.sin(a), -Math.cos(a));
    assert.ok(Math.abs(v.reduce((n, x) => n + x * x, 0) - 1) < 1e-6);
    assert.equal(v[3], 0);
    const next = speakerGains(Math.sin(a + 0.0001), -Math.cos(a + 0.0001));
    assert.ok(v.every((x, i) => Math.abs(x - next[i]) < 0.001));
  }
  assert.equal(speakerGains(0, 0)[2], 1, 'overhead/on-listener sources remain centered');
  assert.ok(speakerGains(-1, 0)[4] > speakerGains(-1, 0)[0]);
  assert.ok(speakerGains(1, 0)[5] > speakerGains(1, 0)[1]);
});
