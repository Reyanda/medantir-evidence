import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ExternalActionCoordinator,
  ExternalActionReconciliationRequiredError,
} from '../src/durability/external-action-coordinator.js';
import { FileExternalActionLedger } from '../src/durability/file-external-action-ledger.js';

async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'medantir-external-action-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = new FileExternalActionLedger({ rootDir: root, lockTimeoutMs: 500, lockRetryMs: 5, staleLockMs: 500 });
  return { root, ledger, coordinator: new ExternalActionCoordinator(ledger) };
}

test('safe-repeat search action reuses a durable success receipt without rerunning provider', async (t) => {
  const { ledger, coordinator } = await harness(t);
  let calls = 0;
  const input = {
    runId: 'run-safe-repeat',
    stage: 'search-execute' as const,
    kind: 'evidence-search-export',
    operationKey: 'pubmed:NCBI:primary-studies',
    request: { query: 'nutrition AND child' },
    replayPolicy: 'safe-repeat' as const,
    perform: async () => {
      calls += 1;
      return { records: ['A', 'B'], count: 2 };
    },
    now: () => '2026-08-11T05:00:00.000Z',
  };
  const first = await coordinator.execute(input);
  const second = await new ExternalActionCoordinator(ledger).execute(input);
  assert.equal(calls, 1);
  assert.equal(first.reusedReceipt, false);
  assert.equal(second.reusedReceipt, true);
  assert.deepEqual(second.response, { records: ['A', 'B'], count: 2 });
  assert.equal(first.actionId, second.actionId);
});

test('safe-repeat action may rerun after a definite provider failure', async (t) => {
  const { coordinator } = await harness(t);
  let calls = 0;
  const base = {
    runId: 'run-safe-failure',
    stage: 'search-execute' as const,
    kind: 'evidence-search-export',
    operationKey: 'pubmed:NCBI:primary-studies',
    request: { query: 'malnutrition' },
    replayPolicy: 'safe-repeat' as const,
    now: () => '2026-08-11T05:00:00.000Z',
  };
  await assert.rejects(() => coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      throw new Error('HTTP 503');
    },
  }), /HTTP 503/);
  const recovered = await coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      return { records: ['A'] };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(recovered.response, { records: ['A'] });
});

test('mutating action failure becomes uncertain and is never blindly repeated', async (t) => {
  const { coordinator } = await harness(t);
  let calls = 0;
  const base = {
    runId: 'run-registry-uncertain',
    stage: 'register-protocol' as const,
    kind: 'registry-registration',
    operationKey: 'osf:protocol-checksum:submit',
    request: { checksum: 'abc123' },
    replayPolicy: 'require-reconciliation' as const,
    now: () => '2026-08-11T05:00:00.000Z',
  };
  await assert.rejects(() => coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      throw new Error('connection reset after request dispatch');
    },
  }), /connection reset/);

  await assert.rejects(
    () => coordinator.execute({
      ...base,
      perform: async () => {
        calls += 1;
        return { externalId: 'should-not-run' };
      },
    }),
    (error: unknown) => error instanceof ExternalActionReconciliationRequiredError,
  );
  assert.equal(calls, 1);
});

test('reconciliation can recover a completed remote mutation without replay', async (t) => {
  const { coordinator } = await harness(t);
  let calls = 0;
  const base = {
    runId: 'run-registry-reconciled',
    stage: 'register-protocol' as const,
    kind: 'registry-registration',
    operationKey: 'prospero:checksum:submit',
    request: { checksum: 'def456' },
    replayPolicy: 'require-reconciliation' as const,
    now: () => '2026-08-11T05:00:00.000Z',
  };
  await assert.rejects(() => coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      throw new Error('response lost');
    },
  }), /response lost/);

  const recovered = await coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      return { externalId: 'duplicate' };
    },
    reconcile: async (idempotencyKey) => ({
      status: 'completed' as const,
      response: { externalId: 'PROSPERO-1', idempotencyKey },
    }),
  });
  assert.equal(calls, 1);
  assert.equal(recovered.reconciled, true);
  assert.equal(recovered.reusedReceipt, true);
  assert.equal(recovered.response.externalId, 'PROSPERO-1');
});

test('reconciliation not-found authorizes one safe mutation retry', async (t) => {
  const { coordinator } = await harness(t);
  let calls = 0;
  const base = {
    runId: 'run-registry-not-found',
    stage: 'register-protocol' as const,
    kind: 'registry-registration',
    operationKey: 'osf:checksum:draft',
    request: { checksum: 'ghi789' },
    replayPolicy: 'require-reconciliation' as const,
    now: () => '2026-08-11T05:00:00.000Z',
  };
  await assert.rejects(() => coordinator.execute({
    ...base,
    perform: async () => {
      calls += 1;
      throw new Error('dispatch uncertainty');
    },
  }), /dispatch uncertainty/);

  const retried = await coordinator.execute({
    ...base,
    perform: async (idempotencyKey) => {
      calls += 1;
      return { externalId: 'OSF-2', idempotencyKey };
    },
    reconcile: async () => ({ status: 'not-found' as const }),
  });
  assert.equal(calls, 2);
  assert.equal(retried.reusedReceipt, false);
  assert.equal(retried.response.externalId, 'OSF-2');
});
