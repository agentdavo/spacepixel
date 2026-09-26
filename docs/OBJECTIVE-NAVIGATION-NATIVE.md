# Native objective navigation and mission clearance

26 September 2026. All four bounded checks pass on source
`1de365200a0a96cfc53f3ecd068df139d091ce3b`. This is the combined navigation,
dialogue, transaction and clearance source plus the accepted impact HUD.
The later dock-evidence commit does not change these gameplay paths.

Fresh mission starts used disposable Edge contexts, native WebGPU (`GPUDevice`
and queue confirmed), seed 1994 and a 1280×720 viewport. The existing route
pilot sent ordinary mouse/keyboard inputs. The only replay command is the
episode start at tick zero. No poses, flags, kills, objective states or health
were injected. No pilot weapons were fired.

## Results

| Episode | Observed native scope | Result | Fresh tape replay |
| --- | --- | --- | --- |
| 04 | 40.233 s: approach moving Magpie, complete form-up | Marker follows Magpie, then changes to live `tankers-1` / Marsh Tanker 1 at 39.233 s. Both on-screen and edge labels observed. | 40/40 checkpoints |
| 05 | 88.1 s: station, North, Void, throat, listening dwell, combat transition | North at 4.967 s; Void at 27.233 s; throat at 52.567 s. Full authored dwell completes at 87.1 s; navigation calls and labels clear for combat with no generic gate replacement. | 88/88 checkpoints |
| 02 | 35 s: precombat barge approach, external arrival and hold | Arrival first sets at tick 1514 / 25.233 s, 99.064 m from the external point. Neutral host has zero drift/speed; route target equals host anchor + `[0,0,-1800]`. No contact involving either subject; full hull/shields retained. | 35/35 checkpoints |
| 10 | 25 s: fresh lifeboat spawn and authored hold beyond launch grace | First-tick member delta is `[240,12,-45]`. Both survive at full hull/shields, halt remains active, and no contact involves either lifeboat. | 25/25 checkpoints |

All **188 checkpoints** match when replaying these newly recorded tapes from
tick zero on the same source. Across 5,650 sampled frames / 11,300 physics
ticks, replay inputs, resolved navigation facts, dwell progress and collected
contact/clearance observations match their recordings exactly. No console
errors or replay desynchronization were reported.

The collision owner independently audited all 2,100 Episode 2 ticks and all
1,500 Episode 10 ticks from the raw JSONL. The minimum conservative rest-model
enclosing-sphere gap was **483.060 m** for the barge/Indomitable and **57.055 m**
for the lifeboats. Centres use rotated model-bounds centres; radii are half the
model-bounds diagonal, not targeting radii. These positive gaps establish
conservative rest-pose clearance for the observed intervals. They are not
general articulated-mesh or combat-route acceptance.

## Reviewable evidence

- [Compact outcomes, tape hashes and screenshot map](reviews/objective-navigation-2026-09-26/outcomes.json).
- [Episode 2 independent audit](reviews/objective-navigation-2026-09-26/ep02-native-independent-audit.json) and [Episode 10 independent audit](reviews/objective-navigation-2026-09-26/ep10-native-independent-audit.json), including raw event hashes and scope.
- [Magpie marker](reviews/objective-navigation-2026-09-26/ep04-magpie-20s.jpg) and [convoy marker after form-up](reviews/objective-navigation-2026-09-26/ep04-convoy-40s.jpg).
- [North buoy](reviews/objective-navigation-2026-09-26/ep05-north-10s.jpg), [Void buoy](reviews/objective-navigation-2026-09-26/ep05-void-30s.jpg), [listening point](reviews/objective-navigation-2026-09-26/ep05-throat-70s.jpg), and [combat with navigation cleared](reviews/objective-navigation-2026-09-26/ep05-combat-no-nav-88s.jpg).
- [Barge arrival](reviews/objective-navigation-2026-09-26/ep02-arrived-25s.jpg), [barge hold](reviews/objective-navigation-2026-09-26/ep02-hold-35s.jpg), [lifeboat episode after grace](reviews/objective-navigation-2026-09-26/ep10-after-grace-2s.jpg), and [end of the hold](reviews/objective-navigation-2026-09-26/ep10-hold-25s.jpg). These are normal player-camera views; the per-tick data establishes actor clearance.
- [Raw artifact manifest](reviews/objective-navigation-2026-09-26/raw-manifest.json) covers 147 local files, including original and diagnostic harnesses, tapes, events and all retained screenshots.

