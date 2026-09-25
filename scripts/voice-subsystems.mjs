/** Enumerate actual combat labels, including mirrored/repeated mounts and emitters. */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

export async function runtimeSubsystemNames() {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
    const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
    const { createCombat } = await server.ssrLoadModule('/src/sim/Combat.ts');
    const names = new Set();
    for (const bp of Object.values(BLUEPRINTS)) {
      const model = buildShip(bp);
      const combat = createCombat(bp.id, model, bp.faction);
      for (const { label } of combat.dmg.subsystems) {
        // FlightRadio.update's subsystem event spelling, including case.
        names.add(label.charAt(0) + label.slice(1).toLowerCase());
      }
      model.root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
      });
    }
    if (!names.size) throw new Error('No runtime subsystem labels found');
    return [...names].sort();
  } finally { await server.close(); }
}
