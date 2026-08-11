import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';
import { createHistoricalReportInventoryVerification } from '../src/historical/report-inventory-attestation.js';

const receipt = (character: string, recordId: string) => ({
  objectId: `HOBJ-${character.repeat(64)}`,
  sha256: character.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId,
  accessClass: 'restricted-source' as const,
});

const sourceManifest = createHistoricalStudySourceManifest({
  historicalCutoff: '2021-06-02',
  requiredLineageIds: ['L1', 'L2'],
  reports: [
    {
      lineageId: 'L1', reportId: 'R1', role: 'primary-results', identifiers: { doi: '10.1/r1' },
      publicationDate: '2021-01-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: receipt('a', 'R1'),
    },
    {
      lineageId: 'L1', reportId: 'R1-SUPP', role: 'supplement', identifiers: { url: 'https://example.org/r1-supp' },
      publicationDate: '2021-01-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: receipt('b', 'R1-SUPP'),
    },
    {
      lineageId: 'L2', reportId: 'R2', role: 'primary-results', identifiers: { pmid: '2' },
      publicationDate: '2021-02-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: receipt('c', 'R2'),
    },
  ],
});

test('computational report inventory completeness requires every canonical lineage and every required report ID to be accounted for', () => {
  const verification = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      {
        lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1', 'R1-SUPP'],
        evidenceReference: 'publication references + trial registry crosswalk',
      },
      {
        lineageId: 'L2', status: 'complete-source-reconstructed', expectedReportIds: ['R2'],
        evidenceReference: 'publication references + trial registry crosswalk',
      },
    ],
  });
  assert.equal(verification.computationalInventoryComplete, true);
  assert.equal(verification.originalInventoryComplete, false);
  assert.deepEqual(verification.incompleteLineageIds, []);
  assert.deepEqual(verification.unlistedReportIds, []);
  assert.deepEqual(verification.undeclaredExpectedReportIds, []);
});

test('one archived report per lineage is insufficient if the report inventory says another required supplement exists', () => {
  const verification = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      { lineageId: 'L1', status: 'incomplete', expectedReportIds: ['R1'], evidenceReference: 'partial reference check' },
      { lineageId: 'L2', status: 'complete-source-reconstructed', expectedReportIds: ['R2'], evidenceReference: 'complete reference check' },
    ],
  });
  assert.equal(verification.computationalInventoryComplete, false);
  assert.deepEqual(verification.incompleteLineageIds, ['L1']);
  assert.deepEqual(verification.undeclaredExpectedReportIds, ['R1-SUPP']);
});

test('an expected report absent from source manifest is explicit report-list debt', () => {
  const verification = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      { lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1', 'R1-SUPP', 'R1-SECONDARY'], evidenceReference: 'registry' },
      { lineageId: 'L2', status: 'complete-source-reconstructed', expectedReportIds: ['R2'], evidenceReference: 'registry' },
    ],
  });
  assert.equal(verification.computationalInventoryComplete, false);
  assert.deepEqual(verification.unlistedReportIds, ['R1-SECONDARY']);
});

test('original report inventory requires original archived inventory evidence for every lineage', () => {
  const shaA = 'd'.repeat(64);
  const shaB = 'e'.repeat(64);
  const verification = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      {
        lineageId: 'L1', status: 'complete-original-ledger', expectedReportIds: ['R1', 'R1-SUPP'],
        evidenceReference: 'original extraction workbook', evidenceObjectId: `HOBJ-${shaA}`, evidenceSha256: shaA,
      },
      {
        lineageId: 'L2', status: 'complete-original-ledger', expectedReportIds: ['R2'],
        evidenceReference: 'original extraction workbook', evidenceObjectId: `HOBJ-${shaB}`, evidenceSha256: shaB,
      },
    ],
  });
  assert.equal(verification.computationalInventoryComplete, true);
  assert.equal(verification.originalInventoryComplete, true);
});

test('unknown/duplicate lineages and empty complete inventories fail closed', () => {
  assert.throws(() => createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [{ lineageId: 'UNKNOWN', status: 'unknown', expectedReportIds: [], evidenceReference: 'none' }],
  }), /unknown canonical lineage/i);
  assert.throws(() => createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      { lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1', 'R1-SUPP'], evidenceReference: 'a' },
      { lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: ['R1', 'R1-SUPP'], evidenceReference: 'b' },
    ],
  }), /duplicates lineage/i);
  assert.throws(() => createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: [
      { lineageId: 'L1', status: 'complete-source-reconstructed', expectedReportIds: [], evidenceReference: 'a' },
      { lineageId: 'L2', status: 'complete-source-reconstructed', expectedReportIds: ['R2'], evidenceReference: 'b' },
    ],
  }), /must identify at least one expected report/i);
});
