# Vanguard V3 — The roads between stars

Chief creative brief, 25 September 2026. User commission: a much stronger lore
and universe trailer, with the solemn scale and political weight of an epic
science-fiction introduction, actual gameplay/HUD, shield state, contrasting
onboard and exterior views, and capital breakup/destruction.

Use original Vanguard language and assets. Preserve V2. This brief authorises
script recording, capture-support engineering, editing, local encoding and
delivery without another creative approval from David. It does not authorise
remote publishing or broad game feature development.

## Film and capture standard

Target roughly 150 seconds; 140–165 seconds is acceptable if the performances
and action need space. Deliver at least 1280x720 H.264/yuv420p + stereo AAC,
faststart, preferably 30 fps with fixed 60 Hz simulation. Native WebGPU only.
Keep a higher-resolution master only if capture costs and hardware permit;
readable, well-framed 720p is more valuable than nominal resolution.

Replace the FIGHT / TRADE / RISE sales-reel structure with one dramatic line:
the lost roads, fuel and power, ordinary crews inside that struggle, a battle
that makes ships physically vulnerable, and the unexplained call outward.

At least 70 seconds must show recognisable gameplay, including continuous
6–10 second takes with the actual HUD. Show current shield facings/hull,
target/subsystem selection, missiles or weapon feedback, and camera changes
that exist in the game. Record native UI, not a fabricated overlay. No debug
panels, capture controls or browser chrome in the film. Keep HUD text readable
and subtitle placement clear of it. Preserve clean exterior shots for scale,
but return to the player's perspective so viewers understand what they play.

Use supported bridge/bow views and exterior chase/orbit/flyby/tactical modes.
The current bridge framing is an on-ship viewpoint over the hull; it is not a
modelled interior cockpit. Do not invent cockpit furniture for the trailer or
claim a full fighter cockpit exists without verifying it. If fighter first-
person is unsupported, use the real capital bridge/bow-versus-exterior contrast
and report that exact limit.

Capture from the integrated game at or after `7c0cae5`. Normal gameplay inputs
or deterministic replay of such inputs drive action. Seeded initial combat
setups and pre-roll are acceptable; record their provenance as staged gameplay.
Once a gameplay take starts, do not inject hits, set health/shields, force death,
teleport ships, or animate a predetermined battle outcome. Existing combat
test-scene forced kills are diagnostic material, not proof of player combat.
Use real Weapons/Damage/Structure/Destruction and actual telemetry/HUD. If a
requested death path cannot be obtained, fix the evidenced capture limitation
or report it before substituting a different shot.

Keep per-take source revision, seed, initial setup, input/replay trace and
time range. Cuts may compress a longer fight, but must not fabricate a hit's
consequence or imply a weapon did damage that came from a debug hook.

## Approved narrator script

The narrator is a calm witness to history, not an announcer. David's subsequent
feedback in the voice task prefers a softly spoken woman with a smooth voice;
the initial male recordings are provisional and must not lock the final cast.
Audition the available female voices and use the selected trailer narrator at
natural 1.0x playback throughout, without changing the game-wide cast. Measure lines
before locking their time windows. Leave intentional pauses; shorten or move
a line instead of raising pitch to meet a cut. These lines are the approved
recording text; stage directions below are not spoken.

1. **“For twenty-two centuries, the stars were neighbours.”**
2. **“The Lantern gates joined the human worlds. Then, in a single day,
   they went dark.”**
3. **“We call it the Shattering. Four centuries later, we still live among its
   wreckage.”**
4. **“Here, in the Meridian Reach, six gates burn again.”**
5. **“Their fuel is Ebon-gas, harvested from dying stars. Their price is war.”**
6. **“The Terran Directorate counts every gram and calls it survival.”**
7. **“The Zenith Hegemony sings to its engines and calls it ascension.”**
8. **“Between them fly the people who keep the worlds alive.”**
9. **“Our ships are older than our nations. We know how to wake them. We have
   forgotten why they work.”**
10. **“You fly Vanguard. The squadron that goes through first.”**
11. **“And beyond the last light, something is counting down.”**

The bible gives no census of connected worlds. Line 2 deliberately leaves the
count unspecified.

No revelation of the Schedule conspiracy, Builders' fate, compression wave,
alignment key or campaign ending. No new Kessen exposition in this film.

