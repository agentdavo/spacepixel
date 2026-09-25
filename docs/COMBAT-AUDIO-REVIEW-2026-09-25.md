# Weapons, shield impacts and audio review

25 September 2026 · source revision `1a359ec` · review and proposed work

Implementation update: the authorized follow-up is documented in [combat and audio improvements](COMBAT-AUDIO-IMPROVEMENTS-2026-09-25.md). The findings below describe the original reviewed revision, before those fixes.

The combat system already distinguishes directional shields, hull damage, subsystems and several capital death paths. Its biggest presentation problems are disagreement between shield geometry and hit detection, missing or misleading audio events, and too little sonic distinction between light and heavy weapons. Improve those before adding surround output. Stereo is implemented; discrete 5.1 is not.

This review adds evidence and recommendations. Game source was not changed. It complements [the rendering and ship review](RENDER-SHIP-REVIEW-2026-09-25.md).

## Coverage and evidence

- Inspected all 28 registered ship blueprints; all 14 gun specifications, three missile families and the separate capital lance profile; shield/hull/subsystem/ordnance event routing; visual impacts; audio synthesis, voice selection, buses and output.
- Ran 4,860 damage-model checks: 18 weapon profiles × each actual facing of each hull × full, weak (5%) and empty shields. All passed basic facing routing, shield/hull response and finite-result checks. Beams use one 60 Hz damage tick. This is a damage-model matrix, not 4,860 end-to-end flights or visual auditions.
- Probed six shield-shell axes per capital-class hull with short entering segments. All ten capital-class hulls have at least one missed live-shield probe. This remains present at the reviewed revision.
- Ran 78 existing targeted combat, catalogue, shield-shell, subsystem, point-defence, destruction, turret-rig and collision tests: all passed. TypeScript typecheck passed. One test server reported an HMR port conflict without failing the tests.
- Rendered eight stereo scenarios through the real offline GameAudio path. All had zero clipped samples. These are objective signal measurements; no human listening-panel or calibrated loudspeaker assessment was performed.
- Captured four fresh 1280×720 native Edge/WebGPU staged stills. No JavaScript exception was reported; the first capture logged one unidentified resource 404. The standard Chromium screenshot harness instead fell back to WebGL2 and logged shader parser errors, so its images are excluded from visual evidence.
- The native Edge audio probe reported 48 kHz, output channel count 2, maximum channel count 2. Physical 5.1 playback could not be verified in this session.

Evidence: [audit data](reviews/combat-audio-2026-09-25/audit.json), [reproduction script](reviews/combat-audio-2026-09-25/audit.mjs), [audio measurements](reviews/combat-audio-2026-09-25/analysis.json), [audio render log](reviews/combat-audio-2026-09-25/audio-render.txt), [native capture metadata](reviews/combat-audio-2026-09-25/native/evidence.json). Run the reproduction script from the repository root; it writes its output under `scratchpad/combat-audio-review/`.

## Findings, in priority order

**1. High: capital shield contact can be rejected before the shell is tested.**

`src/sim/Combat.ts:581` rejects a segment using the hull's bounding sphere, then tests the larger, offset shield ellipsoid at line 594. A segment crossing a live shield outside that sphere returns no hit. The next segment can already be inside the shell, where the entry test is skipped. The ten affected hulls are listed in the evidence. For example, Lantern Guard has a model radius of 85.61 m but a shield longitudinal half-axis of 117.57 m; its fore and aft probes both miss.

This proves incorrect contact geometry, not universal loss of shield protection: `damageShip` still chooses a shield pool from a later hit position. Symptoms can include a projectile entering the visible shield before contact, losing the proper entry facing or missing a grazing contact. Fix the conservative bound and verify complete bolt/missile trajectories and beam sweeps, including starts inside the shell and facing seams. The existing shell test proves the shield encloses the hull; it does not prove collision agrees with that shell.

**2. High: successful missile interception can sound like damage to the player.**

`src/sim/Missiles.ts:241` emits an intercepted detonation while retaining the intended target. `src/audio/index.ts:419` treats every detonation with a player target as `playerHit`. The audio event interface omits `intercepted` and `shielded`, although both survive the EventTap. Reproductions of an intercepted missile and a fully shield-absorbed missile both request the cockpit hull-crunch sound. This gives the wrong tactical feedback.

