import { Vector3 } from 'three';
import type { ShipEntity } from '../Fleet';
import { GUN, inFiringSolution, leadPoint, noseAngleTo, setSpeed, steerToward } from './Pilot';
import { avoidance, type Obstacle } from './Avoid';
import { findChaser, flyFormation } from './Squadron';
import { isCapital, rand, setManeuver, type Brain } from './state';

/**
 * Milestone 14 — fighter brain.
 *
 * Two layers, both tiny:
 *
 *  think()  runs every `reaction` seconds (jittered). Picks a target (per the
 *           wingman order), checks for a hostile on our tail, and selects ONE
 *           maneuver with a short priority list — a flat behaviour tree:
 *
 *             formUp order          → form
 *             committed maneuver    → keep flying it (reversals, rolls, break)
 *             hostile on my tail    → break → jink / barrel roll / split-S
 *             no target             → form on leader, else patrol
 *             nose-to-nose, closing → headOn
 *             too close / overshoot → extend (boom & zoom) or reversal
 *             otherwise             → pursue (lead-shoot)
 *
 *  fly()    runs every frame. Executes the maneuver by writing ControlState,
 *           always through the Pilot primitives, with collision avoidance
 *           bent into the desired direction last.
 *
 * Perception lags reality by the pilot's reaction time (perceive()): the
 * brain aims at a filtered estimate of the target, never at ground truth.
 */

const _dir = new Vector3();
const _esc = new Vector3();
const _tmp = new Vector3();
const _los = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();
const _tf = new Vector3();

// ── perception ─────────────────────────────────────────────────────────

/** Track the current target through a reaction-time lag filter. */
export function perceive(s: ShipEntity, b: Brain, dt: number): void {
  const t = s.target;
  if (!t || !t.alive) {
    b.perceivedId = -1;
    return;
  }
  const tf = t.flight;
  if (b.perceivedId !== t.id) {
    b.perceivedId = t.id;
    b.pPos.copy(tf.position);
    b.pVel.copy(tf.velocity);
    b.pAcc.set(0, 0, 0);
    b.lastTVel.copy(tf.velocity);
    return;
  }
  if (dt <= 0) return;
  const k = 1 - Math.exp(-dt / Math.max(0.02, b.personality.reaction * 0.5));
  _tmp.subVectors(tf.velocity, b.lastTVel).divideScalar(dt);
  b.pAcc.lerp(_tmp, 1 - Math.exp(-dt / 0.25));
  b.lastTVel.copy(tf.velocity);
  b.pVel.lerp(tf.velocity, k);
  b.pPos.addScaledVector(b.pVel, dt).lerp(tf.position, k);
}

// ── target & threat selection ──────────────────────────────────────────

/**
 * Nearest-threatening target with weights: prefer what's ahead of the nose,
 * whoever is shooting at us, the player (scaled by aggression), our current
 * target (hysteresis), and spread out rather than dogpile.
 */
export function pickTarget(s: ShipEntity, b: Brain, ships: readonly ShipEntity[]): ShipEntity | null {
  const f = s.flight;
  f.forward(_fwd);
  let best: ShipEntity | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (!o.alive || o.faction === s.faction || isCapital(o)) continue;
    _tmp.subVectors(o.flight.position, f.position);
    const d = Math.max(1, _tmp.length());
    let score = d * (1.6 - 0.6 * (_fwd.dot(_tmp) / d));
    if (o.target === s) score *= 0.75;
    if (o.isPlayer) score *= 1 - 0.4 * b.personality.aggression;
    if (o === s.target) score *= 0.7;
    let piling = 0;
    for (let j = 0; j < ships.length; j++) {
      const a = ships[j];
      if (a !== s && a.alive && a.faction === s.faction && a.target === o) piling++;
    }
    score *= 1 + 0.3 * piling;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** A hostile fighter behind us, close, with its nose on us. */
export function findThreat(s: ShipEntity, ships: readonly ShipEntity[], range = 800): ShipEntity | null {
  const f = s.flight;
  f.forward(_fwd);
  let best: ShipEntity | null = null;
  let bestD = range;
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (!o.alive || o.faction === s.faction || isCapital(o)) continue;
    _tmp.subVectors(f.position, o.flight.position); // o → me
    const d = _tmp.length();
    if (d >= bestD || d < 1e-3) continue;
    _tmp.divideScalar(d);
    if (_fwd.dot(_tmp) < 0.45) continue; // not behind me
    if (o.flight.forward(_tf).dot(_tmp) < 0.93) continue; // not pointed at me
    bestD = d;
    best = o;
  }
  return best;
}

