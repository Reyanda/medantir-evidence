import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AutonomousQuestionAgent } from '../src/question/autonomous-question-agent.js';
import {
  parseClarificationSubmission,
  submitClarificationAndResume,
} from '../src/question/clarification-controller.js';

test('clarification controller derives actor identity from authenticated session', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages.question.status = 'awaiting-human';
  const issue = (state.artifacts.clarificationIssues as Array<{ id: string; field: 'eligibleDesigns' }>)[0];
  assert.ok(issue);

  let resumed = false;
  const final = await submitClarificationAndResume({
    state,
    submission: parseClarificationSubmission({
      issueId: issue.id,
      field: issue.field,
      value: ['randomised controlled trial'],
      rationale: 'Use randomized trials only.',
      actorId: 'spoofed-client-actor',
    }),
    actor: { sub: 'real-user-sub' },
    now: '2026-08-11T00:05:00.000Z',
    resume: async (pending) => {
      resumed = true;
      const result = await agent.execute({ state: pending, now: () => '2026-08-11T00:05:01.000Z' });
      Object.assign(pending.artifacts, result.artifacts);
      return pending;
    },
  });

  assert.equal(resumed, true);
  const ledger = final.artifacts.clarificationResolutionLedger as { resolutions: Array<{ actorId: string }> };
  assert.equal(ledger.resolutions[0]?.actorId, 'user:real-user-sub');
  assert.equal((final.artifacts.reviewSpecCompilation as { status: string }).status, 'complete');
});

test('lost-response retry is idempotent even when server decision time changes', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages.question.status = 'awaiting-human';
  const issue = (state.artifacts.clarificationIssues as Array<{ id: string; field: 'eligibleDesigns' }>)[0];
  assert.ok(issue);
  const submission = {
    issueId: issue.id,
    field: issue.field,
    value: ['randomised controlled trial'],
    rationale: 'Use randomized trials only.',
  };
  let resumeCalls = 0;
  const resume = async (pending: typeof state) => {
    resumeCalls += 1;
    const result = await agent.execute({ state: pending, now: () => '2026-08-11T00:05:01.000Z' });
    Object.assign(pending.artifacts, result.artifacts);
    return pending;
  };
  await submitClarificationAndResume({
    state,
    submission,
    actor: { sub: 'retry-user' },
    now: '2026-08-11T00:05:00.000Z',
    resume,
  });
  const auditCount = state.audit.filter((entry) => entry.event === 'clarification-resolved').length;
  await submitClarificationAndResume({
    state,
    submission,
    actor: { sub: 'retry-user' },
    now: '2026-08-11T00:09:00.000Z',
    resume,
  });
  assert.equal(resumeCalls, 1);
  assert.equal(state.audit.filter((entry) => entry.event === 'clarification-resolved').length, auditCount);
  const ledger = state.artifacts.clarificationResolutionLedger as { resolutions: Array<{ decidedAt: string }> };
  assert.equal(ledger.resolutions.length, 1);
  assert.equal(ledger.resolutions[0]?.decidedAt, '2026-08-11T00:05:00.000Z');
});

test('clarification parser rejects missing rationale, missing value, and unknown fields', () => {
  assert.throws(() => parseClarificationSubmission({
    issueId: 'x', field: 'eligibleDesigns', value: ['randomised controlled trial'], rationale: '',
  }), /rationale/);
  assert.throws(() => parseClarificationSubmission({
    issueId: 'x', field: 'eligibleDesigns', rationale: 'reason',
  }), /value/);
  assert.throws(() => parseClarificationSubmission({
    issueId: 'x', field: 'madeUpField', value: 'x', rationale: 'reason',
  }), /field/);
});

test('clarification controller refuses unauthenticated actors', async () => {
  const state = createPipelineState(fixtureRequest);
  await assert.rejects(() => submitClarificationAndResume({
    state,
    submission: {
      issueId: 'x',
      field: 'eligibleDesigns',
      value: ['randomised controlled trial'],
      rationale: 'reason',
    },
    actor: { sub: '   ' },
    resume: async (pending) => pending,
    now: '2026-08-11T00:05:00.000Z',
  }), /Authenticated clarification actor/);
});
