import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('all four trailer capitals fire along the displayed articulated barrels, with a real fire gate', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { Vector3, Quaternion, Object3D } = await server.ssrLoadModule('three');
    const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
    const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
    const { CinemaGunnery } = await server.ssrLoadModule('/src/cinema/gunnery.ts');
    const { rigFromInfo, barrelDir } = await server.ssrLoadModule('/src/sim/TurretRig.ts');
    let checked = 0;
    for (const id of ['bb-indomitable', 'choir-cathedral', 'ffl3-valiant', 'choir-canticle']) {
      const model = buildShip(BLUEPRINTS[id]);
      const position = new Vector3(4000, -200, 600);
      const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
      model.root.position.copy(position);
      model.root.quaternion.copy(orientation);
      const ship = { model, flight: { position, orientation }, combat: { dmg: { subsystems: [] as { id: string; destroyed: boolean }[] } } };
      const guns = new CinemaGunnery();
      for (const [socket, info] of model.turrets) {
        const rig = rigFromInfo(info);
        const target = barrelDir(rig, 0.35, 0.2, new Vector3()).multiplyScalar(3000).add(rig.base).applyQuaternion(orientation).add(position);
        guns.traverse(ship, [socket], target, 0);
        const before = model.articulations.get(info.yaw).angle;
        assert.equal(guns.ready(ship, [socket], target).length, 0, `${id}/${socket}: cannot fire while training`);
        guns.traverse(ship, [socket], target, 1);
        assert.ok(Math.abs(before - model.articulations.get(info.yaw).angle) > 0.1, 'visible joint moved');
        assert.deepEqual(guns.ready(ship, [socket], target), [socket]);
        const pitch = model.articulations.get(info.pitch);
        for (const tip of info.tips) {
          const probe = new Object3D();
          probe.position.copy(tip).sub(info.pivot);
          pitch.node.add(probe);
          model.root.updateMatrixWorld(true);
          const actual = probe.getWorldPosition(new Vector3());
          const emitted = guns.muzzle(ship, socket, new Vector3());
          assert.ok(actual.distanceTo(emitted) < 1e-5, `${id}/${socket}: projectile origin differs from visible barrel`);
          probe.position.add(info.fwd);
          model.root.updateMatrixWorld(true);
          const axis = probe.getWorldPosition(new Vector3()).sub(actual).normalize();
          assert.ok(axis.dot(guns.direction(ship, socket, new Vector3())) > 0.999999, `${id}/${socket}: projectile bends away from barrel`);
          pitch.node.remove(probe);
          checked++;
        }
        ship.combat.dmg.subsystems = [{ id: socket, destroyed: true }];
        assert.equal(guns.ready(ship, [socket], target).length, 0, 'destroyed mount stays quiet');
        ship.combat.dmg.subsystems = [];
        const below = info.base.clone().addScaledVector(info.up, -3000).applyQuaternion(orientation).add(position);
        assert.equal(guns.ready(ship, [socket], below).length, 0, 'out-of-arc target stays quiet');
      }
    }
    assert.ok(checked > 50, `checked ${checked} barrel tips`);
    console.log(`Verified ${checked} actual model barrel tips and axes across four capital hulls`);
  } finally { await server.close(); }
});
