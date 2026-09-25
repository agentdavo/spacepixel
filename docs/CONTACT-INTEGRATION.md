# Capital contact integration

Chief review, 25 September 2026. Accepted bounded source: `dbf1899`, `59f84b3`,
`2a13afe` and test-only `dee8042`, merged with the canonical renderer, refit,
campaign/expansion, audio, Kessen and escort-arrival work. This acceptance covers
the described contact implementation, not unrestricted physics or campaign
clearance certification.

## Behavior

Cruisers/capitals above the existing large-hull cutoff now exchange momentum
when their coarse hull shapes meet. Contact uses both bodies' effective mass,
inertia, normal closing speed and impact point. Low restitution avoids a
pinball response. Gentle contact can drain the struck shield; stronger impact
damages the local structure/subsystem; sufficiently severe damage uses the
existing structural-breakup system. Fragments inherit parent motion.

Resting overlap does not repeatedly inflict frame-based damage. The solver has
no new persisted state or random source. Fighter handling is preserved.

Review also corrected three integration defects: collision events surviving
the weapons phase, feedback following the actual shield/hull damage layers,
and per-hull outward normals for impact presentation. Physical separation
normals remain distinct from surface normals. Collision FX/audio now use the
normal presentation adapter and remain silent during replay fast-forward.

## Evidence

- Combined source `84fe110` passed all **371 tests**, production build and the
  existing balance bands. That full run precedes the bounded feedback/normal
  review fixes; it is not relabelled as a later full-suite run.
- The layer-aware followup passed 44 relevant collision, fighter, destruction,
  replay, combat-audio and EventTap tests on the combined tree.
- Final runtime `2a13afe` passed sixteen physics tests, the actual-hull runtime,
  combat-audio and EventTap checks, plus the production build. Test-only
  `dee8042` added actual rotated-hull normal assertions; the updated runtime
  test passed again after integration.
- The final combined runtime passed ten simulated minutes each of dogfight,
  capital and traffic: same-seed repeat and JSON-round-trip replay matched all
  600 checkpoints per scenario; changing the seed changed each world. The
  traffic result differs from pre-fix history, as expected when collisions and
  previously discarded damage events begin affecting the simulation.
- Independent Combat & Spatial Audio review closed both reported feedback
  issues and the surface-normal defect at runtime `2a13afe`. It verified
  exactly-once ordered impact/kill delivery, shield-only versus mixed cues,
  player-dead/gunless paths, ordinary bolt behavior and the replay-seek gate.
- Matched native Edge WebGPU fixtures show actual `c9429e0` ships overlapping
  intact versus one 360 m/s contact producing two structural deaths and four
  wreck pieces on `2a13afe`. A 20 m/s contact on `dee8042` produced two shield
  events and zero hull damage. Both cases had zero page errors. The latter
  two commits have identical production files; source hashes are retained.

Logs, copied provenance and the comparison are in
[the evidence directory](reviews/contact-integration). The [comparison video](reviews/contact-integration/before-after.mp4)
and [comparison frame](reviews/contact-integration/before-after-5s.png) are
controlled native-game fixtures, not campaign footage. All copied files were
hash-checked against the owning task's retained originals. Native fixtures
identify their own source revisions; the separate combined-tree checks above
are not replaced by older fixture evidence.

## Boundaries and next gate

Six longitudinal box envelopes and volume-derived mass are an approximate
rigid-body model. Concavities, moving appendages, rotational continuous
collision detection, surface friction, crush deformation and large-ship versus
station response remain outside this slice. The detailed model, measurements
and reproduction commands are in [the owner's review](CAPITAL-CONTACT-REVIEW.md).

The accepted escort correction fixes shared arrival destinations and braking.
It does not remove Episode 10's initial overlapping spawn wedge or change
Episode 2's target-capital-centre route semantics. These remain explicit
placement/navigation work, not claims of a fully collision-safe campaign.

The trailer owner must record and replay a fresh ordinary-input Episode 4 take
on the accepted combined source, verify convoy clearance and motion, and then
replace only V4's 42.5–48.5 seconds with a continuous, restrained tracking shot.
V4 and its frozen source evidence remain preserved.
