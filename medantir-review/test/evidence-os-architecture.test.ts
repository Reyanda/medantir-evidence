import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceOsArchitectureManifest } from '../src/evidence-os/architecture.js';
import { buildEvidenceCostLedger } from '../src/evidence-os/cost-ledger.js';
import type { PipelineState, StageName } from '../src/core/types.js';

const stageNames = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve',
  'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
] as StageName[];

function state(): PipelineState {
  return {
    runId: 'cost-run',
    request: { reviewType: 'systematic', databases: ['PubMed'], question: { title: 'Q', objective: 'O' } },
    stages: Object.fromEntries(stageNames.map((name) => [name, { name, status: 'pending', attempts: 0, errors: [] }])) as unknown as PipelineState['stages'],
    artifacts: {
      routing: { requestedModel: 'model-a', actualModel: 'model-a-2026', provider: 'provider-a', requestId: 'req-1', inputTokens: 100, outputTokens: 25, latencyMs: 500, costUsd: 0.04 },
      nested: [{ requestedModel: 'model-b', provider: 'provider-b', inputTokens: 10, outputTokens: 5 }],
    },
    audit: [], createdAt: '2026-08-14T08:00:00Z', updatedAt: '2026-08-14T08:00:00Z',
  };
}

test('architecture manifest reports truthfully bounded capabilities and cost ledger aggregates receipts', () => {
  const manifest = buildEvidenceOsArchitectureManifest('2026-08-14T08:00:00Z');
  assert.equal(manifest.runtime.horizontalScaleReady, false);
  assert.ok(manifest.modules.some((module) => module.id === 'causal-evidence-engine'));
  assert.ok(manifest.coverage.operational > 0);
  assert.ok(manifest.coverage.planned > 0);
  assert.ok(manifest.coverage['research-only'] > 0);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);

  const ledger = buildEvidenceCostLedger(state(), '2026-08-14T08:00:00Z');
  assert.equal(ledger.totals.calls, 2);
  assert.equal(ledger.totals.pricedCalls, 1);
  assert.equal(ledger.totals.unpricedCalls, 1);
  assert.equal(ledger.totals.inputTokens, 110);
  assert.equal(ledger.totals.outputTokens, 30);
  assert.equal(ledger.totals.costUsd, 0.04);
});
