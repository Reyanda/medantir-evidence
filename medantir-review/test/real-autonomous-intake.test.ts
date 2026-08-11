import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRequest } from '../src/fixtures.js';
import { runRealPipeline } from '../src/real-engine.js';

test('real pipeline stops at question clarification before search/network stages', async () => {
  const state = await runRealPipeline(fixtureRequest);
  assert.equal(state.stages.question.status, 'awaiting-human');
  assert.equal(state.stages.identity.status, 'pending');
  assert.equal(state.stages.protocol.status, 'pending');
  assert.equal(state.stages['search-execute'].status, 'pending');
  assert.equal(state.artifacts.searchProvenance, undefined);
  assert.equal(state.artifacts.searchResults, undefined);
  assert.equal((state.artifacts.reviewSpecCompilation as { status: string }).status, 'needs-clarification');
  const request = state.artifacts.clarificationRequest as {
    status: string;
    issue: { field: string; earliestAffectedStage: string };
  };
  assert.equal(request.status, 'needs-clarification');
  assert.equal(request.issue.field, 'eligibleDesigns');
  assert.equal(request.issue.earliestAffectedStage, 'protocol');
  assert.ok(state.audit.some((event) => event.event === 'awaiting-human-evidence-review' && event.stage === 'question'));
});
