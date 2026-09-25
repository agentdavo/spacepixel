# Package A — implementation and acceptance record

> Historical record for `02b2817`, preserved for provenance. Its full source bundle was not integrated. Current reconciliation excludes its default bloom/ink changes and extra fitted point-defence cadence tuning; see [the reconciliation record](RENDER-RECONCILIATION.md). The captures and performance numbers below are historical, not certification of the current canonical build. Art and performance acceptance remain open.

25 September 2026 · baseline `4ef419b` · isolated branch `codex/render-ships-m01-m04`

David's “go” authorised the recommended M01–M04 package. This record separates implemented work, automated evidence and outstanding design/performance acceptance. The original technical milestones retain their own numbering; M01–M12 here belong to the rendering/ship review.

## Review links

- [Six-hull sign-off atlas](reviews/package-a/index.html): Kestrel, Warhorse, Resolute, Valiant, Cathedral and Longhaul; four fixed views, 32/64/128 px silhouettes, proportional scale comparison, current system volumes and authored turret limits.
- [Moving combat comparisons](reviews/package-a/motion.html): native WebGPU and WebGL2; 720p/1080p; render scales 0.6, 0.8 and 1.0; authored dark sky and synthetic bright contrast backgrounds.
- [Full baseline review and M01–M12 roadmap](RENDER-SHIP-REVIEW-2026-09-25.md).
- [Resource/recovery and hull measurements](reviews/package-a/evidence.json), [motion metadata](reviews/package-a/motion-evidence.json).

## Milestone status

| Milestone | Delivered | Acceptance still required |
|---|---|---|
| M01 — combat correctness | Authoritative stats determine facing count and capital damage capabilities before construction. All 28 stock-fitted designs covered. Shared drawn/contact ellipsoid for all shields, conservative contact bounds, swept missile contact. Fitted armour scales subsystem HP while preserving damage fractions. | Human balance review of the newly active bridge/core/structure vulnerabilities on Resolute, Tallow, Longhaul and Umbra. Scripted balance and replay gates pass. |
| M02 — budgets/reliability | Native/software profiling modes; actual backend/adapter; render/compute/CPU/frame timing, sample counts, errors and dropped simulation frames. Disposable refit pods. Device-loss restart and compatibility restart. Resource/recovery probes and fallback captures. | **1080p/60 is not accepted:** the measured integrated GPU misses the proposed budget. Agree reference hardware and run a discrete-GPU baseline before setting shipping tiers. This is a measurement and reliability delivery, not a claim that optimisation is finished. |
| M03 — cel readability | Strong silhouettes retained, distant crease/region detail softened, region ink reduced, bloom 0.55 → 0.45. Persistent reduced-effects option, Shift+F9, or `calm=1`: no animated ink/grain, reduced post flash and CRT flicker. Both backend paths exercised in moving comparisons. | David's visual sign-off: silhouette readability, shield versus hull impact, disabled mounts/core crisis and OVA character. Two-second staged clips do not replace a gameplay readability session. Reduced effects is a presentation option, not a photosensitivity certification. |
| M04 — class/design bible | Six measured stock-fit sheets; class/role/capability vocabulary; faction rules and per-hull geometry proposals. Current system locations and turret traverse/elevation are explicit. | Approve the six silhouettes and role/geometry proposals before remodelling. No wholesale hull remodel or new faction fleet has been slipped into this package. |

## Combat changes and balance

The original shield finding was a missed/delayed **contact**, not proven shield damage bypass. A later hull contact still passed through `Damage.applyHit` and the facing pool. The corrected implementation puts projectile contact on the drawn shell; the review now states the distinction.

Regressions cover all 28 stock-fitted hulls; radius changes around the former 200 m threshold; all six principal shell directions after rotation and large universe translation; an exhausted facing versus a live opposite facing; inside-shell starts; actual multi-tick gunfire on Cathedral, Resolute and Kestrel; and repeated damaged-subsystem refits.

Resolute remains **4500 base hull** with its accepted Mk II stock armour, resulting in **5175 fitted hull**. Moving it from erroneous fighter shielding to four-facing capital systems materially changed survival and missile contact timing. Two explicit adjustments keep the unchanged balance suite within its existing bands:

- Compact catalogue capital hulls (100–399 m nominal catalogue length) redistribute shields at 0.9%/s base capacity, instead of accidentally inheriting the fighter rate of 12%/s. Larger catalogue hulls retain 0.3%/s. Fitted shield equipment can modify these rates.
- Fitted point defence has a maximum base burst pause of 1.2 s, matching the existing capital point-defence convention. Weapon damage, PD range and balance thresholds were not increased to mask the contact fix.
- Fitted hull protection also scales subsystem pools, preserving each pool's current damage fraction and destroyed state. Reapplying the same fit does not compound capacity.

Legacy flight handling remains separately tuned by its existing rules. Small-ship unshielded hull collision remains a gameplay sphere. Mutable part collision, detached-turret repair and per-part armour/power are later milestones.

## Native performance evidence

Installed Edge **153.0.4234.48**, adapter **Intel / xe-lpg**, native WebGPU, DPR 1, scene render scale 1, dynamic resolution disabled, staged capital combat. Each run reached at least 240 frames with a 60-frame CPU/frame warmup. GPU queries are sampled asynchronously; counts are included. These are short headless local measurements, not exclusive-hardware certification.

