import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
after(async () => { await server?.close(); });

test('Lantern Guard PD skips nearer ordnance outside the mount arc', async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const { Group, Vector3 } = await server.ssrLoadModule('three');
  const { Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts');
  const { Weapons } = await server.ssrLoadModule('/src/sim/Weapons.ts');
  const { Missiles } = await server.ssrLoadModule('/src/sim/Missiles.ts');
  const { Capitals } = await server.ssrLoadModule('/src/sim/Capitals.ts');
  const { MISSILES } = await server.ssrLoadModule('/src/sim/Loadouts.ts');
  const fleet = new Fleet(new Group(), 31);
  const weapons = new Weapons(fleet);
  const missiles = new Missiles(fleet);
  const capitals = new Capitals(fleet, weapons);
  const guard = fleet.spawn('ffc-lantern-guard', 'concord', new Vector3(), new Vector3(0, 0, 1));
  const bomber = fleet.spawn('sb9-warhorse', 'choir', new Vector3(0, 0, 5000), new Vector3(0, 0, -1), { isPlayer: true });
  guard.flight.velocity.set(0, 0, 0);
  capitals.register(guard);
  capitals.step(1 / 60);
  const gun = capitals.list[0].guns[0];
  missiles.salvo(bomber, guard, MISSILES.torpedo);
  missiles.salvo(bomber, guard, MISSILES.torpedo);
  missiles.step(1 / 60);
  const blocked = gun.mount.position.clone().addScaledVector(gun.mount.up, -100);
  const reachable = gun.mount.position.clone().addScaledVector(gun.mount.forward, 300).addScaledVector(gun.mount.up, 100);
  missiles.pos[0].copy(blocked);
  missiles.pos[1].copy(reachable);
  missiles.vel[0].set(0, 0, 0);
  missiles.vel[1].set(0, 0, 0);
  gun.scan = 0;
  gun.cooldown = 0;
  capitals.step(1 / 60);
  assert.equal(gun.aim, 'pd', 'a missile below the deck must not hide an engageable missile');
  assert.ok(gun.sol.aimPoint.distanceTo(reachable) < 1e-6);
  // Candidate enumeration order must not leave the rejected missile's aim in the solution.
  missiles.pos[0].copy(reachable);
  missiles.pos[1].copy(blocked);
  gun.scan = 0;
  capitals.step(1 / 60);
  assert.ok(gun.sol.aimPoint.distanceTo(reachable) < 1e-6);
  missiles.pos[1].copy(reachable);
  // In arc, but outrunning the gun: an impossible intercept must not mask it either.
  missiles.pos[0].copy(gun.mount.position).addScaledVector(gun.mount.forward, 100).addScaledVector(gun.mount.up, 30);
  missiles.vel[0].subVectors(missiles.pos[0], gun.mount.position).normalize().multiplyScalar(10000);
  gun.scan = 0;
  capitals.step(1 / 60);
  assert.equal(gun.aim, 'pd');
  assert.ok(gun.sol.aimPoint.distanceTo(reachable) < 1e-6);
  missiles.pos[0].copy(blocked);
  missiles.vel[0].set(0, 0, 0);
  // Once the reachable missile is intercepted, do not aim through the deck.
  missiles.shoot(reachable.x - 10, reachable.y, reachable.z, 20, 0, 0, guard.team, 1000);
  gun.scan = 0;
  capitals.step(1 / 60);
  assert.equal(gun.aim, 'none');
});
