import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

/**
 * The Kessen frames (src/kessen): the shared 42-bone rig, the variant data,
 * the clips, and — through Vite's SSR loader so the `@/` alias resolves —
 * that every variant builds, stays planted on the ground through every clip
 * and stands at its Stature's height.
 */

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

async function load() {
  server ??= await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const THREE = await server.ssrLoadModule('three');
  const rig = await server.ssrLoadModule('/src/kessen/rig.ts');
  const data = await server.ssrLoadModule('/src/kessen/data.ts');
  const clips = await server.ssrLoadModule('/src/kessen/clips.ts');
  const kit = await server.ssrLoadModule('/src/kessen/FrameKit.ts');
  return { THREE, rig, data, clips, kit };
}

test('rig: 42 unique bones, every parent declared before its children', { timeout: 120_000 }, async () => {
  const { rig } = await load();
  const tree = rig.BONE_TREE as readonly (readonly [string, string | null])[];
  assert.equal(tree.length, 42);
  const seen = new Set<string>();
  for (const [name, parent] of tree) {
    assert.ok(!seen.has(name), `duplicate bone ${name}`);
    if (parent === null) assert.equal(name, 'root');
    else assert.ok(seen.has(parent), `${name}: parent ${parent} not declared first`);
    seen.add(name);
  }
});

test('data: five Statures, every variant armed with known kit', { timeout: 120_000 }, async () => {
  const { data, kit } = await load();
  const statures = new Set(data.VARIANTS.map((v: { stature: number }) => v.stature));
  assert.deepEqual([...statures].sort(), [1, 2, 3, 4, 5]);
  const heights = data.STATURES.map((s: { height: number }) => s.height);
  assert.ok(heights.every((h: number, i: number) => i === 0 || h > heights[i - 1]), 'heights rise with Stature');
  assert.ok(heights[4] <= 12, 'Gantry stays under ~three storeys + a crane');
  for (const v of data.VARIANTS) {
    assert.ok(v.weapons.length > 0, `${v.id} has kit`);
    for (const w of v.weapons) assert.ok(kit.WEAPONS[w.kind], `${v.id}: weapon ${w.kind}`);
  }
});

test('clips: every clip is finite and deterministic for every stance', { timeout: 120_000 }, async () => {
  const { clips, rig } = await load();
  const stances = ['ready', 'aim', 'dual', 'heavy', 'guard', 'cast', 'drive', 'lance'];
  for (const clip of clips.CLIPS) {
    for (const stance of stances) {
      for (const t of [0, 0.37, 1.9, 7.25]) {
        const a = clips.sampleClip(clip, t, { stance, stature: 3 }, clips.createPoseBuffer());
        const b = clips.sampleClip(clip, t, { stance, stature: 3 }, clips.createPoseBuffer());
        assert.deepEqual(a, b, `${clip}/${stance}@${t} deterministic`);
        for (const n of rig.BONE_NAMES) for (const x of a.rot[n]) assert.ok(Number.isFinite(x) && Math.abs(x) < Math.PI, `${clip}/${stance} ${n}`);
        assert.ok(Number.isFinite(a.hipsDrop) && Number.isFinite(a.lift));
      }
    }
  }
});

test('every variant builds, stands its height and keeps its feet on the ground', { timeout: 240_000 }, async () => {
  const { THREE, data, kit } = await load();
  // Weapons may reach below the feet (a grounded rifle, the Knell's lance butt), so probe the legs.
  const legLow = (f: { bones: Record<string, { children: { isMesh?: boolean }[] }> }) => {
    let lo = Infinity;
    for (const n of ['foot_L', 'foot_R', 'toe_L', 'toe_R', 'shin_L', 'shin_R']) {
      const mesh = f.bones[n].children.find((c) => c.isMesh);
      if (mesh) lo = Math.min(lo, new THREE.Box3().setFromObject(mesh).min.y);
    }
    return lo;
  };
  for (const v of data.VARIANTS) {
    const f = new kit.KessenFrame(v);
    assert.ok(f.meshes.length >= 30, `${v.id}: ${f.meshes.length} meshes`);
    assert.ok(f.triangles < 20_000, `${v.id}: ${f.triangles} triangles`);
    const h = data.statureOf(v).height;

    f.play('standDown', 0);
    f.update(0);
    const low = legLow(f);
    assert.ok(Math.abs(low) < 0.02 * h, `${v.id} standDown grounded (lowest leg point ${low.toFixed(3)})`);
    // Weapons and cranes stick out, so check the body: the head sits near the top of the Stature.
    const head = new THREE.Vector3().setFromMatrixPosition(f.bones.head.matrixWorld);
    assert.ok(head.y > 0.8 * h && head.y < 1.0 * h, `${v.id}: head at ${head.y.toFixed(2)} m of ${h} m`);

    for (const clip of ['idle', 'walk', 'run', 'fire', 'melee', 'kneel']) {
      f.play(clip, 0);
      for (let i = 0; i < 12; i++) {
        f.update(0.11);
        const lo = legLow(f);
        const tol = clip === 'run' ? 0.08 * h : 0.03 * h;
        assert.ok(lo > -tol && lo < (clip === 'run' ? 0.1 * h : tol), `${v.id} ${clip}: lowest leg point ${lo.toFixed(3)} m`);
      }
    }

    f.play('boost', 0);
    f.update(0.5);
    assert.ok(legLow(f) > 0, `${v.id} boost leaves the ground`);
  }
});
