import test from 'node:test';
import assert from 'node:assert/strict';
import {
  benchmarkCatalog,
  classifyDiscrepancy,
  evaluateBenchmark,
  screeningMetrics,
} from '../src/benchmark/index.js';
import type { BenchmarkTarget } from '../src/benchmark/types.js';

const targets: BenchmarkTarget[] = [
  {
    id: 'screening-recovery',
    stage: 'tiab-screen',
    metric: 'screening-recall',
    kind: 'set-recovery',
    referenceIds: ['a', 'b', 'c'],
    minimumRecall: 0.95,
    minimumPrecision: 0.5,
    required: true,
    rationale: 'Systematic-review screening must prioritise sensitivity.',
  },
  {
    id: 'pooled-effect',
    stage: 'synthesise',
    metric: 'synthesis-estimate-within-tolerance',
    kind: 'numeric-tolerance',
    expected: 0.8,
    absoluteTolerance: 0.01,
    relativeTolerance: 0.02,
    required: true,
    rationale: 'Reference analysis should be numerically reproducible.',
  },
  {
    id: 'prisma-consistency',
    stage: 'report',
    metric: 'prisma-count-consistency',
    kind: 'exact',
    expected: true,
    required: true,
    rationale: 'Flow counts must reconcile.',
  },
];

test('benchmark catalog spans gold data, silver reviews, and method conformance', () => {
  assert.ok(benchmarkCatalog.length >= 20);
  assert.deepEqual(new Set(benchmarkCatalog.map((entry) => entry.tier)), new Set(['gold-data', 'silver-review', 'method-conformance']));
  assert.ok(benchmarkCatalog.some((entry) => entry.authority === 'World Health Organization'));
  assert.ok(benchmarkCatalog.some((entry) => entry.authority === 'Cochrane'));
  assert.ok(benchmarkCatalog.some((entry) => entry.authority === 'JBI'));
});

test('fully open benchmark cases are separated from mixed-access live searches', () => {
  const readyGold = benchmarkCatalog.filter((entry) => entry.tier === 'gold-data' && entry.readiness === 'ready');
  assert.ok(readyGold.length >= 4);
  assert.ok(readyGold.every((entry) => entry.publicInputClass === 'fully-open'));
  const whoCases = benchmarkCatalog.filter((entry) => entry.authority === 'World Health Organization' && entry.tier === 'silver-review');
  assert.ok(whoCases.every((entry) => entry.publicInputClass === 'open-reference-mixed-search-access'));
});

test('evaluates exact, tolerance, and set-recovery targets', () => {
  const evaluation = evaluateBenchmark({
    benchmarkId: 'fixture',
    mode: 'frozen-reproduction',
    targets,
    observations: [
      { targetId: 'screening-recovery', recoveredIds: ['a', 'b', 'c'], evidence: ['screening.csv'] },
      { targetId: 'pooled-effect', value: 0.805, evidence: ['analysis.json'] },
      { targetId: 'prisma-consistency', value: true, evidence: ['report.json'] },
    ],
    discrepancyEvidence: { withinTolerance: true, frozenSnapshot: true },
  });
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.requiredPassed, 3);
  assert.equal(evaluation.discrepancyClass, 'exact-match');
});

