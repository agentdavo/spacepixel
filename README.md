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
npm run ai-sim         # headless dogfight/formation sim with pass/fail numbers
npm run balance        # headless combat balance: time-to-kill bands, pass/fail
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
| R | next gun (e.g. Kestrel: pulse laser ↔ autocannon) |
| F / RMB | missile salvo (needs lock) |
| Y | next missile type (micro swarm · heavy torpedo · harpoon) |
| T | next target |
| B | next subsystem on the target (turrets, lances, hangars, engines, shield generator, bridge) |
| 1–4 | wing orders: form up · attack my target · engage at will · cover me |
| Tab | tactical view (battle at ¼ speed) |
| V · K | camera shots · cinematic auto-cutaways |
| M | star map (click a system to plot a route) |
| H | hail the ship under your nose (name, flag, route, manifest) |
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

## Contracts & free flight

Between episodes the Reach stays open. After a debrief (or **CONTINUE — FREE
FLIGHT** on the title) you start berthed at a Directorate station; the next
episode is posted as **PRIORITY ORDERS** on every Directorate board, so the
story continues when you choose (the star map lists it; **P** on the map plots
the nearest Directorate berth).

Docked, tab **2 · CONTRACTS** is the station's board: seeded per station, 10
minutes of free flight per repost, reseeded as your standing climbs and
matched to your ship's tier. Eight kinds, each with a named client (comms
portrait) and an OVA mission-brief card:

| Kind | Work | Paid at | Tier I fee |
|---|---|---|---|
| Courier | sealed case to a station by a deadline (tier ≥ II: interceptors at the far end) | consignee | 520 + 460/jump |
| Cargo haul | 2–12 units loaded into your pod here, delivered there (sell one and it's theft) | consignee | 380 + 340/jump + 10 % of cargo value |
| Escort | see a freighter down a lane to a Lantern or station through 1–2 raids | client | 1,500 |
| Bounty | find a named raider in the wrecks and kill them (and their wing) | client | 2,300 + 300/jump |
| Patrol sweep | fly 3–4 nav points in order, clear what's hiding | client | 1,350 + 280/jump |
| Salvage recovery | survey a wreck or golden-age hulk (dwell), recover its flight core, get clear | client | 1,650 + 300/jump |
| Reconnaissance | hold an observation point in a dangerous system, then break contact | client | 1,900 + 320/jump |
| Faction sortie (rare) | join a Directorate picket flight against a Choir Measure | client | 5,200 + 300/jump |

Tier II ×1.75, tier III ×2.8; standing moves fees −12 %…+25 %. Late or
abandoned jobs cost 30 % of the fee and twice the standing. Up to 5 at once.
Accepted work in the current system runs through the campaign runner
alongside normal flight (objective panel top-right, orange nav diamonds,
**C** tracks the next job and plots its route on the star map); fees are paid
on docking. Keys on the tab: ↑↓ · **A** accept · **D** decline · **T** turn
in · **X** abandon. Pure + tested: `src/game/contracts/`,
`tests/contracts.test.ts`. Captures:
`?scene=flight&contract=<kind>&cphase=board|op|pay|map`.

![Contracts board](docs/screenshots/contracts-board.jpg)
![Escort contract in flight](docs/screenshots/contracts-escort.jpg)

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

## The living Reach

**Planets.** Every system is surveyed on its own seeded stream *after* the
generator and station placement, so lanes, gates, stations and campaign
positions never move: original planets keep name, position, radius and ring
and gain a kind and a look; new planets, moons and landmarks are appended
well clear of everything. One painted shader (`src/world/planets/`) covers
banded gas / ice giants with great storms and ring shadow, height-ramp
terrestrial worlds (contour-band posterisation, Worley craters, caps, two-tone
cloud decks, cyclones), volcanic and burning worlds (glowing crack networks
and lava seas), Lantern-lit worlds (black-light veins) and night-side city
lights on inhabited worlds (from the station data). Landmarks: shattered
moons (tumbling chiselled fragments + rubble), burning worlds, Lantern-lit
worlds. Moons orbit slowly outside rings and station altitudes. Fly into a
ring plane and the disc becomes a place: a wrapping field of ice and rock
chunks thins with height and vanishes in the gaps. Every body has a name and
a line of flavour — on the star map survey panel and the HUD nav.

**Traffic.** Each system has a lane graph (Lanterns, stations, the belt) with
a timetable that is a pure function of the clock (`src/universe/traffic.ts`):
freighters, Ebon tankers, liners, couriers, miners, patrol wings of 2–4.
`src/world/Traffic.ts` materialises the sailings within 24 km (budget 22
ships, nearest first, parked past 32 km) and flies them with the same
FlightModel: slow off the node, lane cruise, slow approach, into a docking bay
or through a Lantern (jump flash; arrivals flash in on the timetable second).
Haulers are neutral (shoot one and it turns); patrols fly their flag and answer
distress calls and hostiles; Rustwake raiders ambush haulers in lawless and
border systems at a deterministic point on the lane — a distress call you can
fly to, with a bounty and standing when you break it. Hull choices are data
(`TRAFFIC_ROLES[role].hulls[flag]`, first id that exists), so civilian designs
drop in without code. Far ships ride the timetable (snapped every 8th frame),
mid-range ones steer every 3rd frame. The star map shows lane volume
(thickness, convoy dots), per-system traffic halos, raider warnings and a
survey panel. Captures: `?reach=body|ring|lane|ambush [&sys=<id>] [&body=<name|index>] [&side=lit|term|night]`,
`?traffic=0` for A/B.

![Castellan](docs/screenshots/reach-gas-giant.jpg)
![Night-side cities](docs/screenshots/reach-night-cities.jpg)
![Ring plane](docs/screenshots/reach-ring-plane.jpg)
![Jump-in](docs/screenshots/reach-jump-in.jpg)
![Raider ambush](docs/screenshots/reach-ambush.jpg)
![Star map survey](docs/screenshots/reach-map.jpg)

## Scenes (`?scene=`)

`flight` (default game) · `showcase` · `hangar` (model sheets) · `paint`
(livery editor) · `spatial` (depth cues) · `dogfight` (AI demo) ·
`combat&stage=capital|shield|smoke|weapons` (damage / shields / weapon
families, `&freeze=S` holds a frame) · `fx`
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

**Combat.** Every design has stats (hull, shields, regen, mass, agility,
speed, signature) and a loadout (`src/sim/Loadouts.ts`): Directorate pulse
lasers and kinetic autocannon, the Choir's hymn pulse and beam-lance, the
Rustwake scattergun; micro-missile swarms, slow heavy torpedoes that point
defence can shoot down, harpoons. Damage types scale against shields and
hull. Capitals carry four shield facings and a voxel hull, so fire lands on
the plating and wrecks the subsystem under it — turrets, lances, hangars,
engines (she drifts), the shield generator (shields gone for good), the bridge
(fire control lost). Fighters take damage by zone: engines lose thrust, a
shot-up wing rolls, a dying ship trails black smoke. Damage is painted on the
cel hull: scorched patches, screentone hatching, glowing craters.
`npm run balance` holds the numbers (Kestrel vs Cantor 3–8 s, a turret to a
wing of four 5–15 s, a capital to a squadron 60–180 s).

![Capital damage](docs/screenshots/combat-capital.jpg)

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
