import test from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalReviewFrozenPlane } from '../src/historical/review-reproduction.js';
import { createHistoricalIndexStateVerification } from '../src/historical/index-state-attestation.js';
import { constrainHistoricalSearchPlaneByIndexState } from '../src/historical/search-plane-index-constraint.js';

const searchPlane = (provenance: HistoricalReviewFrozenPlane['historicalProvenance']): HistoricalReviewFrozenPlane => ({
  plane: 'search-import-dedup',
  hash: 'a'.repeat(64),
  artifactKeys: ['searchResults'],
  replayFidelity: 'exact',
  historicalProvenance: provenance,
  sourceReferences: ['capsule'],
});

const currentIndex = createHistoricalIndexStateVerification({
  historicalSearchEnd: '2021-06-02',
  attestations: [{
    database: 'PubMed', queryExecutedAt: '2026-08-10', historicalSearchEnd: '2021-06-02',
    provenance: 'current-index-reconstruction', resultSetHash: 'b'.repeat(64), resultCount: 303,
    sourceReference: 'current PubMed reconstruction',
  }],
});

const exactIndex = createHistoricalIndexStateVerification({
  historicalSearchEnd: '2021-06-02T23:59:59Z',
  attestations: [{
    database: 'PubMed', queryExecutedAt: '2021-06-02T12:00:00Z', historicalSearchEnd: '2021-06-02T23:59:59Z',
    provenance: 'original-export', resultSetHash: 'c'.repeat(64), resultCount: 303,
    sourceReference: 'original export', sourceObjectId: `HOBJ-${'d'.repeat(64)}`, sourceSha256: 'd'.repeat(64),
  }],
});

test('current database index reconstruction downgrades an otherwise original search claim', () => {
  const constrained = constrainHistoricalSearchPlaneByIndexState({ searchPlane: searchPlane('original-exact'), indexState: currentIndex });
  assert.equal(constrained.replayFidelity, 'exact');
  assert.equal(constrained.historicalProvenance, 'source-reconstructed');
  assert.ok(constrained.artifactKeys.includes('historicalIndexStateVerification'));
});

test('exact historical index state preserves original-exact only when the base search evidence was already original-exact', () => {
  const original = constrainHistoricalSearchPlaneByIndexState({ searchPlane: searchPlane('original-exact'), indexState: exactIndex });
  assert.equal(original.historicalProvenance, 'original-exact');

  const reconstructed = constrainHistoricalSearchPlaneByIndexState({ searchPlane: searchPlane('source-reconstructed'), indexState: exactIndex });
  assert.equal(reconstructed.historicalProvenance, 'source-reconstructed');
});

test('index-state constraint cannot be applied to a non-search plane', () => {
  assert.throws(() => constrainHistoricalSearchPlaneByIndexState({
    searchPlane: { ...searchPlane('source-reconstructed'), plane: 'appraisal-ledger' },
    indexState: currentIndex,
  }), /requires search-import-dedup/i);
});
