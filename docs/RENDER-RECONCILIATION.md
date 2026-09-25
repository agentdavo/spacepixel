# Renderer and refit reconciliation

Base: canonical `c9429e0`. Working branch: `codex/package-a-reconciliation`.
This takes bounded unique fixes from historical Package A `02b2817`; it does not merge that ancestry or certify the earlier art/performance proposals.

## Included

- Shared portable TSL hex lookup for shield surfaces and particles. Both shader consumers switch from the raw WGSL helper.
- Adapter reporting reads Three's actual device/adapter; profiling records render/compute samples, timing failures and warmup-filtered frame intervals. Compute sampling checks the current frame rather than reusing warmup activity. Missing/nonfinite timing is not a valid GPU sample. Native performance gates require timestamps and a verified native adapter; software/stepped/fallback results are explicitly informational.
- Renderer loss stops the loop and scene systems and presents native/compatibility restart actions using existing saved state.
- Removed refit pods dispose owned geometry/material instances while preserving shared textures. Fitted armour scales subsystem pools through upgrades/downgrades without healing damage or reviving destroyed systems.
- Optional reduced-effects setting and Shift+F9/`calm=1`: removes animated grain/ink and reduces post flashes/CRT flicker. Default is off; existing audio configuration and visual defaults are preserved.
- Independent stock-hull review scene and capture/resource/recovery tooling. Atlas inspection still uses the existing hangar model sheet. Tool output now defaults to `docs/reviews/render-reconciliation`, preserving the historical Package A captures.

## Explicit exclusions

- No Package A combat contact/classification rewrite, broad-phase rename or missile fuze replacement. Canonical reviewed combat and moving-missile relative sweep remain intact.
- No additional compact-capital shield transfer change; canonical already contains the reviewed adjustment.
- No fitted point-defence burst-pause cap of 1.2 seconds. Canonical cadence and damage/range/balance thresholds remain intact.
- No default bloom reduction from 0.55 to 0.45; no distant crease/region suppression or region-ink multiplier change. Those require visual sign-off.
- No new asset designs, campaign changes, collision-physics changes, automatic repairs, or art/performance acceptance.

## Evidence and limits

Historical `docs/reviews/package-a`, native M02 reports, original ship audit and screenshots are preserved from `02b2817`. They were captured on a different branch with the excluded style and PD adjustments; use them as provenance, not current-tree acceptance. Historical Intel xe-lpg sampled GPU p95 was 26.28 ms at 1080p and 17.45 ms at 720p; the proposed 8 ms GPU / 16.7 ms frame gates failed. No discrete-GPU certification exists.

Current validation:

- **350 tests passed, zero failed**, run serially to limit host memory. [Full output](reviews/render-reconciliation/tests.txt). Seven new tests cover armour scaling through upgrades/downgrades, damage/destruction preservation, pod ownership/disposal, timestamp warmup/failure/nonfinite handling and reduced-effects/audio persistence.
- Production build passed TypeScript plus both content validators (twenty campaign episodes and expansion references).
- One native Edge browser on **Intel / xe-lpg** captured all six review hulls. Twenty rendered refits and ten complete scene cycles retained stable geometry, attribute, texture, render-target, uniform-buffer, pipeline and program counts. [Measurements](reviews/render-reconciliation/evidence.json).
- Two injected device-loss callbacks exercised native restart and WebGL2 compatibility restart. The storage sentinel survived. The harness recorded the two expected Three device-loss console messages and no JavaScript page errors. [Run output](reviews/render-reconciliation/native.txt).
- Live shield rendering completed on both native WebGPU and WebGL2 with no shader console errors; inspected screenshots show the hex surface on both. This is shader functionality evidence, not visual parity or art sign-off. [WebGPU](reviews/render-reconciliation/shield-webgpu.png), [WebGL2](reviews/render-reconciliation/shield-webgl.png).
- Harness browser and Vite server closed normally; GPU slot explicitly released to chief and collision owner. No native performance-budget run was performed in this reconciliation.
- `git diff --check` passed. Canonical combat/contact/missile/PD/audio source files remain unchanged.

Native checks must use one browser at a time and coordinate with cinematic/collision work. Forced device destruction with an injected loss callback tests the application restart boundary; it is not an uncontrolled driver-loss or unsaved mission recovery test. Short resource probes do not prove a multi-hour session leak-free. Native art, fleet performance, ordinary-input contact journeys and U08 acceptance remain open.

## Preserved local artifacts

Before switching from `codex/universe-expansion` at `8b084f2`, the worktree was tracked-clean. That branch remains available and chief has archived its ref. Five ignored scratchpad text reports and four Package A `.log` files remain in place. Generated `dist/` has been refreshed by the reconciliation build; it is reproducible output, not immutable evidence. `node_modules` is a junction to the canonical checkout's dependency directory; it must not be recursively followed during worktree cleanup. Historical log copies and scratch reports must be archived or compared before removal.
