import { Vector3 } from 'three';
import type { ShipEntity } from '../../sim/Fleet';
import { createPilotState, flyToPoint, type PilotState } from '../../sim/ai/Pilot.ts';
import type { EscortRoute } from '../CampaignRunner';
import type { CampaignMission, SpawnSpec } from './types';

// Two Lantern Guard rest-pose bounding spheres total 187.43 m. Add 20 m
// clearance and both 8 m stop tolerances, then round up to a 240 m lane.
const LANE_SPACING = 240;
const STOP_RADIUS = 8;

interface EscortPilot {
  slot: Vector3;
  pilot: PilotState;
}

/**
 * Story escorts own their navigation controls after combat AI has run. All
 * groups sharing a destination use one arrival formation; otherwise separate
 * groups (Magpie, tankers, audit) would still collide at their common buoy.
 * Slots depend on authored spawn/member identity, never living-ship order or
 * current position, so casualties, retries and Runner.restore cannot reshuffle
 * the surviving ships. Current authored convoys have at most five members:
 * their 240 m lanes fit comfortably inside the runner's 800 m arrival radius.
 * Like authored placement offsets, these lanes use world axes.
 */
export class EscortGuidance {
  private slots = new Map<SpawnSpec, Vector3[]>();
  private pilots = new WeakMap<ShipEntity, EscortPilot>();
  private destination = new Vector3();

  constructor(mission: Pick<CampaignMission, 'spawns'>) {
    const routes = new Map<string, { spec: SpawnSpec; member: number; x: number; order: number }[]>();
    for (const [order, spec] of mission.spawns.entries()) {
      if (spec.role !== 'escort' || !spec.routeTo) continue;
      const members = routes.get(spec.routeTo) ?? [];
      for (let member = 0; member < spec.count; member++) {
        // Same initial wedge as CampaignRunner.releaseSpawns. Keep its lateral
        // ordering when spreading ships into their destination lanes.
        const x = spec.place.offset[0] + (member % 2 ? 1 : -1) * Math.ceil(member / 2) * 60;
        members.push({ spec, member, x, order });
      }
      routes.set(spec.routeTo, members);
      this.slots.set(spec, []);
    }
    for (const members of routes.values()) {
      members.sort((a, b) => a.x - b.x || a.order - b.order || a.member - b.member);
      members.forEach(({ spec, member }, i) => {
        this.slots.get(spec)![member] = new Vector3((i - (members.length - 1) / 2) * LANE_SPACING, 0, 0);
      });
    }
  }

  register(ship: ShipEntity, spec: SpawnSpec, member: number): void {
    this.pilots.set(ship, { slot: this.slots.get(spec)?.[member] ?? new Vector3(), pilot: createPilotState() });
  }

  step(routes: readonly EscortRoute[], dt: number): void {
    for (const route of routes) for (const ship of route.ships) {
      if (!ship.alive) continue;
      const state = this.pilots.get(ship);
      if (!state) continue;
      const c = ship.controls;
      // Do not inherit combat AI's burner, cruise, FA toggle or throttle delta.
      c.pitch = c.yaw = c.roll = c.throttleDelta = 0;
      c.throttleSet = 0;
      c.afterburner = c.fire = c.missile = false;
      c.flightAssistToggle = !ship.flight.flightAssist;
      c.cruise = ship.flight.cruise !== 'off';
      if (route.target) this.destination.copy(route.target).add(state.slot);
      if (route.halted || !route.target || ship.flight.position.distanceToSquared(this.destination) <= STOP_RADIUS * STOP_RADIUS) {
        // FA bleeds residual velocity through real retro thrusters; never snap
        // position/velocity or turn back through the formation at the endpoint.
        state.pilot.hasPrev = false;
        state.pilot.ffPitch = state.pilot.ffYaw = 0;
        continue;
      }
      flyToPoint(c, ship.flight, this.destination, 0, state.pilot, dt);
    }
  }
}
