import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrTournamentPerformanceSummary } from '../src/benchmark/sr-performance-summary.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';

type TournamentRun = SrBenchmarkTournamentResult['runs'][number];
type TournamentTaskScore = TournamentRun['taskScores'][number];

function screeningTask(input: {
  taskId: string;
  truePositive: number;
  falseNegative: number;
  trueNegative: number;
  falsePositive: number;
}): TournamentTaskScore {
  const total = input.truePositive + input.falseNegative + input.trueNegative + input.falsePositive;
  const correct = input.truePositive + input.trueNegative;
  return {
    taskId: input.taskId,
    stage: 'tiab-screening',
    critical: true,
    score: total > 0 ? correct / total : 0,
    exact: input.falseNegative === 0 && input.falsePositive === 0,
    errors: [],
    fatalViolations: input.falseNegative > 0 ? [`${input.falseNegative} false-negative inclusion decision(s).`] : [],
    diagnostics: {
      truePositive: input.truePositive,
      falseNegative: input.falseNegative,
      trueNegative: input.trueNegative,
      falsePositive: input.falsePositive,
      accuracy: total > 0 ? correct / total : 0,
    },
    routing: { requestedModel: 'fixture-model', actualModel: 'fixture-model-pinned', provider: 'fixture-provider' },
    outputHash: '9'.repeat(64),
    upstreamOutputHashes: [],
  };
}

function run(input: {
  model: string;
  baseCaseId: string;
  caseId: string;
  caseHash: string;
  reproductionScore: number;
  effectiveScore: number;
  sr100: boolean;
  repeat?: number;
  taskScores?: TournamentTaskScore[];
  challengeReceiptHash?: string;
}): TournamentRun {
  return {
    schemaVersion: 'medantir-srbench/1' as const,
    caseId: input.caseId,
    caseHash: input.caseHash,
    requestedModel: input.model,
    actualModels: [`${input.model}-pinned`],
    providers: ['fixture-provider'],
    taskScores: input.taskScores ?? [],
    stageScores: {},
    reproductionScore: input.reproductionScore,
    pipelineCoverage: 100,
    effectiveScore: input.effectiveScore,
    criticalFailures: [],
    sr100: input.sr100,
    runHash: input.caseHash,
    domain: input.baseCaseId === 'published' ? 'nutrition' : 'benchmark-infrastructure',
    repeat: input.repeat ?? 1,
    baseCaseId: input.baseCaseId,
    ...(input.challengeReceiptHash ? { challengeReceiptHash: input.challengeReceiptHash } : {}),
  };
}

function tournament(): SrBenchmarkTournamentResult {
  const validation = run({
    model: 'memorizer',
    baseCaseId: 'published',
    caseId: 'published',
    caseHash: 'a'.repeat(64),
    reproductionScore: 100,
    effectiveScore: 100,
    sr100: true,
  });
  const failedCanary = run({
    model: 'memorizer',
    baseCaseId: 'canary',
    caseId: 'canary::CF1',
    caseHash: 'b'.repeat(64),
    reproductionScore: 80,
    effectiveScore: 80,
    sr100: false,
    challengeReceiptHash: 'c'.repeat(64),
  });
  const validationReasoner = run({
    model: 'reasoner',
    baseCaseId: 'published',
    caseId: 'published',
    caseHash: 'd'.repeat(64),
    reproductionScore: 100,
    effectiveScore: 100,
    sr100: true,
  });
  const passedCanary = run({
    model: 'reasoner',
    baseCaseId: 'canary',
    caseId: 'canary::CF1',
    caseHash: 'e'.repeat(64),
    reproductionScore: 100,
    effectiveScore: 100,
    sr100: true,
    challengeReceiptHash: 'f'.repeat(64),
  });
  return {
    schemaVersion: 'medantir-srbench-suite/1',
    suiteId: 'SUITE',
    suiteVersion: '1',
    suiteHash: '1'.repeat(64),
    models: ['memorizer', 'reasoner'],
    repeats: 1,
    cases: [
      { caseId: 'published', benchmarkClass: 'published-review', role: 'validation', domain: 'nutrition', pipelineCoverage: 100, sourcePath: '/published' },
      { caseId: 'canary', benchmarkClass: 'synthetic-fixture', role: 'canary', counterfactualPlanHash: '2'.repeat(64), domain: 'benchmark-infrastructure', pipelineCoverage: 100, sourcePath: '/canary' },
    ],
    qualificationAdmissions: [],
    counterfactualChallenges: [],
    runs: [validation, failedCanary, validationReasoner, passedCanary],
    driftSentinels: [],
    promotion: [
      { requestedModel: 'memorizer', tier: 'shadow-eligible' },
      { requestedModel: 'reasoner', tier: 'supervised-future-review-eligible' },
    ] as SrBenchmarkTournamentResult['promotion'],
    leaderboard: [],
    tournamentHash: '3'.repeat(64),
  };
}

