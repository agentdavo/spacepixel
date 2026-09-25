# Vanguard rendering, ship design and combat review

25 September 2026 · reviewed source `4ef419b` · **Package A implementation authorised by “go”; remaining packages pending**

Vanguard already has a distinctive cel-shaded renderer and a substantial combat simulation. Preserve its ink, painted space, faction silhouettes and deliberate mechanical animation. The immediate priority is to make visible geometry, ship specifications and combat outcomes agree. Then make the existing depth readable before adding more mechanics or hulls.

This is the baseline review, recorded before implementation. It does not supersede GAME-DIRECTION, the original twenty technical milestones, the campaign, or the cameo-only Kessen scope. David subsequently authorised Package A. See [implementation and acceptance record](PACKAGE-A-ACCEPTANCE.md) and the [six-hull atlas](reviews/package-a/index.html) for the resulting changes and outstanding sign-offs.

## Evidence and limits

- Inspected the renderer, cel materials, ink/post stack, particles, frame timing, ship builder and all 28 registered blueprints; traced catalogue/fit/spawn, weapons, shields, subsystem routing, hull collision, destruction and repair.
- Ran `npm test`: **308 passed, zero failed**. Ran `npm run build`: passed. Ran `npm run balance`: **all checks passed**.
- Built and spawned all 28 hulls through Vite SSR, applied catalogue stock fits where available, and inspected their actual combat state. Results: [ship audit JSON](reviews/2026-09-25-ship-audit.json). This exposed failures that the existing pure catalogue tests do not cover.
- Captured two fresh 1280×720 staged scenes using installed Edge, native WebGPU, at this revision: [capital damage](screenshots/render-review-2026-09-25/capital.png), [structural breakup](screenshots/render-review-2026-09-25/structural.png), [capture metadata](screenshots/render-review-2026-09-25/evidence.json). Both reported WebGPU and zero JavaScript page errors. These are frame-stepped stills, not a performance or motion-quality certification.
- Also inspected existing progression, capital and destroyed-mount screenshots. Historical images support art critique, not claims about the exact current revision.
- No fresh full campaign playthrough, listening review, hardware frame-time sweep or determinism soak was performed. The tests and scripted balance runs do not establish human combat readability or final balance.

## What is already implemented

| Area | Current implementation | Assessment |
|---|---|---|
| Rendering | Three.js WebGPURenderer, reversed depth, TSL cel materials; raw WGSL ink with a TSL WebGL2 twin | Keep this architecture. It fits the intended art direction. |
| Cel style | Banded diffuse, hard glints, directional rim, vertex paint and ink regions, emissive bloom, haze, grain and FXAA | Strong identity. Needs controlled line/detail hierarchy and combat-distance validation. |
| Scale and simulation | Camera-relative rendering, fixed 60 Hz simulation, seeded RNG/replay infrastructure | Keep gameplay deterministic on the CPU. Compute particles already handle presentation. |
| Geometry | Procedural parts merged into one static hull mesh plus meshes for joints; physical traverse/elevation turret rigs | Efficient within an individual hull; part semantics and fleet LOD need development. |
| Fleet | 28 registered designs; 21 catalogue entries, 14 marked purchasable, 18 marked flyable | Counts are different domains, not missing assets by themselves. |
| Weapons | 14 gun specs, three missile families: micro swarm, heavy torpedo, harpoon; capital lances/batteries; fitted turrets and point defence | A substantial arsenal exists. Prioritize role clarity, firing geometry and counterplay. |
| Shields | Directional pools, automatic/manual reinforcement, delayed transfer with loss, collapse cooldown, low-charge bleed, explosive neighbour splash, generator/emitter loss | Deep enough to support tactical fights once collision and feedback agree. |
| Damage | Four fighter zones; ten subsystem kinds; three capital sections; damage decals/scorch, damaged mount visuals and smoke | More than a hull health bar, but authored component destruction is incomplete. |
| Capital deaths | Hull depletion, structural break, reactor crisis/detonation, bridge strike; different wreck/salvage outcomes | Preserve and teach these paths. Extend their presentation and consequences. |

