import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runSrBenchmarkCase, type SrReviewModelPort } from '../src/benchmark/sr-reproduction-benchmark.js';
import { loadSrBenchmarkCase } from '../src/benchmark/sr-benchmark-suite.js';
import {
  createSrDriftSentinelReceipt,
  verifySrDriftSentinelReceipt,
} from '../src/benchmark/sr-drift-sentinel.js';

class GoldEchoPort implements SrReviewModelPort {
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    return {
      output: input.task.gold,
      routing: { requestedModel: input.model, actualModel: 'pinned-model', provider: 'provider-a' },
    };
  }
}

class UnsafePort implements SrReviewModelPort {
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    const output = input.task.id === 'fixture-tiab'
      ? { decisions: [{ id: 'r1', decision: 'exclude' }, { id: 'r2', decision: 'exclude' }, { id: 'r3', decision: 'exclude' }] }
      : input.task.gold;
    return { output, routing: { requestedModel: input.model, actualModel: 'pinned-model', provider: 'provider-a' } };
  }
}

const fixturePath = resolve('benchmarks/srbench-v1/synthetic-complete/case.json');

async function perfectCanary() {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const run = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'candidate', port: new GoldEchoPort() });
  return { ...run, domain: 'canary-domain', repeat: 1 };
}

test('valid drift sentinel is hash-bound to suite/model and expires', async () => {
  const run = await perfectCanary();
  const suiteHash = 'a'.repeat(64);
  const receipt = createSrDriftSentinelReceipt({
    sentinelId: 'sentinel-1',
    suiteHash,
    requestedModel: 'candidate',
    canaryRuns: [run],
    issuedAt: '2026-08-10T12:00:00Z',
    expiresAt: '2026-08-17T12:00:00Z',
  });
  const valid = verifySrDriftSentinelReceipt({ receipt, expectedSuiteHash: suiteHash, requestedModel: 'candidate', now: '2026-08-11T12:00:00Z' });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);

  const wrongSuite = verifySrDriftSentinelReceipt({ receipt, expectedSuiteHash: 'b'.repeat(64), requestedModel: 'candidate', now: '2026-08-11T12:00:00Z' });
  assert.equal(wrongSuite.valid, false);
  assert.ok(wrongSuite.errors.some((item) => /different benchmark suite/i.test(item)));

  const expired = verifySrDriftSentinelReceipt({ receipt, expectedSuiteHash: suiteHash, requestedModel: 'candidate', now: '2026-08-18T12:00:00Z' });
  assert.equal(expired.valid, false);
  assert.ok(expired.errors.some((item) => /expired/i.test(item)));
});

test('tampering any sentinel field invalidates its receipt hash', async () => {
  const run = await perfectCanary();
  const suiteHash = 'a'.repeat(64);
  const receipt = createSrDriftSentinelReceipt({
    sentinelId: 'sentinel-1', suiteHash, requestedModel: 'candidate', canaryRuns: [run],
    issuedAt: '2026-08-10T12:00:00Z', expiresAt: '2026-08-17T12:00:00Z',
  });
  const tampered = { ...receipt, actualModel: 'different-model' };
  const verification = verifySrDriftSentinelReceipt({ receipt: tampered, expectedSuiteHash: suiteHash, requestedModel: 'candidate', now: '2026-08-11T12:00:00Z' });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((item) => /receipt hash mismatch/i.test(item)));
});

test('sentinel cannot be minted from non-SR100 or critically unsafe canary runs', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const unsafe = await runSrBenchmarkCase({ caseDefinition: loaded.definition, model: 'candidate', port: new UnsafePort() });
  assert.equal(unsafe.sr100, false);
  assert.ok(unsafe.criticalFailures.length > 0);
  assert.throws(() => createSrDriftSentinelReceipt({
    sentinelId: 'unsafe-sentinel',
    suiteHash: 'a'.repeat(64),
    requestedModel: 'candidate',
    canaryRuns: [{ ...unsafe, domain: 'canary-domain', repeat: 1 }],
    issuedAt: '2026-08-10T12:00:00Z',
    expiresAt: '2026-08-17T12:00:00Z',
  }), /every canary run is SR100/i);
});
