import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Rng, hashTag, mix32 } from '../src/sim/Rng.ts';

/**
 * MP-0 lint: the simulation draws every die from a seeded world stream
 * (src/sim/Rng.ts). `Math.random` anywhere that feeds sim state breaks
 * replays, the kill-cam's history and (later) server/client agreement.
 * Visual-only randomness (particles, HUD noise, camera shake) lives outside
 * these paths.
 */
const ROOT = new URL('..', import.meta.url).pathname;

/** Everything that writes sim state: the whole of src/sim plus the sim-side world/game modules. */
const SIM_PATHS = [
  'src/sim',
  'src/world/Traffic.ts',
  'src/world/HullCollisions.ts',
  'src/world/Docking.ts',
  'src/world/WingDocking.ts',
  'src/universe/traffic.ts',
  'src/game/contracts',
  'src/game/CampaignRunner.ts',
  'src/game/CampaignSession.ts',
  'src/game/RescueBeat.ts',
  'src/game/outfitting/turrets.ts',
  'src/game/outfitting/apply.ts',
  'src/game/world',
];

function files(p: string): string[] {
  const abs = join(ROOT, p);
  if (!statSync(abs, { throwIfNoEntry: false })) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((f) => files(join(p, f)));
}

/** Source with comments removed (strings kept — a string never calls anything). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('no Math.random in the simulation (0 allowed)', () => {
  const hits: string[] = [];
  const all = SIM_PATHS.flatMap(files).filter((f) => f.endsWith('.ts'));
  assert.ok(all.length > 30, `expected to scan the sim sources, found ${all.length}`);
  for (const f of all) {
    code(readFileSync(f, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (/Math\s*\.\s*random/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, [], `Math.random in sim code:\n${hits.join('\n')}`);
});

test('src/sim imports nothing from three/webgpu (a headless shard has no renderer)', () => {
  const hits = files('src/sim')
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /from\s+['"]three\/(webgpu|tsl)['"]/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test('Rng: same seed → same stream; fork is pure and order-independent', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  const root = new Rng(99);
  const w1 = root.fork('weapons');
  root.next();
  root.next(); // consuming the parent never shifts a child
  const m = root.fork('missiles');
  const w2 = root.fork('weapons');
  assert.equal(w1.seed, w2.seed);
  assert.notEqual(w1.seed, m.seed);
  assert.equal(w1.next(), w2.next());
  assert.notEqual(root.fork(7).seed, root.fork(8).seed);
  assert.notEqual(new Rng(1).fork('x').seed, new Rng(2).fork('x').seed);
});

test('Rng: roughly uniform, in range', () => {
  const r = new Rng(42);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 100_000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    bins[Math.floor(x * 10)]++;
  }
  for (const n of bins) assert.ok(Math.abs(n - 10_000) < 500, `bin ${n}`);
  assert.equal(typeof hashTag('a'), 'number');
  assert.notEqual(mix32(1, 2), mix32(2, 1));
});