Carry interception and actual impact-layer information through the audio interface. Interception gets an external warhead pop; shield absorption gets an explosive shield response; actual hull damage gets cockpit impact. A mixed shield/hull hit should carry explicit damage results rather than infer them solely from `shielded`.

**3. Medium: missile and beam sound selection depends on array order.**

At `src/audio/index.ts:420–423`, the first explosion updates `lastDetonate` inside the event loop. Every later explosion in the same frame sees zero elapsed time and is skipped, despite a budget of three. The reproduction of three simultaneous remote detonations produces one `missileHit` request. A distant, inaudible first event can consume this opportunity.

At lines 323–326, all beam contacts share one 90 ms timer, set before checking audibility. A far-away beam contact preceding a player contact prevents the latter from being submitted. `shield-bleed` has the same global-timer pattern. Rank contacts by audibility and gameplay importance before advancing shared timing, or budget persistent contacts per emitter/target. Player damage needs a reserved priority path.

**4. Medium: capital lances have no firing sound event.**

The capital lance path at `src/sim/Capitals.ts:412` calls `Weapons.fireBeam`, sets its target and cooldown, but does not emit the firing event that pilot guns and fitted beam turrets emit. `fireBeam` itself only allocates/initializes the beam. A capital lance can therefore fire into empty space without a corresponding launch/charge sound; contact sounds begin only if it hits. None of the beam paths has a sound that follows beam duration continuously.

Add a charge cue, attack, sustained emitter sound and release tied to the beam lifetime. Make impact sound a separate contact layer. The source should be audible before it reaches the target and stop when its mount is destroyed.

**5. Medium: many weapon identities are missing from the sound interface.**

The firing interface exposes only `laser | cannon` plus faction timbre. Pulse and heavy pulse use the same sound; autocannon, GU-17 and railgun share another; mass driver, scattergun and scrap/flak guns share the Rustwake cannon sound. Missile audio receives no specification and uses the same launch/hit family for micro missiles, torpedoes and harpoons. Random pitch variation and firing cadence do not provide weight or functional identity.

Shield-hit synthesis also ignores damage type, weapon energy, target size and faction. Remote shield strength changes gain, not spectral character. Hull hits distinguish scorching, kinetic impact and explosive crunch, but beam contact uses one sound and player hull contact replaces the damage-type distinction with one heavy crunch. Pass stable weapon/material/energy descriptors to sound design without copying simulation logic into the audio layer.

**6. Medium: small-ship visual shields and hit volumes differ.**

Non-capital hit detection uses a sphere (`src/sim/Combat.ts:557`), while presentation projects hits onto a fitted ellipsoid (`src/world/ShieldGeometry.ts`). Bare-hull bolt particles are projected inward from that shell, while non-capital beam burns use the raw contact position (`src/world/CombatFx.ts:270–339`). This can separate beam scorch from the visible skin. Agree on a measurable collision/aim-assistance margin and one contact-point policy for bolts, beams and missiles.

The related catalogue classification issue remains: Resolute, Tallow, Longhaul and Umbra specify four facings but create two. Their shield/subsystem response cannot be treated as equivalent to the four-facing ships. See the companion ship review and the per-hull table below.

**7. Medium: the combat test scene is unsuitable for a combined live sound/flash sign-off.**

`CombatTestScene` does not call `GameAudio.update`; its weapon/impact stages exercise visuals without matching live combat audio. Its `update` also calls `visuals.consume()` when frozen, repeatedly consuming the final tick's events. Frozen stills can accumulate repeated flashes/ripples and exaggerate their brightness. Correct that diagnostic behavior before using freeze captures to judge bloom or event density. The supplied stills establish effect presence and shape, not normal live flash intensity.

**8. Design issue: player damage loudness follows the cinematic camera.**

Player gunfire is deliberately non-spatial, but shield/hull hits and shield collapse are attenuated from the camera eye. Moving the camera away can make vital damage feedback much quieter. Preserve a cockpit/ship feedback layer at stable level, with a separate spatial external impact. Keep source direction readable during camera cuts, tactical view and capital bridge views.