test('fails a required benchmark target when recall is insufficient', () => {
  const evaluation = evaluateBenchmark({
    benchmarkId: 'fixture',
    mode: 'frozen-reproduction',
    targets,
    observations: [
      { targetId: 'screening-recovery', recoveredIds: ['a'], evidence: ['screening.csv'] },
      { targetId: 'pooled-effect', value: 0.805, evidence: ['analysis.json'] },
      { targetId: 'prisma-consistency', value: true, evidence: ['report.json'] },
    ],
    discrepancyEvidence: { withinTolerance: false, frozenSnapshot: true },
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.results.find((result) => result.targetId === 'screening-recovery')?.status, 'fail');
});

test('does not call a difference a source-review error without proof, repetition, and human adjudication', () => {
  assert.equal(classifyDiscrepancy({
    withinTolerance: false,
    frozenSnapshot: true,
    sourceLevelProof: true,
    reproducedAcrossIndependentRuns: true,
    humanAdjudicated: false,
  }), 'unresolved');

  assert.equal(classifyDiscrepancy({
    withinTolerance: false,
    frozenSnapshot: true,
    sourceLevelProof: true,
    reproducedAcrossIndependentRuns: true,
    humanAdjudicated: true,
    pipelineUnitFailure: false,
  }), 'candidate-source-review-error');
});

test('classifies live-index changes as database drift rather than review error', () => {
  assert.equal(classifyDiscrepancy({
    withinTolerance: false,
    frozenSnapshot: false,
    databaseOrIndexChanged: true,
  }), 'database-drift');
});

test('computes screening recall, precision, F1, and work saved', () => {
  const metrics = screeningMetrics(['a', 'b'], ['a', 'b', 'x'], 10);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.precision, 2 / 3);
  assert.ok(metrics.f1 > 0.79 && metrics.f1 < 0.81);
  assert.equal(metrics.workSavedOverSampling95, 0.7);
});

import { createBenchmarkProtocol, getBenchmarkCase } from '../src/benchmark/index.js';

test('creates a frozen reproduction protocol with immutable inputs and stage targets', () => {
  const protocol = createBenchmarkProtocol(getBenchmarkCase('synergy-screening-gold'), 'frozen-reproduction');
  assert.equal(protocol.frozenInputsRequired, true);
  assert.equal(protocol.independentRuns, 1);
  assert.ok(protocol.freezeRequirements.some((entry) => entry.includes('checksums')));
  assert.ok(protocol.targets.some((entry) => entry.metric === 'screening-recall'));
});

test('independent audit requires two runs and begins blinded', () => {
  const protocol = createBenchmarkProtocol(getBenchmarkCase('who-wasting-guideline-silver'), 'independent-audit');
  assert.equal(protocol.independentRuns, 2);
  assert.equal(protocol.humanVerification.initialMode, 'blinded');
  assert.equal(protocol.humanVerification.unblindForAdjudication, true);
});

test('method-conformance cases cannot be misused as frozen numeric benchmarks', () => {
  assert.throws(
    () => createBenchmarkProtocol(getBenchmarkCase('cochrane-intervention-conformance'), 'frozen-reproduction'),
    /does not support|no frozen numeric reference package/,
  );
});

import { validateBenchmarkManifest } from '../src/benchmark/index.js';
import type { BenchmarkManifest } from '../src/benchmark/manifest.js';

const validChecksum = 'a'.repeat(64);

function benchmarkManifest(): BenchmarkManifest {
  return {
    schemaVersion: '1.0',
    benchmarkId: 'sealed-fixture',
    benchmarkVersion: '1.0.0',
    mode: 'frozen-reproduction',
    reviewType: 'intervention',
    diseaseDomains: ['fixture'],
    sourceReview: { title: 'Fixture review', locator: 'https://example.org/review' },
    oracleSealed: true,
    expectedStages: ['tiab-screen', 'extract', 'synthesise'],
    artifacts: [{
      id: 'raw-export',
      name: 'Raw export',
      kind: 'dataset',
      access: 'open',
      locator: 'https://example.org/export',
      path: 'oracle/raw-export.json',
      required: true,
      checksum: validChecksum,
    }],
    softwareEnvironment: { packageLockChecksum: validChecksum },
    curators: [
      { id: 'curator-1', role: 'primary', signedAt: '2026-07-13T00:00:00.000Z' },
      { id: 'curator-2', role: 'independent-verifier', signedAt: '2026-07-13T00:00:00.000Z' },
    ],
  };
}

test('accepts a sealed and checksummed frozen benchmark manifest', () => {
  const result = validateBenchmarkManifest(benchmarkManifest());
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
});

test('rejects an unfrozen or unsealed exact-reproduction oracle', () => {
  const manifest = benchmarkManifest();
  manifest.oracleSealed = false;
  delete manifest.artifacts[0]?.checksum;
  const result = validateBenchmarkManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'ORACLE_NOT_SEALED'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNFROZEN_REQUIRED_ARTIFACT'));
});