function syncPerception(s: ShipEntity, b: Brain): void {
  if (s.target && s.target.id !== b.perceivedId) perceive(s, b, 0);
}

// ── decisions ──────────────────────────────────────────────────────────

function startReversal(s: ShipEntity, b: Brain): void {
  const f = s.flight;
  f.forward(b.refDir);
  f.up(b.refUp);
  // Pull toward the target if it's "above" us, else roll inverted first.
  let upSide = rand(b) < 0.5;
  if (s.target) {
    _los.subVectors(b.pPos, f.position);
    upSide = _los.dot(b.refUp) >= 0;
  }
  setManeuver(b, upSide ? 'immelmann' : 'splitS', 4.5);
  b.sense = rand(b) < 0.5 ? 1 : -1;
}

function extendDistance(b: Brain): number {
  return 550 + 450 * (1 - b.personality.aggression);
}

export function think(s: ShipEntity, b: Brain, ships: readonly ShipEntity[]): void {
  const p = b.personality;
  const leader = b.leader && b.leader.alive && b.leader !== s ? b.leader : null;

  // 1. Target per standing order.
  switch (b.order) {
    case 'formUp':
      s.target = null;
      b.threat = null;
      if (leader && b.maneuver !== 'form') setManeuver(b, 'form');
      if (!leader) b.order = 'engageAtWill';
      else return;
      break;
    case 'attackMyTarget': {
      const lt = leader ? leader.target : null;
      s.target = lt && lt.alive && lt.faction !== s.faction ? lt : leader ? null : pickTarget(s, b, ships);
      break;
    }
    case 'coverMe':
      s.target = leader ? findChaser(leader, ships) : pickTarget(s, b, ships);
      break;
    case 'engageAtWill':
    case 'breakAndAttack':
      s.target = pickTarget(s, b, ships);
      break;
  }
  syncPerception(s, b);

  // 2. Committed maneuvers run to completion.
  const m = b.maneuver;
  const running = b.maneuverT < b.maneuverMax;
  if (running && (m === 'immelmann' || m === 'splitS' || m === 'scatter' || m === 'barrelRoll' || m === 'jink' || m === 'break')) return;
  if (m === 'scatter') {
    b.order = 'engageAtWill';
    s.target = pickTarget(s, b, ships);
    syncPerception(s, b);
  }

  // 3. Someone on my tail?
  b.threat = findThreat(s, ships, 900 - 250 * p.aggression);
  if (b.threat) {
    // Aggressive pilots hold a good firing solution a moment longer.
    const pressing = m === 'pursue' && s.target && noseAngleTo(s.flight, b.aim) < 0.08 && rand(b) < p.aggression * 0.6;
    if (!pressing) {
      if (m === 'break') {
        const r = rand(b);
        if (r < 0.4) setManeuver(b, 'jink', 1.8 + rand(b) * 1.4);
        else if (r < 0.75) setManeuver(b, 'barrelRoll', 1.8 + rand(b) * 0.8);
        else startReversal(s, b);
      } else {
        setManeuver(b, 'break', 1 + rand(b) * (1.4 - p.skill * 0.6));
      }
      b.sense = rand(b) < 0.5 ? 1 : -1;
      return;
    }
  }

  // 4. Nothing to fight: rejoin or patrol.
  if (!s.target) {
    const want = leader ? 'form' : 'patrol';
    if (m !== want) setManeuver(b, want);
    return;
  }

  // 5. Dogfight geometry (from perception).
  const f = s.flight;
  _los.subVectors(b.pPos, f.position);
  const d = Math.max(1, _los.length());
  _los.divideScalar(d);
  f.forward(_fwd);
  const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_los))));
  const aspect = Math.acos(Math.max(-1, Math.min(1, -s.target.flight.forward(_tf).dot(_los))));
  const closing = _tmp.subVectors(f.velocity, b.pVel).dot(_los);
  const minRange = 70 + 130 * (1 - p.aggression);

  if (m === 'extend') {
    if (running && d < extendDistance(b)) return;
    startReversal(s, b);
    return;
  }
  if (m === 'headOn' && angleOff < 1.4 && d > 120) return; // still converging
  if (m === 'headOn') {
    // Passed through: turn back in (reversal) or keep running and extend.
    if (d < 900 && rand(b) < 0.4 + 0.5 * p.skill) startReversal(s, b);
    else setManeuver(b, 'extend', 5);
    return;
  }
  if (angleOff < 0.5 && aspect < 0.5 && d > 260 && d < 2600 && closing > 120) {
    setManeuver(b, 'headOn');
    return;
  }
  if (d < minRange && angleOff > 0.45) {
    setManeuver(b, 'extend', 5); // too close to fight: boom-and-zoom out
    return;
  }
  if (d < 450 && angleOff > 2.0) {
    // Overshot: skilled pilots reverse, others extend and come back.
    if (rand(b) < p.skill) startReversal(s, b);
    else setManeuver(b, 'extend', 5);
    return;
  }
  if (p.aggression < 0.5 && d < 160 && m === 'pursue') {
    setManeuver(b, 'extend', 5); // cautious pilots slash and zoom
    return;
  }
  if (m !== 'pursue') setManeuver(b, 'pursue');
}

