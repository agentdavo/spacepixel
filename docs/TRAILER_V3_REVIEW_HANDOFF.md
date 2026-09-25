# Vanguard V3 clarity review

The V3 review is a 152.967-second film with the rewritten 125-word lore script,
native gameplay, a complete title/end slate, generated score, captured gameplay
effects and a new British female narration candidate. Amy and HFC Female were
rejected for unclear English and are excluded from this review. Kokoro bf_emma
is a new review candidate, not accepted casting. No actor voice is cloned.

## Files

The current package is under `scratchpad/delivery/v3/clarity-final/`:

- `vanguard-v3-clarity-review-720p.mp4`: complete narrated review.
- `picture-master.mp4`: the same encoded picture and captions, without audio.
- `captions.srt`, `captions.ass`, `shot-ledger.json`: edit and readable captions.
- `qa.json`, `ffprobe.json`, `contact-sheet.jpg`, `av-analysis.txt`: final checks.

The earlier `final/vanguard-v3-picture-review-no-narrator.mp4` is superseded.
It preserves the first picture review and its camera obstruction; do not use
it as the current film. V2 is also retained unchanged.

## What the film shows

The lost Lantern roads lead into the Shattering, six surviving gates,
Ebon-gas scarcity, the Directorate and Hegemony, and Vanguard's role. The
narrator yields to the battle from 81 seconds until the final mystery line.
The text uses original Vanguard lore and withholds campaign revelations.

There are 142 seconds of native staged gameplay, including 92 seconds with the
actual HUD. The remaining 10.967 seconds are native branding and the end slate.
Bridge/bow views are on-ship views over the hull; no fighter cockpit interior is
claimed. Fighter footage includes ordinary mouse/keyboard aiming, a player
missile command, gunfire, damage and shield recovery. Capital footage retains
subsystem selection, shield trim, weapon feedback and actual hull/shield state.

Initial scenery and healthy stock ship formations are staged before simulation.
There are no post-start health, shield, hit, death or ship-pose writes. The
capital kill uses normal FlightScene Weapons, Damage, Structure and Destruction.
The Canticle's midships section fails at source second 65.4833 and creates two
physical wreck sections. The 20-second ending battle shot includes damage,
separation and drift from that same recorded fight.

The 29-second exterior HUD section and the clean breakup shot hold the native
orbit camera during replay. These are disclosed presentation adjustments;
simulation checkpoints remain identical. Lore scenery uses existing Lantern
and Wreckage assets in staged views, not literal campaign-location footage.

## Verification and provenance

Native capture is 1280x720 at 30 fps with fixed 60 Hz simulation. Final encoding
uses H.264, limited-range BT.709/yuv420p, stereo 48 kHz AAC and MP4 faststart.
There are 4,589 frames. The capture audit verifies all eight selected takes,
frame/input continuity, the selected frame files and retained weapon events.
Capital control replay passes 44 checkpoints, exterior HUD 59, and breakup 80.
Fighter and lore original recordings retain their inputs/checkpoints; record
mode itself is not a separate playback determinism test.

`capture-audit.json`, `source-reconciliation.json`, per-take provenance, original
replay tapes, event logs and source frame hashes remain in the V3 directory.
Early captures include uncommitted support source hashes; original provenance
is preserved rather than rewritten to a later clean commit. The living-route
take predates per-take GPUDevice metadata, although its capture path asserted
WebGPU. Later captures record an actual GPUDevice and queue.

Audio uses native event-derived effects, including both simulation ticks in
each video frame. EventTap retains turret/death metadata and the FlightScene
audio sink reads the accumulated batch. The focused pool-reuse test and the
actual native FlightScene audio-sink check pass. Sound scheduling is frame/block
based; it is not claimed to be sample-exact. Effects may be selected or
throttled by the game's normal audio facade.

The replacement narrator preserves all eleven lines at playback 1x, with no
pitch processing. Kokoro bf_emma was synthesized locally at pace 0.90. Exact
settings, source/model hashes, licenses, line WAVs and timing audits are retained
in `clarity-review-kokoro-v1/`. Narration, score and effects receive timed ducking
and a two-pass loudness master. Technical PCM/encode checks do not establish
perceived speech clarity; the new voice remains for the user's review.

## Remaining game-camera issue

Timed native camera cutaways can return to a LOCK view that intersects the
player's own capital hull and obscures the target. This trailer holds orbit to
avoid the obstruction. The underlying runtime camera-return issue is not fixed
by that editorial workaround and remains a separate game issue.

No remote publishing is part of this delivery.
