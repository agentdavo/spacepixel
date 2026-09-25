# Lantern Guard and combat visuals — 25 September 2026

Baseline: `72ced42` (merged gameplay and batch 6 work). No changes to weapon
damage, missile HP, reload intervals, the Resolute's 4500 catalogue hull, or
its Mk II stock fit. Cinema, capture and audio-render scripts are untouched.

## Reproducing the torpedo report

Run `node scripts/lantern-pd.mjs`. It emits JSON lines with individual seeded
duels and every controlled salvo's outcome, and asserts that every missile
resolves and equal launch schedules produce equal outcomes across marks.

The controlled comparison uses the real Capitals, Weapons and Missiles at
60 Hz: a stationary Lantern Guard facing +X, a Resolute at (0, 180, 1500)
facing -Z, zero velocity on both hulls, six single torpedoes per run. Ship
damage is suppressed so a damaged gun, shield or fire-control subsystem
cannot change a later trial. Missile damage/interception HP, guidance,
barrel arcs, slew, scatter and turret cooldowns remain live. Only the missile
rack mark changes. Seeds: 31, 47, 59, 73, 89, 97. Launch offsets: 0, 0.25,
0.5, 1 and 2 seconds. There are 240 controlled runs / 1440 torpedoes.

The reported pattern **does occur**, but is conditional. At seed 47, offset
0, all six Mk I, II and IV torpedoes are intercepted; the fourth Mk III hits.
Seeds 73 and 97 reproduce that same pattern at offset 0. Mk III is not immune
to PD, and other timings allow other marks through.

Interceptions with each rack's actual reload (36 torpedoes per cell):

| Launch offset | Mk I (12 s) | Mk II (11.04 s) | Mk III (10.2 s) | Mk IV (9.36 s) |
|---|---:|---:|---:|---:|
| 0 s | 36 | 34 | 32 | 36 |
| 0.25 s | 36 | 33 | 31 | 35 |
| 0.5 s | 35 | 34 | 35 | 33 |
| 1 s | 34 | 33 | 32 | 32 |
| 2 s | 35 | 33 | 29 | 35 |
| Total / 180 | 176 | 167 | 159 | 171 |

Control: launch **all marks every 12 seconds**, preserving each mark's
missile spec. Every individual outcome then matches across marks: 36, 36,
35, 34 and 35 interceptions for the five offsets, or **176/180 each**. Thus
the isolated mark difference follows launch timing against the defences;
it is not a Mk III targeting exemption. The physical missile flight and HP
are the same across these marks. No reload-reset defect was demonstrated.

The script also runs six full combat duels per mark, changing the whole
fit, with damage, movement stepping and both sides' guns active. Those
results are deliberately separate from the controlled missile experiment:
other equipment and destroyed defences affect full duels. All marks have
intercepted torpedoes; a higher interception fraction does not mean a worse
overall fit.

## Actual defect and fix

Both AI capital PD and fitted flak mounts selected the nearest missile
**before** checking its lead solution and firing arc. A nearer missile below
the deck, or one with no possible intercept solution, hid a farther
engageable missile. The gun could idle or shoot a ship instead.

`turretSelectThreat` now filters candidate lead solutions before choosing
the nearest threat. `Missiles.nearestThreat` accepts an optional predicate;
omnidirectional PD clusters retain their existing selection. No cadence,
range, slew, damage or fire-gate changes were needed.

`tests/point-defence.test.ts` reproduces this with an actual Lantern Guard
mount and two real launched torpedoes. It failed on baseline (`none` instead
of `pd`) and passes with the fix. It also checks reversed candidate order,
an impossible intercept, and losing the valid threat without firing through
the deck. The controlled single-torpedo matrix and full-fit duel results
were unchanged by this fix: it is a separate targeting defect, not a balance
adjustment intended to erase the reported pattern.

## Visual verification at 1280 × 720

