# Open Horizon implementation ledger

25 September 2026. David authorized starting **U00 through U08**, including fictional languages and player localization. This ledger separates implemented code from production acceptance. The [expansion charter](UNIVERSE-EXPANSION-PLAN.md) remains the design brief.

Original implementation branch: `codex/universe-expansion`, based on isolated rendering Package A. Chief integration takes only the expansion foundation and four review fixes onto the current engine/combat/audio baseline. Package A ancestry is excluded. The original evidence below remains isolated-branch evidence; combined integration results are recorded in `EXPANSION-CHIEF-REVIEW.md`.

## Run and inspect

- `npm run dev -- --host 127.0.0.1 --port 5232`
- `/?atlas=1`: Open Horizon survey atlas, also reachable from the title menu. This path does not create a renderer.
- `/?scene=flight&expansion=pilot`: independent six-system flight prototype. Start at Threshold; use M to plot a gate route and G for normal docking. FIRST CONTACT at a Marches port lists supply agreements and their destinations. Buy cargo in MARKET and deliver it through FIRST CONTACT. Existing flight controls, repair and trade apply.
- Reloading that prototype resumes at its last berth in either the Marches or the Reach. A dedicated prototype berth survives subsequent normal-campaign visits; a first prototype visit starts at Threshold. Cargo, rewards and completion receipts commit together, with delivery refused if persistence fails. Loading the normal campaign still uses the original Reach.
- `/?scene=hangar&ship=pa-skimmer`: inspect a prototype with the existing four-view hangar model sheet. Other IDs are listed below. This avoids depending on the isolated Package A ship-review scene; it is a model inspection, not a stock-fit or art acceptance claim.
- Developer-only `own=<id>` can exercise a stock-fitted prototype in flight; it uses the existing debug ownership mechanism and adds it to that test profile's hangar. Prototype hulls are not yet sold by normal yards.

The flight prototype shares the existing career ledger at its browser origin. It is an explicit development entry point, not an automatic first-contact event inserted into the twenty-episode campaign. The authored expansion's chronology remains after Open Horizon.

## Delivered code

| Milestone | This implementation | Still required before exit |
|---|---|---|
| U00 | Implementation authorization recorded; Nacreans and Oruni are the first pair; existing campaign/Kessen boundaries retained. | Art and language choices can be refined during prototype review. |
| U01 | Typed registries for eight peoples, ten polities, cultures, traditions and twenty organization records; distinct vessel ownership/design contract; expanded rendering/combat/economic identities; neutral first-contact patrols; stable legacy wire indices; content validation; old-ledger migration and backup. | Remaining legacy assumptions in contract characters, equipment makers and dialogue; runtime crew identity; content-pack loading/dependencies; migration of other stores when their schemas actually change. Organization records are initial briefs, not twenty completed character casts. |
| U02 | Eight distinct procedural hull blockouts, registered in blueprint/catalogue systems, with dimensions, roles, stock fitting and prototype liveries. | Anatomy/model sheets, four-view art approval, bespoke station kits, final silhouettes/materials, performance reels and voice direction. |
| U03 | Ten language/register profiles; authored Nacric and Orunic pilot lexicons (24 roots each) and twelve fixed-meaning contact lines per language; interpretation levels; essential meanings always readable; versioned voice asset identity; independent interface/subtitle/contact-language preferences; EN/JA/pseudolocale atlas UI. | 250-root/60-bark pilot targets, grammar/naming review, native voice recordings, complete text extraction, Japanese review, five further translation bundles. English descriptions remain visible in the atlas: this is not a complete Japanese game localization. No new recorded fictional speech is supplied. |
| U04 | Six connected, flyable Marches systems; functioning ports with distinct ownership/markets; pilot traffic; two three-step cargo agreements; real cargo consumption, standing and reward receipts; reload at last berth. | Character-led contact scenes, choices, escorts/combat branches, unique station architecture, recorded ordinary-input playthrough and balancing. The current arcs are economic prototypes, not finished story missions. |
| U05 | Eight-region/192-system atlas using independent stable seeds; route closure support in the pure atlas graph; coarse deterministic economic sample; only six new systems connected to flight. | Full regional streaming, discovery progression, border diplomacy, trade simulation integration and runtime route closures. Atlas sample supply/demand is not yet the live market driver. |
| U06 | Four civil/support and four combat hull blockouts; real sockets, turret joints, shield fitting, and authored capital subsystem positions for the four larger prototypes. | 80–100 production hulls, civilian variety in later traditions, subsystem acceptance sheets, detachable pressure/relay/radiator modules, weapon/doctrine encounter balance. Shared existing weapons/equipment are used now. |
| U07 | Four content-wave manifests and regional anchor descriptions. | Later civilizations' playable ports, fleets, encounters, characters, missions and language assets. Background survey systems are not completed locations. |
| U08 | Build-time content checks, regression tests and GPU-free browser integration checks. | Native device performance, full playthroughs, art/voice/language QA, migration/replay soaks, accessibility review and release acceptance. **Not accepted.** |