## Weapon-by-weapon sound direction

These are proposed sound identities, not claims that the current render has been subjectively auditioned.

| Weapon(s) | Current firing identity | Proposed distinction |
|---|---|---|
| Pulse laser | Concord laser | Tight electric snap, short descending body; clear repeated transients |
| Heavy pulse laser | Same Concord laser | Slower, lower body and stronger attack; controlled tail |
| Autocannon | Concord cannon | Dry mechanical chatter and light casing-like texture |
| GU-17 cannon | Same Concord cannon | Deeper single report with short recoil mechanism |
| Heavy railgun | Same Concord cannon | Brief charge, sharp crack, metallic decay; unmistakable low-rate shot |
| Hymn pulse | Choir laser | Retain crystalline/inharmonic identity, with a short choral ring |
| Choir battery | Same Choir laser | Lower register, broader body, tightly defined burst rhythm |
| Beam-lance | Choir laser attack + contact ticks | Short charge, continuous electrical/choral body, clean release |
| Great lance | Same Choir laser attack + contact ticks | Larger lower-register body, longer charge, restrained bass |
| Capital lance | No firing event; contact only | Threatening charge audible at source, sustained beam, distinct shutdown |
| Scattergun | Rustwake cannon | One chunky blast per trigger with a brief pellet spray texture |
| Scrap flak | Same Rustwake cannon | Rattling burst with separate interception pops |
| Flak cannon | Same Rustwake cannon | Heavier blast than scatter, short fragment decay |
| Directorate flak | Concord cannon | Crisp mount/burst cadence; avoid dominating nearby player guns |
| Mass driver | Rustwake cannon | Heavy low report and mechanical recovery; distinguish from rapid guns |
| Micro swarm | Generic missile launch/hit | Small rail/ejection ticks, brief ignition rush; group dense volleys |
| Heavy torpedo | Same generic missile sounds | Heavy ejection, rising motor, deep detonation with longer body |
| Harpoon | Same generic missile sounds | Metallic launch and clamp/anchor hit; persistent tether cue while active |

Keep a shared vocabulary across targets: kinetic impacts spark/crack; lasers hiss/scorch; harmonic hits ring/arc; explosive hits thump and fragment. Shields answer with an energetic deflection layer, hulls with material damage. Scale the body's register and duration with target/weapon size without simply making every larger event louder. Shield collapse, emitter loss and full generator loss need recognizably different cues.

## Target coverage and impact limits

| Target | Current handling | Review consequence |
|---|---|---|
| Fighters, bombers, small gunships | Sphere contact, fore/aft shield pools, damage zones; some exposed mounts | Reconcile shell and skin contact; preserve positional hit feedback |
| Capital-class ships including legacy corvettes | Fitted shield ellipsoid, directional pools, voxel hull, subsystem hit spheres | Correct early rejection; distinguish shield, plating and targeted component |
| Civilian/neutral ships | Fleet ship damage path; bolts explicitly provoke neutrals | Beam path does not call the bolt's `provoke` helper; review consistent neutral response |
| Exposed turrets, launchers, lances, hangars, engines, emitters, generator, bridge, sensors, reactor | Subsystem routing and destruction events | General `mountBlast` plus extra large/generator layers; needs component-specific clarity |
| Incoming missiles | Bolts/PD can shoot down supported ordnance | Distinguish interception from target damage, visually and audibly |
| Other ships along a missile path | Missile fuze examines its designated target | General obstruction/collateral collision is not provided by this missile path |
| Stations, asteroids, scenery and wrecks | Not in the reviewed ship/ordnance weapon intersection loop | Do not claim universal shootable-world support; environment impacts require explicit collision/event integration |

Faction shield palettes and kinetic/laser/harmonic/explosive visual functions are already implemented. Capitals also get impact decals and beam-cut tracking. Preserve these. Native captures show a readable difference between [shield contact](reviews/combat-audio-2026-09-25/native/shield.png) and [exposed hull](reviews/combat-audio-2026-09-25/native/hull.png); the [collapse stage](reviews/combat-audio-2026-09-25/native/collapse.png) and [weapons stage](reviews/combat-audio-2026-09-25/native/weapons.png) demonstrate broader coverage. Recheck live bloom and silhouette visibility after fixing the frozen-scene issue.

