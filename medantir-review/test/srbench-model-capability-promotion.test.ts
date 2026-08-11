import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REQUIRED_MODEL_STAGES,
  buildSr100PromotionDossier,
  type SrBenchmarkRunWithContext,
} from '../src/benchmark/sr100-promotion.js';
import type { SrBenchmarkStage } from '../src/benchmark/sr-reproduction-benchmark.js';

function fakeRun(input: {
  caseId: string;
  caseHash: string;
  domain: string;
  repeat: number;
  stages?: SrBenchmarkStage[];
}): SrBenchmarkRunWithContext {
  const stages = input.stages ?? DEFAULT_REQUIRED_MODEL_STAGES;
  return {
    schemaVersion: 'medantir-srbench/1',
    caseId: input.caseId,
    caseHash: input.caseHash,
    requestedModel: 'candidate',
    actualModels: ['candidate-pinned'],
    providers: ['fixture-provider'],
    taskScores: stages.map((stage, index) => ({
      taskId: `${stage}-${index}`,
      stage,
      critical: true,
      score: 1,
      exact: true,
      errors: [],
      fatalViolations: [],
      routing: { requestedModel: 'candidate', actualModel: 'candidate-pinned', provider: 'fixture-provider' },
      outputHash: String(index + 1).padStart(2, '0').repeat(32),
      upstreamOutputHashes: [],
    })),
    stageScores: Object.fromEntries(stages.map((stage) => [stage, 1])),
    reproductionScore: 100,
    pipelineCoverage: 100,
    effectiveScore: 100,
    criticalFailures: [],
    sr100: true,
    runHash: input.caseHash,
    domain: input.domain,
    repeat: input.repeat,
  };
}

function threeReviewRuns(stagesFor?: (caseIndex: number) => SrBenchmarkStage[]): SrBenchmarkRunWithContext[] {
  const cases = [
    ['review-a', 'infectious-disease', 'a'.repeat(64)],
    ['review-b', 'nutrition', 'b'.repeat(64)],
    ['review-c', 'cardiology', 'c'.repeat(64)],
  ] as const;
  const runs: SrBenchmarkRunWithContext[] = [];
  cases.forEach(([caseId, domain, caseHash], caseIndex) => {
    for (let repeat = 1; repeat <= 3; repeat += 1) {
      runs.push(fakeRun({
        caseId,
        domain,
        caseHash,
        repeat,
        ...(stagesFor ? { stages: stagesFor(caseIndex) } : {}),
      }));
    }
  });
  return runs;
}

test('three complete SR100 reviews cannot promote a model when screening was never directly model-evaluated', () => {
  const withoutScreening = DEFAULT_REQUIRED_MODEL_STAGES.filter((stage) => stage !== 'tiab-screening' && stage !== 'fulltext-screening');
  const dossier = buildSr100PromotionDossier({
    requestedModel: 'candidate',
    runs: threeReviewRuns(() => withoutScreening),
    driftSentinelConfigured: true,
  });
  assert.equal(dossier.sr100Runs, 9, 'pipeline SR100 alone is intentionally insufficient for model promotion');
  assert.equal(dossier.tier, 'shadow-eligible');
  assert.ok(dossier.checks.some((item) => item.code === 'model-stage-tiab-screening-review-coverage' && !item.passed));
  assert.ok(dossier.checks.some((item) => item.code === 'model-stage-fulltext-screening-domain-coverage' && !item.passed));
  const tiab = dossier.modelCapabilityCoverage.find((item) => item.stage === 'tiab-screening')!;
  assert.deepEqual(tiab.distinctReviewHashes, []);
  assert.deepEqual(tiab.domains, []);
});

test('all required model-dependent stages across three review hashes and domains satisfy the capability gate', () => {
  const dossier = buildSr100PromotionDossier({
    requestedModel: 'candidate',
    runs: threeReviewRuns(),
    driftSentinelConfigured: true,
  });
  assert.equal(dossier.checks.every((item) => item.passed), true);
  assert.equal(dossier.tier, 'supervised-living-review-eligible');
  assert.equal(dossier.modelCapabilityCoverage.length, DEFAULT_REQUIRED_MODEL_STAGES.length);
  assert.equal(dossier.modelCapabilityCoverage.every((item) => item.distinctReviewHashes.length === 3), true);
  assert.equal(dossier.modelCapabilityCoverage.every((item) => item.domains.length === 3), true);
});

test('deterministic deduplication and synthesis software are not required model-capability stages', () => {
  assert.equal(DEFAULT_REQUIRED_MODEL_STAGES.includes('deduplication'), false);
  assert.equal(DEFAULT_REQUIRED_MODEL_STAGES.includes('synthesis'), false);
  const dossier = buildSr100PromotionDossier({
    requestedModel: 'candidate',
    runs: threeReviewRuns(),
    driftSentinelConfigured: true,
  });
  assert.equal(dossier.checks.some((item) => item.code.includes('deduplication')), false);
  assert.equal(dossier.checks.some((item) => item.code.includes('synthesis')), false);
  assert.equal(dossier.tier, 'supervised-living-review-eligible');
});

test('repeat executions of one review cannot inflate per-stage review breadth', () => {
  const runs: SrBenchmarkRunWithContext[] = [];
  for (let repeat = 1; repeat <= 9; repeat += 1) {
    runs.push(fakeRun({ caseId: `alias-${repeat}`, caseHash: 'a'.repeat(64), domain: `domain-${repeat}`, repeat }));
  }
  const dossier = buildSr100PromotionDossier({ requestedModel: 'candidate', runs, driftSentinelConfigured: true });
  const screening = dossier.modelCapabilityCoverage.find((item) => item.stage === 'tiab-screening')!;
  assert.equal(screening.distinctReviewHashes.length, 1);
  assert.equal(dossier.checks.find((item) => item.code === 'model-stage-tiab-screening-review-coverage')?.passed, false);
  assert.notEqual(dossier.tier, 'supervised-living-review-eligible');
});