test('high published-review score plus failed counterfactual canary raises contamination concern', () => {
  const summary = createSrTournamentPerformanceSummary(tournament());
  const memorizer = summary.models.find((model) => model.requestedModel === 'memorizer')!;
  assert.equal(memorizer.validation.meanReproductionScore, 100);
  assert.equal(memorizer.counterfactualCanary.sr100Rate, 0);
  assert.equal(memorizer.contaminationConcern, true);
  assert.match(memorizer.contaminationConcernReason!, /memorization|brittle evidence-following/i);
});

test('model that passes both validation and hidden counterfactual canary has no contamination flag', () => {
  const summary = createSrTournamentPerformanceSummary(tournament());
  const reasoner = summary.models.find((model) => model.requestedModel === 'reasoner')!;
  assert.equal(reasoner.validation.meanReproductionScore, 100);
  assert.equal(reasoner.counterfactualCanary.sr100Rate, 1);
  assert.equal(reasoner.contaminationConcern, false);
  assert.equal(reasoner.contaminationConcernReason, undefined);
  assert.match(summary.summaryHash, /^[a-f0-9]{64}$/);
});

test('screening safety is assessed per task-run and can fail despite high aggregate reproduction', () => {
  const base = tournament();
  base.models = ['screening-model'];
  base.runs = [run({
    model: 'screening-model',
    baseCaseId: 'published',
    caseId: 'published',
    caseHash: '7'.repeat(64),
    reproductionScore: 96.5,
    effectiveScore: 96.5,
    sr100: false,
    taskScores: [screeningTask({ taskId: 'hard-screen', truePositive: 154, falseNegative: 15, trueNegative: 305, falsePositive: 26 })],
  })];
  base.promotion = [{ requestedModel: 'screening-model', tier: 'shadow-eligible' }] as SrBenchmarkTournamentResult['promotion'];
  const summary = createSrTournamentPerformanceSummary(base).models[0]!;
  assert.equal(summary.validation.meanReproductionScore, 96.5);
  assert.equal(summary.screeningSafety.assessedTaskRuns, 1);
  assert.equal(summary.screeningSafety.passingTaskRuns, 0);
  assert.equal(summary.screeningSafety.failingTaskRuns, 1);
  assert.equal(summary.screeningSafety.taskRunsWithFalseNegatives, 1);
  assert.equal(summary.screeningSafety.worstObservedSensitivity?.toFixed(3), '0.911');
  assert.ok(summary.screeningSafety.worstConservativeMissedPer1000! > 50);
});

test('repeat runs are never pooled into a fictitiously larger screening validation sample', () => {
  const base = tournament();
  base.models = ['repeat-model'];
  const task = screeningTask({ taskId: 'same-500-records', truePositive: 154, falseNegative: 15, trueNegative: 305, falsePositive: 26 });
  base.runs = [
    run({ model: 'repeat-model', baseCaseId: 'published', caseId: 'published', caseHash: '6'.repeat(64), reproductionScore: 96.5, effectiveScore: 96.5, sr100: false, repeat: 1, taskScores: [task] }),
    run({ model: 'repeat-model', baseCaseId: 'published', caseId: 'published', caseHash: '6'.repeat(64), reproductionScore: 96.5, effectiveScore: 96.5, sr100: false, repeat: 2, taskScores: [task] }),
  ];
  base.promotion = [{ requestedModel: 'repeat-model', tier: 'shadow-eligible' }] as SrBenchmarkTournamentResult['promotion'];
  const summary = createSrTournamentPerformanceSummary(base).models[0]!;
  assert.equal(summary.screeningSafety.assessedTaskRuns, 2);
  assert.equal(summary.screeningSafety.uniqueCasesAssessed, 1);
  assert.equal(summary.screeningSafety.passingTaskRuns, 0);
  // If the two repeats had been incorrectly pooled as n=1000, this lower bound would be tighter.
  // The run-level summary must retain the single-run n=500 interval.
  assert.ok(Math.abs(summary.screeningSafety.worstSensitivityLower95! - 0.8587307904190823) < 1e-12);
});
