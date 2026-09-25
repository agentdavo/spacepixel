# Trailer capture and delivery

The trailer render uses Symphony of Gates (`nexus` / `trailer-ova+cast`),
the recorded Piper neural cast, and simulation audio events from the same
frames that were photographed. The film lasts 90.375 seconds at 24 fps
(2,169 frames); the authored timeline ends at 90.384615 seconds.

## Reproduce

From the repository root, with Node, FFmpeg/FFprobe, dependencies and a
Playwright-compatible browser installed:

```powershell
npm ci
node scripts/record.mjs --scene trailer --from 0 --to 90.375 --fps 24 --size 1280x720 --out scratchpad/trailer-v2/final-frames --port 5381 --require-webgpu --query "quality=high&score=nexus&voice=off"
node scripts/audio-render.mjs --only trailer-ova+cast --events scratchpad/trailer-v2/final-frames/events-0.jsonl --out scratchpad/trailer-v2/audio --port 5382
node scripts/make-video.mjs --frames scratchpad/trailer-v2/final-frames --audio scratchpad/trailer-v2/audio/trailer-ova+cast.wav --crf 20 --out scratchpad/trailer-v2/delivery/vanguard-trailer-v2-720p.mp4
node scripts/trailer-qa.mjs scratchpad/trailer-v2/delivery/vanguard-trailer-v2-720p.mp4 scratchpad/trailer-v2/final-frames/events-0.jsonl
```

On Windows the recorder defaults to installed Edge (`--browser msedge`),
native D3D11 presentation and WebGPU. `--browser chromium` selects the
Playwright full Chromium build; `--gpu software` retains the older
SwiftShader path. On the delivery machine, Chromium 1194 enumerated the
Intel adapter but failed device creation because its `dxil.dll` was absent.
Edge 153 successfully rendered with WebGPU. `--require-webgpu` prevents an
unnoticed WebGL fallback. Each port uses a separate Vite cache.

The frame recorder seeds incidental browser randomness, advances simulation
and CSS animations on the film clock, waits for GPU work, and snapshots the
camera plus weapon/missile events before their pooled objects are reused.
The JSONL header records resolution, frame rate, backend and time range.
Every following record belongs to the JPEG with the same frame number.
Do not combine independently captured frames with an unrelated event log.

The offline renderer replays this log through `GameAudio.update`, including
gun family, damage type, facing strength and subsystem type. It suppresses
the authored laser/cannon, missile, shield/hull and beam cues that the log
replaces. Script-only fighter kills and cinematic explosion montages retain
their single authored cue track. It rejects incomplete logs. Audio scheduling
uses 1,024-sample blocks at 48 kHz (at most 21.34 ms from the matching frame).

All 19 spoken lines, including Lucan's concourse greeting, must have a
recorded clip, decode successfully and finish inside the caption interval.
The audit is saved as `voice-audit.json`. Neural speech is capped at 1.2×
playback rate, brought forward in the mix, and ducks music and effects.
The recording overlay shows complete captions throughout their intervals,
above the dock interface. Capital turrets visibly traverse before firing;
one drive supplies both the model pose and the projectile origin/direction.
Mounts hold fire while training, outside their arcs or after destruction.
The Cathedral's fixed bow lance follows its heading. Scripted bolts queue
muzzle flashes and audio events. The model test checks 88 barrel tips and
axes across the Indomitable, Cathedral, Valiant and Canticle.

The revised narration explains the Lantern collapse, rival factions,
Ebon-gas, the colonies' dependence on the surviving gates, and Vanguard's
role. See `TRAILER_SCRIPT.md` for the timed narration and cast lines.

The encoder checks frame continuity, uses H.264/yuv420p and stereo AAC at
48 kHz, performs two-pass loudness normalization, fades the last 1.25 seconds
of audio, and moves the MP4 index ahead of the media data (`faststart`).
The QA script checks format, encoded frame count and simulation-clock drift;
it writes `ffprobe.json`, `qa.json`, `av-analysis.txt` and a contact sheet.
Black detection should be reviewed against the intentional opening/closing
fades rather than treated as an unconditional error.

Verification for the change: TypeScript, production build, trailer timeline
tests, model-based gunnery tests and the pooled-event snapshot test. Representative WebGPU frame runs
cover capital subsystem damage, directional shield collapse and the frigate
broadside before the full capture.
