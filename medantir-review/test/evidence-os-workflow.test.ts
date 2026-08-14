import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceWorkflowPlan } from '../src/evidence-os/workflow.js';

test('systematic review workflow is a deterministic auditable DAG', () => {
  const plan = buildEvidenceWorkflowPlan('systematic', undefined, '2026-08-14T08:00:00Z');
  assert.equal(plan.acyclic, true);
  assert.equal(plan.nodes.length, 21);
  assert.equal(plan.topologicalOrder.length, plan.nodes.length);
  assert.equal(new Set(plan.topologicalOrder).size, plan.nodes.length);
  const searchTest = plan.nodes.find((node) => node.stage === 'search-test');
  const synthesis = plan.nodes.find((node) => node.stage === 'synthesise');
  assert.ok(searchTest?.dependsOn.includes('stage:search-build'));
  assert.ok(synthesis?.dependsOn.includes('stage:extract'));
  assert.equal(plan.backend.resumable, true);
  assert.equal(plan.backend.checkpointed, true);
  assert.equal(plan.backend.distributedExecution, false);
  assert.deepEqual(plan.backend.supportedFutureBackends, ['Temporal', 'Dagster', 'Prefect', 'Airflow']);
  assert.match(plan.workflowHash, /^[a-f0-9]{64}$/);
});
