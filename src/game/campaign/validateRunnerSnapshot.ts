import type { RunnerSnapshot } from '../CampaignRunner';
import type { CampaignMission } from './types';

function requireValue(condition: boolean, path: string, expected: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid campaign snapshot at ${path}: expected ${expected}`);
}

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'an object');
}

function array(value: unknown, path: string): asserts value is unknown[] {
  requireValue(Array.isArray(value), path, 'an array');
}

function finite(value: unknown, path: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value), path, 'a finite number');
}

function nonnegative(value: unknown, path: string): asserts value is number {
  finite(value, path);
  requireValue(value >= 0, path, 'a nonnegative number');
}

function index(value: unknown, length: number, path: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length, path, `an index in [0, ${length})`);
}

function vector(value: unknown, path: string): void {
  array(value, path);
  requireValue(value.length === 3, path, 'three coordinates');
  for (let i = 0; i < 3; i++) finite(value[i], `${path}[${i}]`);
}

function pairs(value: unknown, path: string, check: (value: unknown, path: string) => void): void {
  array(value, path);
  const keys = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const p = `${path}[${i}]`;
    array(entry, p);
    requireValue(entry.length === 2, p, 'a key/value pair');
    requireValue(typeof entry[0] === 'string', `${p}[0]`, 'a string');
    requireValue(!keys.has(entry[0]), `${p}[0]`, 'a unique key');
    keys.add(entry[0]);
    check(entry[1], `${p}[1]`);
  }
}

/**
 * Validate the complete plain-JSON payload before restore mutates the runner
 * or invokes its host. This is data validation, not a host-callback transaction.
 * Keep the existing schema and mission array indices; no content migration.
 */
export function validateRunnerSnapshot(value: unknown, mission: CampaignMission): asserts value is RunnerSnapshot {
  record(value, 'snapshot');
  nonnegative(value.time, 'time');
  pairs(value.flags, 'flags', nonnegative);
  array(value.state, 'state');
  requireValue(value.state.length === mission.objectives.length, 'state', 'one state per mission objective');
  for (let i = 0; i < value.state.length; i++) {
    requireValue(['locked', 'active', 'done', 'failed'].includes(value.state[i] as string), `state[${i}]`, 'an objective state');
  }
  array(value.fired, 'fired');
  const fired = new Set<string>();
  for (let i = 0; i < value.fired.length; i++) {
    const id = value.fired[i];
    requireValue(typeof id === 'string' && !fired.has(id), `fired[${i}]`, 'a unique string');
    fired.add(id);
  }
  pairs(value.kills, 'kills', (n, p) => {
    nonnegative(n, p);
    requireValue(Number.isSafeInteger(n), p, 'a nonnegative integer');
  });
  pairs(value.dwells, 'dwells', (n, p) => {
    nonnegative(n, p);
    requireValue(n <= 1, p, 'progress in [0, 1]');
  });
  array(value.released, 'released');
  const released = new Set<number>();
  for (let i = 0; i < value.released.length; i++) {
    const n = value.released[i];
    index(n, mission.spawns.length, `released[${i}]`);
    requireValue(!released.has(n), `released[${i}]`, 'a unique spawn index');
    released.add(n);
  }
  array(value.ships, 'ships');
  const members = new Set<string>();
  for (let i = 0; i < value.ships.length; i++) {
    const ship = value.ships[i];
    const p = `ships[${i}]`;
    record(ship, p);
    index(ship.spawn, mission.spawns.length, `${p}.spawn`);
    index(ship.member, mission.spawns[ship.spawn].count, `${p}.member`);
    requireValue(released.has(ship.spawn), `${p}.spawn`, 'a released spawn index');
    const key = `${ship.spawn}:${ship.member}`;
    requireValue(!members.has(key), p, 'a unique spawn/member pair');
    members.add(key);
    requireValue(typeof ship.alive === 'boolean', `${p}.alive`, 'a boolean');
    vector(ship.pos, `${p}.pos`);
    vector(ship.vel, `${p}.vel`);
    // Damage can leave dead ships below zero. Preserve the existing restore
    // hull clamp and accept any finite fraction, including those dead records.
    finite(ship.hull, `${p}.hull`);
  }
  // Missing members are valid: a second snapshot after restore omits the dead.
}