Raw data remains in:
`C:/Users/David(J)Smith/.codex/worktrees/objective-navigation/spacepixel/scratchpad/objective-navigation-native/`.
Accepted takes are `ep04-take-2`, `ep05-take-1`, `ep02-take-1`, `ep10-take-1`;
each has a corresponding `epXX-replay-1` directory. No historical trailer tape
was reused across the placement change.

## Reproduction

`scripts/objective-navigation-proof.mjs` is the exact diagnostic harness used.
It copies the existing `v3-gameplay.mjs` route pilot and simulation stepping;
added wrappers observe HUD calls and per-tick clearance facts without changing
game state. Each capture saves its own harness, original harness, source-file
hashes, provenance, replay and observations. Use a fresh output directory for
every run and serialize native GPU work.

```sh
node scripts/objective-navigation-proof.mjs --scenario route --episode ep04-black-light --route docs/reviews/objective-navigation-2026-09-26/ep04-route.json --stop-objective raid --seconds 60 --probe --port 5444 --out scratchpad/nav-proof/ep04
node scripts/objective-navigation-proof.mjs --scenario route --episode ep05-whispers-in-the-static --route docs/reviews/objective-navigation-2026-09-26/ep05-route.json --stop-objective measure --seconds 120 --probe --port 5444 --out scratchpad/nav-proof/ep05
node scripts/objective-navigation-proof.mjs --scenario route --episode ep02-fossil-fire --route docs/reviews/objective-navigation-2026-09-26/ep02-route.json --seconds 35 --probe --contact-audit --port 5444 --out scratchpad/nav-proof/ep02
node scripts/objective-navigation-proof.mjs --scenario route --episode ep10-the-fall-of-the-bastion --inputs docs/reviews/objective-navigation-2026-09-26/ep10-inputs.json --seconds 25 --probe --contact-audit --port 5444 --out scratchpad/nav-proof/ep10
node scripts/audit-objective-navigation.mjs scratchpad/nav-proof/ep04
```

For each newly recorded tape, use `--replay <take.vgr> --replay-from-start`,
`--seconds` equal to its recorded `ticks / 60`, and a fresh output directory.
Retain `--contact-audit` for the clearance tapes. Require every recorded
checkpoint to match, `desyncAt === -1`, and the final tick to equal the tape's
tick count. The independent collision audit script is preserved alongside its
reports and accepts `<capture-directory> <output-json>`.

## Limits and retained incomplete evidence

The first Episode 4 take stopped at 35 s before the ordinary pilot caught the
moving convoy. Its marker worked, but form-up remained active. That take is
retained as **incomplete**, not counted as transition acceptance. A longer
fresh take reached the transition; no state was forced to do so.

Probe mode runs simulation at 60 Hz and HUD observations at 30 Hz, rendering
the 3D scene once per simulated second. Screenshots at transitions show the
current HUD over the most recently rendered world frame. This is functional
route/HUD evidence, not real-time performance or a smooth 30 fps movie. Selected
navigation screenshots use settled labels because the first transition frame
includes their normal fade-in. Voice was disabled; this is not a listening test.

Episodes 4 and 5 stop at combat. Dead-member replacement, failure/retry, Episode
5 return and mission victory remain covered by CPU fixtures, not this native
run. Episode 2's combat-dependent halt/resume and Episode 10's resumed evacuation
also remain CPU-only coverage. The completed dwell ring still draws according
to existing presentation behavior; the objective navigation marker clears.

All owned browsers and servers closed successfully. Port 5444 was checked
closed and the GPU was explicitly released to Rendering before packaging.
