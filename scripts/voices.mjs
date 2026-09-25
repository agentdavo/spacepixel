#!/usr/bin/env node
/**
 * npm run voices -- [--models DIR] [--python EXE] [--jobs 2]
 * npm run voices -- --check [--json]  (read-only; no Python/models required)
 * Models default to PIPER_MODELS or ./piper-models; Python to PIPER_PYTHON,
 * then an installed python/python3/py with the required recording modules.
 * Legacy clips are retained. Coverage checks the current authored vocabulary.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const validFile = (path) => { try { return statSync(path).isFile() && statSync(path).size > 0; } catch { return false; } };

export function coverage(catalog, out = join(root, 'public', 'voice')) {
  const manifestPath = join(out, 'manifest.json');
  const manifest = validFile(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const expected = new Set(catalog.lines.map((l) => l.key));
  const missing = catalog.lines.flatMap((l) => {
    const problems = [];
    if (!Number.isFinite(manifest[l.key]) || manifest[l.key] <= 0) problems.push('missing/invalid duration');
    if (!validFile(join(out, `${l.key}.mp3`))) problems.push('missing/empty clip');
    return problems.length ? [{ ...l, problems }] : [];
  });
  const retained = Object.keys(manifest).filter((k) => !expected.has(k));
  const unindexed = readdirSync(out).filter((f) => f.endsWith('.mp3') && !(f.slice(0, -4) in manifest));
  const exclusions = {};
  for (const l of catalog.excluded) exclusions[l.reason] = (exclusions[l.reason] ?? 0) + 1;
  return { required: expected.size, covered: expected.size - missing.length, missing,
    exclusions, excluded: catalog.excluded, retained, unindexed, subsystemNames: catalog.subsystemNames };
}

function summary(report, json) {
  if (json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`${report.covered}/${report.required} authored clips covered; ${report.missing.length} missing; ${report.retained.length} legacy entries retained.`);
  console.log(`Deliberate exclusions (unique speaker/text templates): ${JSON.stringify(report.exclusions)}`);
  console.log(`${report.subsystemNames.length} runtime subsystem labels; ${report.unindexed.length} unindexed files.`);
  for (const l of report.missing.slice(0, 12)) console.log(`  ${l.who}: ${l.text} (${l.problems.join(', ')})`);
  if (report.missing.length > 12) console.log('  Use --check --json for the complete list.');
}

function pythonCommand(explicit) {
  const candidates = explicit ? [[explicit]] : [['python'], ['python3'], ...(process.platform === 'win32' ? [['py', '-3']] : [])];
  for (const command of candidates) {
    const probe = spawnSync(command[0], [...command.slice(1), '-c', 'from piper import PiperVoice, SynthesisConfig; import numpy, lameenc'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (probe.status === 0) return command;
  }
  throw new Error('Recording needs Python with piper-tts, numpy and lameenc. Install them in a Python virtual environment, then pass --python <path-to-python> (or set PIPER_PYTHON). No clips were changed.');
}

export function main() {
  const { values } = parseArgs({ options: {
    check: { type: 'boolean' }, json: { type: 'boolean' }, models: { type: 'string' },
    python: { type: 'string' }, jobs: { type: 'string', default: '2' },
  } });
  if (values.json && !values.check) throw new Error('--json requires --check');
  if (!/^\d+$/.test(values.jobs) || Number(values.jobs) < 1) throw new Error('--jobs must be a positive integer');
  const emitted = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', join(root, 'scripts/voice-lines.ts'), '--catalog'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (emitted.status !== 0) throw new Error(emitted.stderr || emitted.error?.message || 'Voice enumeration failed');
  const catalog = JSON.parse(emitted.stdout);
  let report = coverage(catalog);
  if (values.check || !report.missing.length) {
    summary(report, values.json);
    return report.missing.length ? 1 : 0;
  }
  const python = pythonCommand(values.python ?? process.env.PIPER_PYTHON);
  const models = resolve(values.models ?? process.env.PIPER_MODELS ?? join(root, 'piper-models'));
  // Unique OS temporary directory: no shell redirection or POSIX environment expansion.
  const temp = mkdtempSync(join(tmpdir(), 'vanguard-voices-'));
  try {
    const lines = join(temp, 'lines.json');
    writeFileSync(lines, JSON.stringify(catalog.lines), 'utf8');
    const run = spawnSync(python[0], [...python.slice(1), join(root, 'scripts/voice-record.py'), lines, '--models', models, '--jobs', values.jobs],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    report = coverage(catalog);
    summary(report, false);
    return run.status === 0 && !report.missing.length ? 0 : 1;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
