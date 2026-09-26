import { Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import type { Fleet, ShipEntity, Team } from '@/sim/Fleet';
import type { Weapons } from '@/sim/Weapons';
import type { Capitals } from '@/sim/Capitals';
import { brainOf, issueOrder, setFormation } from '@/sim/ai';
import { postFx } from '@/render/post/PostFx';
import { createSetPiece, type SetPiece, type SetPieceFrame } from '@/world/setpieces';
import { Comms } from '@/ui/Comms';
import { Codex } from '@/ui/Codex';
import { CAMPAIGN } from './campaign';
import { PLOT_ARMOUR } from './campaign/missions';
import type { CampaignMission, SpawnSpec } from './campaign/types';
import { CampaignRunner, type CampaignHost, type SetPieceHandle } from './CampaignRunner';
import { EscortGuidance } from './campaign/EscortGuidance';

/**
 * Glue between one CampaignMission (data + CampaignRunner) and the live
 * flight scene: spawns ships with story roles, builds set pieces, drives
 * static bystanders and escort routes, plays radio chatter, unlocks the
 * codex and applies plot armour. The scene calls, each frame:
 *
 *   updateAI → capitals → session.preStep(dt) → fleet.step → weapons →
 *   session.update(dt, time)
 */
export interface FlightHostScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly world: WorldSpace;
  readonly fleet: Fleet;
  readonly weapons: Weapons;
  readonly capitals: Capitals;
  readonly player: ShipEntity;
  currentSystemId(): string;
  jumpCount(): number;
  gatePosition(i: number): Vector3 | null;
}

const _v = new Vector3();

export class CampaignSession {
  readonly runner: CampaignRunner;
  readonly comms: Comms;
  readonly codex: Codex;
  private pieces: SetPiece[] = [];
  private statics: ShipEntity[] = [];
  private stationary = new WeakSet<ShipEntity>();
  private departing: { ship: ShipEntity; t: number; dir: Vector3 }[] = [];
  private frame: SetPieceFrame;
  /** Codex titles unlocked during this mission (for the debrief). */
  readonly unlockedTitles: string[] = [];
  private outcomeAt = -1;
  private escortGuidance: EscortGuidance;

  constructor(
    readonly mission: CampaignMission,
    private host: FlightHostScene,
    uiRoot: HTMLElement,
  ) {
    this.escortGuidance = new EscortGuidance(mission);
    this.comms = new Comms(uiRoot, CAMPAIGN.cast);
    this.codex = new Codex(uiRoot, CAMPAIGN.codex, { key: 'KeyL' });
    const p = host.player;
    const self = this;
    const runnerHost: CampaignHost = {
      get playerPosition() {
        return p.flight.position;
      },
      get playerAlive() {
        return p.alive;
      },
      get playerHull() {
        return p.hull / p.hullMax;
      },
      get systemId() {
        return host.currentSystemId();
      },
      get jumps() {
        return host.jumpCount();
      },
      ships: host.fleet.ships,
      gatePosition: (i) => host.gatePosition(i),
      spawnShip: (spec, i, pos) => self.spawn(spec, i, pos),
      spawnSetPiece: (spec, pos) => self.buildPiece(spec, pos),
      playChatter: (beat) => self.comms.play(beat),
      unlockCodex: (id) => {
        if (self.codex.unlock(id)) {
          const e = CAMPAIGN.codex.find((c) => c.id === id);
          if (e) self.unlockedTitles.push(e.title);
        }
      },
      command: (verb, ships) => self.command(verb, ships),
    };
    this.runner = new CampaignRunner(mission, runnerHost);
    this.frame = {
      dt: 0,
      time: 0,
      eye: host.world.eye,
      playerPos: p.flight.position,
      playerVel: p.flight.velocity,
      flags: this.runner.flags,
      setFlag: (f) => this.runner.setFlag(f),
      postFx,
      camera: host.camera,
      scene: host.scene,
    };
  }

  begin(): void {
    this.runner.begin();
  }

  /** Story role → team (who it fights for). */
  private team(spec: SpawnSpec): Team {
    switch (spec.role) {
      case 'wing':
        return this.host.player.team;
      case 'static':
        return 'neutral';
      case 'hostile':
        return spec.faction === this.host.player.faction ? 'renegade' : spec.faction;
      default:
        return spec.faction;
    }
  }

