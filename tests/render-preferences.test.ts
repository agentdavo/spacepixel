import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('opt-in reduced effects preserve existing audio configuration and persist alongside it', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const audio = { master: .7, music: .2, effects: .9, dialogue: .8, output: 'headphones', range: 'reduced' };
  let saved = JSON.stringify({ audio, voice: 'off', subSecond: false, soundtrack: 'choir' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { saved = value; },
  } });
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { settings, setSettings } = await server.ssrLoadModule('/src/game/Settings.ts');
    assert.equal(settings.reducedEffects, false);
    assert.deepEqual(settings.audio, audio);
    for (const reducedEffects of [true, false]) {
      setSettings({ reducedEffects });
      const record = JSON.parse(saved);
      assert.equal(record.reducedEffects, reducedEffects); assert.deepEqual(record.audio, audio);
      assert.equal(record.voice, 'off'); assert.equal(record.subSecond, false); assert.equal(record.soundtrack, 'choir');
    }
  } finally {
    await server.close();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
