import { Quaternion, Vector3 } from 'three';
import type { ShipEntity } from '@/sim/Fleet';
import { aimAngles, aimError, barrelDir, createDrive, nextMuzzle, poseTurret, reachable, rigFor, type TurretDrive, type TurretRig } from '@/sim/TurretRig';

/**
 * Scripted gunnery for the cinema stages: the trailer and prologue volleys
 * are timeline events, not fire control, but their shots still leave the
 * barrels. `train` lays a mount on a target (snapped, clamped to its arcs;
 * a shot can seek, so there is no slew history to keep) and `muzzle` gives
 * the next barrel tip in the universe, alternating through the salvo like
 * the live batteries (TurretRig.nextMuzzle).
 *
 * `traverse` animates the displayed joints and the firing solution together;
 * `ready` gates fire on alignment, mount health and mechanical arcs.
 * `pose: false` computes a solution without immediately applying its pose.
 */
export class CinemaGunnery {
  private readonly mounts = new Map<ShipEntity, Map<string, { rig: TurretRig; drive: TurretDrive } | null>>();

  private mount(s: ShipEntity, socket: string): { rig: TurretRig; drive: TurretDrive } | null {
    let m = this.mounts.get(s);
    if (!m) this.mounts.set(s, (m = new Map()));
    if (!m.has(socket)) {
      const rig = rigFor(s.model, socket);
      m.set(socket, rig ? { rig, drive: createDrive() } : null);
    }
    return m.get(socket)!;
  }

  /** Lay `socket` on `target` (clamped to its traverse and elevation); false when the target is outside its arcs. */
  train(s: ShipEntity, socket: string, target: Vector3, pose = true): boolean {
    const m = this.mount(s, socket);
    if (!m) return true;
    const { rig, drive } = m;
    _q.copy(s.flight.orientation).invert();
    _d.subVectors(target, s.flight.position).applyQuaternion(_q).sub(rig.base).normalize();
    aimAngles(rig, _d, _a);
    const ok = reachable(rig, _a.yaw, _a.pitch);
    drive.yaw = rig.full ? _a.yaw : Math.max(rig.traverse[0], Math.min(rig.traverse[1], _a.yaw));
    drive.pitch = Math.max(rig.elevation[0], Math.min(rig.elevation[1], _a.pitch));
    if (pose) poseTurret(s.model, rig, drive);
    return ok;
  }

  /** The sockets that can bear on `target`, trained on it. */
  bear(s: ShipEntity, sockets: string[], target: Vector3, pose = true): string[] {
    const on = sockets.filter((k) => this.train(s, k, target, pose));
    return on;
  }

  /** Seekable cinema traverse: stowed → firing solution on shot-local time. */
  traverse(s: ShipEntity, sockets: string[], target: Vector3, progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    const ease = p * p * (3 - 2 * p);
    for (const socket of sockets) {
      if (s.combat.dmg.subsystems.some(sub => sub.id === socket && sub.destroyed)) continue;
      this.train(s, socket, target, false);
      const m = this.mount(s, socket);
      if (!m) continue;
      // Start 0.4 radians short of the solution, then visibly train in.
      // A firing solution and a render pose always share this same drive.
      m.drive.yaw = Math.max(m.rig.traverse[0], Math.min(m.rig.traverse[1], m.drive.yaw - 0.4 * (1 - ease)));
      m.drive.pitch = Math.max(m.rig.elevation[0], m.drive.pitch - 0.12 * (1 - ease));
      m.drive.recoil = 0;
      poseTurret(s.model, m.rig, m.drive);
    }
  }

  /** Only intact, articulated mounts actually aligned with the target may fire. */
  ready(s: ShipEntity, sockets: string[], target: Vector3): string[] {
    return sockets.filter(socket => {
      if (s.combat.dmg.subsystems.some(sub => sub.id === socket && sub.destroyed)) return false;
      const m = this.mount(s, socket);
      if (!m?.rig.yawJoint || !m.rig.pitchJoint) return false;
      _q.copy(s.flight.orientation).invert();
      _d.subVectors(target, s.flight.position).applyQuaternion(_q).sub(m.rig.base).normalize();
      aimAngles(m.rig, _d, _a);
      return reachable(m.rig, _a.yaw, _a.pitch) && aimError(m.rig, m.drive.yaw, m.drive.pitch, _d) < 0.025;
    });
  }

  direction(s: ShipEntity, socket: string, out: Vector3): Vector3 {
    const m = this.mount(s, socket);
    if (!m) throw new Error(`No articulated barrel: ${socket}`);
    return barrelDir(m.rig, m.drive.yaw, m.drive.pitch, out).applyQuaternion(s.flight.orientation).normalize();
  }

  /** Universe muzzle of the mount's next barrel (the socket for an unrigged one). */
  muzzle(s: ShipEntity, socket: string, out: Vector3): Vector3 {
    const m = this.mount(s, socket);
    if (!m) return out.copy(s.flight.position);
    return nextMuzzle(m.rig, m.drive, out).applyQuaternion(s.flight.orientation).add(s.flight.position);
  }

  /** Ship-frame emitter tip for a beam (`Beam.muzzle`), or null for an unrigged socket. */
  emitter(s: ShipEntity, socket: string): Vector3 | null {
    const m = this.mount(s, socket);
    return m ? nextMuzzle(m.rig, m.drive, new Vector3()) : null;
  }

  /** Forget a ship's mounts (a set torn down and rebuilt). */
  forget(s: ShipEntity): void {
    this.mounts.delete(s);
  }
}

const _q = new Quaternion();
const _d = new Vector3();
const _a = { yaw: 0, pitch: 0 };
