import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryingEvidenceSourceAdapter, isRetryableSourceError, retryTransientOperation } from '../src/adapters/retry.js';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { SearchStrategy } from '../src/core/types.js';

const strategy: SearchStrategy = {
  database: 'pubmed',
  platform: 'test',
  query: 'baricitinib',
  generatedAt: new Date().toISOString(),
};

function success(database = 'pubmed') {
  return {
    records: [{ id: 'pmid:1', title: 'Study', abstract: '', authors: [], year: 2021, pmid: '1', sourceDatabases: [database] }],
    provenance: {
      database,
      platform: 'test',
      executedQuery: strategy.query,
      executedAt: new Date().toISOString(),
      resultCount: 1,
      exportFormat: 'JSON' as const,
      warnings: [],
    },
  };
}

test('classifies socket termination, 429 and 5xx as retryable but not query/reconciliation failures', () => {
  assert.equal(isRetryableSourceError(new TypeError('terminated', { cause: new Error('UND_ERR_SOCKET other side closed') })), true);
  assert.equal(isRetryableSourceError(new Error('Europe PMC search failed with HTTP 503')), true);
  assert.equal(isRetryableSourceError(new Error('PubMed ESearch failed with HTTP 429')), true);
  assert.equal(isRetryableSourceError(new Error('PubMed ESearch failed with HTTP 400')), false);
  assert.equal(isRetryableSourceError(new Error('PubMed pagination/export reconciliation failed: source reported 12, retrieved 11')), false);
  assert.equal(isRetryableSourceError(new Error('PubMed returned 12000 records, exceeding configured complete-export limit 10000')), false);
});

test('generic transient operation retry recovers from 500 and records the failed attempts', async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryTransientOperation(async () => {
    calls += 1;
    if (calls < 3) throw new Error('ClinicalTrials.gov API failed with HTTP 500');
    return 'ok';
  }, {
    maxAttempts: 5,
    baseDelayMs: 10,
    maxDelayMs: 100,
    sleep: async (ms) => { delays.push(ms); },
  });

  assert.equal(result.value, 'ok');
  assert.equal(result.attempts, 3);
  assert.equal(result.failures.length, 2);
  assert.deepEqual(delays, [10, 20]);
});

test('generic transient operation retry does not repeat a non-retryable 400', async () => {
  let calls = 0;
  await assert.rejects(() => retryTransientOperation(async () => {
    calls += 1;
    throw new Error('ClinicalTrials.gov API failed with HTTP 400');
  }, {
    maxAttempts: 5,
    baseDelayMs: 0,
    sleep: async () => {},
  }), /HTTP 400/);
  assert.equal(calls, 1);
});

test('retries a transient source failure from the beginning and records recovery in provenance', async () => {
  let calls = 0;
  const delays: number[] = [];
  const inner: EvidenceSourceAdapter = {
    database: 'pubmed',
    async execute() {
      calls += 1;
      if (calls === 1) throw new TypeError('terminated', { cause: new Error('UND_ERR_SOCKET other side closed') });
      return success();
    },
  };
  const adapter = new RetryingEvidenceSourceAdapter(inner, {
    maxAttempts: 3,
    baseDelayMs: 10,
    sleep: async (ms) => { delays.push(ms); },
  });

  const result = await adapter.execute(strategy);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [10]);
  assert.equal(result.records.length, 1);
  assert.ok(result.provenance.warnings.some((warning) => /recovered after 2 attempt/i.test(warning)));
});

test('does not retry logical or scientific-integrity failures', async () => {
  let calls = 0;
  const inner: EvidenceSourceAdapter = {
    database: 'pubmed',
    async execute() {
      calls += 1;
      throw new Error('PubMed pagination/export reconciliation failed: source reported 12, retrieved 11');
    },
  };
  const adapter = new RetryingEvidenceSourceAdapter(inner, {
    maxAttempts: 3,
    baseDelayMs: 0,
    sleep: async () => {},
  });

  await assert.rejects(() => adapter.execute(strategy), /reconciliation failed/);
  assert.equal(calls, 1);
});

test('bounded retry still fails after the configured transient-failure ceiling', async () => {
  let calls = 0;
  const inner: EvidenceSourceAdapter = {
    database: 'europepmc',
    async execute() {
      calls += 1;
      throw new Error('Europe PMC search failed with HTTP 503');
    },
  };
  const adapter = new RetryingEvidenceSourceAdapter(inner, {
    maxAttempts: 3,
    baseDelayMs: 0,
    sleep: async () => {},
  });

  await assert.rejects(() => adapter.execute({ ...strategy, database: 'europepmc' }), /HTTP 503/);
  assert.equal(calls, 3);
});
