import { Vector3, type Group, type Scene } from 'three';
import type { LightPreset } from '@/render/LightRig';
import type { ShipEntity } from '@/sim/Fleet';
import type { SurfacePortSite, Universe } from '@/universe/Universe';
import type { DockingController, Dockable } from '../Docking';
import type { StarSystemView } from '../StarSystemView';
import type { StationView } from '../Station';
import { SurfaceWorld } from './SurfaceWorld';
import { DT, descentDockable } from './Descent';

/**
 * Flight-scene glue for planetary ports: the surface layer, one landing
 * corridor dockable per orbital port with a city under it, berthing straight
 * onto a pad (saves, free-flight starts), and the `?descent=` captures.
 */
export interface PortsHost {
  readonly scene: Scene;
  readonly root: Group;
  readonly universe: Universe;
  readonly docking: DockingController;
  view(): StarSystemView;
  player(): ShipEntity;
  ships(): readonly ShipEntity[];
  warpTo(systemId: string): void;
  quiet(): void;
  placePlayer(pos: Vector3, dir: Vector3, speed: number): void;
  closeDockScreen(): void;
  /** Show / hide the space world (system view + backdrop). */
  setSpaceVisible(v: boolean): void;
  systemLight(): LightPreset;
}

/** `?descent=` beats → sequence time (s). */
const BEATS: Record<string, { phase: 'auto' | 'launch'; t: number }> = {
  entry: { phase: 'auto', t: 3.6 },
  clouds: { phase: 'auto', t: 6.4 },
  below: { phase: 'auto', t: 8.8 },
  glide: { phase: 'auto', t: 13.5 },
  final: { phase: 'auto', t: 20.5 },
  liftoff: { phase: 'launch', t: 2.2 },
  climb: { phase: 'launch', t: 6.5 },
  orbit: { phase: 'launch', t: 10.4 },
};

export class PlanetaryPorts {
  readonly surface: SurfaceWorld;
  private docks = new WeakMap<StationView, Dockable>();
  private hidden = new Set<ShipEntity>();

  constructor(private host: PortsHost) {
    this.surface = new SurfaceWorld(host.scene, host.root, { setSpaceVisible: (v) => host.setSpaceVisible(v), systemLight: () => host.systemLight() });
    host.docking.descent = (st) => this.dockable(st);
  }

  get active(): boolean {
    return this.surface.active;
  }

  /** The landing corridor under `st` (orbital ports with a surface port). */
  dockable(st: StationView): Dockable | null {
    if (!st.surface) return null;
    let d = this.docks.get(st);
    if (!d) {
      d = descentDockable(st, this.surface) ?? undefined;
      if (!d) return null;
      this.docks.set(st, d);
    }
    return d;
  }

  /** Per frame, after the world has been synced: surface scene + keep space ships out of the city. */
  update(time: number): void {
    this.surface.update(time);
    const player = this.host.player();
    if (this.surface.active) {
      for (const s of this.host.ships()) {
        if (s === player || !s.model.root.visible) continue;
        s.model.root.visible = false;
        this.hidden.add(s);
      }
    } else if (this.hidden.size) {
      for (const s of this.hidden) s.model.root.visible = s.alive;
      this.hidden.clear();
    }
  }

  /** Every surface port in the Reach (markets for the ticker). */
  markets(): SurfacePortSite[] {
    return [...this.host.universe.systems.values()].flatMap((s) => s.surfacePorts ?? []);
  }

  private find(portId: string): { port: SurfacePortSite; system: string } | null {
    for (const s of this.host.universe.systems.values()) {
      const port = s.surfacePorts?.find((p) => p.id === portId);
      if (port) return { port, system: s.id };
    }
    return null;
  }

  /** The landing corridor dockable for a port id (warping to its system first). */
  private corridor(portId: string): Dockable | null {
    const hit = this.find(portId);
    if (!hit) return null;
    this.host.warpTo(hit.system);
    const st = this.host.view().stations.find((x) => x.site.id === hit.port.orbital);
    return st ? this.dockable(st) : null;
  }

  /** Berth on a surface port's pad (saves / free-flight starts / captures). */
  berthAt(portId: string): boolean {
    const d = this.corridor(portId);
    if (!d) return false;
    const pos = d.bay.clone().addScaledVector(d.axis, 1200);
    this.host.placePlayer(pos, d.axis.clone().negate(), 60);
    this.host.docking.berth(d);
    return true;
  }

  /**
   * ?descent=corridor|entry|clouds|below|glide|final|pad|docked|liftoff|climb|orbit [&port=<id>] [&dockt=S]
   * (default port: the first in the Reach; `dockt` overrides the beat's time).
   */
  stage(mode: string, q: URLSearchParams): void {
    const portId = q.get('port') ?? this.markets()[0]?.id ?? '';
    const d = this.corridor(portId);
    if (!d) return;
    this.host.quiet();
    const dk = this.host.docking;
    const t = Number(q.get('dockt') ?? NaN);
    if (mode === 'corridor') {
      // Cleared, flying down beside the tether 4 km above the entry gate.
      this.host.placePlayer(d.bay.clone().addScaledVector(d.axis, 4200).addScaledVector(d.up, 140), d.axis.clone().negate(), 260);
      dk.clear(d);
      return;
    }
    if (mode === 'pad' || mode === 'docked') {
      this.berthAt(portId);
      if (mode === 'pad') this.host.closeDockScreen();
      return;
    }
    const beat = BEATS[mode] ?? BEATS.entry;
    if (beat.phase === 'auto') {
      this.host.placePlayer(d.bay.clone().addScaledVector(d.axis, 1800), d.axis.clone().negate(), 300);
      dk.clear(d);
      dk.skipTo = Number.isFinite(t) ? t : beat.t;
    } else {
      this.berthAt(portId);
      this.host.closeDockScreen();
      dk.launch();
      dk.t = Math.min(DT.out - 0.1, Number.isFinite(t) ? t : beat.t);
    }
  }
}
