import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Perf } from '../src/core/Perf.ts';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const calls: string[] = [];
  const renderer = {
    backend: { isWebGPUBackend: true, trackTimestamp: true },
    info: { compute: { calls: 0 } },
    resolveTimestampsAsync: async (kind: string): Promise<number | undefined> => { calls.push(kind); return kind === 'render' ? 4 : 2; },
  };
  const perf = new Perf(renderer as never);
  return { renderer, perf, calls };
}

test('profiling excludes warmup and includes compute only when dispatched during the sampled frame', async () => {
  const { renderer, perf, calls } = fixture(); perf.warmupFrames = 2;
  for (const t of [0, 1000]) { perf.begin(t); renderer.info.compute.calls++; perf.end(-1); }
  assert.equal(perf.cpu.count, 0); assert.equal(perf.interval.count, 0); assert.deepEqual(calls, []);
  perf.begin(1016); renderer.info.compute.calls++; perf.end(-1); await settle();
  assert.equal(perf.cpu.count, 1); assert.equal(perf.interval.at(0), 16);
  assert.equal(perf.gpu.at(0), 6); assert.equal(perf.gpuRender.at(0), 4); assert.equal(perf.gpuCompute.at(0), 2);
  perf.begin(1032); perf.end(-1); await settle();
  assert.equal(perf.gpu.at(0), 4); assert.equal(perf.gpuCompute.at(0), 0);
  assert.deepEqual(calls, ['render', 'compute', 'render']);
});

test('a first sample without compute cannot reuse warmup compute timestamps', async () => {
  const { renderer, perf, calls } = fixture(); perf.warmupFrames = 1;
  perf.begin(0); renderer.info.compute.calls += 50; perf.end(-1);
  perf.begin(16); perf.end(-1); await settle();
  assert.deepEqual(calls, ['render']); assert.equal(perf.gpu.at(0), 4);
});

test('timestamp rejection is counted and does not wedge future measurements', async () => {
  const { renderer, perf } = fixture(); perf.warmupFrames = 0;
  renderer.resolveTimestampsAsync = async () => { throw new Error('device lost'); };
  perf.begin(0); perf.end(-1); await settle();
  assert.equal(perf.summary().timingErrors, 1); assert.equal(perf.summary().gpuSamples, 0);
  assert.equal(perf.summary().gpuRender.p95, null);
  renderer.resolveTimestampsAsync = async () => 3;
  perf.begin(16); perf.end(-1); await settle();
  assert.equal(perf.summary().gpuSamples, 1); assert.equal(perf.gpu.at(0), 3);
});

test('missing and nonfinite timestamps never become valid GPU samples', async () => {
  const { renderer, perf } = fixture(); perf.warmupFrames = 0;
  for (const value of [undefined, 0, NaN, Infinity]) {
    renderer.resolveTimestampsAsync = async () => value;
    perf.begin(16); perf.end(-1); await settle();
  }
  assert.equal(perf.summary().gpuSamples, 0); assert.equal(perf.summary().gpuRender.p95, null);
});
