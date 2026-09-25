# Vanguard V4.1 delivery

V4.1 repairs the convoy sequence at **00:42.5–00:48.5**. The previous two shots
showed actual shared-endpoint crowding, amplified by an orbit camera and a
source-time skip. Shield glare was also present near 00:48.25; V4's earlier
sparse review missed it. V4 remains preserved as the previous review cut.

The replacement is one continuous six-second EP04 replay, recorded after the
accepted escort-arrival and collision fixes. A steady native tracking camera
frames the audit corvette and the separated convoy. The rest of the edit and
the narration text/timing, score timing and captions are unchanged.

## Delivery

Folder: `scratchpad/delivery/v4.1/final/`.

- `vanguard-trailer-v4.1-720p.mp4`: completed narrated trailer.
- `picture-master.mp4`: identical picture without sound.
- `shot-ledger.json`, `captions.ass`, `captions.srt`, `narration-timing.md`.
- `audio/`: final PCM master, revised gameplay-effects stem, unchanged
  narration and score sources, and audio audits.
- `provenance/`: new tape, dense motion/contact logs, audit-off replay,
  invocation harness snapshots, source hashes and original V4 evidence.
- `contact-sheet.jpg`, `replacement-at-45.jpg`,
  `replacement-encoded-contact-sheet.jpg`, `qa.json`, `ffprobe.json`,
  `av-analysis.txt`, and `delivery-manifest.json`.

MP4 SHA-256:
`df30a08f4dec70eeecc7af9fb7602f19f1ca05ade67eb3878c43d1714e73170a`.

## Capture and qualification

New capture source is the clean accepted commit
`2d8d5590fde1d7bf9ced28307fefb2c1329e0566`. It contains the combined renderer,
escort and contact fixes, plus reviewed capture support. The campaign and all
simulation modules, HullCollisions, FlightScene and invocation harness are
hashed in each take's original provenance.

The original `convoy-probe-1` is a 100-second ordinary-input EP04 run, seed
1994, following Magpie through normal mouse/keyboard navigation. The episode
starts normally at tick zero. No post-start pose, velocity, health, damage or
mission-flag writes are used. The selected `convoy-steady-take-3` replays source
seconds 42–48, exactly 180 frames at 30 fps. Its native track camera follows
the audit corvette, scale 1.2, with fixed world direction `[0.7,-0.25,-1]`.
Only the camera's cloned direction is fixed; ship motion stays under simulation.

The dense audit records contact events after every 60 Hz physics step and
ship poses, velocities and model bounds at every 30 Hz output frame. Sphere
centres are transformed from each model's actual bounds centre, not the
targeting origin. Throughout the selected interval:

- All five escorted ships retain full hull health and remain stationary after
  their normal arrival. Their arrival flags were set by source second 30.
- There are zero recorded convoy contacts, including zero-damage contacts.
- Minimum conservative model-sphere clearance is **133.2626 m**.
- Every selected motion/contact/input record and six per-second campaign
  samples match the original recording exactly.
- Replay passes **48 of 48 world checks**, with no desync.

The audit-off replay also passes 48 checks, with all 1,440 frame input batches
and 48 campaign samples matching the audit-on original. This verifies that
the optional diagnostics did not change the recorded simulation. It is not
a real-time performance measurement.

All 180 replacement frames were reviewed on six consecutive frame sheets,
with full-resolution checks and encoded-file inspection. Chief independently
reviewed the six sheets and accepted take 3. Earlier framing takes remain in
the capture worktree; they were rejected for obstruction or small ship scale.

The full probe later loses the player and tankers to hostile fire. Those
events are outside the selected interval; this is not a convoy-rescue victory.
Positive rest-pose bounding-sphere clearance proves separation of those model
bounds, not a universal guarantee for articulated appendages or every route.

## Edit and audio scope

Source-frame hashes confirm exactly frames **1275–1454** changed. The other
**3,240 source frames** and the complete ASS caption file are identical to V4.
The final encode still contains **3,420 frames / 114 seconds**, including 105
seconds of gameplay and 73 seconds with the actual HUD. H.264 re-encoding is
not claimed to preserve compressed bytes or decoded pixels outside the edit.

Replacement effects come from the new capture's native audio events. The
gameplay-effects PCM outside the six-second interval is preserved exactly.
The revised local mix is spliced into the original final PCM master, using
50 ms complementary blends inside the replacement boundaries. The final PCM
outside 42.5–48.5 is byte-for-byte identical to V4. Original narration, music,
voice timing and text are retained; no new speech generation or time stretch.

The delivered AAC measures **-17.0 LUFS integrated, -1.5 dB true peak**.
The native pickup effects have zero clipped samples. Human listening and ASR
transcription are not claimed.

## Final checks and preservation

The final file passes 720p30 H.264 limited-range BT.709/yuv420p, stereo 48 kHz
AAC, exact frame count/duration, MP4 faststart and complete decode checks.
The capture audit passes 12 takes and 17 shots, including selected living-player
checks and retained event counts. Original source provenance is preserved;
reused V4 material is not relabelled as captured on the new physics baseline.

The portable manifest covers all included files except itself. Working JPEG
frame directories remain in their capture worktrees; six review sheets retain
a view of every replacement frame. Neither V4 nor earlier delivery packages
are overwritten. No remote push or publication is part of this delivery.
