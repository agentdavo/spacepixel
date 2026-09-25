import { Group, Vector3 } from 'three';
import { faceAlong, type ShipEntity } from '@/sim/Fleet';
import { LanternGate } from '@/world/LanternGate';
import { Wreckage } from '@/world/setpieces/Wreckage';
import type { SetPieceFrame } from '@/world/setpieces/types';

/** Disclosed V3 lore staging, not a literal EP01 mission capture.
 * Native gate/wreckage assets; player placement happens only before tick zero.
 * The existing gate's event surface is dark; its small pylon lamps are retained.
 */
export function stageLoreFlight(root: Group, player: ShipEntity, wingmen: ShipEntity[], mode: 'gate' | 'wreckage') {
  const origin = player.flight.position.clone().add(new Vector3(50000, 25000, -40000));
  const group = new Group();
  group.name = 'v3-staged-anchorage-lore';
  root.add(group);
  const gate = new LanternGate(6000);
  gate.setGlow(0);
  gate.group.position.copy(origin);
  group.add(gate.group);
  const wreck = new Wreckage('v3-timetable-graveyard', origin.clone().add(new Vector3(-4200, -700, -4500)), {
    radius: 4500, count: 600, hulks: 5, hulk: 'ffc-lantern-guard',
  });
  group.add(wreck.group);
  const position = origin.clone().add(mode === 'gate' ? new Vector3(1500, 300, -19000) : new Vector3(-3400, -400, -7200));
  const look = origin.clone().add(mode === 'gate' ? new Vector3(1300, -900, 0) : new Vector3(-3200, -500, -1500));
  const direction = look.sub(position).normalize();
  const speed = mode === 'gate' ? 110 : 75;
  const place = (ship: ShipEntity, p: Vector3) => {
    ship.flight.position.copy(p);
    faceAlong(ship.flight.orientation, direction);
    ship.flight.velocity.copy(direction).multiplyScalar(speed);
    ship.flight.throttle = speed / ship.flight.spec.maxSpeed;
    ship.model.root.position.copy(p);
    ship.model.root.quaternion.copy(ship.flight.orientation);
  };
  place(player, position);
  wingmen.forEach((w, i) => place(w, position.clone().add(new Vector3(i ? 85 : -85, -25, -130 - 40 * i))));
  return {
    provenance: { mode, origin: origin.toArray(), gateRadius: 6000, gateEventGlow: 0, gatePylonLamps: 'native retained', wreckage: { position: wreck.position.toArray(), radius: 4500, count: 600, hulks: 5, blueprint: 'ffc-lantern-guard' }, player: { position: position.toArray(), direction: direction.toArray(), speed } },
    update: (frame: SetPieceFrame) => wreck.update(frame),
    dispose: () => { wreck.dispose(); group.removeFromParent(); gate.group.traverse(o => { const mesh = o as import('three').Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose(); }); },
  };
}