Used native Intel WebGPU (`intel / xe-lpg`) through installed Edge:
`channel: 'msedge'`, `--enable-unsafe-webgpu`, `--use-angle=d3d11`,
`--ignore-gpu-blocklist`. Chromium 1194 failed device creation on this machine
and fell back to WebGL2; those earlier captures were not used as evidence.
The existing screenshot harness was copied into ignored scratch space with
only browser-launch changes. No capture script changes are in this patch.

The combat test scene needed corrections before its captures were valid:

- Collapse and regen could occur during its hidden warm-up, before the
  visual consumers ran. Their stages now start live.
- Scripted subsystem hits ran before `Weapons.step` cleared events. Timed
  hits now occur after that clear and before the FX consumers.
- Subsystem samples now expose the mounts, target them explicitly and run
  the capital turret wreck drive. They show both a blown mount and a droop.
- `fx=0` used to skip all CombatFx consumption, including decals. It now
  disables particles while retaining marks and wrecks. `firefor=S` stops
  impact-stage firing after S live seconds, allowing marks to cool.

The saved screenshots use `scene=combat&stage=impacts` plus these parameters:

| Evidence | Parameters | Observed |
|---|---|---|
| [Hull cooling and beam cut](screenshots/combat-720p/hull-cooling.jpg) | `side=hull&cam=0&firefor=1&freeze=1.9&fx=0` | Molten/kinetic/ion spots cool separately; a thin orange beam-cut segment remains on the aft patch. Readable but small at broadside distance. |
| [Destroyed mounts](screenshots/combat-720p/mounts.jpg) | `side=subsystem&freeze=1.5&cam=1&fx=0&hud=0` | Blown mount removed; adjacent wreck droops over scorched plating; intact mounts remain articulated. |
| [Concord](screenshots/combat-720p/concord.jpg) | `side=shield&freeze=0.5` | Cyan hex lattice and local impact splashes. |
| [Choir](screenshots/combat-720p/choir.jpg) | `side=shield&faction=choir&freeze=0.5` | Magenta elongated crystal facets. |
| [Rustwake](screenshots/combat-720p/rustwake.jpg) | `side=shield&faction=rustwake&freeze=0.5` | Amber irregular plates with holes. |
| [Early collapse](screenshots/combat-720p/collapse-early.jpg) | `side=collapse&after=0.1` | Discrete short-lived shards and lattice flash; hull remains readable. |
| [Late collapse](screenshots/combat-720p/collapse-late.jpg) | `side=collapse&after=0.8` | Particle shards gone; remaining lattice folds/fades. No solid white collapse disc. |
| [Regeneration](screenshots/combat-720p/regen.jpg) | `side=regen&freeze=0.4` | Visible sweep across the recovering facing. |

The existing 0.35–0.65 second shard lifetimes and lattice-only collapse
pinch are preserved. No production shield/decal shader tuning was necessary.
These are correctness/readability captures, not a GPU performance benchmark.

## Validation and remaining scope

- Typecheck and production build pass.
- 299 discovered tests pass. Used an explicit PowerShell file list and the
  coordinator's temporary `fileURLToPath` correction for the Windows lint
  test; restored that file afterwards. Package/test-runner fixes remain
  owned by the coordinator and are not part of these commits.
- All balance scenarios pass. Stock Resolute vs Lantern Guard: 93.6 s,
  33.59% hull. Mk III Resolute: 67.3 s, 73.60% hull. Stock Valiant: 83.6 s,
  21.78% hull; Mk III Valiant: 68.7 s, 52.58% hull.
- Ten-minute dogfight, capital and traffic determinism scenarios pass:
  600/600 checkpoints for repeated runs and recorded-input replay in each;
  different-seed sensitivity passes too.
- The final diagnostic script and focused regression pass.

Station batteries remain a gap: bastion mounts are visual `scanPose` rigs,
and the old station-defence model is not wired into this combat simulation.
This change adds no station AI. Fitted omnidirectional PD clusters also
retain their existing implementation; this fix concerns articulated mounts.
