# Large hull contact and the V4 motion report

25 September 2026. Owner: Collision Physics & Capital Breakup, coordinated under
[TEAM-OWNERSHIP.md](TEAM-OWNERSHIP.md). Implementation branch:
`codex/hull-contact-physics`, based on clean `c9429e0`. Chief owns integration;
this document does not claim that the branch or a replacement trailer is accepted.

## V4 diagnosis and preserved evidence

The original `C:/projects/spacepixel/scratchpad/delivery/v4/final/` is untouched.
The movie's SHA-256 still matches its delivery manifest:
`c5c709830ab871a50616aac4c14d462d734d3ab0e3010c39da026577d9f21c6d`.
The investigation used its shot ledger, archived takes, capture harnesses,
per-second campaign states and CPU-extracted frames. No V4 rerender occurred.

| Film time | Source and interpretation |
| --- | --- |
| 42–42.5 s | End of V3 `capital-controls-take-1`, source 8.5–9 s. |
| 42.5–46 s | V4 `convoy-take-1`, source 41–44.5 s. Magpie orbit, scale 1.6. |
| 46–48.5 s | V4 `convoy-raid-take-2`, source 46–48.5 s. Same underlying campaign run, orbit scale 3. The edit skips 1.5 source seconds and widens the camera. |

Trailer owner's source-motion audit establishes actual crowding, not merely
parallax: tanker 1/2 centres remain about 8.30 m apart at source 41, 43, 46 and
48 s. Audit/Magpie repeatedly approach 45.24 m. Magpie changes velocity from
`[-7.65,-1.87,-14.29]` at 40 s to `[0.64,-4.71,2.17]` at 41 s,
`[11.94,-4.09,7.21]` at 42 s, and `[-11.12,11.07,2.90]` at 43 s near the endpoint.
Recorded replay checks did not desynchronise. Exact contact normals/body rates
were not logged in these old captures, so contact impulses cannot be reconstructed
from that footage alone.

The convoy shares one `rwbuoy` destination. Old CampaignSession guidance calls
`flyToPoint(..., target, 60, ...)` for every escort, including after the Runner
sets its arrival flag. That is a 60 m/s arrival request, not a braking/holding
controller. FighterCollisions' 0.8-radius separation explains the observed
repeated small separations. Chief assigned the independent arrival-slot/braking
fix to Integration & QA (`5cd644c`); this branch does not edit CampaignSession.
The orbit's 0.35 rad/s turn and the 46 s edit amplify the movement on screen.

Separately, the code audit found **no large-ship pair response at all**:
HullCollisions makes radius >60 m ships static-response hosts for fighters,
while its moving bodies and FighterCollisions both exclude that class. The new
solver fixes this confirmed gap. It does not by itself fix the small convoy's
arrival guidance, and the trailer complaint should not be attributed solely to
large-ship physics.

## Bounded implementation

`CapitalCollisions` runs in the normal FlightScene contact phase after flight.
It processes living radius >60 m ships; the existing fighter/station collision
paths and docking exemption remain intact. It also runs in the headless replay
harness at the same point in the tick.

- Static hull geometry is read once to fit six longitudinal box envelopes.
  Triangle edges are clipped at slab planes, so long triangles with no vertex
  inside a slab are still represented. Cached shapes are reused. Runtime uses
  conservative swept bounding spheres followed by 15-axis swept OBB SAT for
  at most 36 box pairs per nearby ship pair. No runtime mesh pair intersection.
- Equal-time contacts on multiple slabs use one manifold-centre impulse. A
  flat broadside must not acquire artificial stern torque from the first slab.
  Each pair is processed once in stable ship-ID order. Linear sweeps find the
  first time of contact even when both end positions have crossed completely.
- Effective dry mass is envelope volume times a declared homogeneous density
  of 0.001 tonnes/m³. Box diagonal inertia plus parallel-axis terms approximate
  inertia about the flight origin. **ShipStats.mass is not used**: it is a
  handling multiplier, not physical tonnage. Examples from this catalog are
  about 2,263 t for Valiant and 433,098 t for Indomitable; these are model-derived
  simulation estimates, not canonical engineering specifications.
- Relative velocity at the contact includes both bodies' angular motion.
  Equal/opposite impulses use inverse mass and inertia. Restitution is 0.04,
  zero for gentle/resting contacts. Tangential velocity is retained; this first
  slice does not add a surface-friction model. Flight assist still damps body
  rates in its existing way. Fighters' controls/specs are unchanged.