## Beat plan — timings are an edit budget, not a speech squeeze

| Approximate time | Picture and sound | Purpose |
|---|---|---|
| 0–18 s | Slow native exterior of a dead Lantern and tiny ship; wreckage reveals scale. Narrator 1–2 with space between them. Sparse score, gate tone and radio texture. | Establish the lost civilisation before selling combat. |
| 18–35 s | Graveyard flight, then a living gate/traffic lane. Narrator 3–4. Introduce actual flight HUD during the transition. | Connect history to the place the player inhabits. |
| 35–54 s | Hauler/convoy and opposed capital silhouettes. Narrator 5–7, with faction names allowed on restrained location/identity captions. | Resource, stakes, distinct ideologies. |
| 54–70 s | Human-scale gameplay: escort flight, brief real docking/berth view if it strengthens the rhythm. Narrator 8–9, split across shots. | People maintain this world; ships feel inhabited. |
| 70–83 s | Actual launch/flight and short squadron exchange; narrator 10 only after the fossil-ship thought lands. | Hand the story to the player. |
| 83–108 s | Unhurried gameplay passages: exterior pursuit, onboard bridge/bow, missile lock/launch, real shield-facing loss or redistribution, target subsystem selection. Use actual weapon/radio events. No narrator. | Demonstrate the playable systems clearly. |
| 108–130 s | One comprehensible capital kill sequence: shield damage, a disabled mount or burning hull, structural breakup into large pieces, drifting debris and secondary explosions. Hold the breakup long enough to see separated sections, then let sound/score recede. | Physical stakes and the user's requested destruction. |
| 130–142 s | Surviving ship against gate/space; narrator 11. A restrained Signal motif, no explanation. | Return from spectacle to mystery. |
| 142–150+ s | PROJECT VANGUARD / THE LONG DARK, then a simple browser-play slate. Music resolves without a premature cut. | Memorable finish. |

If the measured narration exceeds a beat, reallocate within 140–165 seconds.
Do not turn lore into machine-gun delivery. Let one significant hit or hull
rupture land without narration or a gratuitous music accent.

## Radio and voice direction

Prefer a small recognisable cast over introducing eight speakers in two minutes.
Kade's existing “Vanguard, launch! Weapons free!” and “Broadside. Everything you
have.” can stay where the pictured action supports them. A fighter help/rescue
exchange may use Sparrow “Two on my six!” and Jackpot “I see them. Stay with me.”
only if the footage actually shows the threat and response. Record that optional
new line after the take exists; do not fake rescue footage to justify a bark.

For a capital command, use Rook rather than Candle. Prefer telemetry-grounded
short calls; do not say all shields are down when only one facing has collapsed.
Correct any visible labels: Jackpot Vanguard 3, Candle Vanguard 4, Sparrow
Vanguard 5. No arbitrary Lucan greeting or promotional feature-list narration.

The score remains grounded in Symphony of Gates, arranged with a sparse first
movement, measured rise and space around the destruction. Avoid overpowering
every line with orchestra. Keep dry narration/radio and final mix stems for
review. Use current voice processing for continuity; do not silently flip the
known recorder pitch formula across the existing cast. If a processing change
is essential, version it and compare a small sample before rendering the cast.

## Production gates and delivery

1. Lock exact text after lore-count check; record dry narration, export durations
   and sample reel at 1.0x. Chief can review script and timing immediately.
2. Produce representative actual-gameplay proof: HUD/shields, supported onboard
   view and a complete physical breakup. Send a compact contact sheet and
   provenance. Establish the real death path before committing a full capture.
3. Edit the film around those takes and measured voice durations. Capture the
   remaining shots, replay actual audio events with matching timestamps, and
   inspect subtitles against HUD. If frame stepping spans several sim ticks,
   retain all audio events, not only the last tick's pooled event arrays.
4. Encode V3 separately from V2. Verify full ending, frame/audio continuity,
   captions, source/clip coverage, no clipped samples and reasonable loudness.
   Numerical checks do not substitute for listening; report review limits.
5. Deliver MP4, final script with actual timings, contact sheet, brief capture
   provenance, voice audit and audio stems in `scratchpad/delivery/v3/`.
   Commit code and production documents regularly; ignored raw capture media
   stays local. Report source hashes and any gap against this brief.
