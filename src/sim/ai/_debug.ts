import { Group, Vector3 } from 'three';
import { Fleet } from '../Fleet';
import { DebugGuns } from './DebugGuns';
import { issueOrder, setFormation } from './Squadron';
import { brainOf, PERSONALITIES, setPersonality } from './state';
import { updateAI } from './index';
export function run(mode = 'kestrel') {
  const O = new Vector3(2_400_000, 150_000, -1_100_000);
  const tally = { concord: 0, choir: 0 };
  for (let seed = 1; seed <= 8; seed++) {
    const fleet = new Fleet(new Group());
    const guns = new DebugGuns();
    const jit = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 120;
    const mk = (fac: 'concord' | 'choir', z: number, dir: number) => {
      const bp = mode === 'kestrel' ? 'vf27-kestrel' : fac === 'concord' ? 'vf27-kestrel' : 'choir-cantor';
      const ships = [[0,0],[-40,-32],[40,-32],[80,-64]].map(([x, dz], i) => fleet.spawn(bp, fac, O.clone().add(new Vector3(x * dir + jit(i + (fac === 'choir' ? 5 : 0)) * 0.1, fac === 'choir' ? 150 : 0, z + dz * dir)), new Vector3(0, 0, dir)));
      for (const s of ships) setPersonality(s, PERSONALITIES.veteran);
      setFormation(ships.slice(1), 'fingerFour', 40); issueOrder(ships.slice(1), 'formUp', ships[0]);
      return ships;
    };
    const A = mk('concord', 0, 1); const B = mk('choir', 4200, -1);
    let engaged = false;
    for (let i = 0; i < 120 * 60; i++) {
      const t = i / 60;
      if (!engaged && A[0].flight.position.distanceTo(B[0].flight.position) < 2600) { engaged = true; issueOrder(A.slice(1), 'breakAndAttack', A[0]); issueOrder(B.slice(1), 'breakAndAttack', B[0]); }
      updateAI(fleet, 1 / 60, t); fleet.step(1 / 60); guns.step(fleet, 1 / 60);
    }
    const a = A.filter(s => s.alive).length, b = B.filter(s => s.alive).length;
    tally.concord += a; tally.choir += b;
    console.log('seed', seed, 'concord', a, 'choir', b, 'hits', guns.hits, 'shots', guns.shots, (guns.hits / guns.shots * 100).toFixed(0) + '%', A.concat(B).map(s => brainOf(s).maneuver[0]).join(''));
  }
  console.log(mode, tally);
}