## Mix assessment

The graph provides music, SFX and voice buses; music ducking for speech; a 40-slot SFX pool; distance attenuation and low-pass; camera-relative left/right pan; rear-source muffling; short stereo reverb; master compression, limiting and safety waveshaping. There is no HRTF or speaker-surround renderer. Spatial parameters for one-shots are sampled at trigger time rather than continuously tracking a moving source.

| Offline scenario | Peak dBFS | RMS dBFS | Maximum pooled voices | Clipped samples |
|---|---:|---:|---:|---:|
| Laser examples | -8.7 | -29.6 | 7 | 0 |
| Stereo pan | -4.6 | -26.8 | 3 | 0 |
| Impacts | -4.6 | -28.9 | 3 | 0 |
| Additional damage effects | -3.7 | -26.1 | 3 | 0 |
| Explosions | -4.0 | -26.8 | 2 | 0 |
| Missiles | -10.8 | -30.5 | 7 | 0 |
| Combat mix | -4.2 | -24.6 | 13 | 0 |
| Stress | -2.6 | -13.1 | 40 | 0 |

Stereo pan measurement swings approximately +19 to -19 dB between the channels in its directional phases. It is working. Stress RMS is about 11.5 dB above the combat example and consumes the whole voice pool. Zero clipped samples does not establish comfortable loudness, low fatigue, intelligible dialogue or true-peak headroom. Existing stress scenarios do not cover every new subsystem/capital-death event combination or every gun ID.

Recommended mix changes:

1. Reserve priority for incoming warnings, real player hits, selected-target feedback and radio intelligibility. Batch repetitive remote fire by emitter/weapon/location, not array order.
2. Separate cockpit feedback, external weapons, impacts/explosions, ambience and alerts beneath the existing SFX control. Duck competing external effects gently for critical radio lines; current speech ducking affects music only.
3. Keep attack transients clear, shorten repetitive reverb tails, and leave low-frequency space for torpedoes, capital guns and major failures. SFX reverb currently branches before slot panning/distance filtering, so the wet field is more diffuse than the dry source.
4. Expose persistent master/music/effects/dialogue controls and dynamic-range choices in normal settings. Current saved settings cover voice/subtitles/score; bus sliders live in the audio test bench.
5. Add a combined weapon/target audition scene with selectable weapon, hull, facing charge, distance and listener mode, plus meters for voice drops and bus reduction. Compare normal battle density as well as stress.

## Stereo, headphones and 5.1

**Recommended default: improved stereo.** Preserve the existing inexpensive pan renderer, stabilize player feedback, add weapon identities and correct event scheduling. This reaches the current two-channel device and provides the reference mix for other modes.

**Optional headphones mode:** test HRTF spatialization for external emitters and impacts, keeping cockpit/UI/radio centered and readable. It is a binaural two-channel output, not discrete speaker surround. Moving beam/missile sources need persistent spatial voices. Measure CPU cost and localization on representative browser/device combinations.