- Positional separation is a split correction, not an added separating speed.
  Initial overlap deeper than 2 cm is treated as spawn/berth/recovery overlap:
  it can stop closing motion and separate, but cannot charge impact damage.
  A stationary overlap therefore cannot generate kinetic energy or frame damage.
  Gentle sustained thrust remains below the 8 m/s damage threshold. No hidden
  cooldown or previous-pose cache is required in saves/replay snapshots.
- Above 8 m/s, damage derives from dissipated normal energy with a 100 m/s
  specific crushing-energy scale. A glancing impact uses its normal closing
  speed, not full tangential speed. Energy divided by each body's mass and
  scaled by its hull capacity determines that body's raw kinetic hit. Damage
  points follow the corrected end-of-tick body pose so CCD still hits the
  appropriate local section. Shields absorb first through the existing kinetic
  damage multipliers; penetrating hits affect nearby hardware and that section.
- Existing Structure thresholds, plot armour, kill causes and Destruction own
  breakup. This change invents no cinematic kill trigger. Wreck pieces now
  inherit the parent's physical angular velocity and velocity at each pivot,
  in addition to existing authored breakup energy. The existing 16-piece cap
  remains; debris does not enter an unbounded collision-pair simulation.

The runtime audit also found Weapons.step clearing collision shield-down,
subsystem and kill events before mission/audio consumers. FlightScene and the
headless harness now explicitly begin the event window immediately before
Fleet.step, after prior-tick traffic/guidance consumers, then retain events
through `Weapons.step(dt, true)`. Standalone `Weapons.step(dt)` still starts its
own window. Tests cover mixed contact and bolt kills, ordered delivery to
EventTap, survival across the weapon phase and absence on the following tick.

Chief/audio review then found that direct collision hull FX/sound ignored actual
shield absorption and bypassed the replay-seek presentation gate. The follow-up
routes capital damage through `Weapons.contactHit`: Fleet.hit applies it, then
one ordinary shield/hit event immediately copies its exact result. It carries
kinetic type, raw amount, null gun, damage in each layer, facing, strength, bleed
and subsystem fields. FlightScene and the headless harness use this adapter.
Capital contacts no longer call particles or audio directly; ordinary CombatFx,
EventTap and GameAudio consumers respect the existing fast-forward gate. Camera
shake remains tied to physical impact. Fighter handling/cues are unchanged.

## Checks and measurements

