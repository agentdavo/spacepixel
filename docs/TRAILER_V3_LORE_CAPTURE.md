# V3 lore and flight capture handoff — 25 September 2026

Completed 57 seconds / 1,710 unique frames at 1280×720, 30 fps. These are supporting shots for the trailer editor, not a completed film. The chief accepted the opening composition and living-route HUD proof. The trailer owner retains combat, bridge/bow controls, fighter action, final sound and encoding.

All files below are under `scratchpad/delivery/v3/` in the trailer worktree. Every take has original JPEG frames, `events.jsonl`, `take.vgr`, `provenance.json`, `replay-status.json`, `capture-audit.json` and a silent H.264 MP4 preview.

| Take directory | Source frames | Source time | Duration | HUD |
| --- | --- | --- | --- | --- |
| `lore-gate-take-1` | 0–539 | 0–18 s | 18 s | Hidden for wide opening |
| `lore-wreckage-take-1` | 0–359 | 0–12 s | 12 s | Actual flight HUD |
| `lore-living-take-1` | 0–449 | 0–15 s | 15 s | Actual flight HUD and traffic |
| `lore-gate-tail-1` | 540–899 | 18–30 s | 12 s | Hidden for later return |

The machine-readable `lore-pack-handoff.json` preserves paths, source offsets, audits and shared world checkpoint comparison. **The gate return starts at frame 540 / source second 18, including its audio-event indices.** The return was captured in a fresh run from the same initial seed/query/input plan; all 18 shared one-second world checkpoints match the opening. It contains unique later frames. Record-mode replay status is not a replay playback test.

## Source and staging

The living route was captured from `d9ee7f0` plus the exact working source hashes recorded in its provenance. It uses the existing `reach=lane&traffic=1` setup, native traffic scheduling, normal FlightScene and stock fighter. Keyboard X stops the initial drift, W resumes a gentle approach, and A/D briefly steer. Input consumption is verified across 900 ticks.

The gate and wreckage captures use `2e89a81` with exact source hashes, including `loreFlightSetup.ts`. Native Edge D3D11, WebGPU, actual GPUDevice and queue are recorded in their provenance. The earlier living take used the same native browser/backend path but predates the additional per-take GPUDevice metadata assertion.

These two locations are **disclosed staged lore views**, not literal EP01 campaign captures. EP01 currently labels generic Wreckage as its great ring; that setpiece does not implement its `shape: ring` parameter. The agreed capture setup instead assembles the existing LanternGate and unchanged Wreckage assets once before the first tick:

- Gate radius 6,000 m, disabled event surface; original pylon lamps retained.
- Wreckage radius 4,500 m, 600 debris pieces and five native Lantern Guard hulks.
- Initial anchor, player pose, velocity and wing positions are stored in each provenance file.
- Opening/return use a wider chase offset of 210 m and 700 m look-ahead. The wreckage take uses the ordinary chase view.
- After starting, ordinary keyboard inputs drive the stock flight simulation. No post-start ship position, health, shield, damage or death writes occur. Wreckage animates through its existing presentation update.

## Validation and audio

Frame and consumed-input sequences are contiguous across every selected interval. All selected player state samples remain at 110 hull / 70 shield. W/W+roll or W+A/D inputs are visible in the per-tick consumption logs. Gate return carries forward the same earlier inputs without new steering. Both clean gate takes still log the underlying flight/audio state.

The pack supplies 27 seconds of visible gameplay HUD. All four takes retain synchronous audio-frame snapshots, including normal engine state. This quiet flight pack has no player weapon/missile events. `voice=off` means visible traffic radio text is not a newly recorded spoken cue. The production editor owns the score, narration and SFX mix; no human-listening claim is made here.

Silent previews are editorial conveniences. Original JPEGs are authoritative; their full-range colour metadata must be explicitly converted/tagged as appropriate in the final BT.709 trailer encode.

Capture GPU/browser/server resources were released after the gate return. No extra variants are requested. The source setup helper is committed as `7d772e1`; its integration and capture assertions are included in `2e89a81`.