The sector atlas contains 192 records: the existing 22 Reach systems and 170 new survey records. The flight prototype contains **28 systems: the original 22 plus six**. These are deliberately different deliverables. Existing Reach objects retain their coordinates, planets, station IDs and gate positions; only an additional border gate is appended at Rustwake in prototype mode.

## Pilot hulls

| ID | Name | Role | Length | Current status |
|---|---|---|---:|---|
| pa-skimmer | Skimmer | Interceptor | 22 m | Twin pressure bodies and steering plane |
| pa-lifeline | Lifeline | Rescue courier | 36 m | Protected rescue chambers |
| pa-basin | Basin | Pressure freighter | 132 m | Four cargo/pressure bodies and service corridor |
| pa-breakwater | Breakwater | Screening corvette | 176 m | Separated pressure bodies and armoured keel |
| mc-flint | Flint | Heavy fighter | 26 m | Stepped compact armour and recessed guns |
| mc-keystone | Keystone | Sample courier | 48 m | Protected ventral cargo keel |
| mc-foundry | Foundry | Industrial freighter | 148 m | Furnace body and lateral mineral vaults |
| mc-bastion | Bastion | Defensive corvette | 200 m | Deep layered citadel |

All are blockouts requiring rendered art review. The catalogue now contains 36 hulls. That does not constitute 36 newly accepted art assets or the planned 84-hull production fleet. New large hulls use the existing shield/subsystem/destruction mechanisms; pressure loss, heat management and biological repair have not been invented as untested special rules.

## Validation and evidence

Reproduce with:

```powershell
npm run check:expansion
npm run build
npm test
node scripts/check-frontier-ui.mjs
```

- 326 regression tests passed, including twelve expansion tests. Existing geometry, sockets, camera framing, turret articulation, shield/damage, fitting, campaign and economy checks remain active; thresholds were not relaxed for the prototypes.
- The production build and content reference checks passed.
- Expansion tests cover malformed/duplicate content, independent seeds, Reach preservation, all atlas destinations reachable, closed-route detours, all ten markets, legacy ledger round-trip, future/corrupt expansion-save preservation, interpretation rules, placeholder consistency, and all six deliveries with duplicate-payment prevention after reload.
- The browser check disables GPU use and rejects WebGPU adapter requests. It exercises 1280 px and 390 px layouts with expanded text, EN/JA selection independence, persistence, eight hull cards, and all eight region selectors.
- The same check instantiates the real FlightScene without creating an Engine/renderer, advances 120 CPU simulation ticks, opens a real Marches dock, completes one supply agreement through keyboard UI, and reloads to the saved berth. Cargo is supplied by an explicit test fixture. This verifies integration, **not** a human-flown journey, visual correctness, audio performance or frame rate.
- No browser page/console errors occurred in the final check.

Final command outputs are stored under [reviews/expansion-foundation](reviews/expansion-foundation/). No new GPU performance result supersedes Package A's failing native performance gate.

The subsequent integration review found four issues in the foundation. [Scoped fix notes](reviews/expansion-foundation/integration-fixes.md) describe issuer ownership, quota-safe primary persistence, future contact-document preservation and actual berth restoration, with focused regression evidence. Generic frontier contracts remain unavailable until local clients are authored; FIRST CONTACT supplies the current pilot agreements.

## Integration boundaries and next production work

The chief's engine direction keeps content pure and application/renderer ownership outside it. This slice follows that boundary: the registries, language data, atlas graph, save parser and delivery rules are DOM/renderer-free. The dock tab is an adapter; the main entry point selects the atlas; FlightScene only chooses the prototype universe and resumes its saved berth. No campaign definition or CampaignRunner change is included.

When integrating with the chief's mission refactor, preserve **both** `check:campaign` and `check:expansion` in the build pipeline. Run the combined-tree suite; the 326-test result applies to this isolated branch, not the later integration checkout.

Next implementation order: finish U01's remaining identity adapters; build bespoke Nacrean/Oruni stations and review the hulls at gameplay scale; expand U03's authored corpora and extracted message coverage; replace the courier-only first-contact prototype with character-led missions and consequential choices. Then extend playable regions in waves. Native performance work and M05/M07 component production must accompany fleet growth. Do not count an atlas record, livery variant or generated sentence as an accepted system, hull or language asset.