  private spawn(spec: SpawnSpec, i: number, pos: Vector3): ShipEntity {
    const p = this.host.player;
    // Face the player's heading for allies, toward the player for everyone else.
    const facing = spec.role === 'wing' || spec.role === 'escort' ? p.flight.forward(_v).clone() : _v.subVectors(p.flight.position, pos).normalize().clone();
    const name = spec.name ? (spec.count > 1 ? `${spec.name} ${i + 1}` : spec.name) : undefined;
    const s = this.host.fleet.spawn(spec.blueprint, spec.faction, pos, facing, { name, team: this.team(spec) });
    const tag = spec.tag ? (spec.count > 1 ? `${spec.tag}-${i + 1}` : spec.tag) : '';
    s.plotArmour = PLOT_ARMOUR.some((t) => tag === t || tag.startsWith(t + '-'));
    if (spec.role === 'capital') this.host.capitals.register(s, { launchBlueprint: null });
    if (spec.role === 'static') this.statics.push(s);
    if (spec.role === 'static' && spec.stationary) {
      this.stationary.add(s);
      s.flight.velocity.set(0, 0, 0);
      s.flight.throttle = 0;
    }
    if (spec.role === 'escort') this.escortGuidance.register(s, spec, i);
    if (spec.role === 'wing') {
      const wing = this.host.fleet.ships.filter((x) => x.alive && x !== p && x.team === p.team && brainOf(x).order === 'formUp');
      setFormation([...wing, s], 'fingerFour', 45);
      issueOrder([s], 'formUp', p);
    }
    return s;
  }

  private buildPiece(spec: Parameters<CampaignHost['spawnSetPiece']>[0], pos: Vector3): SetPieceHandle {
    const piece = createSetPiece(spec, pos);
    this.host.world.root.add(piece.group);
    this.pieces.push(piece);
    return piece;
  }

  private command(verb: 'destroy' | 'depart', ships: ShipEntity[]): void {
    for (const s of ships) {
      if (verb === 'destroy') {
        // Scripted death: bypass plot armour, no kill credit.
        s.plotArmour = false;
        s.alive = false;
        s.model.root.visible = false;
        postFx.flash = Math.max(postFx.flash, 0.35);
      } else {
        s.team = 'neutral';
        this.departing.push({ ship: s, t: 0, dir: s.flight.forward(new Vector3()) });
      }
    }
  }

  /** After AI, before physics: bystanders hold station, escorts fly their routes, departures leave. */
  preStep(dt: number): void {
    for (const s of this.statics) {
      if (!s.alive || s.team !== 'neutral') continue; // provoked statics fight like anyone else
      const c = s.controls;
      c.pitch = c.yaw = c.roll = 0;
      c.throttleSet = this.stationary.has(s) ? 0 : 0.35;
      c.fire = false;
      c.afterburner = false;
    }
    this.escortGuidance.step(this.runner.escorts, dt);
    for (const d of this.departing) {
      const s = d.ship;
      if (!s.alive) continue;
      d.t += dt;
      s.controls.pitch = s.controls.yaw = s.controls.roll = 0;
      s.controls.afterburner = true;
      s.controls.fire = false;
      if (d.t > 3.5) {
        s.alive = false; // jumped out — not a kill
        s.model.root.visible = false;
      }
    }
  }

  update(dt: number, time: number): void {
    for (const e of this.host.weapons.events) if (e.kind === 'kill' && e.ship) this.runner.onKill(e.ship);
    this.runner.update(dt);
    const f = this.frame;
    f.dt = dt;
    f.time = time;
    for (const p of this.pieces) p.update(f);
    this.comms.update(dt);
    if (this.runner.outcome !== 'running' && this.outcomeAt < 0) this.outcomeAt = time;
  }

  /** Large set pieces that should slow supercruise (Monolith, Nexus, derelicts). */
  masses(): { position: Vector3; radius: number }[] {
    return this.pieces.filter((p) => p.kind === 'monolith' || p.kind === 'megagate' || p.kind === 'derelict' || p.kind === 'bastion');
  }

  /** Seconds since the mission resolved (−1 while running). */
  sinceOutcome(time: number): number {
    return this.outcomeAt < 0 ? -1 : time - this.outcomeAt;
  }

  /** Visible objectives for the HUD (hidden script cues filtered out). */
  visibleObjectives(): { text: string; state: string; optional: boolean }[] {
    return this.mission.objectives
      .map((o, i) => ({ o, st: this.runner.state[i] }))
      .filter(({ o }) => !o.hidden)
      .map(({ o, st }) => ({ text: o.text, state: st, optional: !!o.optional }));
  }

  dispose(): void {
    for (const p of this.pieces) {
      p.group.removeFromParent();
      p.dispose();
    }
    this.pieces.length = 0;
    this.comms.destroy();
    this.codex.destroy();
    postFx.flash = 0;
    postFx.jump = 0;
  }
}
