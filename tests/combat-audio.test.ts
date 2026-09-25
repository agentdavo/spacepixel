import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('combat audio preserves impact truth and selects audible simultaneous contacts', async () => {
  const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { GameAudio } = await server.ssrLoadModule('/src/audio/index.ts');
    const eye = { x: 0, y: 0, z: 0 }, near = { x: 5, y: 0, z: -5 }, far = { x: 0, y: 0, z: -1e7 };
    const player = { isPlayer: true, faction: 'concord', radius: 9 }, remote = { isPlayer: false, faction: 'choir', radius: 90 };
    const make = () => {
      const audio = new GameAudio({ unlockTarget: null });
      const calls: { name: string; args: any[] }[] = [];
      for (const name of ['impact', 'warhead', 'weapon', 'playRaw', 'playAtRaw']) audio.sfx[name] = (...args: any[]) => calls.push({ name, args });
      return { audio, calls };
    };
    for (const [intercepted, shielded, hullDamage, expected] of [[true,false,0,[]],[false,true,0,[true]],[false,true,4,[true,false]],[false,false,9,[false]]] as const) {
      const { audio, calls } = make();
      audio.missileEvents([{ kind: 'detonate', position: near, target: player, shooter: remote, intercepted, shielded, hullDamage, spec: {id:'torpedo',damage:180} }], eye, 1);
      assert.deepEqual(calls.filter(c => c.name === 'impact').map(c => c.args[0]), expected);
      assert.equal(calls.find(c => c.name === 'warhead')?.args[2], intercepted);
      audio.dispose();
    }
    {
      const { audio, calls } = make();
      audio.missileEvents([far, near, { ...near, x: 10 }, { ...near, x: 15 }].map(position => ({ kind: 'detonate', position, target: remote, shooter: player })), eye, 1);
      assert.equal(calls.filter(c => c.name === 'warhead').length, 3);
      assert.ok(calls.every(c => c.args[3] !== far));
      audio.dispose();
    }
    {
      const { audio, calls } = make();
      audio.weaponEvents([{kind:'beam-hit',position:far,ship:remote,shooter:remote}, {kind:'beam-hit',position:near,ship:player,shooter:remote,shielded:true,hullDamage:0}],eye,1);
      assert.equal(calls.length,1);
      assert.equal(calls[0].name,'impact');
      assert.equal(calls[0].args[4],true,'player feedback is cockpit anchored');
      audio.dispose();
    }
    {
      const { audio, calls } = make();
      audio.weaponEvents([{kind:'shield',position:far,ship:player,shooter:remote,hullDamage:5,type:'harmonic'}],eye,1);
      assert.deepEqual(calls.map(c=>[c.args[0],c.args[4]]),[[true,true],[false,true]],'camera distance cannot silence shield/hull feedback');
      audio.dispose();
    }
  } finally { await server.close(); }
});
