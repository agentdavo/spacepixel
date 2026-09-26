import type { ShipEntity } from '@/sim/Fleet';
import type { WeaponEvent } from '@/sim/Weapons';
import type { MissileEvent } from '@/sim/Missiles';

export type ImpactState = 'absorbed' | 'bleed' | 'hull' | 'collapse';
export interface ImpactCue {
  state: ImpactState;
  facing: number;
  hull: boolean;
  at: number;
  until: number;
}
const PRIORITY: Record<ImpactState, number> = { absorbed: 0, hull: 1, bleed: 2, collapse: 3 };

/** Presentation only. Copy pooled event values; never infer damage from a flash. */
export class CombatFeedback {
  private cues = new WeakMap<ShipEntity, ImpactCue>();
  private time = -Infinity;

  consume(events: readonly WeaponEvent[], missiles: readonly MissileEvent[], time: number): void {
    if (time < this.time) this.cues = new WeakMap();
    this.time = time;
    for (const e of events) {
      if (!e.ship) continue;
      if (e.kind === 'shield-down') this.push(e.ship, 'collapse', e.facing, false, time);
      else if (e.kind === 'shield-bleed') this.push(e.ship, 'bleed', e.facing, true, time);
      else if (e.kind === 'hit' || e.kind === 'shield' || e.kind === 'beam-hit') {
        const shielded = e.kind === 'shield' || !!e.shielded;
        const hull = (e.hullDamage ?? 0) > 0;
        if (hull) this.push(e.ship, shielded ? 'bleed' : 'hull', e.facing, true, time);
        else if (shielded && (e.shieldDamage ?? 0) > 0) this.push(e.ship, 'absorbed', e.facing, false, time);
      }
    }
    for (const e of missiles) {
      if (e.kind !== 'detonate' || e.intercepted || !e.target) continue;
      const hull = (e.hullDamage ?? 0) > 0;
      // MissileEvent does not carry a facing; its shield-down consequence does.
      if (hull) this.push(e.target, e.shielded ? 'bleed' : 'hull', -1, true, time);
      else if (e.shielded && (e.shieldDamage ?? 0) > 0) this.push(e.target, 'absorbed', -1, false, time);
    }
  }

  private push(ship: ShipEntity, state: ImpactState, facing: number, hull: boolean, time: number): void {
    const previous = this.cues.get(ship);
    if (previous && previous.until > time && PRIORITY[previous.state] > PRIORITY[state]) {
      // Keep a collapse legible through the immediately following impact.
      // Never attribute another facing's damage to that collapsed facing.
      if (hull) {
        previous.hull = true;
        if (facing !== previous.facing) previous.facing = -1;
      }
      return;
    }
    // Consequences can arrive before or after the primary hit in a tick.
    hull ||= !!previous && previous.at === time && previous.hull;
    this.cues.set(ship, { state, facing, hull, at: time, until: time + (state === 'absorbed' ? 0.55 : 1.4) });
  }

  get(ship: ShipEntity, time: number): Readonly<ImpactCue> | null {
    const cue = this.cues.get(ship);
    return cue && time < cue.until ? cue : null;
  }
}

export function impactLabel(cue: Readonly<ImpactCue>): string {
  if (cue.state === 'collapse') return cue.hull ? 'SHIELD DOWN · HULL HIT' : 'SHIELD DOWN';
  if (cue.state === 'bleed') return 'SHIELD BLEED · HULL HIT';
  return cue.state === 'hull' ? 'HULL HIT' : 'SHIELD ABSORBED';
}
