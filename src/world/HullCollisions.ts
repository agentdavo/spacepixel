import { Vector3 } from 'three';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import { collideBody, impactDamage, makeHost, placeHost, sphereContact, type Body, type CollisionHost, type Contact, type HitEvent } from '@/sim/Collision';
import { proxiesFromModel } from '@/sim/CollisionProxies';
import { FighterCollisions } from '@/sim/FighterCollisions';
import { CapitalCollisions, type CapitalDamage } from '@/sim/CapitalCollisions';
import type { Obstacle } from '@/sim/ai';
import { hostObstacles, proxyObstacles } from '@/sim/ai/Avoid';
import type { Particles } from '@/fx/Particles';
import { PAL } from '@/fx/kinds';
import { getAudio } from '@/audio';
import type { StationView } from './Station';

/**
 * Hull collisions in the flight scene (glue): stations and capital ships
 * get proxy shapes from their blueprints (sim/CollisionProxies.ts), every
 * fighter is a sphere; `step` pushes fighters out of hulls, bounces and
 * scrapes them, applies impact damage, throws sparks, shakes the camera
 * when it's the player, and publishes the same proxies as AI avoidance
 * obstacles (stations via `obstacles`, capitals via Avoid's host table).
 */
const ZERO = new Vector3();
const _hit: Contact = { point: new Vector3(), normal: new Vector3(), depth: 0 };

export class HullCollisions {
  /** Station proxies as avoidance capsules (pass to updateAI). */
  readonly obstacles: Obstacle[] = [];
  /** Camera shake offset for this frame (universe metres; add to the eye). */
  readonly shake = new Vector3();
  /** Contacts this frame (reused objects). */
  readonly events: HitEvent[] = [];
  private stationHosts = new Map<StationView, { host: CollisionHost; obstacles: Obstacle[] }>();
  private shipHosts = new Map<ShipEntity, CollisionHost>();
  private bodies = new Map<ShipEntity, Body & { sparkT: number; hurtT: number; graceT: number }>();
  private hosts: CollisionHost[] = [];
  private evPool: HitEvent[] = [];
  private shakeAmp = 0;
  private shakeT = 0;
  /** Fighter ↔ fighter spheres (rams, blown merges); launch grace built in. */
  readonly fighters = new FighterCollisions();
  /** Swept, finite-mass large hulls. Fighters retain their existing response. */
  readonly capitals = new CapitalCollisions();

  constructor(
    private fleet: Fleet,
    private fx: () => Particles | null,
    private contactDamage?: CapitalDamage,
  ) {}

  private stationHost(st: StationView): { host: CollisionHost; obstacles: Obstacle[] } {
    let h = this.stationHosts.get(st);
    if (!h) {
      const host = makeHost(st, st.collisionProxies(), st.center, st.quaternion, ZERO);
      h = { host, obstacles: proxyObstacles(host.proxies) };
      this.stationHosts.set(st, h);
    }
    return h;
  }

  private shipHost(s: ShipEntity): CollisionHost {
    let h = this.shipHosts.get(s);
    if (!h) {
      h = makeHost(s, proxiesFromModel(s.model), s.flight.position, s.flight.orientation, s.flight.velocity);
      this.shipHosts.set(s, h);
    }
    return h;
  }

