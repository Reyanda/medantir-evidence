import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalStudySourceManifest, type HistoricalStudyReportInput } from '../src/historical/study-source-manifest.js';

const source = (character: string) => ({
  objectId: `HOBJ-${character.repeat(64)}`,
  sha256: character.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId: `record-${character}`,
  accessClass: 'restricted-source' as const,
});

function report(overrides: Partial<HistoricalStudyReportInput> = {}): HistoricalStudyReportInput {
  return {
    lineageId: 'L1',
    reportId: 'R1',
    role: 'primary-results',
    identifiers: { doi: 'https://doi.org/10.1000/FIXTURE' },
    publicationDate: '2020-12-01',
    availableByHistoricalCutoff: true,
    requiredForReproduction: true,
    resultBearing: true,
    sourceStatus: 'archived-exact',
    sourceObject: source('a'),
    ...overrides,
  };
}

test('exact study-source coverage requires every canonical lineage to have an archived required result-bearing report', () => {
  const manifest = createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: ['L1', 'L2'],
    reports: [
      report(),
      report({ lineageId: 'L2', reportId: 'R2', identifiers: { pmid: '2' }, sourceObject: source('b') }),
    ],
  });
  assert.equal(manifest.exactSourceCoverage, true);
  assert.deepEqual(manifest.missingLineageIds, []);
  assert.deepEqual(manifest.lineagesWithoutArchivedResultSource, []);
  assert.equal(manifest.archivedRequiredReportCount, 2);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
});

test('identified but unarchived primary report is explicit source debt, not extraction-ready evidence', () => {
  const manifest = createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: ['L1'],
    reports: [report({ sourceStatus: 'identified-unarchived', sourceObject: undefined })],
  });
  assert.equal(manifest.exactSourceCoverage, false);
  assert.deepEqual(manifest.lineagesWithoutArchivedResultSource, ['L1']);
  assert.equal(manifest.archivedRequiredReportCount, 0);
});

test('a protocol or non-result report cannot satisfy historical extraction coverage by itself', () => {
  const manifest = createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: ['L1'],
    reports: [report({ role: 'protocol', resultBearing: false })],
  });
  assert.equal(manifest.exactSourceCoverage, false);
  assert.deepEqual(manifest.lineagesWithoutArchivedResultSource, ['L1']);
});

test('unknown lineages, duplicate reports, false archived receipts and post-cutoff required reports fail closed', () => {
  assert.throws(() => createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02', requiredLineageIds: ['L1'], reports: [report({ lineageId: 'L9' })],
  }), /unknown canonical lineage/i);
  assert.throws(() => createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02', requiredLineageIds: ['L1'], reports: [report(), report()],
  }), /duplicates report ID/i);
  assert.throws(() => createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02', requiredLineageIds: ['L1'], reports: [report({ sourceObject: { ...source('a'), objectId: `HOBJ-${'b'.repeat(64)}` } })],
  }), /archived-exact without a valid content-addressed source receipt/i);
  assert.throws(() => createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02', requiredLineageIds: ['L1'], reports: [report({ publicationDate: '2021-07-01', availableByHistoricalCutoff: false })],
  }), /cannot be required.*unavailable by the bound cutoff/i);
});

test('source object cannot be attached while status claims it is unarchived', () => {
  assert.throws(() => createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02', requiredLineageIds: ['L1'], reports: [report({ sourceStatus: 'identified-unarchived' })],
  }), /has a source object but sourceStatus/i);
});