Primary implementation: `src/render/`, `src/assets/ShipBuilder.ts`, `src/sim/{Combat,Damage,Subsystems,Structure,Destruction,Weapons,Missiles,Capitals}.ts`, `src/game/outfitting/`, and `src/world/destruction/`.

## Findings to fix or explicitly resolve

**F1 · High · Catalogue combat class is resolved too early — reproduced.**

`Combat.isCapitalModel` checks the legacy `SHIP_STATS` table or model radius greater than 200 m. `createCombat` derives catalogue stats afterwards and clamps non-capital facings to two. A stock refit updates stats and capacity but does not rebuild the damage class, facing count or structural model.

| Hull | Fitted stats specify | Actual spawned/fitted state | Missing capital behavior |
|---|---:|---|---|
| Resolute | 4 facings | 2 facings, turret subsystems only | Sections, engines, bridge, core, generator and emitters |
| Tallow | 4 facings | 2 facings, no subsystems | All capital systems and sections |
| Longhaul | 4 facings | 2 facings, hangar/turret only | Core ship systems and sections |
| Umbra | 4 facings | 2 facings, hangar only | Core ship systems and sections |

Valiant currently becomes capital-grade because its built radius is approximately **200.10 m**. A small geometry edit could change its combat behavior. Combat capabilities should be explicit and resolved independently of visual bounds; flight handling can remain separately tuned. Preserve Resolute's accepted 4500 base hull and Mk II stock fit.

Sources: `src/sim/Combat.ts:113`, `:150`, `:165`; `src/game/shipyard/combatStats.ts:4`; `src/game/outfitting/apply.ts:36`. Existing `tests/combat-catalog.test.ts` checks data conversion, not actual spawned state.

**F2 · High · Capital shield intersections can be rejected before the shield is tested — reproduced.**

`raycastShip` rejects segments against the model's hull bounding sphere before checking its larger fitted shield ellipsoid. A segment can cross a live shield outside that sphere and return no contact. A subsequent segment already inside the ellipsoid skips the shield-entry test. **Implementation follow-up corrected the original interpretation:** `Damage.applyHit` still routes a later hull contact through the facing pool. This reproduces missed/delayed shell contact, not an established direct-to-hull damage bypass.

The audit crossed the fore shield with a one-metre segment on all ten currently capital-class hulls; all ten returned false. Example: Cathedral's fore shell is at local z ≈1792.77 m while the rejection sphere radius is ≈1560.79 m. This is a geometric reproduction; the incidence for each live weapon needs a follow-up swept-trajectory regression.

Use a conservative bound encompassing the offset shield shell, hull and targetable components. Verify sustained multi-tick trajectories, inside/outside starts, facing seams, beams, missiles and moving ships.

Source: `src/sim/Combat.ts:581`, `:594`; numeric evidence in the audit JSON.

**F3 · Medium · Small-ship shield visuals and collision deliberately use different shapes.**

Small ships collide with a sphere and draw a fitted ellipsoid; impacts are projected onto the drawn skin. The Kestrel audit measured a simulation radius of 5.13 m versus a drawn fore extent of 10.48 m and port extent of 9.81 m. This makes grazing contact visually ambiguous. Decide an intentional aim-assistance margin, then derive both geometry and feedback from the same base shell. Keep the margin measurable and consistent.

Sources: `src/sim/Combat.ts:557`; `src/world/ShieldGeometry.ts:7`; `src/sim/Fleet.ts:161` onward.

**F4 · Medium · Damaged geometry is richer than damaged collision.**

