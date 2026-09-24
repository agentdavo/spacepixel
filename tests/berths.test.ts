import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Big-hull berths against the real station models (docking for every hull
 * size): for every station kind, a Bulwark (56 m) and a Resolute (177 m)
 * lie at each clamp gantry and a Valiant (380 m) at the mooring pylon
 * without touching the station's collision proxies (arms stowed or
 * deployed), and the approach corridor out along the docking axis is clear
 * for the whole hull. Loads the blueprints through Vite's SSR loader (they
 * use the `@/` alias), like tests/shipyard.test.ts.
 */
let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

test('clamp gantries and mooring pylons: hulls fit, corridors clear', { timeout: 240_000 }, async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { stationBlueprint } = await server.ssrLoadModule('/src/assets/blueprints/stations.ts');
  const { stationBerths, hullHalfExtents } = await server.ssrLoadModule('/src/world/berths/sites.ts');
  const { proxiesFromModel } = await server.ssrLoadModule('/src/sim/CollisionProxies.ts');
  const { placeProxy, signedDistance } = await server.ssrLoadModule('/src/sim/Collision.ts');
  const { approachProfile } = await server.ssrLoadModule('/src/world/berths/classes.ts');

  const hulls = {
    bulwark: buildShip(BLUEPRINTS['gs12-bulwark']),
    resolute: buildShip(BLUEPRINTS['cr5-resolute']),
    valiant: buildShip(BLUEPRINTS['ffl3-valiant']),
  };
  const n = new Vector3();
  const pt = new Vector3();
  const O = new Vector3();
  const I = new Quaternion();

  for (const kind of ['refinery', 'salvage', 'bastion', 'freeport', 'orbital'] as const) {
    for (const seed of [11, 523]) {
      const model = buildShip(stationBlueprint(kind, 'concord', seed));
      const berths = stationBerths(kind);
      assert.equal(berths.filter((b: { cls: string }) => b.cls === 'clamp').length, 2, `${kind}: two clamp gantries`);
      assert.equal(berths.filter((b: { cls: string }) => b.cls === 'mooring').length, 1, `${kind}: one mooring pylon`);
      for (const armOut of [0, 1]) {
        for (const b of berths) if (b.channel) model.setChannel(b.channel, armOut);
        model.root.updateMatrixWorld(true);
        const proxies = proxiesFromModel(model);
        for (const px of proxies) placeProxy(px, O, I);
        /** Minimum signed distance from `p` to any station proxy. */
        const clearance = (p: Vector3) => {
          let best = Infinity;
          for (const px of proxies) best = Math.min(best, signedDistance(px.world, p, n, pt));
          return best;
        };
        for (const b of berths) {
          const ships = b.cls === 'clamp' ? [hulls.bulwark, hulls.resolute] : [hulls.valiant];
          for (const ship of ships) {
            const half = hullHalfExtents(ship);
            const L = ship.length;
            const centre = b.tip.clone().addScaledVector(b.side, b.gap + half.x);
            // The hull's box, in the station frame: lateral axis along `side`, up along `up`, length along Z.
            const across = b.side;
            const up = b.up;
            const tag = `${kind}#${seed} ${b.cls}${b.index} ${ship.blueprint.id} arms ${armOut ? 'out' : 'stowed'}`;
            // Berthed: sample the hull box (the pad itself stands `gap` off the flank).
            for (const fz of [-1, -0.5, 0, 0.5, 1])
              for (const fx of [-0.85, 0, 0.85])
                for (const fy of [-0.85, 0, 0.85]) {
                  const p = centre.clone().addScaledVector(across, fx * half.x).addScaledVector(up, fy * half.y).add(new Vector3(0, 0, fz * half.z));
                  const c = clearance(p);
                  assert.ok(c > -0.5, `${tag}: hull point ${fx},${fy},${fz} inside the station by ${(-c).toFixed(1)} m`);
                }
            // The corridor out along +Z (stowed arms: the way in and out), the hull's width either side.
            if (!armOut) {
              const prof = approachProfile(b.cls, L);
              for (let z = half.z; z <= prof.autoRange; z += 60)
                for (const fx of [-1, 1])
                  for (const fy of [-1, 1]) {
                    const p = centre.clone().addScaledVector(across, fx * half.x * 1.1).addScaledVector(up, fy * half.y).add(new Vector3(0, 0, z));
                    assert.ok(clearance(p) > 0, `${tag}: corridor blocked ${z.toFixed(0)} m out`);
                  }
            }
          }
        }
      }
    }
  }
});
