import test from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalReviewFrozenPlane } from '../src/historical/review-reproduction.js';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';
import { createHistoricalReportInventoryVerification } from '../src/historical/report-inventory-attestation.js';
import { constrainHistoricalFullTextPlaneByInventory } from '../src/historical/fulltext-plane-inventory-constraint.js';

const source = {
  objectId: `HOBJ-${'a'.repeat(64)}`,
  sha256: 'a'.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId: 'R1',
  accessClass: 'restricted-source' as const,
};
const sourceManifest = createHistoricalStudySourceManifest({
  historicalCutoff: '2021-06-02',
  requiredLineageIds: ['L1'],
  reports: [{
    lineageId: 'L1', reportId: 'R1', role: 'primary-results', identifiers: { doi: '10.1/r1' },
    publicationDate: '2021-01-01', availableByHistoricalCutoff: true,
    requiredForReproduction: true, resultBearing: true,
    sourceStatus: 'archived-exact', sourceObject: source,
  }],
});
const base = (historicalProvenance: HistoricalReviewFrozenPlane['historicalProvenance']): HistoricalReviewFrozenPlane => ({
  plane: 'fulltext-corpus', hash: 'b'.repeat(64), artifactKeys: ['historicalStudySourceManifest'],
  replayFidelity: 'exact', historicalProvenance, sourceReferences: ['source manifest'],
});

test('complete source-reconstructed inventory preserves computational full-text exactness but not original provenance', () => {
  const inventory = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [{ lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1'], evidenceReference: 'registry + references' }],
  });
  const plane = constrainHistoricalFullTextPlaneByInventory({ fullTextPlane: base('original-exact'), inventory });
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'source-reconstructed');
});

test('original-exact provenance survives only an original exact inventory attestation', () => {
  const sha = 'c'.repeat(64);
  const inventory = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [{
      lineageId: 'L1', status: 'complete-original-ledger', expectedReportIds: ['R1'],
      evidenceReference: 'original extraction workbook', evidenceObjectId: `HOBJ-${sha}`, evidenceSha256: sha,
    }],
  });
  const plane = constrainHistoricalFullTextPlaneByInventory({ fullTextPlane: base('original-exact'), inventory });
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'original-exact');
});

test('incomplete report inventory downgrades full-text replay even when all currently declared reports are archived', () => {
  const inventory = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [{ lineageId: 'L1', status: 'incomplete', expectedReportIds: ['R1'], evidenceReference: 'partial check' }],
  });
  const plane = constrainHistoricalFullTextPlaneByInventory({ fullTextPlane: base('source-reconstructed'), inventory });
  assert.equal(plane.replayFidelity, 'unverified');
  assert.equal(plane.historicalProvenance, 'unavailable');
});

test('inventory constraint rejects non-full-text planes', () => {
  const inventory = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [{ lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1'], evidenceReference: 'complete' }],
  });
  assert.throws(() => constrainHistoricalFullTextPlaneByInventory({
    fullTextPlane: { ...base('source-reconstructed'), plane: 'appraisal-ledger' }, inventory,
  }), /requires fulltext-corpus/i);
});