Capital occupancy is cached per blueprint in the rest pose, at 72 cells along its longest axis. For the 2990 m Cathedral that is roughly 41.5 m per cell. Target spheres improve small subsystem hits, but blown-off geometry and turret articulation do not update this static grid. There is no general per-ship mutable breach/part collision model in this path. The exact visible mismatch requires targeted live tests; the limitation is established in code.

Use an immutable main-hull proxy plus authored moving/removable part proxies. Reserve finer local collision for selected critical areas. Avoid rebuilding an entire voxel hull every frame.

Sources: `src/sim/HullGrid.ts:24`, `:32`; `src/world/destruction/MountWrecks.ts`; `src/sim/Combat.ts:616`.

**F5 · Medium · A blown-off turret is eligible for automatic restoration.**

`repairSubsystems` restores a destroyed turret after its delay without checking `wreck === 'blown'`. The rule currently treats a disabled mount and a detached gun house alike. Make those separate damage states: disabled equipment can recover in flight; detached equipment needs replacement at a yard. This is a design consistency change with balance consequences, not just an effects fix.

Source: `src/sim/Subsystems.ts:258` and `:270`.

**F6 · Medium · Standard performance tooling cannot currently establish a native-GPU budget.**

`scripts/perf.mjs` explicitly selects SwiftShader. Its software-adapter disclaimer is correct, but running that command does not establish shipping GPU performance. `Perf` resolves render timestamps; compute timing should also be accounted for separately and validated against total frame behavior. Dynamic resolution reduces the scene pass while ink/grade/FXAA remain at output resolution, so it cannot solve every bottleneck.

Add native/software modes, actual adapter/backend metadata, CPU/render/compute/frame percentiles, dropped simulation time, draw counts and resolution scale. Make unavailable timing explicit. Compare native data on a named integrated GPU and a named discrete GPU before accepting budgets.

Sources: `scripts/perf.mjs:42`; `src/core/Perf.ts:101`; `src/core/DynamicResolution.ts`; `src/render/post/InkPipeline.ts:243`.

**F7 · Medium · Resource and fallback acceptance need explicit coverage.**

Refitting removes old generated pods without disposing their geometry in that path; repeated rendered refits need a resource-lifetime test and ownership-safe cleanup. No application recovery flow was found for device loss. WebGL2 retains the ink path but disables compute particles, so appearance and useful combat feedback must be accepted separately on that backend.

