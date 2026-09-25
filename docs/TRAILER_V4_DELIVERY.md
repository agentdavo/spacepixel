# Vanguard V4 delivery

The completed V4 trailer is **114 seconds**. It replaces V3's narration with
110 words explaining the gates, their failure, isolated worlds, scarce fuel,
the war over supplies, the player's squadron and the unanswered signal.
V3 remains preserved as an earlier review.

The delivery folder is `scratchpad/delivery/v4/final/`:

- `vanguard-trailer-v4-720p.mp4`: final picture, captions, narration, score and effects.
- `picture-master.mp4`: identical picture without audio.
- `captions.srt`, `captions.ass`, `narration-timing.md`, `shot-ledger.json`.
- `audio/`: narration line masters, picture-aligned narration, native score,
  gameplay effects, final PCM master and their audits.
- `provenance/`: capture audits, original input tapes, event logs, replay
  checks, source hashes and harness snapshots.
- `qa.json`, `ffprobe.json`, `av-analysis.txt`, `contact-sheet.jpg` and
  `delivery-manifest.json`: encoded-file checks and package hashes.

## Picture and story

The 18-shot edit contains 105 seconds of native gameplay, including 73 seconds
with the actual HUD, followed by nine seconds of native title/end slate.
Gate and wreckage scenes illustrate the history; they are staged scenery,
not footage of the historical gate collapse. Bridge/bow shots look over the
ship's hull; no furnished cockpit interior is claimed.

New pickups show the Episode 4 fuel convoy, a four-second tactical overview
of the capital battle, and Episode 5's real **RESPONSE TRANSMITTED.** message.
Both missions start through the normal campaign API and progress through
ordinary navigation inputs. Replay camera holds change presentation only.
No post-start health, hit, death, pose, objective or mission-flag writes are
used. All selected convoy samples have a living player and surviving tankers;
the later player loss is outside the edit. The trailer promises a role, not a
filmed convoy rescue victory.

The capital sequence advances through the same battle's fire, shield damage,
hull failure and separated wreckage. Its continuous breakup runs from 74.5
to 90.5 seconds. Fighter footage comes from a separate encounter and is not
presented as the cause of the capital kill. The convoy shield whiteout at
source seconds 49–51 is excluded.

## Narration and sound

The British female Kokoro bf_emma voice reads all twelve paragraphs at natural
playback speed. Synthesis pace is 0.90; playback is 1x with no pitch processing.
Narration starts at 2, 10, 15, 24.5, 31, 37, 43, 51.5, 57, 92, 97 and 101 seconds.
The last spoken word ends at 103.521 seconds; its caption ends before the title
at 105 seconds. The battle is unvoiced from 62.270 to 92 seconds.

The native Symphony of Gates score withdraws before the rupture and is silent
from 74.9 to 90.5 seconds. Its ending cadence begins at 105 seconds and fades
out by the end of the film. Gameplay effects are rendered from retained native
weapon/missile events, including both simulation ticks per video frame.
Scheduling is frame/block based, not claimed to be sample-exact.

The PCM mix measures -17.02 LUFS integrated and -1.50 dBTP. The delivered AAC
measures -17.0 LUFS integrated and -1.5 dB true peak with FFmpeg ebur128.
The model license is Apache-2.0 and the kokoro-onnx runtime license is MIT;
local inference required no hosted speech API or actor voice cloning.
Numeric/decode checks do not establish acting quality; human listening and
ASR transcription are not claimed.

## Verification

The encoded file passes 1280×720, 30 fps, 3,420 frames, H.264 limited-range
BT.709/yuv420p, stereo 48 kHz AAC, 114-second duration and MP4 faststart checks.
Full-file decode succeeds; encoded contact-sheet and response-message frames
were visually inspected. No unexpected black interval is detected.

The capture audit passes all 13 selected takes and 18 shots, including frame,
input, event and selected-player-alive checks. New replays pass 22/54/52 world
checks for the convoy angles, 34 for tactical and 118 for the signal, all with
no desync. Per-second selected convoy and signal campaign state, flags, ships,
positions and typed comms match the original runs exactly.

Original capture provenance is preserved, including earlier V3 support-source
hashes and the living-route take's older metadata. It predates explicit
per-take GPUDevice metadata, although the capture path asserted WebGPU. Later
captures record GPUDevice and queue. The older signal target/deadAt diagnostic
refers to the parked free-flight cast, not a campaign death; campaign state and
replay validation establish the selected scene's actual outcome.

V4 uses the frozen monolithic campaign baseline. Later engine/episode-module
refactors are separate work and are not substituted into this provenance.
The build/typecheck passes on this baseline. Production support is committed
through `3b80215`; this delivery document records the final edit and checks.

Final MP4 SHA-256:
`c5c709830ab871a50616aac4c14d462d734d3ab0e3010c39da026577d9f21c6d`.

The portable package excludes the large working JPEG directories, which remain
in the capture worktree. Its manifest covers every included file except the
manifest itself. Nothing has been pushed or published remotely.
