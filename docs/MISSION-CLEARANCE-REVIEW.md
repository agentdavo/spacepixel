# EP02 / EP10 mission clearance

Branch `codex/mission-clearance`, based on `a38865a`. This changes mission
placement and control authoring, with no changes to collision response,
damage, physics integration, launch grace, or snapshot format.

## Reproduction and correction

`tests/campaign-clearance.test.ts` loads the actual Fleet models on CPU and
uses the production CampaignSession spawn/preStep methods, including ship
facing, starting velocity and static actor controls. Fleet.step integrates
the real flight model. DOM, rendering, combat AI and set-piece geometry are
outside this fixture.

| Case | Original authoring | Corrected authoring |
| --- | --- | --- |
| EP02 | Barge first intersects the Indomitable's structural collision proxies at 19.28 s; centre-based delivery fires at 21.87 s, after hull entry. | Destination is 1,800 m outside the host centre on the approach side; guidance and delivery share that point, with a 100 m delivery radius. The Indomitable starts at rest and holds its authored anchor while neutral. |
| EP10 | The original two-member wedge puts lifeboats 75.95 m apart. Their meshes' initial lateral bounds have an 11.72 m gap, but the production fighter solver records a contact after launch grace. | The second lifeboat's offset is `[240,12,-45]` instead of `[60,12,-45]`. The first spawn, member identities, destination lanes and 800 m arrival rule remain unchanged. |

The EP02 baseline probes actual structural proxies without resolving the
collision, so its later intersection count is not a count of live damage
events. The EP10 baseline uses the resolving fighter solver and its normal
launch grace. No rest-pose enclosing-sphere overlap is presented as proof
of mesh intersection.

The corrected EP02 halt/resume run gives zero proxy intersections and a
minimum 479.76 m gap between spheres enclosing both rest-pose model bounds.
It halts after 8 s, holds for 20 s, resumes and reaches the external arrival
zone at 40.00 s (99.14 m from the destination), then remains stopped during
the remainder of a 120 s post-resume flight. A separate test drives the
actual rendezvous, raid, stall and delivery predicates to success, with
no hull loss. Being at the host centre alone does not set the arrival flag.

EP10 holds for 20 s and then flies for 150 s. It produces zero fighter
contacts, with minimum full-flight enclosing-sphere clearance 41.68 m,
and sets `lifeboats-arrived` at 53.63 s. Both lifeboats stop in their existing
240 m destination lanes.

## Compatibility and scope

- Optional `routeArrival` authoring is used only by EP02. Unspecified routes
  keep their original cached destination and 800 m completion radius.
- Optional `stationary` authoring applies only to EP02's static Indomitable.
  Other statics retain their 0.35 throttle. Provoked non-neutral actors still
  leave the static control path as before. Velocity is initialized only at
  spawn; ordinary FlightModel braking holds the anchor afterward.
- Optional `memberOffsets` is used only for EP10's two lifeboats. All other
  groups retain the original wedge. The same helper supplies spawn offsets
  and stable destination-lane ordering.
- Snapshot shape, spawn indices, member indices, saved coordinates and saved
  velocities are unchanged. Restore does not re-space living ships or revive
  dead members. A save from the old moving-host authoring retains its velocity
  on load and then brakes naturally. This does not repair a save that already
  contains overlapping ships.
- Fixed-step retries and alternate tick batches produce identical snapshots.
  This is not a new claim of bit-identical mid-flight restore: the existing
  save format does not persist ship orientation or pilot steering memory.

## Verification

- Focused clearance tests: legacy reproduction, production flight/control,
  mission success, prolonged holds, deterministic retries, JSON restore,
  casualty identity and existing moving-host save compatibility.
- Existing escort coverage for every authored escort episode remains passing.
- Full suite: 377/377 passed before adding the final old-save compatibility
  case; that case was then verified in the focused suite.
- Production build: TypeScript, campaign/expansion validation and Vite pass.
- Native GPU and ordinary-player-input acceptance remain pending the chief's
  shared GPU allocation. No browser or GPU was used for this work.

Run the bounded regression with:

```sh
node --experimental-transform-types --no-warnings --test tests/campaign-clearance.test.ts tests/campaign-escort.test.ts tests/campaign-validation.test.ts
```
