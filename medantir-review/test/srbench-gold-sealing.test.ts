import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { SrReviewModelPort } from '../src/benchmark/sr-reproduction-benchmark.js';
import { runSrBenchmarkTournament } from '../src/benchmark/sr-benchmark-suite.js';

class GoldProbePort implements SrReviewModelPort {
  readonly observations: Array<{ taskId: string; gold: boolean; scorer: boolean; critical: boolean }> = [];

  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    const task = input.task as unknown as Record<string, unknown>;
    this.observations.push({
      taskId: String(task.id),
      gold: Object.prototype.hasOwnProperty.call(task, 'gold'),
      scorer: Object.prototype.hasOwnProperty.call(task, 'scorer'),
      critical: Object.prototype.hasOwnProperty.call(task, 'critical'),
    });
    return {
      output: { deliberatelyWrong: true },
      routing: { requestedModel: input.model, actualModel: 'probe-model', provider: 'fixture-provider' },
    };
  }
}

test('tournament seals gold/scorer/critical metadata from every model adapter call', async () => {
  const port = new GoldProbePort();
  const tournament = await runSrBenchmarkTournament({
    suitePath: resolve('benchmarks/srbench-v1/suite.json'),
    models: ['probe'],
    repeats: 1,
    port,
  });
  assert.ok(port.observations.length > 0);
  assert.equal(port.observations.every((item) => !item.gold && !item.scorer && !item.critical), true);
  assert.equal(tournament.runs.every((run) => run.sr100 === false), true);
});
