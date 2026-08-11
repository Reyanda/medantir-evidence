import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { SearchStrategy } from '../src/core/types.js';
import { DurableSearchExecuteAgent } from '../src/durability/durable-search-agent.js';
import { ExternalActionCoordinator } from '../src/durability/external-action-coordinator.js';
import { FileExternalActionLedger } from '../src/durability/file-external-action-ledger.js';

async function coordinator(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'medantir-durable-search-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new ExternalActionCoordinator(new FileExternalActionLedger({ rootDir: root, lockTimeoutMs: 500, lockRetryMs: 5, staleLockMs: 500 }));
}

function strategy(database: string): SearchStrategy {
  return {
    database,
    platform: `${database} test platform`,
    query: `query-${database}`,
    generatedAt: '2026-08-11T05:00:00.000Z',
  };
}

test('partial multi-database search resumes from per-source receipts', async (t) => {
  const externalActions = await coordinator(t);
  let aCalls = 0;
  let bCalls = 0;
  let bShouldFail = true;
  const adapterA: EvidenceSourceAdapter = {
    database: 'db-a',
    async execute(input) {
      aCalls += 1;
      return {
        records: [{ id: 'a1', title: 'A', abstract: '', authors: [], year: 2026, sourceDatabases: ['db-a'] }],
        provenance: { database: 'db-a', platform: 'db-a test platform', executedQuery: input.query, executedAt: '2026-08-11T05:00:01.000Z', resultCount: 1, exportFormat: 'JSON', warnings: [] },
      };
    },
  };
  const adapterB: EvidenceSourceAdapter = {
    database: 'db-b',
    async execute(input) {
      bCalls += 1;
      if (bShouldFail) throw new Error('temporary db-b failure');
      return {
        records: [{ id: 'b1', title: 'B', abstract: '', authors: [], year: 2026, sourceDatabases: ['db-b'] }],
        provenance: { database: 'db-b', platform: 'db-b test platform', executedQuery: input.query, executedAt: '2026-08-11T05:00:02.000Z', resultCount: 1, exportFormat: 'JSON', warnings: [] },
      };
    },
  };

  const state = createPipelineState({ ...fixtureRequest, databases: ['db-a', 'db-b'] });
  state.artifacts.searchStrategies = [strategy('db-a'), strategy('db-b')];
  const agent = new DurableSearchExecuteAgent([adapterA, adapterB], externalActions);
  await assert.rejects(() => agent.execute({ state, now: () => '2026-08-11T05:00:03.000Z' }), /temporary db-b failure/);
  assert.equal(aCalls, 1);
  assert.equal(bCalls, 1);

  bShouldFail = false;
  const resumed = await agent.execute({ state, now: () => '2026-08-11T05:00:04.000Z' });
  assert.equal(aCalls, 1, 'db-a must be reused from its durable success receipt');
  assert.equal(bCalls, 2, 'only failed db-b should execute again');
  const receipts = resumed.artifacts.externalSearchReceipts as Array<{ database: string; reusedExternalReceipt: boolean }>;
  assert.equal(receipts.find((entry) => entry.database === 'db-a')?.reusedExternalReceipt, true);
  assert.equal(receipts.find((entry) => entry.database === 'db-b')?.reusedExternalReceipt, false);
  assert.equal((resumed.artifacts.searchResults as unknown[]).length, 2);
});