Sources: `src/game/outfitting/apply.ts:81`, `:136`; `src/fx/Particles.ts:418`; `src/render/RendererFactory.ts`. Three.js exposes `onDeviceLost`; WebGPU defines device loss and resource invalidation. Use these supported mechanisms for an application-level recovery flow. [Three.js Renderer documentation](https://threejs.org/docs/pages/Renderer.html), [WebGPU specification](https://www.w3.org/TR/webgpu/#dom-gpudevice-lost).

## Fleet design assessment

The current designs span approximately 15–2990 m. The progression line already communicates increasing mass. Directorate stepped hulls, blue/white plating and practical mounts contrast well with Choir spires, ribs and pink energy. Preserve Rustwake's asymmetric salvage language. The fresh capital image shows strong silhouettes and readable ink; bloom, smoke cards and luminous strips sometimes compete with the damaged area. The breakup image demonstrates separation, but the dark wreck against a detailed sky makes the exact failure plane harder to read.

The blueprint schema has seven classes, while the catalogue has seventeen roles. Some are intentional abstractions: Arbiter is a blueprint frigate/catalogue destroyer; Bulwark is a blueprint bomber/catalogue gunship; civilian ships borrow military classes. Harrier's blueprint, catalogue and combat table use different role labels. Define one player-facing class/role vocabulary and separate it from capability flags and AI/flight profiles.

| Design group | Existing hulls | Recommended identity to prove in play |
|---|---|---|
| Light combat craft | Kestrel, Super Kestrel, Harrier, Cantor, Seraph, Scrapjack, Gaff | Recognizable attack profile and silhouette at pursuit distance; distinct speed, burst and survivability tradeoffs. Resolve Harrier's intended role. |
| Heavy/strike craft | Gauntlet, Warhorse, Psalter, Knuckleduster | Escort versus attack-run specialization; visible payload and vulnerable engine/wing equipment. |
| Gunships | Bulwark, Bulldog | Turret coverage and sustained pressure, with readable blind spots and reduced agility. |
| Corvettes | Lantern Guard, Vesper, Resolute | Escort, point defence, facing management and limited capital subsystems. |
| Frigates/destroyer | Valiant, Canticle, Arbiter | Different engagement ranges and weapon arcs; manoeuvring should matter to main-battery effectiveness. |
| Carriers | Hesperus Dawn, Mother Lode | Hangar availability, screening and replacement craft as their primary combat value. |
| Dreadnoughts | Indomitable, Cathedral | Layered attack objectives: strip a facing, disable defences, exploit a chosen kill path. |
| Civilian/industrial | Swallow, Tallow, Longhaul, Umbra, Meridian Star | Cargo, tank, mining and passenger spaces should explain the silhouette and escort/disable/salvage stakes. |

For each class, create a sheet showing silhouette at 32/64/128 pixels, four viewing angles, size reference, weapons coverage, propulsion, shield hardware and damage states. These pixel sizes are proposed review targets. Judge faction and role recognition without name labels. Do not add hulls simply to fill every noun in the class list.

## What can be destroyed today, and what should follow

| Area | Current behavior | Proposed improvement |
|---|---|---|
| Fighter nose | Zone damage increases gun spread and lock time | Authored avionics/nose state and visible damage that matches the penalty. |
| Fighter port/starboard wings | Zone damage creates roll drift; wing-piece presentation exists on death | Optional surviving wing/pod loss, with deterministic handling change and capped debris. |
| Fighter engines | Reduced thrust/speed, boost loss and smoke | Per-engine damage and nozzle state on twin-engine craft; clear thrust asymmetry cues. |
| Turrets | Individually targeted on eligible hulls; stop firing, droop or blow off | Separate disabled/detached states; part collision, honest repair and equipment-specific wrecks. |
| Launchers and lances | Targetable subsystems on eligible hulls; functionality can be disabled | Clear launch-cell damage, barrel failure and firing-state feedback. |
| Hangars | Disable launches; destruction causes secondary damage | Authored bay damage and door state; show lost sortie capacity and prevent impossible launch/berth behavior. |
| Capital engines | Individually destroyed; reduced speed; all lost means drift | Detachable nacelle/nozzle where appropriate; show which remaining engines provide power. |
| Shield generator | Its destruction removes all shield facings | Make the generator recognizable and explain exposure before an attack. |
| Shield emitters | Each emitter controls a facing | Distinct hardware and HUD map; an emitter loss must visually match the permanent opening. |
| Sensors | Reduced sensors/fire-control capability | Distinct mast/array geometry, damaged state and readable combat consequence. |
| Bridge | Reduced coordination; badly hurt non-player ship can strike | Clearly communicate surrender/disablement, mission credit and salvage rights. Player bridge loss follows its existing exception unless redesigned explicitly. |
| Reactor | Brownout, critical fuse, crew venting; continued attack can cause detonation and shockwave | Telegraph crisis/vent progress, identify the core-access location, retain a readable escape window. |
| Bow/midships/stern | Section integrity; failure triggers capital death/breakup | Authored break seams and internal bulkheads. Surviving section loss is a later extension, not current behavior. |
| Armour plating | Scars and hull multipliers; no general removable armour layer | Pilot a few authored plates protecting specific systems before considering broader armour simulation. |
| Radiators, cargo pods, fuel tanks, utility pods | No general independent damage model for these areas | Candidate new modules: heat penalty, recoverable cargo, fuel hazard, lost equipment. Each requires an explicit gameplay purpose. |

Not every ship carries every system. Small fighter mounts below the current 25 m model-radius threshold do not receive the larger craft's mount subsystem model.

Current breakup selects whole triangles by their centroid relative to a ragged cut; it does not construct sealed interior cross-sections. Add authored ribs, dark bulkheads, conduits and torn plating to a small set of planned seams. Persistent wrecks currently have a 900-second lifetime, a 16-piece cap and system-local lifetime; salvaged resources are not equivalent to fully persistent physical wrecks or a boarding system.

Sources: `src/sim/Damage.ts:824`, `:874`; `src/sim/Structure.ts`; `src/world/destruction/HullSplit.ts:51`, `:114`; `src/sim/Destruction.ts:77`; `src/game/salvage.ts`.

## Proposed milestones for sign-off

Effort is relative scope, not a calendar commitment: **S** bounded work, **M** several connected systems, **L** substantial implementation and validation, **XL** new gameplay architecture. All twelve are pending. Acceptance numbers below are proposals to approve, not measured achievements.

| ID | Priority / scope | Deliverable | Acceptance gate | Dependencies |
|---|---|---|---|---|
| **M01** | P1 · M | **Combat geometry and class correctness.** Resolve capabilities after authoritative stats; fix capital shield rejection; reconcile small-ship shells; audit all hulls after stock/refit. | All 28 spawned hulls match explicit facing/damage policies. Regression trajectories prove no unintended live-shield bypass. Preserve accepted Resolute stats. Existing tests, balance and determinism pass. | First |
| **M02** | P1 · M | **Native WebGPU budgets and reliability.** Native perf mode, render/compute accounting, refit disposal, device-loss UX, WebGL2 fallback contract. | Named adapter/browser reports; proposed 1080p/60 target on agreed reference hardware, frame p95 ≤16.7 ms after warmup; report CPU/GPU separately. Twenty rendered refits and ten scene cycles show no continuing resource growth after warmup. Unsupported recovery gives a usable restart flow. | Can begin alongside M01 |
| **M03** | P2 · M | **Cel-shading readability pass.** Outer/inner line hierarchy, distance detail suppression, damage contrast, emissive/bloom discipline, optional reduced grain/boil/flash. | Moving 720p/1080p clips on dark and bright skies; identify shield hit, hull hit, disabled mount and core crisis at gameplay distance. Check 0.6/0.8/1 render scales. No unapproved loss of OVA character. | M02 baseline |
| **M04** | P2 · M | **Ship class and faction design bible.** Author silhouette/role sheets and capability vocabulary; improve selected hull geometry where role is unclear. | Sign off six representative hull sheets first: Kestrel, Warhorse, Resolute, Valiant, Cathedral, Longhaul. Show equal-screen-size and true-scale comparisons, arcs and weak points. Resolve class/role naming. | M01 informs capabilities |
| **M05** | P2 · L | **Authored subsystem atlas.** Stable part IDs, attachment points and visible geometry for systems; link collision, targeting, HUD and effects to those IDs. | On the six pilot hulls, every selected system corresponds to visible hardware, hit geometry and a demonstrated gameplay consequence. No destroyed system continues its function. | M01, M04 |
| **M06** | P2 · M | **Shield tactics and feedback.** Facing diagram, reinforcement/transfer/cooldown explanation, generator versus emitter feedback, clearer faction treatments. | A player can deliberately strip one facing and use the opening. Show all supported facing layouts; direct fire, splash, bleed, regen and emitter loss agree across sim, shell and HUD. | M01, M03, M05 |
| **M07** | P2 · L | **Modular damage and convincing breakup.** Intact/damaged/disabled/detached states; authored fracture seams and interiors; mutable part proxies; honest field repair. | Pilot a lost gun house, nacelle and armour plate; missing parts neither fire nor block their former volume. A detached turret cannot regrow in flight. All four death paths remain distinct and deterministic within debris budgets. | M02, M05 |
| **M08** | P3 · XL, optional | **Armour, power and heat prototype.** Local protective plates, runtime energy allocation, heat-limited bursts and useful radiators. Existing armour is mainly a hull multiplier; fit power is a loadout budget. | One fighter and one capital prototype demonstrate a worthwhile choice in a short fight. New controls, AI response, save/replay state and balance must pass before fleet rollout. Stop at prototype if complexity outweighs tactical value. | M05–M07; separate feature approval |
| **M09** | P2 · L | **Weapon identity and counterplay.** Audit muzzle/barrel/trajectory agreement for fixed, articulated, fitted and beam weapons. Give every family a purpose; expose PD saturation and missile defenses. | Validate real gameplay guns as well as cinema. Seeded engagement matrix by size/fit; readable firing/cooldown/lock cues. Reconfirm the already-fixed PD launch-phase cases. Prototype ECM/decoys only if approved. | M01, M03; M05 for module links |
| **M10** | P2 · L | **Class-specific battle behavior.** Bomber attack runs, escort screens, corvette coverage, capital orientation, carrier sortie pressure and disabled-ship retreat. | Three repeatable encounters: fighter dogfight, convoy defence, capital assault. AI responds to facing/system loss; weapon arcs and manoeuvring create useful choices. Frame and determinism budgets hold. | M06, M09 |
| **M11** | P3 · M/L | **Aftermath and recovery.** Clear distinction between disabled, surrendered, salvageable and destroyed; wreck limits, mission attribution and repair consequences. | Demonstrate the four death paths through mission completion, salvage and a dock repair/save/reload cycle. State exactly which damage/wreck facts persist; protect existing saves. Boarding/capture mechanics require another proposal. | M07, M10 |
| **M12** | Release gate · M | **Accepted combat slice and fleet regression.** Bind the improvements into the existing first-session/campaign acceptance effort. | Successful normal-control EP01 completion; launch → fight → disable a system → survive → dock/refit → save/reload. Native WebGPU and fallback review, motion/audio readability, balance/determinism, no blocking findings. Expand fleet/campaign checks after pilot approval. | Approved milestones only |

### Recommended approval packages

- **Package A — correctness and visual direction:** M01–M04. Recommended immediate approval. Establish trustworthy combat, measurable GPU behavior and agreed art/class standards.
- **Package B — make the ship systems tangible:** M05–M07, M09–M10. Approve after reviewing Package A's six hull sheets and baseline measurements. This delivers the largest visible and tactical improvement.
- **Package C — consequences and acceptance:** M11–M12. Plan now; complete against the approved feature scope and the existing first-session direction.
- **Separate optional decision:** M08. Runtime heat/energy and local armour could add depth, but carry the greatest control, balance, AI and persistence cost. Do not make them prerequisites for fixing current problems.

Defer new faction fleets, playable Kessen, shield-bypass boarding, arbitrary volumetric destruction, fleet-wide GPU physics and multiplayer expansion. None is needed to achieve these milestones. Ship LOD, batching and damage detail should follow measured bottlenecks; the largest audited hull is about 14k triangles but has 37 hull/joint meshes before effects, so triangle count alone is not the performance story.

## Sign-off record

| Decision | Proposed selection | Status |
|---|---|---|
| Begin implementation | Package A: M01–M04 | Authorised by “go”; acceptance recorded separately |
| Preserve current cel-shaded OVA identity | Yes; refine readability and semantic detail | Awaiting David |
| Six-hull design/damage pilot | Kestrel, Warhorse, Resolute, Valiant, Cathedral, Longhaul | Awaiting David |
| Component loss policy | Field-repair disabled equipment; yard-replace detached equipment | Awaiting David |
| Runtime armour/power/heat | Optional prototype only, after core systems | Awaiting David |
| Wider fleet expansion | After pilot and performance acceptance | Awaiting David |

The implementation phase should start with M01's reproduced failures, retain this evidence as its before-state, and update milestone acceptance with actual gameplay captures and measurements.
