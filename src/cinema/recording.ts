import type { AudioFrame, AudioWeaponEvent, AudioMissileEvent, AudioShip } from '@/audio';

/** JSON-only snapshots: no pooled vectors, ship graphs or mutable subsystem references. */
export interface RecordedAudioFrame {
  frame: number;
  at: number;
  timeline: number;
  shot: string;
  eye: AudioFrame['eye'];
  camera: AudioFrame['camera'];
  weaponEvents: AudioWeaponEvent[];
  missileEvents: AudioMissileEvent[];
}

export function snapshotAudioFrame(f: AudioFrame): Pick<RecordedAudioFrame, 'eye' | 'camera' | 'weaponEvents' | 'missileEvents'> {
  const ship = (s: AudioShip | null): AudioShip | null => s && ({ isPlayer: s.isPlayer, faction: s.faction, radius: s.radius });
  const pos = (p: AudioFrame['eye']) => ({ x: p.x, y: p.y, z: p.z });
  return {
    eye: pos(f.eye),
    camera: f.camera && { x: f.camera.x, y: f.camera.y, z: f.camera.z, w: f.camera.w },
    weaponEvents: f.weaponEvents.map(e => ({ kind: e.kind, position: pos(e.position), ship: ship(e.ship), shooter: ship(e.shooter),
      gun: e.gun && { sfx: e.gun.sfx, timbre: e.gun.timbre }, type: e.type, shielded: e.shielded,
      strength: e.strength, sub: e.sub && { kind: e.sub.kind }, turret: e.turret, cause: e.cause })),
    missileEvents: f.missileEvents.map(e => ({ kind: e.kind, position: pos(e.position), shooter: ship(e.shooter), target: ship(e.target) })),
  };
}
