import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  runSrBenchmarkCase,
  validateSrBenchmarkCase,
  type SrBenchmarkCase,
  type SrModelVisibleTask,
  type SrReviewModelPort,
} from '../src/benchmark/sr-reproduction-benchmark.js';
import { loadSrBenchmarkCase } from '../src/benchmark/sr-benchmark-suite.js';
import { buildSr100PromotionDossier } from '../src/benchmark/sr100-promotion.js';

function goldOracle(caseDefinition: SrBenchmarkCase): Map<string, unknown> {
  return new Map(caseDefinition.tasks.map((task) => [task.id, structuredClone(task.gold)]));
}

class OraclePort implements SrReviewModelPort {
  readonly seen = new Map<string, SrModelVisibleTask>();
  constructor(protected readonly oracle: Map<string, unknown>) {}

  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    this.seen.set(input.task.id, structuredClone(input.task));
    if (!this.oracle.has(input.task.id)) throw new Error(`No test oracle for ${input.task.id}`);
    return {
      output: structuredClone(this.oracle.get(input.task.id)),
      routing: {
        requestedModel: input.model,
        actualModel: `${input.model}-pinned`,
        provider: 'fixture-provider',
      },
    };
  }
}

class FalseNegativeCascadePort extends OraclePort {
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    this.seen.set(input.task.id, structuredClone(input.task));
    if (input.task.id === 'fixture-tiab') {
      return {
        output: { decisions: [{ id: 'r1', decision: 'exclude' }, { id: 'r2', decision: 'exclude' }, { id: 'r3', decision: 'include' }] },
        routing: { requestedModel: input.model, actualModel: `${input.model}-pinned`, provider: 'fixture-provider' },
      };
    }
    if (input.task.id === 'fixture-fulltext') {
      const tiab = input.task.upstream.find((item) => item.taskId === 'fixture-tiab');
      const decisions = (tiab?.output as { decisions?: Array<{ id: string; decision: string }> } | undefined)?.decisions ?? [];
      const r1 = decisions.find((item) => item.id === 'r1');
      if (r1?.decision === 'exclude') {
        return {
          output: { decisions: [{ id: 'r1', decision: 'exclude' }, { id: 'r3', decision: 'exclude' }] },
          routing: { requestedModel: input.model, actualModel: `${input.model}-pinned`, provider: 'fixture-provider' },
        };
      }
    }
    return super.completeJson(input);
  }
}

class HashLyingPort extends OraclePort {
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    const response = await super.completeJson(input);
    return { ...response, outputHash: '0'.repeat(64) };
  }
}

const fixturePath = resolve('benchmarks/srbench-v1/synthetic-complete/case.json');
const jakPath = resolve('benchmarks/srbench-v1/jak-covid-2021/case.json');

test('complete synthetic fixture can achieve SR100 only with exact closed-loop reproduction of every stage', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const port = new OraclePort(goldOracle(loaded.definition));
  const result = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'perfect-model', port });
  assert.equal(loaded.benchmarkClass, 'synthetic-fixture');
  assert.equal(result.pipelineCoverage, 100);
  assert.equal(result.reproductionScore, 100);
  assert.equal(result.effectiveScore, 100);
  assert.equal(result.criticalFailures.length, 0);
  assert.equal(result.sr100, true);
  assert.ok(result.taskScores.every((item) => item.exact));

  const report = port.seen.get('fixture-report');
  assert.ok(report);
  assert.deepEqual(report!.upstream.map((item) => item.taskId), ['fixture-synthesis', 'fixture-appraisal']);
  assert.equal(report!.upstream.every((item) => /^[a-f0-9]{64}$/.test(item.outputHash)), true);
});

test('a false exclusion propagates into downstream full-text state and causes a second failure', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const port = new FalseNegativeCascadePort(goldOracle(loaded.definition));
  const result = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'unsafe-model', port });
  const screening = result.taskScores.find((item) => item.taskId === 'fixture-tiab');
  const fulltext = result.taskScores.find((item) => item.taskId === 'fixture-fulltext');
  assert.ok(screening && fulltext);
  assert.equal(screening!.exact, false);
  assert.equal(fulltext!.exact, false);
  assert.ok(screening!.fatalViolations.some((message) => /false-negative/i.test(message)));
  assert.ok(fulltext!.fatalViolations.some((message) => /false-negative/i.test(message)));
  assert.ok(result.criticalFailures.some((message) => /fixture-tiab.*false-negative/i.test(message)));
  assert.ok(result.criticalFailures.some((message) => /fixture-fulltext/i.test(message)));
  assert.equal(result.sr100, false);

  const downstream = port.seen.get('fixture-fulltext');
  const upstreamTiab = downstream!.upstream.find((item) => item.taskId === 'fixture-tiab');
  assert.ok(upstreamTiab);
  assert.deepEqual(upstreamTiab!.output, {
    decisions: [{ id: 'r1', decision: 'exclude' }, { id: 'r2', decision: 'exclude' }, { id: 'r3', decision: 'include' }],
  });
  assert.equal(
    fulltext!.upstreamOutputHashes.find((item) => item.taskId === 'fixture-tiab')?.outputHash,
    screening!.outputHash,
  );
});

