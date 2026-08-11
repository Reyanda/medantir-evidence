import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AutonomousQuestionAgent } from '../src/question/autonomous-question-agent.js';
import { recordClarificationResolution } from '../src/question/clarification-state.js';
import type { ClarificationResolution } from '../src/question/review-spec.js';

test('records one attributable clarification and reopens question stage for recompilation', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages.question.status = 'awaiting-human';
  state.stages.question.attempts = 1;
  const issue = (state.artifacts.clarificationIssues as Array<{ id: string; field: 'eligibleDesigns' }>)[0];
  assert.ok(issue);

  const resolution: ClarificationResolution = {
    issueId: issue.id,
    field: 'eligibleDesigns',
    value: ['randomised controlled trial'],
    rationale: 'Eligibility is restricted to randomized trials.',
    actorId: 'reviewer:gm',
    decidedAt: '2026-08-11T00:05:00.000Z',
  };
  recordClarificationResolution(state, resolution, '2026-08-11T00:05:01.000Z');

  assert.equal(state.stages.question.status, 'pending');
  const ledger = state.artifacts.clarificationResolutionLedger as { resolutions: ClarificationResolution[] };
  assert.equal(ledger.resolutions.length, 1);
  assert.equal(ledger.resolutions[0]?.actorId, 'reviewer:gm');
  assert.equal(state.artifacts.clarificationRequest, undefined);
  const audit = state.audit.at(-1);
  assert.equal(audit?.event, 'clarification-resolved');
  assert.equal(audit?.details.field, 'eligibleDesigns');
  assert.equal(audit?.details.actorId, 'reviewer:gm');
  assert.equal(typeof audit?.details.answerHash, 'string');
  assert.equal((audit?.details.answerHash as string).length, 64);
});

test('identical clarification submission is idempotent but conflicting duplicate is rejected', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages.question.status = 'awaiting-human';
  const issue = (state.artifacts.clarificationIssues as Array<{ id: string; field: 'eligibleDesigns' }>)[0];
  assert.ok(issue);
  const resolution: ClarificationResolution = {
    issueId: issue.id,
    field: 'eligibleDesigns',
    value: ['randomised controlled trial'],
    rationale: 'RCT-only protocol.',
    actorId: 'reviewer:gm',
    decidedAt: '2026-08-11T00:05:00.000Z',
  };
  recordClarificationResolution(state, resolution, '2026-08-11T00:05:01.000Z');
  const auditCount = state.audit.length;
  recordClarificationResolution(state, resolution, '2026-08-11T00:05:02.000Z');
  assert.equal(state.audit.length, auditCount);

  assert.throws(() => recordClarificationResolution(state, {
    ...resolution,
    value: ['randomised controlled trial', 'non-randomised intervention study'],
  }), /different recorded resolution/);
});

test('rejects answers to issues that are not active on the run', () => {
  const state = createPipelineState(fixtureRequest);
  state.stages.question.status = 'awaiting-human';
  assert.throws(() => recordClarificationResolution(state, {
    issueId: 'clar-does-not-exist',
    field: 'eligibleDesigns',
    value: ['randomised controlled trial'],
    rationale: 'No active issue exists.',
    actorId: 'reviewer:gm',
    decidedAt: '2026-08-11T00:05:00.000Z',
  }), /not active/);
});
