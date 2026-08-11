import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalIndexStateVerification } from '../src/historical/index-state-attestation.js';

const exactReceipt = (character: string) => ({
  sourceObjectId: `HOBJ-${character.repeat(64)}`,
  sourceSha256: character.repeat(64),
});

test('current index reconstruction is never promoted to exact historical database state solely by publication-date filtering', () => {
  const verification = createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02T23:59:59Z',
    requiredDatabases: ['PubMed'],
    attestations: [{
      database: 'PubMed',
      queryExecutedAt: '2026-08-10T12:00:00Z',
      historicalSearchEnd: '2021-06-02T23:59:59Z',
      provenance: 'current-index-reconstruction',
      resultSetHash: 'a'.repeat(64),
      resultCount: 303,
      sourceReference: 'current PubMed API query constrained to publication date <= cutoff',
    }],
  });
  assert.equal(verification.exactHistoricalIndexCoverage, false);
  assert.deepEqual(verification.exactDatabases, []);
  assert.deepEqual(verification.reconstructedDatabases, ['PubMed']);
});

test('original archived export can prove exact index state when the represented query ran by the bound search end', () => {
  const verification = createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02T23:59:59Z',
    requiredDatabases: ['PubMed'],
    attestations: [{
      database: 'PubMed',
      queryExecutedAt: '2021-06-02T10:00:00Z',
      historicalSearchEnd: '2021-06-02T23:59:59Z',
      provenance: 'original-export',
      resultSetHash: 'b'.repeat(64),
      resultCount: 303,
      sourceReference: 'original reviewer PubMed export',
      ...exactReceipt('c'),
    }],
  });
  assert.equal(verification.exactHistoricalIndexCoverage, true);
  assert.deepEqual(verification.exactDatabases, ['PubMed']);
  assert.match(verification.verificationHash, /^[a-f0-9]{64}$/);
});

test('historical snapshot provenance requires immutable snapshot bytes and all declared databases', () => {
  assert.throws(() => createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02',
    requiredDatabases: ['PubMed'],
    attestations: [{
      database: 'PubMed', queryExecutedAt: '2021-06-02', historicalSearchEnd: '2021-06-02',
      provenance: 'trusted-historical-snapshot', resultSetHash: 'd'.repeat(64), resultCount: 303,
      sourceReference: 'archive snapshot',
    }],
  }), /requires an immutable source export\/snapshot receipt/i);

  assert.throws(() => createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02',
    requiredDatabases: ['PubMed', 'ClinicalTrials.gov'],
    attestations: [{
      database: 'PubMed', queryExecutedAt: '2021-06-02', historicalSearchEnd: '2021-06-02',
      provenance: 'current-index-reconstruction', resultSetHash: 'e'.repeat(64), resultCount: 303,
      sourceReference: 'current reconstruction',
    }],
  }), /missing database\(s\).*ClinicalTrials\.gov/i);
});

test('an original export executed after the bound search end cannot attest the original historical index state', () => {
  assert.throws(() => createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02T23:59:59Z',
    attestations: [{
      database: 'PubMed', queryExecutedAt: '2021-06-03T00:00:01Z', historicalSearchEnd: '2021-06-02T23:59:59Z',
      provenance: 'original-export', resultSetHash: 'f'.repeat(64), resultCount: 303,
      sourceReference: 'late export', ...exactReceipt('a'),
    }],
  }), /after the historical search end/i);
});

test('index-state hashes, counts and database identities fail closed on malformed or duplicate declarations', () => {
  assert.throws(() => createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02',
    attestations: [{
      database: 'PubMed', queryExecutedAt: '2021-06-02', historicalSearchEnd: '2021-06-02',
      provenance: 'current-index-reconstruction', resultSetHash: 'not-a-hash', resultCount: 1,
      sourceReference: 'x',
    }],
  }), /resultSetHash must be SHA-256/i);
  assert.throws(() => createHistoricalIndexStateVerification({
    historicalSearchEnd: '2021-06-02',
    attestations: [
      { database: 'PubMed', queryExecutedAt: '2026-01-01', historicalSearchEnd: '2021-06-02', provenance: 'current-index-reconstruction', resultSetHash: 'a'.repeat(64), resultCount: 1, sourceReference: 'x' },
      { database: 'PubMed', queryExecutedAt: '2026-01-01', historicalSearchEnd: '2021-06-02', provenance: 'current-index-reconstruction', resultSetHash: 'b'.repeat(64), resultCount: 1, sourceReference: 'y' },
    ],
  }), /duplicates database/i);
});
