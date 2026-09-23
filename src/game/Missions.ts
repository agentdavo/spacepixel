/**
 * Milestone 18 — mission structure.
 *
 * A mission is data: briefing text, and an ordered list of objectives whose
 * completion is tested against the live sim each frame by small predicate
 * functions (no event plumbing). Objectives unlock in order; optional ones
 * run in parallel. The runner exposes plain state for the HUD.
 */
export interface MissionContext {
  /** Seconds since mission start. */
  time: number;
  systemId: string;
  /** Distance (m) from the player to the Lantern leading to `gateTo`, if present. */
  gateDistance(gateTo?: string): number;
  kills(faction: string): number;
  jumps: number;
  playerAlive: boolean;
  allyAlive(name: string): boolean;
}

export interface ObjectiveDef {
  id: string;
  text: string;
  optional?: boolean;
  done(ctx: MissionContext): boolean;
  failed?(ctx: MissionContext): boolean;
}

export interface MissionDef {
  id: string;
  episode: string;
  title: string;
  system: string;
  briefing: string;
  /** Draw the tactical diagram on the briefing screen (canvas 2D). */
  diagram?(c: CanvasRenderingContext2D, w: number, h: number, t: number): void;
  objectives: ObjectiveDef[];
}

export type ObjectiveState = 'locked' | 'active' | 'done' | 'failed';

export class MissionRunner {
  readonly state: ObjectiveState[];
  outcome: 'running' | 'success' | 'failure' = 'running';

  constructor(readonly def: MissionDef) {
    this.state = def.objectives.map((o, i) => (i === 0 || o.optional ? 'active' : 'locked'));
  }

  update(ctx: MissionContext): void {
    if (this.outcome !== 'running') return;
    if (!ctx.playerAlive) {
      this.outcome = 'failure';
      return;
    }
    this.def.objectives.forEach((o, i) => {
      if (this.state[i] !== 'active') return;
      if (o.failed?.(ctx)) {
        this.state[i] = 'failed';
        if (!o.optional) this.outcome = 'failure';
      } else if (o.done(ctx)) {
        this.state[i] = 'done';
        const next = this.def.objectives.findIndex((x, j) => j > i && !x.optional && this.state[j] === 'locked');
        if (next >= 0) this.state[next] = 'active';
      }
    });
    if (this.def.objectives.every((o, i) => o.optional || this.state[i] === 'done')) this.outcome = 'success';
  }
}

// ── Episode 01 ─────────────────────────────────────────────────────────

export const FIRST_LIGHT: MissionDef = {
  id: 'ep01-first-light',
  episode: 'EPISODE 01',
  title: 'FIRST LIGHT',
  system: 'meridian',
  briefing:
    'VANGUARD FLIGHT, THIS IS HESPERUS DAWN ACTUAL.\n\n' +
    'Picket drones at the Castellan Lantern reported a harmonic on the jump band ' +
    'eleven minutes ago. Then they stopped reporting.\n\n' +
    'Take your flight to the Lantern. If the Choir has put scouts through, ' +
    'you will engage and destroy them before they can sing the gate open ' +
    'for anything larger.\n\n' +
    'Then go through. We need eyes on the far side.\n\n' +
    'Keep your wingmen close. Hesperus Dawn out.',
  objectives: [
    { id: 'approach', text: 'Fly to the Castellan Lantern', done: (c) => c.gateDistance() < 1500 },
    { id: 'scouts', text: 'Destroy 3 Choir scouts', done: (c) => c.kills('choir') >= 3 },
    { id: 'jump', text: 'Jump through the Lantern', done: (c) => c.jumps >= 1 },
    { id: 'wing', text: 'Bring both wingmen home', optional: true, done: (c) => c.jumps >= 1, failed: (c) => !c.allyAlive('Vanguard 2') || !c.allyAlive('Vanguard 3') },
  ],
  diagram(c, w, h, t) {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(125,255,178,0.15)';
    for (let x = 0; x < w; x += w / 12) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 0; y < h; y += h / 9) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    // Lantern.
    const gx = w * 0.72;
    const gy = h * 0.4;
    c.strokeStyle = '#6fe6ff';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(gx, gy, 16, 40, 0.3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#6fe6ff';
    c.font = '11px monospace';
    c.fillText('CASTELLAN LANTERN', gx - 50, gy + 58);
    // Friendly flight + route.
    const fx = w * 0.18;
    const fy = h * 0.68;
    c.strokeStyle = '#7dffb2';
    c.setLineDash([6, 4]);
    c.lineDashOffset = -t * 20;
    c.beginPath();
    c.moveTo(fx, fy);
    c.quadraticCurveTo(w * 0.4, h * 0.45, gx - 18, gy);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#7dffb2';
    for (const [dx, dy] of [[0, 0], [-12, 10], [12, 12]]) {
      c.beginPath();
      c.moveTo(fx + dx + 8, fy + dy);
      c.lineTo(fx + dx - 6, fy + dy - 5);
      c.lineTo(fx + dx - 6, fy + dy + 5);
      c.fill();
    }
    c.fillText('VANGUARD', fx - 26, fy + 32);
    // Bandits, blinking.
    if ((t * 2) % 1 < 0.6) {
      c.fillStyle = '#ff5fb4';
      for (let i = 0; i < 3; i++) {
        const a = t * 0.6 + i * 2.1;
        const bx = gx + Math.cos(a) * 60;
        const by = gy + Math.sin(a) * 40;
        c.fillRect(bx - 3, by - 3, 6, 6);
      }
      c.fillText('BANDITS ×3 (EST.)', gx + 30, gy - 50);
    }
  },
};

export const MISSIONS: MissionDef[] = [FIRST_LIGHT];
