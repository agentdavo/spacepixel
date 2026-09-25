import { Vector3 } from 'three';
import { faceAlong, type Fleet, type ShipEntity } from '@/sim/Fleet';
import { applyFit } from '@/game/outfitting/apply';
import { stockFit } from '@/game/outfitting/fit';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';

/** Capture-only initial conditions. No timeline, damage injection or outcome script. */
export function stageV3Battle(fleet: Fleet, player: ShipEntity, escorts = 2): ShipEntity {
  for (const s of fleet.ships) if (s !== player) { s.alive = false; s.model.root.visible = false; }
  const origin = player.flight.position.clone().add(new Vector3(16000, 7000, -20000));
  const pose = (ship: ShipEntity, delta: number[], dir: number[]) => {
    ship.flight.position.copy(origin).add(new Vector3(...delta));
    faceAlong(ship.flight.orientation, new Vector3(...dir).normalize());
    ship.flight.velocity.set(0, 0, 0);
    ship.flight.throttle = 0;
    ship.model.root.position.copy(ship.flight.position);
    ship.model.root.quaternion.copy(ship.flight.orientation);
  };
  pose(player, [-1000, 60, -500], [1, -0.06, 0.5]);
  const target = fleet.spawn('choir-canticle', 'choir', origin.clone(), new Vector3(0, 0, 1), { name: 'Canticle — Evening Prayer' });
  applyFit(target, CATALOG_BY_ID['choir-canticle'], stockFit(CATALOG_BY_ID['choir-canticle']));
  pose(target, [0, 0, 0], [0, 0, 1]);
  for (let n = 0; n < escorts; n++) {
    const a = fleet.spawn('ffl3-valiant', 'concord', origin.clone(), new Vector3(1, 0, 0), { name: `Reserve escort ${n + 1}` });
    applyFit(a, CATALOG_BY_ID['ffl3-valiant'], stockFit(CATALOG_BY_ID['ffl3-valiant']));
    pose(a, [-1050, (n + 1) * -180, -150 + n * 450], [1, 0.1, 0]);
    a.target = target;
  }
  player.target = target;
  return target;
}

/** Healthy fighter encounter; only the starting formation is authored. */
export function stageV3Pursuit(player: ShipEntity, wing: ShipEntity[], enemies: ShipEntity[]): void {
  const origin = player.flight.position.clone().add(new Vector3(-8000, 500, 8000));
  const place = (s: ShipEntity, p: number[], forward: number[]) => {
    const direction = new Vector3(...forward).normalize();
    s.flight.position.copy(origin).add(new Vector3(...p));
    faceAlong(s.flight.orientation, direction);
    s.flight.velocity.copy(direction).multiplyScalar(160);
    s.flight.throttle = 0.65;
    s.model.root.position.copy(s.flight.position);
    s.model.root.quaternion.copy(s.flight.orientation);
  };
  place(player, [0, 40, -700], [0, 0, 1]);
  wing.forEach((s,i) => place(s, [i ? 70 : -70, 20, -770-i*40], [0,0,1]));
  enemies.forEach((s,i) => place(s, i ? [i === 1 ? 400 : -500, i*50, i*500] : [0,0,0], i ? [0,0,-1] : [0,0,1]));
}
