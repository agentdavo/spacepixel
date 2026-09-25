import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('two simulation ticks retain ordered events, turret sound and death cause across pool reuse', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { EventTap, blankWeaponEvent } = await server.ssrLoadModule('/src/world/EventTap.ts');
    const tap = new EventTap();
    const pooled = blankWeaponEvent();
    Object.assign(pooled, { kind: 'fire', turret: true, cause: null });
    pooled.position.set(1, 2, 3);
    tap.capture([pooled], []);
    Object.assign(pooled, { kind: 'kill', turret: false, cause: 'structural' });
    pooled.position.x = 9;
    tap.capture([pooled], []);
    assert.deepEqual(tap.weapons.map(e => [e.kind, e.position.x, e.turret, e.cause]), [['fire', 1, true, null], ['kill', 9, false, 'structural']]);
    tap.clear();
    Object.assign(pooled, { kind: 'hit', turret: undefined, cause: undefined });
    tap.capture([pooled], []);
    assert.equal(tap.weapons[0].turret, undefined);
    assert.equal(tap.weapons[0].cause, undefined);
  } finally { await server.close(); }
});
