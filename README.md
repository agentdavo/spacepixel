# PROJECT VANGUARD

**Retro OVA cel-shaded space combat for the web** — Three.js (WebGPU renderer,
TSL + hand-written WGSL), TypeScript, Vite.

![Hero shot](docs/screenshots/m03-hero.jpg)

Inspired by 1990s OVA space opera (Macross, Wing Commander): bold ink lines,
hard cel bands, stark rim light, painted nebula skies, and a ship roster that
runs from 17 m interceptors to 2.6 km dreadnoughts. See the
[series bible](docs/LORE.md) for the setting and factions, and the
[roadmap](docs/ROADMAP.md) for milestone status.

## Running

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production bundle
npm run shot -- --jpg --shot 'hero:cam=0&t=3'   # headless screenshots → docs/screenshots
```

Needs a WebGPU browser (Chrome/Edge 113+, Safari 26+, Firefox 141+). Without
WebGPU, three.js falls back to WebGL2 and the ink pass switches to its TSL twin.

### Controls (render test)

| Key | Action |
|---|---|
| `1`–`6` | View: final · raw colour · normals · depth · ink region ids · edge sources |
| `I` | Toggle ink lines |
| `B` | Toggle line boil |
| `C` | Cycle camera shots |

### URL flags

`?backend=webgl` force fallback · `?ink=0` · `?view=edges` · `?cam=2` ·
`?shot=1` deterministic capture mode · `?t=3` start time · `?hud=0`.

## Rendering pipeline

```
scene pass ──MRT──► output  HDR cel colour
                ├─► gbuf    view normal (rgb) + linear depth in km (a)
                └─► ink     ink weight, hashed region id, haze factor
      │
      ├─ ink edges ─ WGSL on WebGPU (src/render/post/shaders/inkEdge.wgsl.ts)
      │              TSL twin on WebGL2 (inkEdge.tsl.ts)
      ├─ aerial haze on inked surfaces (sells km-scale capital ships)
      ├─ ink composite (distant lines fade into haze)
      ├─ bloom from emissives only
      ├─ tone map → vignette + film grain
      └─ FXAA
```

**Ink edges** combine three sources:
1. **Silhouettes** — Laplacian of *inverse* linear depth. 1/z is linear in
   screen space for planes, so flat plating never fires at any angle; the
   response is normalised so a fighter and a dreadnought get identical line
   weight. Only the near side of a depth jump is inked.
2. **Creases** — normal discontinuities.
3. **Regions** — hashed per-part ids from the ship builder, which gives
   mechanical panel lining with no extra geometry.

A stepped-clock noise wobble ("line boil", 12 Hz — animating on twos) makes the
lines shimmer like hand-traced cels.

**Cel material** (`CelMaterial`): banded ramp lookup on half-Lambert, coloured
shadow tint from the system's light rig, hard specular glints, rim light
masked toward a rim source, canopy streaks, vertex-driven emissives.

## Asset pipeline

Ships are **data**: a `Blueprint` lists parts (lofted chamfered hull sections,
wings, cylinders, domes, tori) with paint slots, mirror flags and region
groups, plus engine mounts and hardpoints. `buildShip()` compiles a blueprint
into a single merged mesh (one draw call per hull) with per-vertex paint and
surface data, engine plume meshes and hardpoint sockets. Liveries come from
the faction table, so any design can be repainted. glTF models can be
imported through `AssetLibrary.loadModel()`, which converts their materials to
the cel look.

## Layout

```
src/
  core/      Engine loop, flags, event bus
  render/    renderer factory, light rig, materials, post pipeline + WGSL
  assets/    blueprint types, hull kit, ship builder, factions, blueprints
  world/     painted backdrop, planets, scenes
  ui/        HUD overlay + CRT styles
scripts/     headless screenshot harness (Playwright + SwiftShader WebGPU)
docs/        lore, roadmap, screenshots
```
