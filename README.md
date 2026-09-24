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
npm run ai-sim         # headless dogfight/formation sim with pass/fail numbers
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

![Docked](docs/screenshots/dock-screen.jpg)

## People, voices & subtitles

**Voices.** Every speaking character has a procedural voice (`src/audio/voice`):
a planner turns the line into syllables and phoneme-ish segments — vowels as
formant targets, consonants as frication / bursts / nasals, a phrase melody
that falls, rises on questions and sings the Hymn in prime intervals — and a
small Web Audio graph (glottal pulse → formant bank + noise) renders it
through a radio band + squelch for comms, a room for people in person, or a
warm hall for the prologue narrator. It is English *shaped*, not English:
OVA radio chatter in an invented cadence, and it renders offline
(`node scripts/audio-render.mjs --only voice-radio,voice-prologue`). Cast
voices are hand-tuned; everyone else gets a stable voice from a seed.
Optional real speech (Web Speech API) with per-character voice picks.

**Subtitles.** One timing model (`src/ui/subtitleTiming.ts`: ≤ 15 chars/s,
hold covers the voice, lines never overlap) drives the comms panel, the
prologue's captions (now voiced by a narrator keyed to them), station
conversations and cutscenes; the typewriter follows the voice. Optional
Japanese second line where the script has one.

**Settings (anywhere):** **F7** voice synth / speech / off · **F8** subtitle
size S / M / L / off · **F9** Japanese line on/off. URL: `?voice=`, `?subs=0`,
`?subsize=l`, `?jp=0`.

**Concourse.** A dock tab (`src/ui/Concourse.ts`, key 2) with the 2–4 people
at the station: fourteen recurring named people who travel the Reach on
their own schedules (a bartender whose bar moves with her, a Graveyard
breaker, an engine-warden on circuit, a Tey of *that* Tey, a grounded Cantor,
a Continuity auditor, a refugee with a letter…) and locals who rotate with
the play clock. Conversations are data (`src/dialog/conversations.ts`) run by
a pure engine (`src/dialog/engine.ts`, `tests/dialog.test.ts`): conditions on
flags / standing / shares / cargo / episode; effects that trade, move
standing, unlock the codex, fill a notebook of rumours and trade tips, and
offer contracts or hires through `dialogHooks`. Several change as the
campaign advances. Captures:
`?scene=flight&dock=docked&docktab=concourse&talk=odile&talkpath=0`.

**Barks.** In flight, wingmen call splashes, hits, missiles and losses;
Cantors taunt on the open band; passing traffic hails — all voiced,
subtitled and rate-limited (`src/dialog/barks.ts`, `FlightRadio.ts`;
`?radio=0` for a quiet HUD; `?bark=<kind>` fires one for captures). Station
control talks you down the docking corridor in the cutaway's letterbox.
Listen: [docs/audio/voice-radio.wav](docs/audio/voice-radio.wav) ·
[docs/audio/voice-prologue-opening.wav](docs/audio/voice-prologue-opening.wav).

![Concourse](docs/screenshots/people-concourse-lucan.jpg)

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
  assets/    blueprint format, hull kit, ship builder, 11 designs
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
