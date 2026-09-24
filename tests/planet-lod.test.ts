import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANET_LOD, discRadiusPx, planetLodFor, type PlanetLod } from '../src/world/planets/lod.ts';

/** Planet surface LOD: disc size on screen → detail level, with hysteresis. */

test('disc radius: small-angle limit and inside the sphere', () => {
  // 1 km radius at 100 km, 60° FOV, 720 px: ≈ r/d · focal.
  const focal = 360 / Math.tan(Math.PI / 6);
  assert.ok(Math.abs(discRadiusPx(1000, 100_000, 60, 720) - 0.01 * focal) < 0.01);
  assert.equal(discRadiusPx(1000, 900, 60, 720), Infinity);
});

test('levels by size', () => {
  const { FULL_PX, FAR_PX } = PLANET_LOD;
  assert.equal(planetLodFor(FULL_PX * 2, 2), 0);
  assert.equal(planetLodFor((FULL_PX + FAR_PX) / 2, 0), 1);
  assert.equal(planetLodFor(FAR_PX / 3, 0), 2);
});

test('hysteresis: no flicker on the line, clean switches past it', () => {
  const { FULL_PX, HYST } = PLANET_LOD;
  let lod: PlanetLod = 0;
  // Wobbling just under the full line keeps full detail…
  for (let i = 0; i < 20; i++) lod = planetLodFor(FULL_PX * (1 - HYST * 0.5) + (i % 2) * 4, lod);
  assert.equal(lod, 0);
  // …until it is clearly smaller.
  lod = planetLodFor(FULL_PX * (1 - HYST) - 1, lod);
  assert.equal(lod, 1);
  // Growing back switches at the line itself.
  assert.equal(planetLodFor(FULL_PX - 1, 1), 1);
  assert.equal(planetLodFor(FULL_PX, 1), 0);
});

test('flying in from far away walks every level', () => {
  let lod: PlanetLod = 2;
  const seen = new Set<PlanetLod>([lod]);
  for (let d = 5e6; d > 60_000; d *= 0.97) {
    lod = planetLodFor(discRadiusPx(40_000, d, 58, 720), lod);
    seen.add(lod);
  }
  assert.equal(lod, 0);
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
