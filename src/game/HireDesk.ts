import type { FlightScene } from '@/world/scenes/FlightScene';
import { HIRES, MAGPIE_WING, has, hire, loadCrew, saveCrew, type Crew, type HireId } from './crew';

/**
 * Hires at runtime: signs people on from conversations (dialogHooks.onRecruit,
 * wired by the ContractDesk) and puts them to work — Magpie's Due joins the
 * free-flight wing (now, and on every load while she is aboard); the
 * mechanic's discount is read by the dock screen's repair service.
 */
export class HireDesk {
  crew: Crew = loadCrew();
  private flying = new Set<HireId>();

  constructor(private scene: FlightScene) {
    for (const id of this.crew.hired) this.apply(id);
  }

  /** Sign `id` on. Returns the dock-log line and whether it worked. */
  recruit(id: string): { text: string; ok: boolean } {
    const r = hire(this.crew, id);
    if (r.error) return { text: r.error, ok: false };
    this.crew = r.crew;
    saveCrew(this.crew);
    const h = id as HireId;
    this.apply(h);
    return { text: HIRES[h].signs, ok: true };
  }

  aboard(id: HireId): boolean {
    return has(this.crew, id);
  }

  private apply(id: HireId): void {
    if (id !== 'magpie-due' || this.flying.has(id)) return;
    this.flying.add(id);
    this.scene.addWingman(MAGPIE_WING.blueprint, MAGPIE_WING.name, MAGPIE_WING.faction);
  }
}