  /**
   * After the fleet has flown. `stations` = the current system's; `skip` =
   * ships the collision world must leave alone (a docking sequence owns
   * the player). `eye` places the sounds.
   */
  step(dt: number, stations: readonly StationView[], skip: (s: ShipEntity) => boolean, eye: Vector3): void {
    this.events.length = 0;
    this.capitals.step(this.fleet.ships, dt, (s, amount, point, normal, other) => {
      if (this.contactDamage) this.contactDamage(s, amount, point, normal, other);
      else this.fleet.hit(s, amount, 'kinetic', point, normal, other);
    }, skip);
    for (const e of this.capitals.events) {
      if (e.energy <= 0) continue;
      // Layer-aware shield/hull FX and sound come through the combat event
      // adapter. Camera shake follows the physical impulse even if absorbed.
      if (e.a.isPlayer || e.b.isPlayer) this.kick(Math.min(2.6, e.closing * 0.02));
    }
    // Hosts: this system's stations + living capitals.
    this.hosts.length = 0;
    this.obstacles.length = 0;
    for (const st of stations) {
      const h = this.stationHost(st);
      placeHost(h.host);
      this.hosts.push(h.host);
      for (const o of h.obstacles) this.obstacles.push(o);
    }
    for (const [st] of this.stationHosts) if (!stations.includes(st)) this.stationHosts.delete(st);
    for (const s of this.fleet.ships) {
      if (!s.alive || s.radius <= 60) continue;
      const h = this.shipHost(s);
      placeHost(h);
      this.hosts.push(h);
      hostObstacles.set(s, proxyObstacles(h.proxies, hostObstacles.get(s)));
    }
    this.decayShake(dt);
    if (dt <= 0 || !this.hosts.length) return;

    const fx = this.fx();
    const audio = getAudio();
    for (const s of this.fleet.ships) {
      if (!s.alive || s.radius > 60 || skip(s)) continue;
      let b = this.bodies.get(s);
      if (!b) {
        b = { position: s.flight.position, velocity: s.flight.velocity, radius: s.radius, sparkT: 0, hurtT: 0, graceT: 0 };
        // Born inside a hull (a hangar launch from deep in a capital): let it fly clear first.
        for (const h of this.hosts) if (sphereContact(b.position, b.radius, h.proxies, _hit)) b.graceT = 2.5;
        this.bodies.set(s, b);
      }
      b.sparkT -= dt;
      b.hurtT -= dt;
      if (b.graceT > 0) {
        b.graceT -= dt;
        continue;
      }
      // Up to two contacts a frame (a corner, a bay wall and the deck).
      for (let k = 0; k < 2; k++) {
        const ev = this.evPool[this.events.length] ?? (this.evPool[this.events.length] = { body: b, host: this.hosts[0], point: new Vector3(), normal: new Vector3(), impact: 0, slide: 0 });
        const hit = collideBody(b, this.hosts, k === 0 ? dt : 0, ev);
        if (!hit) break;
        this.events.push(hit);
        const dmg = impactDamage(hit.impact);
        if (dmg > 0 && b.hurtT <= 0) {
          this.fleet.damage(s, dmg);
          b.hurtT = 0.15; // one knock per bounce, not per frame of a grind
        }
        if (fx && (b.sparkT <= 0 || hit.impact > 20)) {
          fx.impact(hit.point, hit.normal, hit.host.velocity, PAL.WARM);
          if (hit.impact > 35) fx.explosion(hit.point, hit.host.velocity, Math.min(8, 2 + hit.impact * 0.03), PAL.WARM);
          if (!s.alive) fx.explosion(s.flight.position, hit.host.velocity, Math.max(10, s.radius * 1.4), PAL.WARM);
          b.sparkT = hit.slide > 15 ? 0.05 : 0.12;
        }
        if (hit.impact > 6) audio.playAt(s.isPlayer ? 'playerHit' : 'hullHit', hit.point, eye, { gain: Math.min(1.2, 0.3 + hit.impact / 120) });
        if (s.isPlayer) this.kick(Math.min(2.6, 0.25 + hit.impact * 0.02 + hit.slide * 0.004));
        if (!s.alive) break;
      }
    }
  }

  /**
   * Fighters against each other (after `step`): same damage-by-closing-speed
   * as the hulls, sparks, a knock on the camera when the player is in it.
   */
  stepFighters(dt: number, skip: (s: ShipEntity) => boolean, eye: Vector3): void {
    const w = this.fighters;
    w.step(this.fleet.ships, dt, (s, d) => this.fleet.damage(s, d), skip);
    if (!w.events.length) return;
    const fx = this.fx();
    const audio = getAudio();
    for (const e of w.events) {
      if (fx) {
        fx.impact(e.point, e.normal, e.a.flight.velocity, PAL.WARM);
        if (e.impact > 35) fx.explosion(e.point, e.a.flight.velocity, Math.min(8, 2 + e.impact * 0.03), PAL.WARM);
        for (const s of [e.a, e.b]) if (!s.alive) fx.explosion(s.flight.position, s.flight.velocity, Math.max(10, s.radius * 1.4), PAL.WARM);
      }
      const player = e.a.isPlayer || e.b.isPlayer;
      if (e.impact > 6) audio.playAt(player ? 'playerHit' : 'hullHit', e.point, eye, { gain: Math.min(1.2, 0.3 + e.impact / 120) });
      if (player) this.kick(Math.min(2.6, 0.25 + e.impact * 0.02));
    }
  }

  private kick(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  private decayShake(dt: number): void {
    this.shakeT += dt;
    this.shakeAmp *= Math.exp(-dt / 0.28);
    if (this.shakeAmp < 0.01) {
      this.shakeAmp = 0;
      this.shake.set(0, 0, 0);
      return;
    }
    const t = this.shakeT;
    this.shake.set(Math.sin(t * 61.3) * Math.sin(t * 17.9 + 1), Math.sin(t * 53.1 + 2) * Math.sin(t * 13.7), Math.sin(t * 47.9 + 4) * 0.5).multiplyScalar(this.shakeAmp);
  }

  /** Current host for a station (for tests / debug). */
  hostOf(st: StationView): CollisionHost {
    return this.stationHost(st).host;
  }
}