// ── execution ──────────────────────────────────────────────────────────

/** Steer along `dir` (unit, world) with collision avoidance blended in last. */
function steer(s: ShipEntity, b: Brain, dir: Vector3, up: Vector3 | null, dt: number, urgency: number): void {
  if (urgency > 0) dir.lerp(_esc, Math.min(1, urgency * 1.6)).normalize();
  steerToward(s.controls, s.flight, dir, up, b.pilot, dt, b.gains);
}

function friendlyInLine(s: ShipEntity, dist: number, ships: readonly ShipEntity[]): boolean {
  const f = s.flight;
  f.forward(_fwd);
  for (let i = 0; i < ships.length; i++) {
    const a = ships[i];
    if (a === s || !a.alive || a.faction !== s.faction) continue;
    _tmp.subVectors(a.flight.position, f.position);
    const along = _tmp.dot(_fwd);
    if (along <= 0 || along > dist + 30) continue;
    const r = a.radius + 8;
    if (_tmp.lengthSq() - along * along < r * r) return true;
  }
  return false;
}

/** Aim at the lead point and pull the trigger when the solution is good. */
function attack(s: ShipEntity, b: Brain, ships: readonly ShipEntity[], dt: number, time: number, urgency: number, headOn: boolean): void {
  const t = s.target!;
  const f = s.flight;
  const p = b.personality;
  _los.subVectors(b.pPos, f.position);
  const d = Math.max(1, _los.length());

  const tof = leadPoint(f.position, f.velocity, b.pPos, b.pVel, p.skill > 0.5 ? _tmp.copy(b.pAcc).multiplyScalar(p.skill) : null, b.aim);
  // Beyond gun range, lag toward pure pursuit so we don't cut across its bow early.
  if (tof < 0 || d > GUN.range * 1.4) b.aim.copy(b.pPos);
  // Pilot sloppiness: a smooth wobble on the aim point (even aces tremble a
  // little; a rookie's spray is several ship-widths at range). Two
  // frequencies so a burst isn't all-hit or all-miss.
  const n = d * (0.004 + (1 - p.skill) * 0.02);
  const ph = b.noisePhase;
  b.aim.x += (0.6 * Math.sin(time * 1.3 + ph) + 0.4 * Math.sin(time * 4.1 + ph * 2)) * n;
  b.aim.y += (0.6 * Math.sin(time * 1.7 + ph * 2) + 0.4 * Math.sin(time * 3.7 + ph * 3)) * n;
  b.aim.z += (0.6 * Math.sin(time * 1.1 + ph * 3) + 0.4 * Math.sin(time * 4.6 + ph)) * n;

  _dir.subVectors(b.aim, f.position).normalize();
  if (headOn && d < 380 + Math.max(0, _tf.subVectors(f.velocity, b.pVel).dot(_dir)) * 0.6) {
    // Pass offset: aim past its canopy instead of through it.
    _dir.addScaledVector(f.up(_up), 0.25).normalize();
  }
  steer(s, b, _dir, null, dt, urgency);

  // Speed: hold a firing range; burn in from far; slow to tighten a big turn.
  const angleOff = noseAngleTo(f, b.pPos);
  let spd: number;
  if (headOn) spd = f.spec.maxSpeed;
  else if (d > 1800) spd = f.spec.boostSpeed;
  else {
    const want = 200 + 250 * (1 - p.aggression);
    spd = b.pVel.length() + Math.max(-110, Math.min(200, (d - want) * 0.6));
    if (angleOff > 1.2) spd = Math.min(spd, f.spec.maxSpeed * 0.55);
    spd = Math.max(spd, f.spec.maxSpeed * 0.3);
  }
  setSpeed(s.controls, f, spd, d > 900);

  const slack = (1 - p.skill) * 0.012;
  if (urgency < 0.5 && inFiringSolution(f, b.aim, d, t.radius, slack) && !friendlyInLine(s, d, ships)) s.controls.fire = true;
}

