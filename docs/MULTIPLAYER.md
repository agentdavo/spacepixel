# Multiplayer — design note

Goal: the Meridian Reach as a shared, persistent space (hundreds of pilots
per system, thousands across the Reach) without giving up the thing the
single-player game is built on: **your ship responds on the frame the input
arrives; only the camera lags.**

This is a plan, not code. Each step has pass/fail numbers, the same as the
renderer budgets.

## What we already have

- Every ship (player, wing, enemy, capital) flies the same `FlightModel`
  from the same `ControlState`; only the writer differs (input or AI). A
  networked pilot is a third writer.
- The sim is plain TypeScript arrays and functions with no DOM, so it can
  run in Node/Bun on a server unchanged.
- Combat already comes out as event arrays (`weapons.events`,
  `missiles.events`), which are what a server broadcasts.
- Universe positions are float64 with a floating origin. Wire formats
  quantise relative to a km cell, so precision never depends on where in
  the Reach the fight is.
- Lantern jumps play a tunnel for several seconds, which hides the
  handoff between system shards.

## What has to change first (MP-0, single-player visible)

| Change | Why | Pass/fail |
|---|---|---|
| Fixed 60 Hz sim step, render interpolates | variable `dt` makes sims diverge | same inputs → bit-identical state after 10 min (`npm run ai-sim --determinism`) |
| Seeded RNG per system/entity, no `Math.random` in `src/sim` | reproducible turrets, spreads, AI | lint rule: zero `Math.random` in `src/sim` |
| Sim state separate from render objects | server has no `Object3D` | `src/sim` imports nothing from `three/webgpu` |
| Input as timestamped `ControlState` frames | prediction + replay | replays of recorded sessions match to the bit |

These pay off offline too: replays, a kill-cam, and trailer capture from
recorded input.

## Topology

- **One authoritative process per star system** (a "shard"). 22 systems
  means 22 shards, and busy ones split by km cells. This is EVE's
  solar-system node model, and our lore already treats systems as separate
  islands joined only by Lanterns.
- **Lantern jump = shard handoff.** The client spools and enters the
  tunnel. The source shard serialises the ship and pilot state, and the
  target shard accepts it and spawns the ship at the exit. The tunnel
  hides the 1–3 s transfer.
- **Time dilation** for huge battles: the shard slows its sim clock, down
  to a floor of 0.25×, instead of dropping ticks. The tactical view
  already runs battles at ¼ speed, so this is a mechanic players will
  recognise, and the lore can call it Ebon-gas field drag.
- Campaign episodes stay single-player, or co-op for up to 4 through a
  private instance of the same shard code.

## Netcode

- **Transport:** WebTransport datagrams for snapshots and input, plus a
  reliable stream for chat, trade and events. WebSocket is the fallback.
- **Server tick** 30 Hz, snapshot rate 20 Hz, input sent every frame
  (redundant last 3 frames per datagram).
- **Own ship:** client-side prediction from local input, then
  reconciliation against the server's acked state (rewind + replay the
  input buffer). Corrections under 1 m are blended over 100 ms; larger
  ones snap during a camera cut or a flash.
- **Other ships:** interpolated 100 ms behind, with velocity extrapolation
  for up to 250 ms on loss.
- **Hits:** bolts are simulated on the server with lag compensation (the
  shooter's view is rewound up to 200 ms). Missiles and beams are
  server-owned entities.
- **Interest management:** a 10 km grid. Full-rate updates within 10 km,
  reduced rate out to 50 km, capitals and stations system-wide, and
  everything else as blips on the star map.
- **Quantisation:** positions as 1 km cell id + 16-bit fraction (1.5 cm),
  orientation as smallest-three 10 bits each, velocity 16-bit/axis;
  about 18 bytes per ship per snapshot before delta compression.

### Budgets (pass/fail)

| Metric | Target |
|---|---|
| Own-ship input → response | 0 frames (predicted) |
| Remote ship visual error at 150 ms RTT | < 2 m typical, < 10 m in hard manoeuvres |
| Downstream at 50 ships in 10 km | < 64 kbit/s |
| Server tick at 200 ships + 2,000 bolts | < 8 ms (Node, one core) |
| Jump handoff | < 3 s, fully inside the tunnel |

## Persistent world

- Profiles, credits, cargo, reputation and liveries live on the server;
  the local profile becomes a cache.
- The economy is authoritative. Station supply and demand are driven by
  player trade and faction logistics, so Ebon-gas scarcity is something
  players can cause.
- Faction war: the Directorate and the Hegemony contest systems. Territory
  shifts with fleet actions and supply lines, and the star map shows the
  front.

## Order of work

1. MP-0 determinism (above), plus a replay recorder and player.
2. Headless shard in Node running `src/sim`, with bots as clients (the
   `ai-sim` harness grows into a load test).
3. Two browsers in one system: prediction, interpolation, hits.
4. Jump handoff between two shards.
5. Persistence, trading and chat.
6. Load test: 200 bots per shard, then a public playtest.
