import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';
import { createHistoricalSourceVersionVerification } from '../src/historical/source-version-attestation.js';

const source = {
  objectId: `HOBJ-${'a'.repeat(64)}`,
  sha256: 'a'.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId: 'r1',
  accessClass: 'restricted-source' as const,
};

const sourceManifest = createHistoricalStudySourceManifest({
  historicalCutoff: '2021-06-02',
  requiredLineageIds: ['L1'],
  reports: [{
    lineageId: 'L1',
    reportId: 'R1',
    role: 'primary-results',
    identifiers: { doi: '10.1000/r1' },
    publicationDate: '2021-01-01',
    availableByHistoricalCutoff: true,
    requiredForReproduction: true,
    resultBearing: true,
    sourceStatus: 'archived-exact',
    sourceObject: source,
  }],
});

test('exact archived bytes require an independent as-of-cutoff attestation before historical version coverage is exact', () => {
  const unverified = createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{ reportId: 'R1', status: 'current-copy-unverified', evidenceReference: 'current publisher copy' }],
  });
  assert.equal(sourceManifest.exactSourceCoverage, true);
  assert.equal(unverified.exactHistoricalVersionCoverage, false);
  assert.deepEqual(unverified.unverifiedRequiredReportIds, ['R1']);

  const verified = createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{
      reportId: 'R1',
      status: 'verified-as-of-cutoff',
      basis: 'trusted-archive-timestamp',
      historicalVersionDate: '2021-01-15',
      evidenceReference: 'trusted archive capture before cutoff',
    }],
  });
  assert.equal(verified.exactHistoricalVersionCoverage, true);
  assert.deepEqual(verified.verifiedRequiredReportIds, ['R1']);
  assert.match(verified.verificationHash, /^[a-f0-9]{64}$/);
});

test('post-cutoff attestation cannot be mislabeled verified-as-of-cutoff', () => {
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{
      reportId: 'R1', status: 'verified-as-of-cutoff', basis: 'publisher-version-history',
      historicalVersionDate: '2021-06-03', evidenceReference: 'publisher history',
    }],
  }), /dated after the review cutoff/i);
});

test('verified version requires exact archived bytes, basis and historical date', () => {
  const unarchived = createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: ['L1'],
    reports: [{
      lineageId: 'L1', reportId: 'R1', role: 'primary-results', identifiers: { pmid: '1' },
      publicationDate: '2021-01-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'identified-unarchived',
    }],
  });
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest: unarchived,
    attestations: [{ reportId: 'R1', status: 'verified-as-of-cutoff', basis: 'repository-version-record', historicalVersionDate: '2021-01-01', evidenceReference: 'repo' }],
  }), /cannot be verified without exact archived report bytes/i);
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{ reportId: 'R1', status: 'verified-as-of-cutoff', historicalVersionDate: '2021-01-01', evidenceReference: 'repo' }],
  }), /requires an attestation basis/i);
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{ reportId: 'R1', status: 'verified-as-of-cutoff', basis: 'repository-version-record', evidenceReference: 'repo' }],
  }), /requires a historical version date/i);
});

test('unknown and duplicate version attestations fail closed', () => {
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{ reportId: 'UNKNOWN', status: 'unknown', evidenceReference: 'none' }],
  }), /unknown report/i);
  assert.throws(() => createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [
      { reportId: 'R1', status: 'unknown', evidenceReference: 'a' },
      { reportId: 'R1', status: 'unknown', evidenceReference: 'b' },
    ],
  }), /duplicates report/i);
});
