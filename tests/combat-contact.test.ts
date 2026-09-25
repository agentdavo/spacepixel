import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('every hull intercepts short shell crossings and respects collapsed facings after rotation', async () => {
  const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { Group, Vector3, Euler } = await server.ssrLoadModule('three');
    const { Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts');
    const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
    const { raycastShip, createRayHit } = await server.ssrLoadModule('/src/sim/Combat.ts');
    const { FACING_AXIS, facingOf, syncShield, resetDamage, applyHit } = await server.ssrLoadModule('/src/sim/Damage.ts');
    const { GUNS, MISSILES, CAPITAL_LANCE_GUN } = await server.ssrLoadModule('/src/sim/Loadouts.ts');
    const profiles: any[] = [...Object.values(GUNS), ...Object.values(MISSILES), CAPITAL_LANCE_GUN];
    const fleet = new Fleet(new Group());
    for (const bp of Object.values(BLUEPRINTS) as any[]) {
      const ship = fleet.spawn(bp.id, bp.faction, new Vector3(2400000, 12000, -1100000), new Vector3(0, 0, 1));
      const { dmg: st, shell, stats } = ship.combat;
      assert.equal(st.facings.length, stats.facings, bp.id);
      for (const profile of profiles) for (const charge of [1, 0.05, 0]) for (let f = 0; f < st.facings.length; f++) {
        resetDamage(st, ship); st.facings.fill(st.facingMax * charge); syncShield(st, ship);
        const local = new Vector3(st.cx, st.cy, st.cz).add(new Vector3(...FACING_AXIS[f]).multiply(shell));
        const r = applyHit(st, ship, { amount: profile.beam ? profile.beam.dps / 60 : profile.damage, type: profile.type, local });
        assert.equal(r.facing, f, `${bp.id}/${profile.id}: facing`);
        assert.equal(r.shielded, charge > 0, `${bp.id}/${profile.id}: layer`);
        assert.ok(r.hullDamage + r.shieldDamage > 0 && Number.isFinite(ship.hull + ship.shield));
        if (!charge) assert.ok(r.hullDamage > 0);
      }
      for (const rotation of [new Euler(), new Euler(0.4, 1.2, -0.7)]) {
        ship.flight.orientation.setFromEuler(rotation);
        for (const axis of FACING_AXIS.slice(0, st.facings.length)) for (const pad of [0, 2.5]) {
          resetDamage(st, ship);
          const scale = shell.clone().addScalar(pad);
          const edge = new Vector3(...axis).multiply(scale);
          const center = new Vector3(st.cx, st.cy, st.cz);
          const local = center.clone().add(edge);
          const f = facingOf(st, local);
          const a = center.clone().addScaledVector(edge, 1.01).applyQuaternion(ship.flight.orientation).add(ship.flight.position);
          const d = edge.clone().multiplyScalar(-0.02).applyQuaternion(ship.flight.orientation);
          const hit = createRayHit();
          assert.ok(raycastShip(ship, a, d, pad, hit), `${bp.id}: shell crossing ${axis}`);
          assert.ok(hit.onShield, bp.id);
          assert.ok(Math.abs(hit.t - 0.5) < 1e-6, `${bp.id}: exact entry`);
          assert.equal(facingOf(st, hit.local), f);
          assert.ok(Math.abs(hit.normal.length() - 1) < 1e-6);
          st.facings[f] = 0; syncShield(st, ship);
          const downHit = raycastShip(ship, a, d, pad, hit);
          assert.ok(!downHit || !hit.onShield, `${bp.id}: down facing must not intercept`);
          // A shot beginning just inside must not invent a new entry at t=0.
          resetDamage(st, ship);
          const inner = a.clone().add(d);
          const insideHit = raycastShip(ship, inner, d.clone().multiplyScalar(0.1), pad, hit);
          assert.ok(!insideHit || !hit.onShield, `${bp.id}: inside start`);
        }
      }
    }
  } finally { await server.close(); }
});