| Output | CPU p95 | Render GPU p95 | Compute GPU p95 | Sampled GPU total p95 | Frame interval p95 | Result |
|---|---:|---:|---:|---:|---:|---|
| 1920×1080 | 5.40 ms | 26.25 ms | 0.03 ms | 26.28 ms | 50.00 ms | Fail proposed budgets |
| 1280×720 | 7.10 ms | 17.41 ms | 0.03 ms | 17.45 ms | 33.40 ms | Fail proposed budgets |

Proposed gates: CPU ≤4 ms; sampled GPU ≤8 ms; frame interval p95 ≤16.7 ms. Neither run logged a JavaScript page error or dropped simulation frames. Missing timestamp data is now reported as unavailable and cannot silently pass a native GPU gate. Queue timing is an upper bound and is not accepted as a timestamp measurement.

Raw reports: [1080p](reviews/m02-native-1080.json), [720p](reviews/m02-native-720.json).

The resolution sensitivity and small sampled compute time make render/post-processing the first optimisation investigation. This is an inference from these runs, not attribution to one pass. Recommended next experiment: instrument per-pass cost; compare ink, bloom and FXAA at fixed simulation state; then tune post-pass resolution and scene/material batching. Do not remove OVA effects without comparison captures.

## Resource and recovery coverage

Removable pods previously lost their geometry without releasing it. Geometry disposal alone still left Three's per-object uniform bindings growing. Pods now have their own material instances and dispose both geometry and material, keeping shared ramp textures alive.

The harness warms the path, then records **20 rendered refits** and **10 complete showcase → ship-review scene cycles**. It compares geometry, attribute, texture, render-target, uniform-buffer, program and pipeline counts after warmup; the final evidence reports both stability booleans true. This is an explicit bounded resource test, not proof of a leak-free multi-hour campaign.

Recovery testing deliberately destroys the real GPU device and injects Three's loss callback (Three suppresses callbacks for intentional destruction). The alert appears; “Restart Vanguard” creates a fresh native renderer; a persisted storage sentinel survives; “Restart with compatibility graphics” successfully boots WebGL2. This tests the application's recovery boundary and persistence, not an uncontrolled OS/driver reset or a mid-mission save/resume.

The combat fallback check exposed a pre-existing raw WGSL hex function inside shield surface rendering. It is now a shared portable TSL formula, so WebGL2 no longer feeds WGSL to its GLSL parser. Compatibility mode still intentionally disables the compute-particle system: some smoke, sparks and other particle detail are absent. Weapon/shield geometry, ink, HUD and the CPU simulation remain available. This is a reduced-effects fallback, not full visual parity.

## Ship design vocabulary

Use three separate terms consistently:

1. **Class**: recognisable hull architecture and scale — interceptor, strike fighter, bomber, gunship, corvette, frigate, carrier, dreadnought, freighter and other civilian architectures.
2. **Role**: job in an encounter — superiority, strike, escort, siege, screening, raiding, cargo, mining. Harrier's “strike-fighter” architecture and “strike” catalogue role are compatible; an AI role name must not silently redefine the class.
3. **Capabilities**: explicit simulation behavior — facing layout, structural sections, installed systems, weapon arcs, hangar and cargo functions. “Capital damage model” includes compact corvettes and eligible civilian hulls.

This package documents the mapping; a later schema migration can replace legacy labels without changing save IDs or AI assumptions.

Faction rules:

- **Concord**: practical symmetry, faceted navy hulls, clear bow/deck/bridge hierarchy, visible serviceable machinery and disciplined accent markings.
- **Choir**: spires, ribs, ceremonial rhythm and negative space; luminous surfaces should support weapon/system identity rather than obscure battle damage.
- **Rustwake**: asymmetry, repairs and salvaged assemblies, with a stable recognisable main silhouette. Surface noise must not replace structural design.
- **Civilian**: cargo/industrial volume first; bridge, engines and defensive mounts second. Cargo is not yet an arbitrary destructible component system.

## Validation and reproduction

- `npm test`: **314 passed**, zero failed.
- `npm run build`: passed.
- `npm run balance`: all scenarios passed with original thresholds.
- `npm run determinism`: dogfight, capital and traffic, **10 simulated minutes each**; repeated seed and recorded input replay match all **600 one-second checkpoints** per scenario; changed seeds differ.
- `node scripts/render-review.mjs`: stock-hull plates, rendered refits, scene cycles and injected recovery/fallback.
- `node scripts/ship-atlas.mjs`: rebuild atlas from measured data and captures.
- `node scripts/render-motion-review.mjs`: all **12 clips** completed, **zero JavaScript or shader console errors**; 24 fps, 48 frames per clip; requires ffmpeg.
- `node scripts/perf.mjs --scene combat --query stage=capital --frames 240 --size 1920x1080 --out docs/reviews/m02-native-1080.json`: expected to fail if budgets remain exceeded.

## Sign-off requested

- Approve or amend the six hull identities, silhouettes and proposed geometry direction in the atlas.
- Approve the revised ink/bloom balance and reduced-effects control after reviewing both backend motion comparisons.
- Select the reference performance tier: maintain 1080p/60 on this integrated GPU as an optimisation target, or nominate the intended minimum and recommended hardware. The current build does **not** meet the first option.
- M05–M07 and M09–M10 remain proposals for a subsequent package. Heat/power/armour expansion (M08) remains deferred.
