import { Box3, Group, MathUtils, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import { BLUEPRINTS } from '@/assets/blueprints';
import { FACTIONS } from '@/assets/Factions';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';

/**
 * Shipyard lineups for the hangar (`?scene=hangar&cam=6..10`): scale charts
 * of the shipyard designs — the Vanguard progression line, Rustwake clans,
 * civilian traffic and line warships — standing in true relative size,
 * nose to screen-right, each with an ink-and-paint caption (designation,
 * name, tier, length) projected under the hull.
 */

export interface LineupSpec {
  name: string;
  /** Rows, front row first; each row is a list of blueprint ids, small → large. */
  rows: string[][];
  /** Camera elevation (radians) and yaw offset for the three-quarter view. */
  elevation?: number;
  fov?: number;
}

export const SHIPYARD_LINEUPS: LineupSpec[] = [
  {
    name: 'SHIPYARD · FIGHTER LINE (T1–T3)',
    rows: [
      ['vf27-kestrel', 'vf27s-super-kestrel', 'vf31-harrier', 'vf40-gauntlet'],
      ['rw-scrapjack', 'choir-seraph', 'rw-gaff', 'civ-swallow', 'rw-knuckleduster'],
    ],
    elevation: 0.42,
    fov: 26,
  },
  {
    name: 'SHIPYARD · PROGRESSION T3 → T6',
    rows: [['vf40-gauntlet', 'gs12-bulwark', 'cr5-resolute', 'ffl3-valiant']],
    elevation: 0.3,
    fov: 28,
  },
  {
    name: 'RUSTWAKE CLANS',
    rows: [['rw-scrapjack', 'rw-gaff', 'rw-knuckleduster', 'rw-bulldog', 'rw-mother-lode']],
    elevation: 0.3,
    fov: 28,
  },
  {
    name: 'CIVIL TRAFFIC',
    rows: [['civ-swallow', 'civ-tallow', 'civ-longhaul', 'civ-umbra', 'civ-meridian-star']],
    elevation: 0.3,
    fov: 28,
  },
  {
    name: 'LINE WARSHIPS · CORVETTE → DESTROYER',
    rows: [['ffc-lantern-guard', 'choir-vesper', 'cr5-resolute', 'ffl3-valiant', 'choir-canticle', 'ddg40-arbiter']],
    elevation: 0.3,
    fov: 28,
  },
];

interface Placed {
  ship: ShipModel;
  id: string;
  /** Caption anchor (world, scene coords). */
  anchor: Vector3;
  label: HTMLDivElement;
}

export interface BuiltLineup {
  name: string;
  group: Group;
  fov: number;
  frame(t: number, aspect: number): [Vector3, Vector3];
}

const YAW = MathUtils.degToRad(64); // nose to screen-right, a little toward camera

/** Caption text for a blueprint: designation · name, then tier · length · maker. */
export function shipCaption(id: string, length: number): { title: string; sub: string; faction: string } {
  const bp = BLUEPRINTS[id];
  const cat = CATALOG_BY_ID[id];
  const title = `${bp.designation.replace(/\s*".*"$/, '')} ${bp.name.toUpperCase()}`;
  const len = `${Math.round(length)} m`;
  const sub = cat ? `T${cat.tier} · ${len} · ${cat.role.toUpperCase()}${cat.purchasable ? ` · ${cat.price.toLocaleString('en-US')} SH` : ''}` : `${len} · ${bp.shipClass.toUpperCase()}`;
  const faction = cat?.faction === 'civil' ? 'CIVIL' : FACTIONS[bp.faction].short;
  return { title, sub, faction };
}

/**
 * Builds every lineup into its own (hidden) group on `scene` and owns the
 * HTML captions. Call `update()` each frame with the active lineup index.
 */
export class ShipyardLineups {
  readonly lineups: BuiltLineup[] = [];
  private readonly placed: Placed[][] = [];
  private readonly overlay: HTMLDivElement;
  private active = -1;

  constructor(scene: Scene, specs: LineupSpec[] = SHIPYARD_LINEUPS) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'shipyard-captions';
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:"Share Tech Mono",monospace;';
    document.getElementById('ui-root')?.append(this.overlay);
    specs.forEach((spec, i) => {
      const group = new Group();
      group.name = `shipyard:${i}`;
      group.visible = false;
      scene.add(group);
      const placed: Placed[] = [];
      let rowZ = 0;
      spec.rows.forEach((row, r) => {
        let x = 0;
        let rowDepth = 0;
        let prevLen = 0;
        const rowPlaced: Placed[] = [];
        for (const id of row) {
          const bp = BLUEPRINTS[id];
          if (!bp) continue;
          const ship = buildShip(bp);
          ship.setThrottle(0.35);
          ship.root.rotation.y = YAW;
          for (const [, a] of ship.articulations) if (a.channel === 'bay') ship.setChannel('bay', 0);
          ship.root.updateMatrixWorld(true);
          const b = new Box3();
          for (const m of ship.meshes) b.expandByObject(m);
          const size = b.getSize(new Vector3());
          const gap = Math.max(6, 0.22 * Math.max(prevLen, ship.length));
          if (rowPlaced.length) x += gap;
          // Stand on y = 0, left edge at x, centred in depth on the row line.
          ship.root.position.set(x - b.min.x, -b.min.y, rowZ - (b.min.z + b.max.z) / 2);
          x += size.x;
          prevLen = ship.length;
          rowDepth = Math.max(rowDepth, size.z);
          group.add(ship.root);
          ship.root.updateMatrixWorld(true);
          const wb = new Box3();
          for (const m of ship.meshes) wb.expandByObject(m);
          const label = this.makeLabel(id, ship.length);
          rowPlaced.push({ ship, id, anchor: new Vector3((wb.min.x + wb.max.x) / 2, wb.min.y, wb.max.z), label });
        }
        // Centre the row on x = 0.
        const shift = -x / 2;
        for (const p of rowPlaced) {
          p.ship.root.position.x += shift;
          p.anchor.x += shift;
        }
        placed.push(...rowPlaced);
        rowZ -= rowDepth * 1.25 + (r === 0 ? 10 : 0);
      });
      // Recompute a clean extent after centring.
      const box = new Box3();
      for (const p of placed) for (const m of p.ship.meshes) box.expandByObject(m);
      this.placed.push(placed);
      const fov = spec.fov ?? 28;
      const elev = spec.elevation ?? 0.3;
      const centre = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      this.lineups.push({
        name: spec.name,
        group,
        fov,
        frame: (t, aspect) => {
          const vh = Math.tan(MathUtils.degToRad(fov) / 2);
          const halfW = size.x / 2 + size.z * 0.15;
          const dist = Math.max(halfW / (vh * aspect), (size.y * 1.4 + size.z * Math.sin(elev)) / vh) * 1.12 + size.z / 2;
          const sway = Math.sin(t * 0.07) * 0.035;
          const dir = new Vector3(Math.sin(sway) * 0.5, Math.sin(elev), Math.cos(elev)).normalize();
          const target = centre.clone().add(new Vector3(0, -size.y * 0.12, 0));
          return [target.clone().addScaledVector(dir, dist), target];
        },
      });
    });
  }

  private makeLabel(id: string, length: number): HTMLDivElement {
    const { title, sub, faction } = shipCaption(id, length);
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;transform:translate(-50%,0);text-align:center;white-space:nowrap;color:#f3eee2;letter-spacing:.12em;' +
      'text-shadow:0 0 3px #000,0 0 8px rgba(0,0,0,.8);display:none;';
    el.innerHTML =
      `<div style="font-size:10px;color:#ffb35c">${faction}</div>` +
      `<div style="font-size:12px;font-weight:bold">${title}</div>` +
      `<div style="font-size:10px;color:#a9d8ff">${sub}</div>`;
    this.overlay.append(el);
    return el;
  }

  /** Show lineup `index` (or none with -1) and place its captions. */
  update(index: number, camera: PerspectiveCamera, time: number): void {
    if (index !== this.active) {
      this.lineups.forEach((l, i) => (l.group.visible = i === index));
      this.placed.forEach((list, i) => list.forEach((p) => (p.label.style.display = i === index ? 'block' : 'none')));
      this.active = index;
    }
    if (index < 0) return;
    const w = this.overlay.clientWidth || window.innerWidth;
    const h = this.overlay.clientHeight || window.innerHeight;
    const v = new Vector3();
    this.placed[index].forEach((p, i) => {
      p.ship.setThrottle(0.35 + Math.sin(time * 6.3 + p.anchor.x) * 0.04);
      if (p.ship.articulations.has('radar')) p.ship.setArticulation('radar', time * 1.2);
      if (p.ship.articulations.has('drill')) p.ship.setArticulation('drill', time * 0.8);
      v.copy(p.anchor);
      v.project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      p.label.style.display = visible ? 'block' : 'none';
      p.label.style.left = `${((v.x + 1) / 2) * w}px`;
      // Stagger neighbours so captions under small hulls never collide.
      p.label.style.top = `${((1 - v.y) / 2) * h + 6 + (i % 2) * 44}px`;
    });
  }
}
