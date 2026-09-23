# Roadmap

Guiding rules (after Carmack): one ship flying well first; performance and
latency measured from day one with pass/fail numbers; camera-relative
rendering designed in; direct code over architecture; strict TypeScript;
lore last.

Scale rule: space is huge — lay it out in kilometres. Physics runs in
metres, but anything placed in the world (strata, belts, set pieces,
spawn rings, HUD ranges) is thought of in 1 km steps.

## Batch 1 — engine & game (first versions: all in)

| # | Milestone | Status | Where |
|---|---|---|---|
| 1 | WebGPU renderer bootstrap | ✅ | `src/render/RendererFactory.ts`, `src/core/Engine.ts` |
| 2 | Asset pipeline + cel material | ✅ | `src/assets/*`, `src/render/materials/CelMaterial.ts` |
| 3 | WGSL ink-line pass | ✅ | `src/render/post/shaders/inkEdge.wgsl.ts` |
| 4 | Flight physics, inertia, afterburner, cruise | ✅ | `src/sim/FlightModel.ts` |
| 5 | Spring chase camera, velocity zoom | ✅ | `src/sim/ChaseCamera.ts` |
| 6 | Cutaways & target-lock views | ✅ | `src/sim/CameraDirector.ts` |
| 7–9 | Fighters → carriers → dreadnoughts (11 designs, articulated) | ✅ | `src/assets/blueprints/*`, `?scene=hangar` |
| 10 | Lasers, beams, impacts, shields | ✅ | `src/sim/Weapons.ts`, `src/world/WeaponVisuals.ts` |
| 11 | Micro-missile swarms, lock HUD | ✅ | `src/sim/Missiles.ts`, `src/ui/FlightHud.ts` |
| 12 | GPU compute particles | ✅ | `src/fx/*`, `?scene=fx` |
| 13 | Wingman AI, formations, orders | ✅ | `src/sim/ai/Squadron.ts` |
| 14 | Enemy AI, maneuvers, turrets | ✅ | `src/sim/ai/*`, `npm run ai-sim` |
| 15 | Universe + star map | ✅ | `src/universe/*`, `src/ui/StarMap.ts` |
| 16 | Lantern jumps + hyperspace | ✅ | `src/world/Hyperspace.ts` |
| 17 | Tactical view + fleet command | ✅ | Tab in flight |
| 18 | Missions & objectives | ✅ | `src/game/*` |
| 19 | CRT HUD, title, briefing | ✅ | `src/ui/Screens.ts` |
| 20 | Perf: budgets, latency, dynamic resolution | ✅ (ongoing) | `src/core/Perf.ts`, `npm run perf` |

Spatial depth: space dust streaks, asteroid belts, haze lanes (`?scene=spatial`),
and a **multiplane sky** — Disney's multiplane camera rebuilt for 6DOF: 16
painted cel strata, one per kilometre (`?planes=0|16|32`,
`src/world/MultiplaneSky.ts`).

## Batch 2 — narrative (in progress)

Canon: the Shattering, fossil technology, Terran Directorate vs Zenith
Hegemony, the Ebon-gas monopoly, the Signal, the Builders and the
compression wave. See `docs/LORE.md` and `docs/CAMPAIGN.md`.

| Chapter | Milestones | Delivery |
|---|---|---|
| I · The Myth and the Machine | 1–5 | codex, briefings, patrol logs, environmental storytelling |
| II · The Spark and the Frying Pan | 6–10 | missions: border skirmish, black box, ghost ship, fall of the Bastion |
| III · Into the Deep Void | 11–15 | Dead Zone nebula, the Monolith, the Oracle broadcast, the schism, siege of the Nexus |
| IV · The Epic Resolution | 16–20 | solo pilgrimage, the Zenith revelation, the key, the symphony of gates, the open horizon |

Systems: data contract `src/game/campaign/types.ts`, runtime
`src/game/CampaignRunner.ts` (tested: `npm test`), radio chatter with
procedural anime portraits, codex, eyecatches, narrative set pieces.

## Known issues

- WebGL2 fallback lines are softer than the WGSL path.
- Large flat hulls (carrier deck) catch the rim light at grazing angles;
  a screen-space silhouette rim would fix it.
- SwiftShader timings are meaningless: run `npm run perf` on real hardware.
