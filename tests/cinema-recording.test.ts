import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotAudioFrame } from '../src/cinema/recording.ts';

test('capture snapshots survive pooled event, camera and ship mutation', () => {
  const ship = { isPlayer: false, faction: 'choir', radius: 400, circular: null as unknown };
  ship.circular = ship;
  const event = { kind: 'subsystem' as const, position: { x: 1, y: 2, z: 3 }, ship, shooter: null, sub: { kind: 'lance' } };
  const frame = { dt: 1 / 24, eye: { x: 4, y: 5, z: 6 }, camera: { x: 0, y: 0, z: 0, w: 1 }, weaponEvents: [event], missileEvents: [], player: {} as never, combatIntensity: 1, jumpPhase: 'none' as const };
  const captured = snapshotAudioFrame(frame);
  event.position.x = 999;
  event.sub.kind = 'reactor';
  ship.radius = 1;
  frame.eye.x = 999;
  frame.camera.w = 0;
  assert.equal(captured.weaponEvents[0].position.x, 1);
  assert.equal(captured.weaponEvents[0].sub?.kind, 'lance');
  assert.equal(captured.weaponEvents[0].ship?.radius, 400);
  assert.equal(captured.eye.x, 4);
  assert.equal(captured.camera?.w, 1);
  assert.doesNotThrow(() => JSON.stringify(captured));
});
