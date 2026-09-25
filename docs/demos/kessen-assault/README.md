# Kessen / capital assault

Two standalone cinematic demonstrations of eight Kessen frames attacking a Choir Cathedral dreadnought:

| Video | Duration | Treatment |
|---|---:|---|
| [Capital assault](kessen-capital-assault.mp4) | 18 seconds | Establishes the capital ship, follows the approach, cuts across the coordinated salvo and hull impacts, then pulls back for the breakaway. |
| [Close attack](kessen-assault-close.mp4) | 12 seconds | Continuous moving camera on the formation, visible barrels, recoil, thrusters and impacts. |

Both outputs are 1280 × 720, 24 fps, H.264 video with stereo AAC sound. The original procedural soundtrack contains engine/thruster wash, staggered gun reports, impact thuds and a heavier rupture at 12 seconds in the scene.

Captured and verified with native Edge WebGPU and an actual GPUDevice. Both runs had zero browser errors and passed original-scale, repeat-seek and visible-barrel alignment checks. The encoded files have 432 / 288 video frames respectively, BT.709 limited-range YUV420 video, and stereo 48 kHz audio. Decoded contact sheets are available for [the cinematic](cinematic-contact-sheet.png) and [the close view](close-contact-sheet.png). Source validation passed all 308 tests and the production build. See [capture.json](capture.json) and [media-validation.json](media-validation.json) for machine-readable results.

The scene reuses the original Cathedral and eight existing Kessen model instances at their normal scale: three Plumbs plus Gauge, Chisel, Anvil, Spanner and Gimlet. The gun-arm pose aims the visible barrel axis at raycast contact points on the capital hull. Camera cuts, formation movement, recoil, projectiles, scars, debris and smoke are authored against an absolute scene clock so captures can seek reproducibly.

This is **staged cinematic action**, independent of the campaign. It does not implement Kessen combat AI, damage balancing, boarding, shield penetration or new campaign events. The capital's emissive strength is reduced on a demo-specific material so its prow does not wash out the mecha. The original shared model material is not edited.

## Reproduction

```powershell
npm run dev -- --host 127.0.0.1 --port 5264
```

Open [the cinematic](http://127.0.0.1:5264/?scene=kessen-assault&cut=cinematic&hud=0) or [the close view](http://127.0.0.1:5264/?scene=kessen-assault&cut=close&t=5&hud=0). The film holds at 18 seconds; reload to replay. Coordinate the shared GPU slot before running the capture harness:

```powershell
node scripts/kessen-assault-demo.mjs --preview
node scripts/kessen-assault-demo.mjs --render
```

The harness requires native Edge WebGPU and verifies that the renderer created a GPUDevice. It rejects browser errors, checks eight original-scale frames, compares direct and repeated-seek poses, and checks gun-axis alignment against each impact point. Raw frames and WAV intermediates are stored in a temporary directory; deliverable MP4s and sampled PNGs are saved here. `capture.json` records the backend, URLs, checks and intermediate location.

Scene implementation: `src/world/scenes/KessenAssaultScene.ts`, registered only under `?scene=kessen-assault`. No campaign, existing trailer, dialogue or audio-engine source is changed.