/** Roll so the target sits in the lift plane (for pulls in reversals). */
function rollTargetUp(s: ShipEntity, b: Brain): number {
  const f = s.flight;
  if (!s.target) return -f.bodyRates.z * 0.3;
  _tmp.subVectors(b.pPos, f.position);
  f.forward(_fwd);
  f.up(_up);
  _tf.crossVectors(_up, _fwd); // up × fwd = body +X = left (right is −X)
  const right = -_tmp.dot(_tf);
  const upc = _tmp.dot(_up);
  if (Math.hypot(right, upc) < 1e-3) return 0;
  const phi = Math.atan2(right, upc);
  return Math.max(-1, Math.min(1, (3 * phi) / f.spec.rollRate));
}

function patrolDir(s: ShipEntity, b: Brain, out: Vector3): Vector3 {
  const f = s.flight;
  const l = b.leader && b.leader.alive && b.leader !== s ? b.leader : null;
  if (l) {
    out.subVectors(l.flight.position, f.position);
    if (out.lengthSq() > 1) return out.normalize();
  }
  return f.forward(out);
}

export function fly(s: ShipEntity, b: Brain, ships: readonly ShipEntity[], obstacles: readonly Obstacle[], dt: number, time: number): void {
  const urgency = flyManeuver(s, b, ships, obstacles, dt, time);
  // Imminent collision: burner off and throttle back — turn radius goes as v².
  if (urgency > 0.35) {
    const c = s.controls;
    c.afterburner = false;
    const cap = Math.max(0.35, 1 - urgency);
    c.throttleSet = Math.min(c.throttleSet ?? s.flight.throttle, cap);
  }
}

