# PROJECT VANGUARD: THE LONG DARK

**Retro OVA cel-shaded space combat for the web** — Three.js (WebGPU renderer,
TSL + hand-written WGSL, compute particles), TypeScript (strict), Vite. No
image or audio assets: every ship, sky, portrait, sound and note of music is
generated.

![Hero shot](docs/screenshots/m03-hero.jpg)

Four hundred years after the Shattering broke the galaxy's gate network,
the Terran Directorate and the Zenith Hegemony fight a slow war over
Ebon-gas — the black-light isotope that keeps six relit Lanterns burning.
You fly Vanguard, the squadron that goes through first. And beyond a gate
that leads nowhere, something is counting down the primes.

- Series bible: [docs/LORE.md](docs/LORE.md)
- Campaign (20 episodes, 4 chapters): [docs/CAMPAIGN.md](docs/CAMPAIGN.md)
- Milestones: [docs/ROADMAP.md](docs/ROADMAP.md)

## Running

```bash
npm install
npm run dev            # http://localhost:5173 — title card → campaign
npm run build          # typecheck + production bundle
npm test               # campaign runner + all 20 missions (node:test)
npm run ai-sim         # headless dogfight/formation/station sim with pass/fail numbers
npm run econ-sim       # trade-route balance on the seeded Reach (profit per hold, pass/fail bands)
npm run perf           # frame-time budgets (meaningful on real GPUs only)
npm run shot -- --jpg --shot 'hero:cam=0&t=3'   # headless screenshots
```

Needs a WebGPU browser (Chrome/Edge 113+, Safari 26+, Firefox 141+). WebGL2
still runs (TSL ink twin), but compute particles are disabled there.

## Controls

| | |
|---|---|
| Mouse / arrows | steer (virtual stick) · gamepad supported |
| Q / E | roll |
| W / S · X | throttle · kill throttle |
| Shift | afterburner |
| J | cruise drive (3 km/s) |
| Z | flight assist on/off (Newtonian) |
| Space / LMB | guns |
| F / RMB | micro-missile salvo (needs lock) |
| T | next target |
| 1–4 | wing orders: form up · attack my target · engage at will · cover me |
| Tab | tactical view (battle at ¼ speed) |
| V · K | camera shots · cinematic auto-cutaways |
| M | star map (click a system to plot a route) |
| G | request docking within 5 km of a station / friendly carrier (again to cancel) |
| L | codex / archive |
| N | mute |
| F3 | dev panel (perf graph, latency) · F1–F6 G-buffer views |

## Docking & trade

Every system has 1–3 stations (seeded): Lantern refineries, fossil-salvage
yards, military bastions, free ports and orbital ports with a landing
tether down to the planet; friendly carriers dock at their bow hangar. Press
**G** within 5 km (no hostiles within 10 km, standing above −50), fly the
ILS corridor, and guidance takes the ship under 1 km (OVA cutaway, iris to
the berth). Docked: buy/sell eight commodities (prices from station type,
faction, slow drift and your own market pressure), repair, rearm missile
rails, read the rumour ticker, launch (**Enter**). Keys on the dock screen:
↑↓ select · →/B buy · ←/V sell · Shift ×5 · R repair · E rearm. Shares,
cargo, standing and rails persist in localStorage. Captures:
`?scene=flight&dock=approach|auto|docked|launch[&station=<id>][&cargo=demo]`.
Pure economy + tests: `src/game/economy.ts`, `tests/economy.test.ts`.

Bays are real hollow recesses (collar, dark liners, frame ribs, deck lights
running inward, a lit berth door) behind a faint atmosphere curtain that
ripples where the ship crosses it; the auto-dock cuts from a tracking shot
to the mouth to the inside of the bay. Wingmen break off to hold points
outside the corridor while you dock and re-form when you launch. Campaign
episodes lock docking out unless the mission sets `allowDocking`.

**Balance.** A safe run earns about 1.5–4k sh a hold (a fresh pilot's first
run, capital-bound, ~1k); the fat margins (up to ~8k) are in contested and
Hegemony space and the Null Lantern's shadow, where markets pay hazard
premiums. Per-commodity pressure means a hold of one good sells badly —
mix the hold. `npm run econ-sim` prints the best routes and asserts the
bands (`src/game/econSim.ts`, `tests/econ-sim.test.ts`).

**Collisions.** Hulls are solid: fighters are spheres, stations and capital
ships get a few dozen proxy boxes / cylinders / rings built from their
blueprint parts (spinning rings ride their joint). Hits bounce and scrape
(damage from closing speed, sparks, camera shake); fast movers are swept
so nothing tunnels at cruise. AI avoidance steers round the same proxies
(`src/sim/Collision.ts`, `src/sim/CollisionProxies.ts`,
`src/world/HullCollisions.ts`, `tests/collision.test.ts`).

![Docked](docs/screenshots/dock-screen.jpg)

## Scenes (`?scene=`)

