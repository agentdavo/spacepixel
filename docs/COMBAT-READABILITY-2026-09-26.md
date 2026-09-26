# Combat readability follow-up — 26 September 2026

The first EP04 convoy fight now has brief, explicit player and selected-target feedback for shield absorption, shield bleed into the hull, shield collapse, and direct hull hits. A collapse remains readable for 1.4 seconds through subsequent shield sparks. Labels copy the real event payloads, include the struck facing when known, and keep missile interceptions from becoming false target-hit confirmations. This is presentation only; the simulation and damage rules are unchanged.

The approved mission-cue revision from `d10650ac5ce0daa11567750d9da7872fc58e8248` is a prerequisite for the improved capture. Its local cherry-pick is `5b18582`; integration should take **only the combat follow-up commit** when the original voice commit is already present. No audio engine, weapon sound, Comms, episode or recorded-voice implementation is changed by the combat follow-up.

## Priority and observed evidence

1. **Make damage states readable during impact.** At 49.03 seconds the original HUD has bars but no immediate impact-state wording, while a bright shield flash occupies the player silhouette. Two compact, dark-backed lines now show `YOU · FORE SHIELD DOWN · HULL HIT` and the corresponding selected-target state. At 48.63 seconds the player line is `SHIELD ABSORBED`; at 50.73 seconds it is `HULL HIT`. Neither line covers the 720p dialogue panel. Target identity remains the normal replay lock, Marsh Tanker 1.
2. **Get the objective instruction through the fight.** The original Magpie raid clip starts at 44.933 seconds and finishes its recorded speech at 50.819 seconds. The approved replacement starts at 43.350 and finishes at 48.425. The first player shield hit is at 48.583: the new instruction ends 0.158 seconds before it, compared with 2.236 seconds after it previously. The first convoy-target impact is earlier, at 48.300, so this is not a claim that speech precedes every impact. SYSTEM remains the existing procedural voice; Magpie plays the recorded cast at 1×.
3. **Verify the mix without speculative gain changes.** The captured weapons, engines, alerts, music and actual timed cast/procedural speech were rendered through shipping Web Audio in default stereo/full mode. Both 22-second excerpts have zero samples at or above 0.999, peak approximately −3.95 dBFS, and a maximum of 36 pooled SFX voices against the configured 40. No concurrent speech start was found across the nine observed cues through 60 seconds. This fixture did not establish a reason to alter weapon levels, ducking, or spatial routing.

The explicit `shield-bleed` event at 57.800 seconds coincides with a collapse. The image at 57.93 therefore correctly retains the higher-priority `SHIELD DOWN · HULL HIT` cue. A separate, non-collapsing bleed label is covered by automated event tests, not claimed as a separate native scene from this tape.

| Evidence | Native frame |
|---|---|
| Matched baseline, collapse flash | [49.03 s](reviews/combat-readability-2026-09-26/baseline-49s.jpg) |
| Improved, absorption | [48.63 s](reviews/combat-readability-2026-09-26/absorbed-48_63s.jpg) |
| Improved, collapse and hull spill | [49.03 s](reviews/combat-readability-2026-09-26/improved-49s.jpg) |
| Improved, direct hull hit | [50.73 s](reviews/combat-readability-2026-09-26/hull-50_73s.jpg) |
| Improved, bleed with collapse | [57.93 s](reviews/combat-readability-2026-09-26/bleed-collapse-57_93s.jpg) |

## Validation and source

Base: `a38865a`. Shared fixture: preserved `convoy-probe-1/take.vgr`, seed 1994, 100-second ordinary-input EP04 tape from the accepted V4.1 source `2d8d559`. Both captures replay the first 60 seconds from tick zero. No pose, damage, mission flags, or input writes occur. The selected camera and target are the tape's normal player view.

- **60/60 replay world checks pass** in each run; no desync or browser page errors.
- All **323 weapon events**, **1,800 audio frames**, and all 60 world hashes are identical before/after.
- **12 targeted tests pass**: feedback event ordering, pooled-value copying, independent targets, cue expiry/rewind, missiles/interceptions, all-catalogue hull/weapon contact matrix, combat audio truth, spatial panning and existing HUD layout checks.
- Typecheck and production build pass, including campaign and expansion validation. Existing test/check helpers emit a nonfatal Vite port-24678 warning when another development server is active.
- Source fingerprints, tape hash, numerical mix results and artifact hashes are in [evidence.json](reviews/combat-readability-2026-09-26/evidence.json). Improved source includes the uncommitted combat presentation patch whose exact file hashes are recorded there; the baseline's pre-change source is recorded separately.

Native hardware reported by the browser: **Intel, architecture `xe-lpg`, WebGPU**, Microsoft Edge 153 on Windows. Viewport 1280×720, simulation 60 Hz, rendering stepped at 30 Hz, review images sampled at 10 fps. These captures are not a real-time performance benchmark. Both native browser processes were closed and the GPU slot explicitly released to the rendering owner.

The audio render restores ship identity from the independently logged tick events before replaying the JSON snapshots, preserving GameAudio's bleed/primary-hit de-duplication. It retains the full 0–60 second mix history before exporting 38–60 seconds, using 48 kHz stereo and scheduling in 512-sample blocks (maximum scheduling quantisation about 10.7 ms). Unlogged UI radio clicks/stingers are not reconstructed. This is measured digital output, not a listening assessment; physical speaker placement and physical 5.1 remain unverified. Existing stereo, headphones/HRTF, 5.1 routing and stereo fallback are unchanged.

## Reproduction and ownership

Run from this worktree, with an available native GPU slot:

```powershell
node scripts/combat-readability-capture.mjs --tape 'C:/Users/David(J)Smith/.codex/worktrees/vanguard-v41-capture/spacepixel/scratchpad/delivery/v4.1/convoy-probe-1/take.vgr' --out scratchpad/combat-readability/new-take
node scripts/combat-readability-mix.mjs scratchpad/combat-readability/new-take
```

The capture harness uses shipping VoiceBox on an offline context for the real clip duration and subtitle reveal, logging requests and stops. Sound is rendered separately because wall-clock sound during frame-stepped screenshots would drift from simulation time. Mix rendering uses a browser with `--disable-gpu` and does not require the native slot.

Preserved local outputs are under `scratchpad/combat-readability/{baseline,improved}/`: `evidence.json`, `provenance.json`, 220 JPG frames, `mix-audit.json`, `mix.wav`, and the 22-second `review.mp4`. Large media remain ignored; selected stills and compact proof are tracked.

Runtime ownership is limited to `CombatFeedback.ts`, `CombatHud.ts`, and the approved single `FlightScene` adapter passing missile events to `combatHud.consume`. Preserve the independently owned mission-navigation and persistence changes when integrating that line.