test('missing, future and self dependencies fail closed before inference', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const withoutCaseHash = (definition: SrBenchmarkCase): SrBenchmarkCase => {
    const { caseHash: _caseHash, ...rest } = structuredClone(definition);
    return rest as SrBenchmarkCase;
  };

  const missing = withoutCaseHash(loaded.definition);
  missing.tasks[1] = { ...missing.tasks[1]!, dependsOn: ['not-a-task'] };
  assert.throws(() => validateSrBenchmarkCase(missing), /earlier declared task.*missing\/future dependencies and cycles/i);

  const future = withoutCaseHash(loaded.definition);
  future.tasks[0] = { ...future.tasks[0]!, dependsOn: ['fixture-report'] };
  assert.throws(() => validateSrBenchmarkCase(future), /earlier declared task.*cycles/i);

  const self = withoutCaseHash(loaded.definition);
  self.tasks[0] = { ...self.tasks[0]!, dependsOn: ['fixture-question'] };
  assert.throws(() => validateSrBenchmarkCase(self), /cannot depend on itself/i);
});

test('adapter-reported output hash cannot override the harness-computed artifact hash', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const result = await runSrBenchmarkCase({
    caseDefinition: loaded.definition,
    model: 'hash-liar',
    port: new HashLyingPort(goldOracle(loaded.definition)),
  });
  assert.equal(result.taskScores.every((item) => item.exact), true);
  assert.ok(result.criticalFailures.some((message) => /output hash.*does not match/i.test(message)));
  assert.equal(result.sr100, false);
  assert.ok(result.taskScores.every((item) => item.outputHash !== '0'.repeat(64)));
});

test('perfect performance on incomplete JAK gold cannot be mislabeled SR100', async () => {
  const loaded = await loadSrBenchmarkCase(jakPath);
  const result = await runSrBenchmarkCase({
    caseDefinition: loaded.definition,
    model: 'perfect-partial-model',
    port: new OraclePort(goldOracle(loaded.definition)),
  });
  assert.equal(loaded.benchmarkClass, 'published-review');
  assert.equal(result.reproductionScore, 100);
  assert.equal(result.pipelineCoverage, 47.5);
  assert.equal(result.effectiveScore, 47.5);
  assert.equal(result.sr100, false);
});

test('one perfect published-review run remains shadow-only under the default multi-review SR100 policy', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const base = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'candidate', port: new OraclePort(goldOracle(loaded.definition)) });
  const dossier = buildSr100PromotionDossier({
    requestedModel: 'candidate',
    runs: [{ ...base, caseId: 'published-1', caseHash: 'a'.repeat(64), domain: 'domain-a', repeat: 1 }],
    driftSentinelConfigured: true,
  });
  assert.equal(dossier.tier, 'shadow-eligible');
  assert.ok(dossier.checks.some((item) => item.code === 'complete-review-count' && !item.passed));
  assert.equal(dossier.autonomousAuthorityGranted, false);
});

test('duplicating one frozen review under multiple case labels cannot satisfy multi-review promotion', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const base = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'candidate', port: new OraclePort(goldOracle(loaded.definition)) });
  const runs = [];
  for (const [caseId, domain] of [['alias-a', 'infectious-disease'], ['alias-b', 'nutrition'], ['alias-c', 'cardiology']] as const) {
    for (let repeat = 1; repeat <= 3; repeat += 1) runs.push({ ...base, caseId, caseHash: 'a'.repeat(64), domain, repeat });
  }
  const dossier = buildSr100PromotionDossier({ requestedModel: 'candidate', runs, driftSentinelConfigured: true });
  assert.ok(dossier.checks.some((item) => item.code === 'complete-review-count' && !item.passed));
  assert.notEqual(dossier.tier, 'supervised-living-review-eligible');
});

test('three distinct review hashes x three distinct repeat indices satisfy supervised living-review promotion when drift sentinel exists', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const base = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'candidate', port: new OraclePort(goldOracle(loaded.definition)) });
  const cases = [
    ['published-a', 'infectious-disease', 'a'.repeat(64)],
    ['published-b', 'nutrition', 'b'.repeat(64)],
    ['published-c', 'cardiology', 'c'.repeat(64)],
  ] as const;
  const runs = [];
  for (const [caseId, domain, caseHash] of cases) {
    for (let repeat = 1; repeat <= 3; repeat += 1) runs.push({ ...base, caseId, caseHash, domain, repeat });
  }
  const dossier = buildSr100PromotionDossier({ requestedModel: 'candidate', runs, driftSentinelConfigured: true });
  assert.equal(dossier.checks.every((item) => item.passed), true);
  assert.equal(dossier.tier, 'supervised-living-review-eligible');
  assert.equal(dossier.autonomousAuthorityGranted, false);
});
