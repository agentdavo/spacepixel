import { Vector3 } from 'three';
import '@/ui/rescue.css';
import type { ShipEntity } from '@/sim/Fleet';
import type { Subject } from '@/sim/CameraDirector';
import { brainOf, flyToPoint } from '@/sim/ai';
import { DockCinema } from '@/ui/DockScreen';
import { getAudio } from '@/audio';
import { COMMODITY, type CommodityId } from '@/game/economy';
import { saveLedger } from '@/game/Profile';
import type { FlightScene } from '@/world/scenes/FlightScene';
import { TOW_HULL, rescueTerms, tugFor, type RescueTerms } from './rescue';

/**
 * Free-flight death as a beat, in the docking cutaways' grammar:
 *
 *   0.0 s  the airframe goes — explosion, chase camera holds
 *   1.4 s  cut: letterbox + ink frame, orbit on the wreck, a salvage tug
 *          noses in; plate "SALVAGE RECOVERY // AIRFRAME 0413" with the tug,
 *          the berth she tows to and the bill; RECOVERED stamp slams in
 *   5.2 s  iris closes to black
 *   6.0 s  berthed at the last dock at 35 % hull; the dock screen opens with
 *          the debrief (tug, insurance charged, cargo lost)
 *
 * Costs are pure (src/game/rescue.ts): an insurance fee in shares and every
 * loose unit in the pod (contract consignments are sealed and survive).
 */
const CUT = 1.4;
const IRIS = 5.2;
const END = 6.0;

export interface RescueHost {
  scene: FlightScene;
  /** Where the tow goes (last dock, else the nearest Directorate station). */
  home(): string;
  stationName(id: string): string;
  /** Units held under contract seal (haul consignments). */
  sealed(): Partial<Record<CommodityId, number>>;
  /** Dock-screen notices for the berth the tow ends at. */
  notices: { text: string; cls?: string }[];
}

export class RescueBeat {
  active = false;
  private t = 0;
  private cinema: DockCinema;
  private stamp: HTMLDivElement;
  private tug: ShipEntity | null = null;
  private wreck = new Vector3();
  private subject: Subject = { position: new Vector3(), velocity: new Vector3(), radius: 40 };
  private terms: RescueTerms | null = null;
  private to = '';
  private tugName = '';
  private cut = false;

  constructor(
    root: HTMLElement,
    private host: RescueHost,
  ) {
    this.cinema = new DockCinema(root);
    this.stamp = document.createElement('div');
    this.stamp.className = 'rescue-stamp';
    this.stamp.innerHTML = '<b>RECOVERED</b><small>回収 · AIRFRAME 0413</small>';
    root.append(this.stamp);
  }

  /** The player just died in free flight. */
  begin(): void {
    const s = this.host.scene;
    this.active = true;
    this.t = 0;
    this.cut = false;
    this.wreck.copy(s.player.flight.position);
    this.to = this.host.home();
    this.terms = rescueTerms(s.ledger, this.host.sealed());
    const sys = s.universe.systems.get(s.currentSystemId());
    const tug = tugFor(sys?.faction ?? 'concord');
    this.tugName = tug.name;
    getAudio().stinger('defeat');
  }

  /** Captures (`?rescue=<seconds into the beat>`): start the beat already under way. */
  skipTo(t: number): void {
    this.t = Math.max(0, Math.min(t, END - 0.05));
  }

  /** After AI, before physics: fly the tug in to the wreck. */
  preStep(dt: number): void {
    const g = this.tug;
    if (!this.active || !g || !g.alive) return;
    const c = g.controls;
    c.fire = false;
    c.afterburner = false;
    flyToPoint(c, g.flight, this.wreck, 8, brainOf(g).pilot, dt);
    c.throttleSet = Math.min(c.throttleSet ?? 0.5, 0.5);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (!this.cut && this.t >= CUT) this.startCutaway();
    if (this.cut) {
      this.cinema.timecode(this.t - CUT);
      this.cinema.setIris(this.t > IRIS ? 1 - (this.t - IRIS) / (END - IRIS) : 1);
    }
    if (this.t >= END) this.finish();
  }

  private startCutaway(): void {
    this.cut = true;
    const s = this.host.scene;
    const terms = this.terms!;
    const lost = terms.lost.length ? `${terms.lost.reduce((n, l) => n + l.units, 0)} UNITS OF CARGO LOST` : 'POD EMPTY';
    this.cinema.show('SALVAGE RECOVERY // AIRFRAME 0413', this.tugName, `UNDER TOW TO ${this.host.stationName(this.to).toUpperCase()} · INSURANCE ${terms.fee.toLocaleString('en-US')} sh · ${lost}`);
    this.stamp.classList.add('show');
    // The tug: an ore-tug with a cab, nosing in from the dark side of the wreck.
    const out = s.player.flight.forward(new Vector3()).negate().add(new Vector3(0.4, 0.25, 0)).normalize();
    const pos = this.wreck.clone().addScaledVector(out, 700);
    this.tug = s.fleet.spawn('rw-bulldog', 'rustwake', pos, this.wreck.clone().sub(pos).normalize(), { name: this.tugName, team: 'neutral' });
    this.tug.flight.velocity.multiplyScalar(0.4);
    this.subject.position.copy(this.wreck);
    s.director.cut('orbit', this.subject, END - CUT + 0.5);
  }

  private finish(): void {
    const s = this.host.scene;
    this.active = false;
    this.stamp.classList.remove('show');
    this.cinema.hide();
    if (this.tug) {
      this.tug.alive = false;
      this.tug.model.root.visible = false;
      this.tug = null;
    }
    // Recompute against the ledger as it is now, and bill it.
    const terms = rescueTerms(s.ledger, this.host.sealed());
    s.ledger = terms.ledger;
    saveLedger(terms.ledger);
    const name = this.host.stationName(this.to);
    const n = this.host.notices;
    n.length = 0;
    n.push({ text: `RECOVERED BY ${this.tugName} · TOWED TO ${name.toUpperCase()} · HULL ${Math.round(TOW_HULL * 100)}%` });
    n.push({ text: `SALVAGE INSURANCE BILLED · −${terms.fee.toLocaleString('en-US')} sh`, cls: 'err' });
    n.push(
      terms.lost.length
        ? { text: `CARGO LOST · ${terms.lost.map((l) => `${l.units} × ${COMMODITY[l.id].name.toUpperCase()}`).join(', ')}`, cls: 'err' }
        : { text: 'POD WAS EMPTY — NOTHING LOST BUT PRIDE' },
    );
    s.director.cut('chase', null, Infinity);
    s.berthAt(this.to, TOW_HULL);
  }
}
