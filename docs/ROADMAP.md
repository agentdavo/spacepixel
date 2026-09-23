# Roadmap

| # | Milestone | Status |
|---|---|---|
| 1 | Project setup, Three.js WebGPU renderer boilerplate | ✅ done |
| 2 | Asset pipeline + cel material base (toon ramps, rim light) | ✅ done |
| 3 | WGSL ink-line edge detection post-process | ✅ done |
| 4 | Player ship physics, inertia, afterburner | ⏳ next |
| 5 | Cinematic chase camera (spring-damper, inertial lag, velocity zoom) | |
| 6 | Camera cutaways & target-lock tracking (missile cam, orbit) | |
| 7 | Interceptors & variable-geometry strike fighters | |
| 8 | Corvettes & heavy strike bombers | |
| 9 | Capital dreadnoughts & fleet carriers | |
| 10 | Lasers, particle beams, impact effects | |
| 11 | Micro-missile swarms & target-lock HUD boxes | |
| 12 | WebGPU compute particle engine (explosions, debris, trails) | |
| 13 | Wingman AI & squadron command | |
| 14 | Enemy AI behaviour trees | |
| 15 | Universe data & multi-system star map | |
| 16 | Jump gates & chromatic-aberration hyperspace transition | |
| 17 | Tactical overhead view & fleet command | |
| 18 | Mission campaign & dynamic objectives | |
| 19 | CRT HUD overlays, menus, briefings | |
| 20 | Performance profiling & final polish | |

## M1–M3 notes

- **M1** — `WebGPURenderer` with reversed-Z float depth (the scene spans
  cockpit bolts to gas giants), WebGL2 fallback, deterministic screenshot mode,
  a compat shim for browsers that shipped the older `swizzle` view-descriptor
  draft.
- **M2** — `CelMaterial` (ramp textures, shadow tint, glints, rim, canopy
  streak, emissive), `GlowMaterial`, per-system `LightRig` presets,
  `Blueprint` → `buildShip()` pipeline, glTF → cel conversion, painted
  nebula backdrop, banded gas giant with shadowed rings.
- **M3** — MRT G-buffer and a hand-written WGSL edge detector (inverse-depth
  Laplacian silhouettes, normal creases, region-id panel lines, line boil),
  aerial haze, bloom, grade, FXAA. Debug views for every buffer.

### Known issues / follow-ups

- WebGL2 fallback lines render slightly softer than the WGSL path. Revisit in M20.
- Capital ships are blockouts. Greebles, turrets and hangar bays come in M9.