**Optional discrete 5.1:** feasible as a separate output graph. A multichannel destination needs sufficient `maxChannelCount`; six explicitly routed channels can be assembled with a channel merger. The existing stereo panners and shared two-channel compressors cannot become a surround renderer merely by setting destination channel count to six. See the [W3C destination definition](https://www.w3.org/TR/webaudio-1.0/#AudioDestinationNode), [compressor definition](https://www.w3.org/TR/webaudio-1.0/#DynamicsCompressorNode), and [channel routing specification](https://www.w3.org/TR/webaudio-1.0/#ChannelMergerNode).

Proposed routing:

| Channel group | Content |
|---|---|
| Front L/R | Music, forward external combat, most ambience |
| Center | Radio/dialogue and important centered cues; avoid overloading it with every impact |
| Surround L/R | Rear external combat, moving fly-bys, restrained ambience/reverb |
| LFE | An optional low-passed send from selected heavy events; retain essential impact body in main channels |

Use a six-channel bus and multichannel-safe dynamics, with linked gain control where required to preserve direction. Retain a predictable stereo downmix and mono compatibility. Do not infer real speaker wiring from the capability count: provide a six-channel identification test and fail back to stereo when the requested output is unavailable. Offline verification must render six channels and export a correctly tagged multichannel file; current render/export code is explicitly stereo. Speaker tests, headphone tests and actual device playback remain required acceptance work.

## Proposed implementation order

1. Correct shield contact/classification and add trajectory regressions; repair missile/beam audio event selection and capital-lance firing events.
2. Build distinct weapon/impact profiles and a live combined audition scene; stabilize player feedback and radio intelligibility.
3. Tune and audition stereo across normal fights, capitals, PD interception and dense swarms; add persistent controls, meters and downmix checks.
4. Prototype headphones spatialization, then discrete 5.1 on supported hardware. Gate surround release on real channel identification and stereo fallback tests.

The next useful deliverable is a trustworthy stereo combat slice where shield absorption, penetration, interception and subsystem loss are unmistakable. Surround should extend that same event model.

## Per-hull audit

The table below records built combat state, before optional outfitting changes. Full numeric results and missed-segment coordinates are in the audit JSON.

| Hull | Actual facings | Stats facings | Combat class | Missed shell-axis probes |
|---|---:|---:|---|---:|
| Kestrel (`vf27-kestrel`) | 2 | 2 | Small ship | Not tested (sphere) |
| Harrier (`vf31-harrier`) | 2 | 2 | Small ship | Not tested (sphere) |
| Cantor (`choir-cantor`) | 2 | 2 | Small ship | Not tested (sphere) |
| Scrapjack (`rw-scrapjack`) | 2 | 2 | Small ship | Not tested (sphere) |
| Warhorse (`sb9-warhorse`) | 2 | 2 | Small ship | Not tested (sphere) |
| Psalter (`choir-psalter`) | 2 | 2 | Small ship | Not tested (sphere) |
| Lantern Guard (`ffc-lantern-guard`) | 4 | 4 | Capital | 2 |
| Vesper (`choir-vesper`) | 4 | 4 | Capital | 2 |
| Hesperus Dawn (`cvs07-hesperus-dawn`) | 6 | 6 | Capital | 2 |
| Indomitable (`bb-indomitable`) | 6 | 6 | Capital | 2 |
| Cathedral (`choir-cathedral`) | 6 | 6 | Capital | 2 |
| Super Kestrel (`vf27s-super-kestrel`) | 2 | 2 | Small ship | Not tested (sphere) |
| Gauntlet (`vf40-gauntlet`) | 2 | 2 | Small ship | Not tested (sphere) |
| Bulwark (`gs12-bulwark`) | 2 | 2 | Small ship | Not tested (sphere) |
| Resolute (`cr5-resolute`) | 2 | 4 | Small ship | Not tested (sphere) |
| Valiant (`ffl3-valiant`) | 4 | 4 | Capital | 2 |
| Seraph (`choir-seraph`) | 2 | 2 | Small ship | Not tested (sphere) |
| Knuckleduster (`rw-knuckleduster`) | 2 | 2 | Small ship | Not tested (sphere) |
| Gaff (`rw-gaff`) | 2 | 2 | Small ship | Not tested (sphere) |
| Bulldog (`rw-bulldog`) | 2 | 2 | Small ship | Not tested (sphere) |
| Mother Lode (`rw-mother-lode`) | 6 | 6 | Capital | 2 |
| Swallow (`civ-swallow`) | 2 | 2 | Small ship | Not tested (sphere) |
| Tallow (`civ-tallow`) | 2 | 4 | Small ship | Not tested (sphere) |
| Longhaul (`civ-longhaul`) | 2 | 4 | Small ship | Not tested (sphere) |
| Umbra (`civ-umbra`) | 2 | 4 | Small ship | Not tested (sphere) |
| Meridian Star (`civ-meridian-star`) | 6 | 6 | Capital | 2 |
| Arbiter (`ddg40-arbiter`) | 6 | 6 | Capital | 2 |
| Canticle (`choir-canticle`) | 6 | 6 | Capital | 2 |
