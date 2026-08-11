import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSrBenchmarkCase } from '../src/benchmark/sr-benchmark-suite.js';

const partial = { status: 'partial', reason: 'fixture partial gold' };
const missing = { status: 'missing', reason: 'fixture missing gold' };

test('complete stage may be bound to a deterministic engine receipt without a model task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srbench-engine-stage-'));
  try {
    await writeFile(join(root, 'search-receipt.json'), JSON.stringify({
      engine: 'MEDANTIR deterministic search executor',
      queryHash: 'abc',
      sourceSnapshotHash: 'def',
      reconciled: true,
    }));
    await writeFile(join(root, 'case.json'), JSON.stringify({
      schemaVersion: 'medantir-srbench/1',
      benchmarkClass: 'published-review',
      caseId: 'engine-stage-case',
      title: 'Engine stage fixture',
      domain: 'fixture-domain',
      reviewType: 'systematic',
      stageReceiptFiles: { search: 'search-receipt.json' },
      stageGold: {
        question: { status: 'complete', receiptHash: 'AUTO' },
        protocol: partial,
        search: { status: 'complete', receiptHash: 'AUTO' },
        deduplication: partial,
        'tiab-screening': partial,
        'fulltext-screening': partial,
        extraction: missing,
        appraisal: partial,
        synthesis: partial,
        report: partial
      },
      tasks: [{
        id: 'question-task',
        stage: 'question',
        instruction: 'Return the title.',
        input: { title: 'Engine stage fixture' },
        gold: { title: 'Engine stage fixture' },
        scorer: { kind: 'exact-json' },
        critical: true
      }]
    }));
    const loaded = await loadSrBenchmarkCase(join(root, 'case.json'));
    assert.match(loaded.definition.stageGold.search.receiptHash!, /^[a-f0-9]{64}$/);
    assert.match(loaded.definition.stageGold.question.receiptHash!, /^[a-f0-9]{64}$/);
    assert.notEqual(loaded.definition.stageGold.search.receiptHash, loaded.definition.stageGold.question.receiptHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('complete deterministic stage fails closed when its bound receipt file is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srbench-engine-stage-missing-'));
  try {
    await writeFile(join(root, 'case.json'), JSON.stringify({
      schemaVersion: 'medantir-srbench/1',
      caseId: 'missing-engine-stage-case',
      title: 'Missing engine stage fixture',
      domain: 'fixture-domain',
      reviewType: 'systematic',
      stageGold: {
        question: partial,
        protocol: partial,
        search: { status: 'complete', receiptHash: 'AUTO' },
        deduplication: partial,
        'tiab-screening': partial,
        'fulltext-screening': partial,
        extraction: missing,
        appraisal: partial,
        synthesis: partial,
        report: partial
      },
      tasks: []
    }));
    await assert.rejects(() => loadSrBenchmarkCase(join(root, 'case.json')), /neither model gold nor a deterministic stage receipt/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
