import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';
import { buildHistoricalParsedDocumentPlane } from '../src/historical/parsed-document-plane.js';

const source = (character: string, recordId: string) => ({
  objectId: `HOBJ-${character.repeat(64)}`,
  sha256: character.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId,
  accessClass: 'restricted-source' as const,
});

const manifest = createHistoricalStudySourceManifest({
  historicalCutoff: '2021-06-02',
  requiredLineageIds: ['L1', 'L2'],
  reports: [
    {
      lineageId: 'L1', reportId: 'REPORT-1', role: 'primary-results', identifiers: { doi: '10.1/r1' },
      publicationDate: '2021-01-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: source('a', 'record-1'),
    },
    {
      lineageId: 'L2', reportId: 'REPORT-2', role: 'primary-results', identifiers: { pmid: '2' },
      publicationDate: '2021-02-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: source('b', 'record-2'),
    },
  ],
});

const checkpoints = [
  { recordId: 'record-1', sourceObjectId: `HOBJ-${'a'.repeat(64)}`, sourceSha256: 'a'.repeat(64), parserContractHash: 'parser-v1', parsedObjectId: `HOBJ-${'c'.repeat(64)}`, parsedDocumentHash: 'd'.repeat(64) },
  { recordId: 'record-2', sourceObjectId: `HOBJ-${'b'.repeat(64)}`, sourceSha256: 'b'.repeat(64), parserContractHash: 'parser-v1', parsedObjectId: `HOBJ-${'e'.repeat(64)}`, parsedDocumentHash: 'f'.repeat(64) },
];
const certificates = [
  { recordId: 'record-1', sourceObjectMatches: true, parserContractMatches: true, parsedDocumentMatches: true, exact: true, expectedParsedHash: 'd'.repeat(64), actualParsedHash: 'd'.repeat(64) },
  { recordId: 'record-2', sourceObjectMatches: true, parserContractMatches: true, parsedDocumentMatches: true, exact: true, expectedParsedHash: 'f'.repeat(64), actualParsedHash: 'f'.repeat(64) },
];

test('parsed-document plane becomes replay-exact only when every required result-bearing source has an exact parser replay certificate', () => {
  const result = buildHistoricalParsedDocumentPlane({ sourceManifest: manifest, checkpoints, certificates });
  assert.equal(result.plane.replayFidelity, 'exact');
  assert.equal(result.plane.historicalProvenance, 'source-reconstructed');
  assert.deepEqual(result.receipt.requiredRecordIds, ['record-1', 'record-2']);
  assert.deepEqual(result.receipt.exactRecordIds, ['record-1', 'record-2']);
  assert.deepEqual(result.receipt.missingRecordIds, []);
  assert.deepEqual(result.receipt.failedRecordIds, []);
});

test('missing parser checkpoint/certificate is explicit parser-plane debt', () => {
  const result = buildHistoricalParsedDocumentPlane({
    sourceManifest: manifest,
    checkpoints: checkpoints.slice(0, 1),
    certificates: certificates.slice(0, 1),
  });
  assert.equal(result.plane.replayFidelity, 'unverified');
  assert.deepEqual(result.receipt.missingRecordIds, ['record-2']);
});

test('parser contract/output divergence keeps parsed-document plane unverified', () => {
  const changed = certificates.map((certificate) => certificate.recordId === 'record-2'
    ? { ...certificate, parserContractMatches: false, exact: false }
    : certificate);
  const result = buildHistoricalParsedDocumentPlane({ sourceManifest: manifest, checkpoints, certificates: changed });
  assert.equal(result.plane.replayFidelity, 'unverified');
  assert.deepEqual(result.receipt.failedRecordIds, ['record-2']);
});

test('duplicate checkpoint/certificate identities fail closed', () => {
  assert.throws(() => buildHistoricalParsedDocumentPlane({
    sourceManifest: manifest,
    checkpoints: [checkpoints[0]!, checkpoints[0]!],
    certificates,
  }), /duplicate historical parser checkpoint/i);
  assert.throws(() => buildHistoricalParsedDocumentPlane({
    sourceManifest: manifest,
    checkpoints,
    certificates: [certificates[0]!, certificates[0]!],
  }), /duplicate historical parser replay certificate/i);
});
