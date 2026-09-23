import { Vector3 } from 'three';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import { avoidance, brainOf, issueOrder, matchVelocity, type Obstacle, type Order } from '@/sim/ai';
import { isBrain, isCapital } from '@/sim/ai/state';
import type { DockingController } from './Docking';

/**
 * Wingmen while the lead docks: they break formation when clearance is
 * given and hold station in pairs well off the approach corridor (never
 * inside the ILS tube, never into the bay), riding the host's velocity for
 * a carrier. When the lead launches and guidance lets go, they re-form on
 * the standing wing order.
 *
 * Runs after `updateAI` and before `fleet.step`: it overwrites the controls
 * of the lead's wingmen only while a docking sequence is live.
 */
const _p = new Vector3();
const _err = new Vector3();
const _des = new Vector3();
const _esc = new Vector3();
const _l = new Vector3();
const GAINS = { kp: 4.5, kd: 0.35, bank: 0, authority: 1 };

export class WingDocking {
  private holding: ShipEntity[] = [];

  /** Hold point for wingman `i`, bay-local (metres): alternate sides, outside the corridor. */
  static slot(i: number, interiorHw: number, out: Vector3): Vector3 {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    return out.set(side * (Math.max(380, interiorHw * 4) + 110 * k), 160 + 35 * k, 700 + 120 * k);
  }

  update(dt: number, dk: Pick<DockingController, 'target' | 'phase' | 'toWorld'>, player: ShipEntity, fleet: Fleet, obstacles: readonly Obstacle[], order: Order): void {
    const d = dk.target;
    const live = !!d && dk.phase !== 'free';
    if (!live) {
      if (this.holding.length) {
        // Guidance let go (launched, cancelled, waved off): form back up on the standing order.
        const wing = this.holding.filter((s) => s.alive);
        this.holding = [];
        if (wing.length) issueOrder(wing, order, player);
      }
      return;
    }
    if (!this.holding.length) {
      for (const s of fleet.ships) if (s.alive && !s.isPlayer && !isCapital(s) && isBrain(s.brain) && s.brain.leader === player) this.holding.push(s);
    }
    if (dt <= 0) return;
    for (let i = 0; i < this.holding.length; i++) {
      const s = this.holding[i];
      if (!s.alive) continue;
      const f = s.flight;
      const b = brainOf(s);
      dk.toWorld(d, WingDocking.slot(i, d.interior.hw, _l), _p);
      _err.subVectors(_p, f.position);
      const dist = _err.length();
      // Arrive and stop (relative to the host): braking-limited closing speed.
      const corr = Math.min(0.45 * dist, Math.sqrt(2 * 30 * dist), 200);
      _des.copy(d.velocity);
      if (dist > 1e-3) _des.addScaledVector(_err, corr / dist);
      const urgency = avoidance(s, fleet.ships, obstacles, _esc);
      if (urgency > 0) {
        const sp = Math.max(40, _des.length());
        _des.normalize().lerp(_esc, Math.min(1, urgency * 1.6)).normalize().multiplyScalar(sp);
      }
      const c = s.controls;
      c.fire = false;
      c.missile = false;
      matchVelocity(c, f, _des, dist < 150 ? d.up : null, b.pilot, dt, GAINS, dist > 1500, 40);
      // On station: just ride the host.
      if (dist < 25 && _des.distanceTo(d.velocity) < 8) {
        c.throttleSet = Math.min(1, d.velocity.length() / f.spec.maxSpeed);
        c.afterburner = false;
      }
    }
  }

  /** Is `s` currently parked off the corridor by us? */
  isHolding(s: ShipEntity): boolean {
    return this.holding.includes(s);
  }
}
