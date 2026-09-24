import { Vector3 } from 'three';
import type { FlightScene } from '@/world/scenes/FlightScene';
import type { StarSystemView } from '@/world/StarSystemView';
import { SYSTEM_OFFSET } from '@/world/StarSystemView';
import { saveContracts, saveLedger } from '@/game/Profile';
import { world } from '@/game/world/WorldState';
import { GUILDS } from '@/game/guilds/guilds';
import { acceptContract, type Contract, type Receipt } from '@/game/contracts/contracts';
import { OutpostView } from './OutpostView';
import { outpostOf, outpostStationId, raidBegins, raidContract, raidDue, raidResolved, siteById, type OutpostState } from './outposts';

/**
 * The flight scene's side of outposts: builds the restoration-stage look in
 * the current system view (and rebuilds it when the stage, damage or view
 * changes), posts raids as defence contracts on the pilot's book, and settles
 * them when the receipt comes back. The pure rules are outposts.ts.
 */
export class OutpostRuntime {
  private view: OutpostView | null = null;
  private key = '';
  private sys: StarSystemView | null = null;
  private t = 0;

  constructor(
    private scene: FlightScene,
    private say: (text: string, cls?: string) => void,
  ) {}

  state(): OutpostState | null {
    return outpostOf(world().state);
  }

  /** System of an outpost berth id (berthAt / captures), or null. */
  systemOf(stationId: string): string | null {
    const o = this.state();
    return o && outpostStationId(o.site) === stationId ? o.site : null;
  }

  /** The outpost's universe centre, if it's in this system. */
  center(): Vector3 | null {
    return this.view?.center ?? null;
  }

  /** Build / rebuild the outpost in the current system view to match the world. */
  sync(): void {
    const s = this.scene;
    const v = s.systemView;
    const o = this.state();
    const here = o && !s.campaign && o.site === s.currentSystemId() ? o : null;
    const key = here ? `${here.site}:${here.stage}:${here.damaged}:${here.guild}` : '';
    if (v !== this.sys) {
      // The old view disposed its stations (ours among them); drop our handle.
      this.view?.dispose(true);
      this.view = null;
      this.sys = v;
      this.key = '';
    }
    if (key === this.key) return;
    this.view?.dispose();
    this.view = null;
    this.key = key;
    if (!here) return;
    const site = siteById(s.contracts.reach, here.site);
    if (!site) return;
    const g = GUILDS[here.guild];
    this.view = new OutpostView(
      {
        id: outpostStationId(site.id),
        name: here.name,
        faction: g.faction,
        color: g.color,
        center: new Vector3(...site.pos).add(SYSTEM_OFFSET),
        axis: new Vector3(...site.axis),
        stage: here.stage,
        damaged: here.damaged,
        seed: 4000 + (site.id.length * 131) % 997,
      },
      v,
    );
  }

  update(dt: number, time: number): void {
    this.sync();
    this.view?.update(time);
    this.t += dt;
    if (this.t < 2) return;
    this.t = 0;
    // Raids: once the bay is open the outpost is worth taking.
    const s = this.scene;
    if (s.campaign) return;
    const desk = s.contracts;
    const running = desk.book.active.some((k) => !!k.outpost);
    if (!raidDue(world().state, running)) return;
    world().update(raidBegins);
    const k = raidContract(world().state, desk.reach, desk.book.clock);
    if (!k) return;
    const r = acceptContract(desk.book, s.ledger, k);
    if (r.error) {
      // No room on the book: the outpost fends for itself.
      const res = raidResolved(world().state, false);
      world().update(() => res.world);
      this.say(res.text, res.held ? 'ok' : 'err');
      return;
    }
    desk.book = r.book;
    saveContracts(r.book);
    desk.toast(`OUTPOST UNDER ATTACK · ${k.payAtName.toUpperCase()} · ${k.payAtSystem.toUpperCase()}`, '#ff5f7a');
    this.say(`RAIDERS ON THE ${k.payAtName.toUpperCase()} — DEFENCE ON YOUR BOOK`, 'err');
  }

  /** A contract settled: raids resolve (defended when paid). */
  onReceipt(k: Contract, r: Receipt): void {
    if (!k.outpost) return;
    const res = raidResolved(world().state, r.result === 'paid');
    world().update(() => res.world);
    this.say(res.text, res.held ? 'ok' : 'err');
    saveLedger(this.scene.ledger);
  }
}
