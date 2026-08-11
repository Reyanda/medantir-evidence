import test from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalReviewMethodsContract, HistoricalReviewFrozenPlane } from '../src/historical/review-reproduction.js';
import { createHistoricalReviewReproductionEnvelope } from '../src/historical/review-reproduction.js';
import { createHistoricalReplayCapsule } from '../src/historical/replay-capsule.js';
import { createHistoricalExecutionEnvironmentFingerprint } from '../src/historical/execution-environment.js';

const methods = (disclosureGaps: string[] = []): HistoricalReviewMethodsContract => ({
  reviewId: 'historical-review',
  sourceReference: 'published methods',
  eligibility: {
    population: ['adults'],
    interventionOrExposure: ['treatment'],
    comparator: ['control'],
    outcomes: ['mortality'],
    includedDesigns: ['RCT'],
    exclusions: ['case report'],
  },
  screening: {
    titleAbstractScreeningReported: true,
    fullTextScreeningReported: true,
    reviewerCount: 2,
    independentReviewReported: true,
    conflictResolutionReported: true,
  },
  extraction: {
    reviewerCount: 2,
    independentReviewReported: true,
    fields: ['events', 'total'],
  },
  appraisal: [{ population: 'RCT', tool: 'historical tool', independentReviewReported: true }],
  synthesis: {
    software: 'Historical Meta',
    softwareVersion: '1.0',
    dichotomousMethod: 'Mantel-Haenszel',
    dichotomousMeasure: 'risk ratio',
    heterogeneityStatistic: 'I2',
    modelRule: 'random effects for all prespecified outcomes',
  },
  disclosureGaps,
});

const searchCapsule = createHistoricalReplayCapsule({ benchmarkId: 'historical-review', historicalCutoff: '2021-01-01', sources: [] });
const requiredPlanes: HistoricalReviewFrozenPlane['plane'][] = [
  'search-import-dedup', 'fulltext-corpus', 'screening-decisions', 'parsed-documents', 'extraction-ledger',
  'appraisal-ledger', 'synthesis-inputs', 'synthesis-results', 'report',
];
const planes: HistoricalReviewFrozenPlane[] = requiredPlanes.map((plane) => ({
  plane,
  hash: `${plane}-hash`,
  artifactKeys: [plane],
  replayFidelity: 'exact',
  historicalProvenance: 'original-exact',
}));
const runtime = {
  engine: 'Historical Meta compatibility engine',
  version: '1.0',
  algorithmContractHash: 'algorithm-hash',
  numericTolerance: 1e-12,
};
const environment = createHistoricalExecutionEnvironmentFingerprint({
  codeIdentity: 'fixture-commit',
  runtime: { engine: 'node', version: 'v22.0.0', platform: 'linux', arch: 'x64' },
  locale: 'en-US',
  timezone: 'UTC',
  algorithmContractHashes: ['algorithm-hash'],
  randomness: { policy: 'deterministic-no-rng' },
});

test('review reproduction remains partial until every frozen plane, statistical runtime and reproducer environment are bound', () => {
  const envelope = createHistoricalReviewReproductionEnvelope({
    methods: methods(),
    searchCapsule,
    frozenPlanes: [{
      plane: 'search-import-dedup', hash: 'search-hash', artifactKeys: ['searchResults'],
      replayFidelity: 'exact', historicalProvenance: 'source-reconstructed',
    }],
  });
  assert.equal(envelope.claim, 'partial-replay');
  assert.ok(envelope.blockingGaps.some((gap) => /fulltext-corpus/.test(gap)));
  assert.ok(envelope.blockingGaps.some((gap) => /source-reconstructed/.test(gap)));
  assert.ok(envelope.blockingGaps.some((gap) => /statistical runtime/i.test(gap)));
  assert.ok(envelope.blockingGaps.some((gap) => /execution-environment/i.test(gap)));
});

test('all frozen planes without environment fingerprint still cannot claim computational exactness', () => {
  const envelope = createHistoricalReviewReproductionEnvelope({ methods: methods(), searchCapsule, frozenPlanes: planes, statisticalRuntime: runtime });
  assert.equal(envelope.claim, 'partial-replay');
  assert.ok(envelope.blockingGaps.some((gap) => /execution-environment/i.test(gap)));
});

test('replay-exact reconstructed historical planes can be computationally exact but never publication exact', () => {
  const reconstructed = planes.map((plane) => plane.plane === 'screening-decisions'
    ? { ...plane, historicalProvenance: 'source-reconstructed' as const }
    : plane);
  const envelope = createHistoricalReviewReproductionEnvelope({
    methods: methods(), searchCapsule, frozenPlanes: reconstructed, statisticalRuntime: runtime, executionEnvironment: environment,
  });
  assert.equal(envelope.claim, 'computationally-exact-publication-incomplete');
  assert.ok(envelope.blockingGaps.some((gap) => /screening-decisions.*source-reconstructed/.test(gap)));
});

test('unverified replay fidelity blocks computational exactness even when every plane name exists', () => {
  const unverified = planes.map((plane) => plane.plane === 'extraction-ledger'
    ? { ...plane, replayFidelity: 'unverified' as const }
    : plane);
  const envelope = createHistoricalReviewReproductionEnvelope({
    methods: methods(), searchCapsule, frozenPlanes: unverified, statisticalRuntime: runtime, executionEnvironment: environment,
  });
  assert.equal(envelope.claim, 'partial-replay');
  assert.ok(envelope.blockingGaps.some((gap) => /extraction-ledger.*not replay-exact/.test(gap)));
});

test('complete computation cannot erase publication disclosure gaps', () => {
  const envelope = createHistoricalReviewReproductionEnvelope({
    methods: methods(['Original reviewer decision ledger is unavailable.']),
    searchCapsule, frozenPlanes: planes, statisticalRuntime: runtime, executionEnvironment: environment,
  });
  assert.equal(envelope.claim, 'computationally-exact-publication-incomplete');
  assert.ok(envelope.blockingGaps.includes('Original reviewer decision ledger is unavailable.'));
  assert.equal(envelope.executionEnvironmentHash, environment.environmentHash);
});

test('end-to-end exact is available only when all planes replay exactly from original historical provenance', () => {
  const envelope = createHistoricalReviewReproductionEnvelope({
    methods: methods(), searchCapsule, frozenPlanes: planes, statisticalRuntime: runtime, executionEnvironment: environment,
  });
  assert.equal(envelope.claim, 'end-to-end-exact');
  assert.equal(envelope.blockingGaps.length, 0);
  assert.equal(envelope.executionEnvironmentHash, environment.environmentHash);
  assert.match(envelope.envelopeId, /^HRR-[a-f0-9]{24}$/);
});
