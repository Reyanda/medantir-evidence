import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHistoricalSrbenchCoverage } from '../src/benchmark/historical-srbench-coverage.js';
import type { HistoricalReviewReproductionEnvelope, HistoricalReviewFrozenPlane } from '../src/historical/review-reproduction.js';

function plane(
  name: HistoricalReviewFrozenPlane['plane'],
  provenance: HistoricalReviewFrozenPlane['historicalProvenance'],
  fidelity: HistoricalReviewFrozenPlane['replayFidelity'] = 'exact',
): HistoricalReviewFrozenPlane {
  return {
    plane: name,
    hash: `${name.length}`.padStart(64, 'a').slice(0, 64),
    artifactKeys: [name],
    replayFidelity: fidelity,
    historicalProvenance: provenance,
  };
}

function envelope(planes: HistoricalReviewFrozenPlane[]): HistoricalReviewReproductionEnvelope {
  return {
    schemaVersion: 'medantir-historical-review-reproduction/1',
    reviewId: 'review-1',
    methodsContractHash: 'b'.repeat(64),
    frozenPlanes: planes,
    statisticalRuntime: {
      engine: 'RevMan compatibility', version: '5.4', algorithmContractHash: 'c'.repeat(64), numericTolerance: 1e-12,
    },
    executionEnvironmentHash: 'd'.repeat(64),
    claim: 'partial-replay',
    blockingGaps: [],
    envelopeId: 'HRR-' + 'e'.repeat(24),
  };
}

const allPlanes: HistoricalReviewFrozenPlane['plane'][] = [
  'search-import-dedup',
  'fulltext-corpus',
  'screening-decisions',
  'parsed-documents',
  'extraction-ledger',
  'appraisal-ledger',
  'synthesis-inputs',
  'synthesis-results',
  'report',
];

test('source-reconstructed exact evidence can be complete scientific gold while historical process remains partial', () => {
  const coverage = deriveHistoricalSrbenchCoverage({
    envelope: envelope(allPlanes.map((name) => plane(name, 'source-reconstructed'))),
    questionGoldReceipt: { question: 'frozen' },
    protocolGoldReceipt: { protocol: 'frozen' },
  });
  assert.equal(coverage.scientificCoverage, 100);
  assert.ok(coverage.historicalProcessCoverage < 100);
  assert.equal(coverage.scientificStageGold.extraction.status, 'complete');
  assert.equal(coverage.historicalProcessStatus.extraction, 'partial');
  assert.match(coverage.scientificReceiptObjects.synthesis!.receiptHash, /^[a-f0-9]{64}$/);
});

test('aggregate-only screening cannot become complete scientific screening gold', () => {
  const planes = allPlanes.map((name) => plane(name, name === 'screening-decisions' ? 'aggregate-only' : 'source-reconstructed'));
  const coverage = deriveHistoricalSrbenchCoverage({ envelope: envelope(planes) });
  assert.equal(coverage.scientificStageGold['tiab-screening'].status, 'partial');
  assert.equal(coverage.scientificStageGold['fulltext-screening'].status, 'partial');
  assert.equal(coverage.historicalProcessStatus['tiab-screening'], 'partial');
});

test('missing source plane makes dependent downstream scientific stages missing', () => {
  const planes = allPlanes.filter((name) => name !== 'parsed-documents').map((name) => plane(name, 'source-reconstructed'));
  const coverage = deriveHistoricalSrbenchCoverage({ envelope: envelope(planes) });
  assert.equal(coverage.scientificStageGold['fulltext-screening'].status, 'missing');
  assert.equal(coverage.scientificStageGold.extraction.status, 'missing');
  assert.equal(coverage.scientificStageGold.appraisal.status, 'complete');
});
