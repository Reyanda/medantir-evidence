import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, PipelineState } from '../src/core/types.js';
import type { PipelineCheckpointPort } from '../src/core/ports.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { ExternalActionReconciliationRequiredError } from '../src/durability/external-action-coordinator.js';
import type { ReviewProtocol } from '../src/protocols/review-protocol.js';

class ReconciliationAgent implements Agent {
  readonly stage = 'question' as const;
  calls = 0;
  async execute() {
    this.calls += 1;
    throw new ExternalActionReconciliationRequiredError(
      'ext-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Remote registry state is uncertain and requires reconciliation.',
    );
  }
}

class CapturingCheckpoint implements PipelineCheckpointPort {
  readonly events: Array<{ event: string; status: string; attempt: number }> = [];
  async checkpoint(input: { state: PipelineState; event: string; attempt: number }) {
    this.events.push({
      event: input.event,
      status: input.state.stages.question.status,
      attempt: input.attempt,
    });
  }
}

const protocol: ReviewProtocol = {
  reviewType: 'systematic',
  stages: [{
    stage: 'question',
    requiredArtifacts: [],
    producedArtifacts: [],
    maxRetries: 3,
    humanGate: 'never',
    validate: () => ({ ok: true, issues: [] }),
  }],
};

test('reconciliation-required external action blocks once without consuming failure retries', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new ReconciliationAgent();
  const checkpoints = new CapturingCheckpoint();
  const orchestrator = new PipelineOrchestrator([agent], { checkpointPort: checkpoints });
  const result = await orchestrator.run(state, protocol);

  assert.equal(agent.calls, 1);
  assert.equal(result.stages.question.status, 'awaiting-human');
  assert.equal(result.stages.question.attempts, 1);
  assert.equal(result.stages.question.errors.length, 0);
  const blocked = result.artifacts.externalActionReconciliationRequired as {
    actionId: string;
    stage: string;
    message: string;
  };
  assert.equal(blocked.actionId, 'ext-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(blocked.stage, 'question');
  assert.match(blocked.message, /requires reconciliation/i);
  assert.ok(result.audit.some((event) => event.event === 'external-action-reconciliation-required'));
  assert.equal(result.audit.some((event) => event.event === 'attempt-failed'), false);
  assert.deepEqual(checkpoints.events.map((entry) => entry.event), [
    'started',
    'external-action-reconciliation-required',
  ]);
});
