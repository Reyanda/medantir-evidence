import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, PipelineState } from '../src/core/types.js';
import type { PipelineCheckpointPort } from '../src/core/ports.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { ReviewProtocol } from '../src/protocols/review-protocol.js';

const oneStageProtocol: ReviewProtocol = {
  reviewType: 'systematic',
  stages: [{
    stage: 'question',
    requiredArtifacts: [],
    producedArtifacts: ['normalisedQuestion'],
    maxRetries: 0,
    humanGate: 'never',
    validate: (state) => ({
      ok: Boolean(state.artifacts.normalisedQuestion),
      issues: state.artifacts.normalisedQuestion ? [] : [{ code: 'MISSING', message: 'missing output', severity: 'error' }],
    }),
  }],
};

class RecordingCheckpointPort implements PipelineCheckpointPort {
  readonly records: Array<{ event: string; state: PipelineState }> = [];
  constructor(private readonly failOn?: string) {}
  async checkpoint(input: Parameters<PipelineCheckpointPort['checkpoint']>[0]): Promise<void> {
    if (input.event === this.failOn) throw new Error(`simulated durability failure at ${input.event}`);
    this.records.push({ event: input.event, state: structuredClone(input.state) });
  }
}

test('orchestrator checkpoints started state before execution and passed state after validation', async () => {
  let executions = 0;
  const agent: Agent = {
    stage: 'question',
    async execute() {
      executions += 1;
      return { artifacts: { normalisedQuestion: { title: 'durable' } } };
    },
  };
  const checkpointPort = new RecordingCheckpointPort();
  const state = createPipelineState(fixtureRequest);
  const result = await new PipelineOrchestrator([agent], { checkpointPort }).run(state, oneStageProtocol);
  assert.equal(executions, 1);
  assert.deepEqual(checkpointPort.records.map((record) => record.event), ['started', 'passed']);
  assert.equal(checkpointPort.records[0]?.state.stages.question.status, 'running');
  assert.equal(checkpointPort.records[0]?.state.artifacts.normalisedQuestion, undefined);
  assert.equal(checkpointPort.records[1]?.state.stages.question.status, 'passed');
  assert.deepEqual(checkpointPort.records[1]?.state.artifacts.normalisedQuestion, { title: 'durable' });
  assert.equal(result.stages.question.status, 'passed');
});

test('durability failure before execution prevents the scientific agent from running', async () => {
  let executions = 0;
  const agent: Agent = {
    stage: 'question',
    async execute() {
      executions += 1;
      return { artifacts: { normalisedQuestion: { title: 'must-not-run' } } };
    },
  };
  const checkpointPort = new RecordingCheckpointPort('started');
  const result = await new PipelineOrchestrator([agent], { checkpointPort }).run(createPipelineState(fixtureRequest), oneStageProtocol);
  assert.equal(executions, 0);
  assert.equal(result.stages.question.status, 'failed');
  assert.ok(result.stages.question.errors.some((message) => /Durable checkpoint failed/.test(message)));
});

test('durability failure after agent success fails fast without retrying the scientific agent', async () => {
  let executions = 0;
  const agent: Agent = {
    stage: 'question',
    async execute() {
      executions += 1;
      return { artifacts: { normalisedQuestion: { title: 'computed-once' } } };
    },
  };
  const checkpointPort = new RecordingCheckpointPort('passed');
  const result = await new PipelineOrchestrator([agent], { checkpointPort }).run(createPipelineState(fixtureRequest), oneStageProtocol);
  assert.equal(executions, 1);
  assert.equal(result.stages.question.status, 'failed');
  assert.deepEqual(result.artifacts.normalisedQuestion, { title: 'computed-once' });
  assert.ok(result.stages.question.errors.some((message) => /Durable checkpoint failed/.test(message)));
});
