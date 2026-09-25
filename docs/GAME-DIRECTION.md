# Vanguard game direction

Decision record: 25 September 2026. David appointed task
`01a0d930-0d92-75d1-b902-7f5e53b75ca2` chief game architect with full editorial
control. This task owns creative direction, scope and acceptance decisions.
Specific later instructions from David take precedence.

## Latest trailer direction

David's review of V3 says the picture is roughly acceptable but insufficiently
cinematic, and the narration needs a full rewrite that makes sense to a
twelve-year-old hearing it once. `TRAILER_V4_SCRIPT.md` is the current chief
replacement text and editorial direction. Explain gates, their failure, fuel,
war and the player's role through concrete cause and effect. Preserve an epic
tone through image, sound and pacing. V3's narration and fixed duration are
superseded; its files remain preserved as a previous review cut.

## The experience we are building

Engine ownership and the staged codebase reform are defined in
[ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md). The first maintenance slice
separates twenty mission modules, adds build-time content checks, and validates
loaded runner snapshots before mutation. [MISSION-AUTHORING.md](MISSION-AUTHORING.md)
sets the authoring and bug-fix workflow. This proceeds alongside the authorised
V4 render without changing its capture baseline.

A cinematic third-person space combat game inside a vast, failing industrial
civilisation, with intimate squadron radio and a sweeping literary campaign.
The player should feel the weight of a ship, recognise who is speaking on the
radio, read the cause of combat damage, and understand how a decision changes
the Reach. Preserve the inked OVA art, painted skies, maintenance rituals and
the contrast between human crews and immense ancient machinery.

The Schedule is a central link between story and play. Consequences must follow
understandable player actions. Kessen engineering challenges the Reach's
dependence on inherited machinery without explaining away the Builders or
taking the campaign climax away from Vanguard.

The user's original twenty technical milestones and twenty narrative milestones
remain the governing brief. Batch 1 is already implemented according to the
roadmap; do not restart it. Verify the actual experience and close gaps before
treating milestone checkmarks as final acceptance.

Technical priorities are Three.js/WebGPU, cel ramps and rim light, bold ink
outlines, compute particles, responsive inertial flight, spring chase cameras
and dramatic cutaways, variable-geometry fighters through capital ships,
legible weapons and missile swarms, squadron AI, tactical command, multi-system
navigation and cinematic gates. Use clean modular TypeScript and measured
performance. Do not silently replace deterministic simulation with GPU physics
or claim fleet-scale compute physics has shipped without an implementation audit.

The campaign preserves all four arcs: the Long Dark, fossil technology, the two
ideologies, Ebon-gas and the Signal; the escort disaster, stolen coordinates,
managed war, ghost ship and fallen Bastion; the Dead Zone, Monolith, Oracle,
schism and Nexus defence; then the pilgrimage, Zenith revelation, alignment key,
multi-system Symphony and quiet Open Horizon. Deliver this through missions,
radio, briefings and environmental storytelling. Preserve mystery and character
stakes; the trailer must not explain the late revelations.

## Current delivery order

1. Finish and verify the revised 720p trailer. Visible gun barrels, muzzle
   positions and trajectories must agree. Explain the Shattering, surviving
   Lanterns, Ebon-gas conflict and Vanguard clearly. Keep speech intelligible
   over Symphony of Gates and synchronise combat audio. Label recorded neural
   voices accurately. Inspect the final film and record backend, source
   revision, codec, timing and known limitations. V1 is not evidence that V2
   passes.
2. Integrate the demonstrated point-defence fix, voice coverage repair and
   portable test/recording tooling. Keep Resolute's 4500 hull and Mk II stock
   fit. Review overlapping cinema/audio changes together and validate the
   combined tree, not only each branch.
3. Prove the first-session route: launch, learn flight and combat, dock, trade
   or refit, save, close and resume. Check objective clarity, controls, camera,
   readable combat feedback, voice/subtitle timing and preserved progress.
   Existing automated checks support this gate; a recorded live playthrough
   remains necessary before calling the opening polished.
4. Continue verifying the core campaign and original visual/flight milestones.
   Introduce Kessen through restrained cameos first. Broader side arcs,
   multiplayer and a 200-frame Train remain later milestones.