`flight` (default game) · `showcase` · `hangar` (model sheets) · `paint`
(livery editor) · `spatial` (depth cues) · `dogfight` (AI demo) · `fx`
(particles) · `setpieces&piece=monolith|megagate|derelict|nebula|bastion|pilgrimage|…`
· `comms` · `audio` · `prologue` (the ~60 s cold open; `&t=SECONDS` seeks,
loops as an attract reel). Add `&episode=N` to `flight` to jump into a
campaign episode.

**Prologue.** A new profile sees the cold open once before Episode 1 (skip:
Space / Esc / click); it is also on the title menu, and plays by itself when
the title is left idle. Shots are plain data in `src/cinema/prologue.ts`, run
by a small sequencer (`src/cinema/`): keyframed or rig-tracked cameras in km,
postFx envelopes, captions, music / SFX / stage cues — all pure functions of
time, so any frame can be seeked and screenshotted.

![Prologue](docs/screenshots/prologue-2-shattering.jpg)

**Shipyard.** 28 hull designs. The Vanguard progression line runs T1 Kestrel
(17 m) → T2 Super Kestrel → T3 Gauntlet heavy fighter → T4 Bulwark gunship
(56 m) → T5 Resolute corvette (177 m, crew 20) → T6 Valiant light frigate
(380 m, flown from the bridge). Alternates come from other yards: the Hegemony
Seraph at high standing, and the Rustwake Knuckleduster and Scrapjack. Also:
Rustwake Gaff harpoon raiders, Bulldog gunboats and the Mother Lode
hauler-carrier; civil traffic (Swallow courier, Tallow mining barge, Longhaul
freighter, Umbra Ebon tanker, Meridian Star liner); and line warships (DDG-40
Arbiter, Hegemony Canticle). Prices, tiers, crew, hardpoint layouts and stat
hints are data in `src/game/shipyard/catalog.ts`. Handling and camera
distance scale with hull size (`src/game/shipyard/flight.ts`). To view them:
`?scene=hangar&cam=6..11` (scale charts with captions),
`?scene=hangar&ship=<id>` (four-view model sheet), and
`?scene=dogfight&ship=<id>` (fly it; `&bridge=1|0` forces the bridge camera
on or off).

![Shipyard](docs/screenshots/ships-progression.jpg)

## How it's built

**Rendering.** A scene pass writes an MRT G-buffer (HDR cel colour; view
normal + linear depth in km; ink weight + region id + haze). A hand-written
WGSL kernel draws the ink: inverse-depth Laplacian silhouettes (flat plating
never fires, line weight is scale-invariant), normal creases, and region-id
panel lines, with 12 Hz "line boil". Then aerial haze, emissive-only bloom,
tone map, grade, speed lines / chromatic focal distortion, FXAA. Dynamic
resolution holds the frame budget.

**Space.** Universe positions are float64 on the CPU; the GPU only ever
sees camera-relative coordinates (`WorldSpace`), so a 3 km dreadnought
2,600 km from the origin — or a moon-sized sphere 30,000 km away — doesn't
jitter. Space dust, asteroid belts and haze lanes give parallax and speed.

**Simulation.** Every ship — player, wingmen, enemies, capitals — flies the
same `FlightModel` from the same `ControlState`; only the writer differs
(input vs AI). The ship responds on the frame the input arrives; only the
camera lags. Plain arrays and functions: `Fleet`, `Weapons` (swept-sphere
bolts, tracking beams), `Missiles` (proportional navigation + Itano
spirals), `Capitals` (flak, lances, hangars), `ai/*` (behaviour selection,
maneuvers, formations, turrets).

**Story.** Missions are data (`src/game/campaign`), run by
`CampaignRunner` (tested) through a small host adapter: story roles →
teams (renegades, defectors, provokable neutrals), plot armour, script
cues, escorts, dwell zones, set pieces, radio chatter with procedural
anime portraits, codex unlocks, eyecatches and debriefs.

**Sound.** Web Audio synthesis only: faction weapons, explosions, engine and
jump loops, lock tones, radio; a generative OVA-style score with moods that
follow the fight and the story.

## Layout

```
src/
  core/      engine loop, input, perf, floating origin, flags
  render/    renderer, light rig, cel/glow materials, ink pipeline + WGSL
  assets/    blueprint format, hull kit, ship builder, 28 designs
  sim/       flight, fleet, weapons, missiles, capitals, cameras, ai/
  fx/        WebGPU compute particles, trails
  world/     sky, planets, gates, dust, asteroids, set pieces, scenes
  universe/  seeded Meridian Reach + special locations
  game/      campaign data, runner, session, missions, profile
  audio/     synthesis engine, SFX, generative music
  ui/        HUD, star map, comms, codex, eyecatch, screens
  cinema/    cutscene sequencer + the prologue (shots, sets, overlay)
tests/       node:test suites (runner + campaign data)
scripts/     screenshots, perf, AI sim, audio render (headless)
docs/        lore, campaign, roadmap, screenshots
```