Focused commands (run serially to avoid this machine's concurrent-suite pressure):

```sh
node --experimental-transform-types --no-warnings --test --test-concurrency=1 tests/capital-collision.test.ts tests/capital-collision-runtime.test.ts tests/collision.test.ts tests/fighter-collision.test.ts tests/destruction.test.ts tests/determinism.test.ts tests/combat-audio.test.ts tests/event-tap.test.ts
npm run build
```

Result: **44 focused tests pass**; production build, TypeScript, campaign and
expansion content checks pass. No combined/full-suite acceptance is claimed here.
The layer-aware follow-up passes the real runtime collision suite, audio and
EventTap checks and TypeScript. Actual GameAudio spies hear shield cues only for
absorbed contacts, exactly one cue per damaged layer for penetrating contacts,
and preserve those layers for a gunless contact which kills the player.

The physics fixtures cover stationary and separating overlap, gentle sustained
thrust, docking exclusion, near misses inside broad spheres, 60 km/s relative
translation without tunnelling, unequal masses, head-on versus glancing damage,
off-centre angular response, momentum preservation and non-increasing kinetic
energy during resolution. Twenty-four rotated arrangements exercise finite
poses/rates and energy dissipation. Linear contact pose/damage agree at 30/60/120
Hz; this does not establish rotational CCD timestep invariance.

Insertion order, repeated runs and reconstruction of the solver each tick are
identical. A real-dreadnought collision is recorded through the normal `.vgr`
codec and replayed after a JSON round trip: ten hash checkpoints and both
structural deaths agree. The three standard 30-second dogfight/capital/traffic
repeat/replay scenarios also pass. The solver adds no persisted state/schema or
random source. Old recordings must use their frozen simulation revision; a
physics fix is not a promise of cross-revision replay hash compatibility.

All eleven catalog hulls above the existing cutoff produce finite six-box
envelopes. Indomitable checks give the following per-ship results (48,000 hull,
9,000 shield initially):

| Contact | Result |
| --- | --- |
| 20 m/s closing, intact shields | About 401 raw damage; 201 shield lost on the fore facing, hull unchanged. |
| 120 m/s closing, shields initially down | About 23,973 hull lost; bow integrity falls from 40,800 to 16,827; other two sections unchanged. |
| 120 m/s into engine deck, shields down | Engine-0 destroyed through ordinary subsystem routing; target stern loses about 11,990 integrity. |
| 360 m/s closing, intact shields | Fore facing collapses, bow integrity reaches zero, both ships die by `structural` and yield four pieces. |
| Same severe hit with plot armour | Both ships survive at the existing 15% floor. |

On Intel Core Ultra 7 265 / Node 24.20, warmed CPU-only fixtures measure roughly
0.20 ms/tick for 200 separated box hulls (19,900 sphere checks, zero SAT pairs),
and 0.57 ms/tick for a close non-touching 200-hull grid (13,320 box SAT checks).
Sixteen wreck pieces cost about 0.003–0.004 ms/tick over 600 ticks. These isolate
solver/wreck cost, exclude first-use mesh fitting and rendering, and do not
constitute a full 200-capital battle frame-time claim. Chief will run the
combined full suite, balance and longer replays after integrating escort and
renderer changes; this branch does not duplicate that full run.

## Native before/after and reproduction

Native Edge / WebGPU (`GPUDevice`, Intel Graphics), 1280×720, 15 fps captures
with the simulation stepping at 60 Hz. Both ships are healthy Indomitables,
initial centres ±1,450 m on Z, opposing 180 m/s inertial velocities, zero thrust.
The camera is fixed. After initial setup the normal FlightScene simulation owns
all poses, shields, damage, events and wrecks. This is an authored **collision
fixture**, not ordinary campaign/trailer footage. It contains no post-start
damage/death/pose injection.

Evidence root on the task's retained worktree:
`C:/Users/David(J)Smith/.codex/worktrees/7638/spacepixel/scratchpad/collision-audit/`.

- `baseline-native/`: actual detached `c9429e0` source. No contacts/damage/deaths;
  ships visibly interpenetrate. Video, frames and state/provenance JSON preserved.
- `native-layer-final/`: final layer-aware source; one 360 m/s contact around tick 107,
  two fore-shield collapses and two structural kill events, four wreck pieces,
  zero page errors. Exact source SHA and file hashes are in `evidence.json`.
- `native-shield-final/`: same committed source, centres ±1,140 m and opposing
  10 m/s inertial velocities. Both hulls remain intact, with two ordinary shield
  impact events and no hull damage. Metadata retains kinetic type and null gun.
- `targeted-tests.txt`: focused test output, catalog/damage/performance facts.
- `v4-42-48.png`: diagnostic V4 contact sheet; original film remains unchanged.

Earlier takes are retained, not relabelled: native-01 failed an import before
capture; native-02 established numeric deaths but its camera looked away;
native-03 has valid framing/physics but predates the event fix; native-04-events
is an intermediate event regression take. `native-final/` is the clean dbf1899
physics/event-boundary fixture before layer-aware feedback review. Use
native-layer-final and native-shield-final for final acceptance.

```sh
node scripts/collision-capture.mjs --out scratchpad/collision-audit/another-final
node scripts/collision-capture.mjs --case shield --out scratchpad/collision-audit/another-shield
node scripts/collision-capture.mjs --root PATH_TO_C9429E0 --baseline --out scratchpad/collision-audit/another-baseline
```

Every output directory must be new; the script refuses to overwrite evidence.
Obtain the shared native GPU slot first. Initial setup is in the script; state,
contact impulses and surviving damage events are recorded in `evidence.json`.
The fixture is not a general-flight replay boot scenario. Trailer production
should record a **fresh normal EP04 take** on the chief's accepted combined
source and use the existing campaign replay/capture harness.

## Explicit limits and next work

This is an approximate rigid-body/game-damage first slice, not engineering-grade
simulation. Six solid slab envelopes fill concavities and can contact before
detailed mesh surfaces. Articulated appendages, arbitrary rotational sweeps,
continuous multi-body stack solving, friction/crushing deformation and large
ship–station response are outside this fix. Diagonal inertia uses the flight
origin, not a reconstructed full mass tensor/centre of mass. Large ships still
lack general navigation/avoidance AI; the existing capital controller regards
them as fixed-heading combat platforms. Fighter-host sweeps retain their older
24-sample cap and infinite-host-mass response.

The independent escort fix guarantees final escort-to-escort slots, not every
route's obstacle clearance. EP10's old initial corvette wedge overlaps, and
EP02's destination remains the Indomitable's centre under existing Runner
semantics. Neither is accepted as hull-clear docking/arrival in this change.
Indomitable's targeting radius is only about 398 m while its static hull bound
is about 1,345 m: future placement/avoidance work must use geometric hull bounds.
Chief should review spawn/route clearance before describing the campaign as
fully collision-safe. V4.1 remains the trailer owner's separate delivery.