## Kessen editorial decisions

David's subsequent clarification says Kessen were initially intended to cameo.
This supersedes the chief task's earlier side-arc-first authorisation.

- **Initial delivery:** propose minimal Episode 10/19 appearances that preserve
  established mission outcomes, player agency and the quiet ending. They must
  not depend on completing an unbuilt side arc. Use existing frame assets and
  the least invasive identity/canon support. Do not expand general faction,
  economy or combat interfaces simply to stage a cameo.
- **Deferred:** the four-step Twelfth Hulk arc, custody routes, playable frames,
  Kessen markets, a sixth guild, homeworld travel and large-scale consist combat.
  Their proposals remain available for later development, not release promises.
- **Future D2 direction:** a requested, successful intervention that defeats an
  active engagement's scheduled outcome breaks that engagement. Presence or
  failure alone does not. Show the stakes before commitment and settle the
  consequence once. Episode 18 still ends the Schedule.
- **Future D3 direction:** validated slow movement relative to a capital hull may let a frame
  couple through a live shield. Projectiles still strike shields; interior
  damage requires an actual breach route. The proposed 2 m/s approach and
  30-tick validation are tuning hypotheses, not accepted balance numbers.

The revised cameo plan began at `e9ed923` on the isolated Kessen branch. Chief
review on 25 September subsequently accepted the service-module geometry, local
lighting, corrected EP10 placement and both EP10/19 normal-approach motion
samples, and authorised integration and default activation after combined checks.
Those checks pass: 308 tests/build and native WebGPU default-on/explicit-off
comparisons preserve gameplay hashes, runner progress, world facts and navigation.
The two render-only cameos are enabled in normal EP10/19 play, with
`kessenCameos=0` retained for debug comparison. EP10 appears only after the
Bastion's actual destruction; EP19 is removed on `leg2`. There is no combat or
objective credit, new voice dependency, collision actor or save change.

The lifeboat clearance test covers both real corvettes and their arrival turns,
with 108.4 m minimum conservative clearance. Motion samples are silent staged
visual evidence from the final geometry before the navigation rebase; combined
native stills and state comparisons were rerun after integration. This accepts
the bounded visual cameos, not a full manual mission or crowd-performance claim.
See [cameo evidence](KESSEN-CAMEO-PREVIEW.md).

The earlier broad phases 0–1 faction-foundation scope is superseded. No boarding
or shield-bypass mechanic is authorised for this introduction. Preserve existing
saves, economy domains, Rustwake facts and seeded world generation. Cameos must
not require an unbuilt side arc or interrupt protected dialogue and the climax.

## Owners and handoffs

| Responsibility | Task ID |
|---|---|
| Chief architect, editorial decisions and acceptance | `01a0d930-0d92-75d1-b902-7f5e53b75ca2` |
| Integration, branch audit, ROADMAP and SESSIONS | `01a0d8f2-bc9d-7713-8f66-cf8baee8ec58` |
| Trailer and cinema/export corrections | `01a0d8f8-3f42-7b33-9607-750700270fb9` |
| Point defence and combat visual verification | `01a0d8f8-3f50-72c2-8722-0a50a7c35a95` |
| Voice recordings, coverage and portable tooling | `01a0d8fc-0557-7431-a748-8c02d06a289d` |
| Kessen cameo plan and minimal integration | `01a0d8f8-3f42-7b33-9607-74ea0db2e1eb` |

These assignments replace the historical ownership assumptions for current
work. Owners agree shared-file boundaries with integration before editing.
Use isolated branches, report source commits and actual checks, and distinguish
implemented, verified and merged. Integration preserves other tasks' working
changes and sequences merges. Do not delete historical branches or merge old
prototypes wholesale as part of this direction change.

Send screenshots regularly at meaningful visual checkpoints, identifying the
scene and renderer. Commit coherent reviewed changes regularly, including
validation evidence. A screenshot supports appearance; it does not prove flight
feel, audio quality or performance. The first-session slice is an immediate
quality gate within the full game, not a reduction of the long-term scope.

This record sets direction and authorises the stated work; it is not a claim
that pending branches have merged, the trailer has passed review, or the
playable slice has been tested. Evidence lives in
[the continuation audit](AUDIT-2026-09-25.md).