function flyManeuver(s: ShipEntity, b: Brain, ships: readonly ShipEntity[], obstacles: readonly Obstacle[], dt: number, time: number): number {
  const c = s.controls;
  const f = s.flight;
  const p = b.personality;
  b.maneuverT += dt;
  c.fire = false;
  c.throttleDelta = 0;
  c.flightAssistToggle = !f.flightAssist; // the AI always flies assisted
  const urgency = avoidance(s, ships, obstacles, _esc);
  const hasTarget = !!(s.target && s.target.alive);
  const directOverride = urgency > 0.2; // hand-flown maneuvers yield to avoidance

  switch (b.maneuver) {
    case 'form': {
      const l = b.leader;
      if (l && l.alive && l !== s) {
        flyFormation(s, b, l, dt, _esc, urgency);
        return urgency;
      }
      setManeuver(b, 'patrol');
      steer(s, b, patrolDir(s, b, _dir), null, dt, urgency);
      setSpeed(c, f, f.spec.maxSpeed * 0.65, false);
      return urgency;
    }

    case 'patrol': {
      steer(s, b, patrolDir(s, b, _dir), null, dt, urgency);
      setSpeed(c, f, f.spec.maxSpeed * 0.7, false);
      return urgency;
    }

    case 'pursue':
    case 'headOn':
      if (!hasTarget) {
        setManeuver(b, 'patrol');
        steer(s, b, f.forward(_dir), null, dt, urgency);
        return urgency;
      }
      attack(s, b, ships, dt, time, urgency, b.maneuver === 'headOn');
      return urgency;

    case 'break': {
      // Max-rate turn toward the side the attacker is on: build angle-off.
      const th = b.threat;
      f.forward(_fwd);
      if (th && th.alive) {
        _tmp.subVectors(th.flight.position, f.position);
        _tmp.addScaledVector(_fwd, -_tmp.dot(_fwd));
        if (_tmp.lengthSq() < 1) _tmp.copy(f.up(_up)).multiplyScalar(b.sense);
        b.refDir.copy(_tmp.normalize()).addScaledVector(_fwd, 0.1).normalize();
      } else if (b.maneuverT < dt * 1.5) {
        b.refDir.copy(f.up(_up)).addScaledVector(_fwd, 0.1).normalize();
      }
      _dir.copy(b.refDir);
      steer(s, b, _dir, null, dt, urgency);
      setSpeed(c, f, f.spec.maxSpeed * (0.5 + 0.1 * p.skill), false);
      return urgency;
    }

    case 'jink': {
      if (directOverride) break;
      const ph = b.noisePhase;
      c.roll = b.sense * (0.55 + 0.45 * Math.sin(time * 2.1 + ph));
      c.pitch = 0.3 + 0.7 * Math.sin(time * 3.7 + ph);
      c.yaw = 0.6 * Math.sin(time * 2.9 + ph * 2);
      setSpeed(c, f, f.spec.boostSpeed, true);
      return urgency;
    }

    case 'barrelRoll': {
      if (directOverride) break;
      c.roll = b.sense * 0.9;
      c.pitch = 0.6;
      c.yaw = 0;
      setSpeed(c, f, f.spec.maxSpeed * 0.9, false);
      return urgency;
    }

    case 'immelmann': {
      if (directOverride) break;
      f.forward(_fwd);
      if (b.phase === 0) {
        // Half loop: full pull, zoom on the burner, keep the target in the lift plane.
        c.pitch = 1;
        c.yaw = 0;
        c.roll = rollTargetUp(s, b) * 0.6;
        setSpeed(c, f, f.spec.boostSpeed, true);
        const onNose = hasTarget && noseAngleTo(f, b.pPos) < 0.35;
        if (onNose || _fwd.dot(b.refDir) < -0.55) {
          b.phase = 1;
          b.maneuverT = 0;
          b.maneuverMax = 0.9;
        }
      } else {
        // Roll upright at the top.
        if (hasTarget) _dir.subVectors(b.pPos, f.position).normalize();
        else _dir.copy(_fwd);
        steerToward(c, f, _dir, b.refUp, b.pilot, dt, b.gains);
        setSpeed(c, f, f.spec.maxSpeed, false);
      }
      if (b.maneuverT >= b.maneuverMax) setManeuver(b, hasTarget ? 'pursue' : 'patrol');
      return urgency;
    }

    case 'splitS': {
      if (directOverride) break;
      f.forward(_fwd);
      if (b.phase === 0) {
        // Half roll: bring the target (or "down") into the lift plane.
        c.pitch = 0;
        c.yaw = 0;
        const r = hasTarget ? rollTargetUp(s, b) : b.sense;
        c.roll = Math.abs(r) < 0.08 && hasTarget ? 0 : r;
        b.rollAccum += Math.abs(f.bodyRates.z) * dt;
        setSpeed(c, f, f.spec.maxSpeed * 0.45, false);
        if ((hasTarget && Math.abs(r) < 0.08 && b.maneuverT > 0.15) || b.rollAccum > Math.PI * 0.95 || b.maneuverT > 1.2) {
          b.phase = 1;
          b.maneuverT = 0;
          b.maneuverMax = 3.5;
        }
      } else {
        // Pull through.
        c.pitch = 1;
        c.yaw = 0;
        c.roll = rollTargetUp(s, b) * 0.5;
        setSpeed(c, f, f.spec.maxSpeed * 0.6, false);
        const onNose = hasTarget && noseAngleTo(f, b.pPos) < 0.35;
        if (onNose || _fwd.dot(b.refDir) < -0.6) setManeuver(b, hasTarget ? 'pursue' : 'patrol');
      }
      if (b.maneuverT >= b.maneuverMax) setManeuver(b, hasTarget ? 'pursue' : 'patrol');
      return urgency;
    }

    case 'extend': {
      // Boom and zoom: burn out along the current heading, angled off the target.
      f.forward(_dir);
      if (hasTarget) {
        _tmp.subVectors(f.position, b.pPos).normalize();
        _dir.multiplyScalar(1.4).add(_tmp).normalize();
      }
      steer(s, b, _dir, null, dt, urgency);
      setSpeed(c, f, f.spec.boostSpeed, true);
      return urgency;
    }

    case 'scatter': {
      _dir.copy(b.refDir);
      steer(s, b, _dir, null, dt, urgency);
      setSpeed(c, f, f.spec.boostSpeed, true);
      return urgency;
    }
  }

  // Hand-flown maneuver pre-empted by collision avoidance: fly the escape.
  f.forward(_dir).multiplyScalar(0.3);
  _dir.add(_esc).normalize();
  steerToward(c, f, _dir, null, b.pilot, dt, b.gains);
  setSpeed(c, f, f.spec.maxSpeed * 0.7, false);
  return urgency;
}
