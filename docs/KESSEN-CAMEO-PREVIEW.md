# Kessen environmental cameo preview

This is an isolated **default-off preview**, initially based on integration commit `cafc28b`. The chief accepted the revised service-module design and local lighting for gated integration after rejecting the first floating platform treatment. Release enablement remains a chief decision, pending final motion evidence and integration's navigation checks; passing the noninterference checks alone does not constitute release acceptance.

## What appears

- **Episode 10:** Plumb (7.2 m) and Bellows (9 m) guard a rescue module beside the Graveyard lane, released only by the existing `bastion-destroyed` flag. Its lane-relative offset is **(-160, -14, 100) m**, on the opposite shoulder from the angled Bastion-to-lane lifeboat route. The earlier (65, -14, 100) preview offset was corrected after the clearance audit.
- **Episode 19:** Plumb and Anvil (11.5 m) stand witness on a maintenance module beside the existing Meridian tuning point. It is 65 m laterally and 100 m behind the beacon, with its deck 14 m below the beacon origin. The first jump's `leg2` flag removes the frames and their module, before the later tuning sites and climax.

Each module has split work decks around an open docking throat, clamp jaws, an underside keel, diagonal supports, drive pods, utility housings, industrial markings and practical work lamps. The frames retain their original size and existing time-derived idle poses. A small baked work-light contribution changes only these instances' vertex surface data. The shared frame material and scene lighting remain untouched.

The cameo has no Fleet actor, collision radius, weapon emission, damage, objective credit, dialogue, rewards, world facts, faction/economy types or save fields. Its registry gate requires `kessenCameos=1`; omitted or `0` allocates no cameo meshes. Episode 20 is unchanged.

## Reproduce and inspect

Run the independent capture harness from the repository root:

```powershell
node scripts/kessen-cameo-check.mjs --out docs/screenshots/kessen --port 5251 --approach
```

It starts its own Vite server and native Microsoft Edge with D3D11. It requires a WebGPU backend and an actual renderer GPUDevice with a queue, failing rather than accepting a fallback. The device's adapter description is unavailable on this host; no specific GPU model is claimed. No existing capture script or package script was changed.

Exact enabled development URLs (while that server is running):

- [Episode 10](http://127.0.0.1:5251/?scene=flight&episode=10&kessenCameos=1&shot=1&record=60&demo=0&hud=1&quality=high&dynres=0)
- [Episode 19](http://127.0.0.1:5251/?scene=flight&episode=19&kessenCameos=1&shot=1&record=60&demo=0&hud=1&quality=high&dynres=0)

Set `kessenCameos=0` for the matching baseline. These URLs boot the episode; the script performs the documented staging. `record=60` is frame-stepped, so an interactive manual visit should omit `shot` and `record`.

| Evidence | Episode 10 | Episode 19 |
|---|---|---|
| Normal chase camera, cameo enabled | [Player view](screenshots/kessen/ep10-on-player.png) | [Player view](screenshots/kessen/ep19-on-player.png) |
| Same view, cameo disabled | [Baseline](screenshots/kessen/ep10-off-player.png) | [Baseline](screenshots/kessen/ep19-off-player.png) |
| Close model/support inspection | [Inspection](screenshots/kessen/ep10-inspection.png) | [Inspection](screenshots/kessen/ep19-inspection.png) |
| Eight-second ordinary-flight approach | [75 m/s approach](screenshots/kessen/ep10-approach.mp4) | [75 m/s approach](screenshots/kessen/ep19-approach.mp4) |
| Beginning / midpoint / final frame, left to right | [Motion samples](screenshots/kessen/ep10-approach-samples.png) | [Motion samples](screenshots/kessen/ep19-approach-samples.png) |

Player images retain the normal chase camera and complete fighter. Inspection images shorten the chase offset and hide foreground fighter meshes to reveal frame/support contact; they are not player-view evidence. Approach clips start from one staged position, then advance eight seconds through the actual FlightModel at 75 m/s with unchanged chase tuning and visible fighter. There are no camera, visibility, dialogue or objective overrides during the clips. The MP4s are silent visual-review captures, not audio validation.

## Timing and validation limits

Episode 10 staging first places the player within the existing CAP objective's range, then executes 100 seconds of normal fixed simulation ticks through `FlightScene.simStep`, the path used by replay seeking. It skips intermediate renders, not simulation ticks. The existing 72-second attack cue starts the Bastion sequence; the Bastion itself emits its destruction flag. The harness does not call `debugSeek`, inject flags, grant kills or complete objectives. It records a one-second progression trace and asserts the cameo remains absent before destruction and appears afterward, with the player alive throughout. Only then is the ship repositioned to inspect or approach the lane.

The bomber-intercept objective may still be pending in that legitimate aftermath: the timed Bastion loss does not require five player kills. These are reproducible staged mission checks, not a claim of a manual end-to-end battle playthrough. The older early-patrol `debugSeek` screenshots have been replaced.

The five focused tests cover mission timing boundaries, equal runner snapshots/chatter/kills/success with cameo specs removed, a single release across repeated updates, default-off allocation, real frame heights, absolute-time posing, idempotent first-jump disposal without disposing the shared frame material, and physical route clearance. The clearance check flies both actual lifeboat models with the production `flyToPoint` / FlightModel escort logic for 300 seconds, including arrival turns; the minimum conservative model-sphere-to-module-sphere gap is **108.4 m**. Native captures compare enabled/off gameplay hashes, runner snapshots and world facts. [Machine-readable evidence](screenshots/kessen/evidence.json) includes source commit, URLs, backend/device checks, progression, camera positions, flags and renderer memory accounting.

Validation before the navigation-base rebase: all **305 tests pass** on the module revision, then all **five focused tests** and typecheck pass on the clearance correction. `npm run build` passes typecheck and the production Vite build. The existing front-end flow check also passes all title/prologue/episode handoff checks; that separate smoke test used its existing WebGL2 fallback on this host, so it is not counted as native visual evidence. Native visual evidence comes from the Edge capture harness above.

Frame timings from a screenshot-stepped process under concurrent development load are not a performance benchmark. Renderer memory accounting measures the incremental resource footprint only; it does not establish a frame-time budget or support extrapolation to crowds. Full manual mission playthrough and chief visual acceptance remain outside the evidence supplied here.

## Integration handoff

The active scope is recorded in [KESSEN-INTEGRATION-PLAN.md](KESSEN-INTEGRATION-PLAN.md); its original broader faction/boarding/Train proposal is explicitly archived. Source checkpoints before rebasing onto the navigation fix are `3a73ff4` (scope correction), `58c1797` (gated preview and tests), `2cbb81d` (purposeful modules and local contrast), and `ddf9e22` (lifeboat route clearance).

Integration owns ROADMAP/SESSIONS; chief owns GAME-DIRECTION. None is edited here. The integration task's subsequent EP01 objective `navTag` work is acknowledged as a separate shared-file hunk to preserve. This branch has not been pushed, merged or made into a PR.
