import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

// The shield shell covers the whole hull with 5–10% to spare: no plating (engine blocks, fins, turrets) pokes through.
test('every ship\'s shield shell clears its hull by 5–10%', { timeout: 240_000 }, async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const THREE = await server.ssrLoadModule('three');
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { createCombat } = await server.ssrLoadModule('/src/sim/Combat.ts');
  const inv = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let n = 0;
  for (const bp of Object.values(BLUEPRINTS) as { id: string; faction: string }[]) {
    const model = buildShip(bp);
    const c = createCombat(bp.id, model, bp.faction);
    const st = c.dmg;
    model.root.updateMatrixWorld(true);
    inv.copy(model.root.matrixWorld).invert();
    let worst = 0;
    for (const mesh of model.meshes) {
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) continue;
      m.multiplyMatrices(inv, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m);
        const x = (p.x - st.cx) / c.shell.x;
        const y = (p.y - st.cy) / c.shell.y;
        const z = (p.z - st.cz) / c.shell.z;
        worst = Math.max(worst, x * x + y * y + z * z);
      }
    }
    const clear = 1 / Math.sqrt(worst);
    assert.ok(clear >= 1.05 && clear <= 1.1, `${bp.id}: shell clears the hull by ${((clear - 1) * 100).toFixed(1)}%`);
    n++;
  }
  assert.ok(n > 15, `checked ${n} hulls`);
});
