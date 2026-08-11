import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AutonomousQuestionAgent } from '../src/question/autonomous-question-agent.js';

test('rejects forged clarification entry for an already-specified field', async () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.clarificationResolutionLedger = {
    version: 1,
    resolutions: [{
      issueId: 'clar-forged-population',
      field: 'population',
      value: 'a different population',
      rationale: 'Attempt to bypass the protocol amendment path.',
      actorId: 'attacker',
      decidedAt: '2026-08-11T00:00:00.000Z',
    }],
  };
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  await assert.rejects(
    () => agent.execute({ state, now: () => '2026-08-11T00:00:01.000Z' }),
    /does not correspond to a baseline material ambiguity/,
  );
});

test('rejects duplicate issue identities inside a clarification ledger', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  const issue = (first.artifacts.clarificationIssues as Array<{ id: string; field: string }>)[0];
  assert.ok(issue);
  const resolution = {
    issueId: issue.id,
    field: issue.field,
    value: ['randomised controlled trial'],
    rationale: 'RCT only.',
    actorId: 'reviewer:gm',
    decidedAt: '2026-08-11T00:00:02.000Z',
  };
  state.artifacts.clarificationResolutionLedger = {
    version: 1,
    resolutions: [resolution, { ...resolution }],
  };
  await assert.rejects(
    () => agent.execute({ state, now: () => '2026-08-11T00:00:03.000Z' }),
    /duplicate issueId/,
  );
});
