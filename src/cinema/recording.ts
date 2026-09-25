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
  beams?: AudioFrame['beams'];
}

export function snapshotAudioFrame(f: AudioFrame): Pick<RecordedAudioFrame, 'eye' | 'camera' | 'weaponEvents' | 'missileEvents' | 'beams'> {
  const ship = (s: AudioShip | null): AudioShip | null => s && ({ isPlayer: s.isPlayer, faction: s.faction, radius: s.radius });
  const pos = (p: AudioFrame['eye']) => ({ x: p.x, y: p.y, z: p.z });
  return {
    eye: pos(f.eye),
    camera: f.camera && { x: f.camera.x, y: f.camera.y, z: f.camera.z, w: f.camera.w },
    weaponEvents: f.weaponEvents.map(e => ({ kind: e.kind, position: pos(e.position), ship: ship(e.ship), shooter: ship(e.shooter),
      gun: e.gun && { id: e.gun.id, sound: e.gun.sound, sfx: e.gun.sfx, timbre: e.gun.timbre }, type: e.type, shielded: e.shielded,
      amount: e.amount, hullDamage: e.hullDamage, shieldDamage: e.shieldDamage,
      strength: e.strength, sub: e.sub && { kind: e.sub.kind }, turret: e.turret, cause: e.cause })),
    missileEvents: f.missileEvents.map(e => ({ kind: e.kind, position: pos(e.position), shooter: ship(e.shooter), target: ship(e.target),
      intercepted: e.intercepted, shielded: e.shielded, hullDamage: e.hullDamage, shieldDamage: e.shieldDamage, spec: e.spec && { id: e.spec.id, damage: e.spec.damage } })),
    beams: f.beams?.filter(b => b.active).map(b => ({ id: b.id, active: true, origin: pos(b.origin), owner: ship(b.owner)!, gun: b.gun && { id: b.gun.id, sound: b.gun.sound } })),
  };
}
