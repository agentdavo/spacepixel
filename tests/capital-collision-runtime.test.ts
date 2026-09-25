import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('real hull contact: catalog envelopes, located shields/structure, deterministic breakup and bounded wrecks', async () => {
  const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { Group, Vector3 } = await server.ssrLoadModule('three');
    const { Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts');
    const { CapitalCollisions } = await server.ssrLoadModule('/src/sim/CapitalCollisions.ts');
    const { Weapons } = await server.ssrLoadModule('/src/sim/Weapons.ts');
    const { EventTap } = await server.ssrLoadModule('/src/world/EventTap.ts');
    const { GameAudio } = await server.ssrLoadModule('/src/audio/index.ts');
    const { ReplayTake, ReplayCursor, parseReplay } = await server.ssrLoadModule('/src/sim/Replay.ts');
    const { hashWorld } = await server.ssrLoadModule('/src/sim/StateHash.ts');
    const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
    const { MAX_WRECKS } = await server.ssrLoadModule('/src/sim/Destruction.ts');
    const catalogFleet = new Fleet(new Group());
    const shapes = new CapitalCollisions();
    const catalog = [];
    for (const bp of Object.values(BLUEPRINTS) as any[]) {
      const s = catalogFleet.spawn(bp.id, bp.faction, new Vector3(), new Vector3(0, 0, 1));
      if (s.radius <= 60) continue;
      const shape = shapes.bodyFor(s).shape;
      assert.ok(shape.boxes.length > 0 && shape.boxes.length <= 6, bp.id);
      assert.ok(Number.isFinite(shape.mass) && shape.mass > 0, bp.id);
      assert.ok(shape.inertia.toArray().every((x: number) => Number.isFinite(x) && x > 0));
      catalog.push({ id: bp.id, massTonnes: shape.mass, boxes: shape.boxes.length, radius: s.radius });
    }
    assert.ok(catalog.length > 10);

    function impact(speed: number, shields = true, protect = false, stern = false, mixed = false) {
      const fleet = new Fleet(new Group());
      const weapons = new Weapons(fleet);
      const a = fleet.spawn('bb-indomitable', 'concord', new Vector3(0, 0, -3000), new Vector3(0, 0, 1));
      const b = fleet.spawn('bb-indomitable', 'concord', new Vector3(0, 0, 3000), new Vector3(0, 0, -1));
      a.flight.velocity.z = speed; b.flight.velocity.z = -speed;
      if (stern) b.flight.orientation.identity(); // a's bow into b's engine deck
      a.plotArmour = b.plotArmour = protect;
      if (!shields) for (const s of [a, b]) { s.shield = 0; s.combat.dmg.facings.fill(0); }
      const solver = new CapitalCollisions();
      a.flight.position.z = -solver.bodyFor(a).shape.radius - 100;
      b.flight.position.z = solver.bodyFor(b).shape.radius + 100;
      const evidence: any[] = [];
      for (let tick = 0; tick < 3600; tick++) {
        weapons.beginTick();
        for (const s of [a, b]) if (s.alive) s.flight.position.addScaledVector(s.flight.velocity, 1 / 60);
        solver.step(fleet.ships, 1 / 60, (s: any, amount: number, point: any, normal: any, other: any) => {
          assert.ok(point.clone().sub(s.flight.position).dot(normal) > 0, 'actual hull contact normal points outwards after hull rotation');
          if (stern && s === b) assert.ok(normal.z < -0.99, 'unrotated engine deck points aft');
          else assert.ok(normal.z * (s === a ? 1 : -1) > 0.99, 'opposed bows have opposed outward normals');
          const r = weapons.contactHit(s, amount, point, normal, other);
          evidence.push({ id: s.id, amount, hull: s.hull, shield: s.shield, facing: r.facing, hullDamage: r.hullDamage, shieldDamage: r.shieldDamage, sub: r.subsystem?.id, destroyed: r.subsystemDestroyed, cause: s.combat.dmg.structure.death, sections: s.combat.dmg.structure.sections.map((x: any) => x.hp) });
        });
        if (mixed && evidence.length) {
          const gunner = fleet.spawn('vf27-kestrel', 'concord', new Vector3(100000, 0, -100), new Vector3(0, 0, 1));
          fleet.spawn('choir-cantor', 'choir', new Vector3(100000, 0, 0), new Vector3(0, 0, 1));
          weapons.spawnBolt(new Vector3(100000, 0, -50), new Vector3(0, 0, 6000), 1, 10000, gunner);
        }
        weapons.step(1 / 60, true);
        if (evidence.length) break;
      }
      assert.ok(evidence.length > 0, 'real geometry collided');
      return { fleet, weapons, a, b, evidence };
    }
    const minor = impact(10);
    assert.ok(minor.evidence.every(x => x.shieldDamage > 0 && x.hullDamage === 0), 'low-energy contact respects intact shields');
    const absorbed = minor.weapons.events.filter((e: any) => e.kind === 'shield');
    assert.equal(absorbed.length, 2);
    assert.ok(absorbed.every((e: any) => e.hullDamage === 0 && e.shieldDamage > 0 && e.type === 'kinetic' && e.gun === null && e.amount > 0));
    assert.equal(minor.weapons.events.filter((e: any) => e.kind === 'hit').length, 0, 'absorbed contact cannot masquerade as a hull hit');
    function heardLayers(events: any[]) {
      const audio = new GameAudio({ unlockTarget: null }), layers: boolean[] = [];
      audio.sfx.audibility = () => 1;
      audio.sfx.impact = (shield: boolean) => layers.push(shield);
      audio.sfx.playAtRaw = audio.sfx.playRaw = () => {};
      audio.weaponEvents(events, new Vector3(), 1);
      audio.dispose();
      return layers;
    }
    assert.deepEqual(heardLayers(minor.weapons.events), [true, true], 'absorbed collision has shield cues only');
    const penetrating = impact(60);
    assert.deepEqual(heardLayers(penetrating.weapons.events), [true, false, true, false], 'each mixed-layer collision supplies each layer once');
    const severe = impact(180);
    const repeat = impact(180);
    assert.deepEqual(severe.evidence, repeat.evidence);
    assert.ok(severe.evidence.some(x => x.hullDamage > 0 && x.cause === 'structural'), 'collision drives real structural breakup');
    assert.ok(severe.fleet.destruction.wrecks.length >= 2);
    assert.equal(severe.weapons.events.filter((e: any) => e.kind === 'kill').length, 2, 'collision kills survive the weapons phase for missions/audio/telemetry');
    assert.equal(severe.weapons.events.filter((e: any) => e.kind === 'shield-down').length, 2);
    severe.a.isPlayer = true;
    assert.deepEqual(heardLayers(severe.weapons.events), [true, false, true, false], 'gunless contact still delivers impact layers after player death');
    severe.weapons.beginTick(); severe.weapons.step(1 / 60, true);
    assert.equal(severe.weapons.events.filter((e: any) => e.kind === 'kill').length, 0, 'kill events are delivered once');
    assert.deepEqual(severe.fleet.destruction.wrecks.map((x: any) => [x.cause, x.position.toArray(), x.velocity.toArray(), x.spin.toArray(), x.kick.toArray()]), repeat.fleet.destruction.wrecks.map((x: any) => [x.cause, x.position.toArray(), x.velocity.toArray(), x.spin.toArray(), x.kick.toArray()]));
    const guarded = impact(180, true, true);
    assert.ok(guarded.a.alive && guarded.b.alive, 'plot armour remains intact');
    assert.ok(guarded.a.hull >= guarded.a.hullMax * 0.15);
    const local = impact(60, false);
    assert.ok(local.evidence.every(x => x.sections.filter((hp: number, i: number) => hp < local.a.combat.dmg.structure.sections[i].hpMax).length === 1), 'impact damages only the struck structural section');
    const engine = impact(60, false, false, true);
    assert.ok(engine.evidence.some(x => x.sub?.startsWith('engine-') && x.destroyed), 'stern contact destroys nearby engine hardware through normal damage routing');
    assert.equal(engine.weapons.events.filter((e: any) => e.kind === 'subsystem').length, 1);
    const mixed = impact(180, true, false, false, true);
    const kills = mixed.weapons.events.filter((e: any) => e.kind === 'kill');
    assert.deepEqual(kills.map((e: any) => e.ship.id), [1, 2, 4], 'contact deaths precede an ordinary bolt death in the same tick');
    assert.ok(mixed.weapons.events.some((e: any) => e.kind === 'shield' && e.ship.id === 4), 'ordinary weapon impact event remains');
    const tap = new EventTap();
    tap.capture(mixed.weapons.events, []);
    mixed.weapons.beginTick(); mixed.weapons.step(1 / 60, true);
    tap.capture(mixed.weapons.events, []);
    assert.equal(tap.weapons.filter((e: any) => e.kind === 'kill').length, 3, 'audio/telemetry tap retains exactly one ordered copy across ticks');
    mixed.weapons.step(1 / 60);
    assert.equal(mixed.weapons.events.filter((e: any) => e.kind === 'kill').length, 0, 'standalone weapons tick still clears its own event window');

    // Record and replay a collision through the real FlightModel, Fleet,
    // damage/destruction and weapon event order, using the normal .vgr codec.
    function replayImpact(file?: any) {
      const fleet = new Fleet(new Group(), 1994), weapons = new Weapons(fleet), solver = new CapitalCollisions();
      const a = fleet.spawn('bb-indomitable', 'concord', new Vector3(0, 0, -1450), new Vector3(0, 0, 1));
      const b = fleet.spawn('bb-indomitable', 'concord', new Vector3(0, 0, 1450), new Vector3(0, 0, -1));
      a.flight.velocity.z = 180; b.flight.velocity.z = -180;
      for (const s of [a, b]) { s.flight.flightAssist = false; s.flight.throttle = 0; }
      const take = new ReplayTake({ v: 1, game: 'vanguard', hz: 60, seed: 1994, scene: 'capital-contact-fixture', boot: '', storage: {}, created: '2026-09-25T00:00:00Z' });
      const cursor = file ? new ReplayCursor(file) : null;
      const hashes = [], events = [];
      for (let tick = 0; tick < 600; tick++) {
        if (cursor) cursor.next(a.controls);
        else { a.controls.throttleSet = 0; a.controls.cycleGun = tick % 60 === 3; }
        take.input.push(a.controls);
        weapons.beginTick(); fleet.step(1 / 60);
        solver.step(fleet.ships, 1 / 60, (s: any, amount: number, point: any, normal: any, other: any) => weapons.contactHit(s, amount, point, normal, other));
        weapons.step(1 / 60, true);
        for (const e of weapons.events) if (e.kind === 'kill') events.push([tick, e.ship.id, e.cause]);
        if ((tick + 1) % 60 === 0) {
          const h = hashWorld(fleet, weapons);
          hashes.push(h); take.checks.push([tick + 1, h]);
          if (cursor) assert.equal(cursor.verify(tick + 1, h), true);
        }
      }
      return { file: take.file(), hashes, events };
    }
    const recorded = replayImpact(), replayed = replayImpact(parseReplay(JSON.stringify(recorded.file)));
    assert.deepEqual(recorded.hashes, replayed.hashes);
    assert.deepEqual(recorded.events, replayed.events);
    assert.equal(recorded.events.length, 2, 'the replay actually contains collision deaths');

    // Existing wreck cap applies to collision deaths too; no debris physics pair explosion.
    for (let i = 0; i < 12; i++) {
      const s = severe.fleet.spawn('bb-indomitable', 'concord', new Vector3(i * 10000, 0, 0), new Vector3(0, 0, 1));
      s.flight.bodyRates.set(0.02, 0.03, -0.04);
      s.combat.dmg.structure.breakZ = 0;
      severe.fleet.destruction.onKill(s, 'structural', null);
      const pieces = severe.fleet.destruction.wrecks.filter((w: any) => w.ship === s);
      assert.ok(pieces.every((w: any) => w.spin.length() > 0 && w.velocity.length() > 0), 'breakup inherits angular contact motion');
    }
    assert.equal(severe.fleet.destruction.wrecks.length, MAX_WRECKS);
    const start = performance.now();
    for (let tick = 0; tick < 600; tick++) severe.fleet.destruction.step(1 / 60);
    const wreckMs = (performance.now() - start) / 600;
    assert.ok(severe.fleet.destruction.wrecks.every((w: any) => [...w.position.toArray(), ...w.velocity.toArray(), ...w.spin.toArray()].every(Number.isFinite)));
    console.log(JSON.stringify({ capitalRuntimeEvidence: { catalog, minor: minor.evidence, severe: severe.evidence, local: local.evidence, engine: engine.evidence, maxWrecks: MAX_WRECKS, wreckMsPerTick: wreckMs } }));
  } finally { await server.close(); }
});
