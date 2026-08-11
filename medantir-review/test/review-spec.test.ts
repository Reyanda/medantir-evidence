import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AutonomousQuestionAgent } from '../src/question/autonomous-question-agent.js';
import {
  compileReviewSpec,
  createProtocolAmendments,
  earliestReplayStage,
  validateClarificationResolution,
  type ClarificationResolution,
} from '../src/question/review-spec.js';

test('intervention-family intake refuses to invent eligible study designs', () => {
  const result = compileReviewSpec(fixtureRequest, { now: '2026-08-11T00:00:00.000Z' });
  assert.equal(result.status, 'needs-clarification');
  assert.deepEqual(result.unresolvedMaterialFields, ['eligibleDesigns']);
  assert.equal(result.spec.fields.eligibleDesigns.source, 'unresolved');
  assert.equal(result.spec.fields.eligibleDesigns.value, undefined);
  assert.match(result.issues[0]?.question ?? '', /study designs/i);
});

test('complete intervention ReviewSpec is deterministic apart from compiledAt', () => {
  const request = {
    ...fixtureRequest,
    question: {
      ...fixtureRequest.question,
      studyDesigns: ['randomised controlled trial'],
    },
  };
  const first = compileReviewSpec(request, { now: '2026-08-11T00:00:00.000Z' });
  const second = compileReviewSpec(request, { now: '2026-08-12T00:00:00.000Z' });
  assert.equal(first.status, 'complete');
  assert.equal(second.status, 'complete');
  assert.equal(first.spec.hash, second.spec.hash);
  assert.notEqual(first.spec.compiledAt, second.spec.compiledAt);
  assert.deepEqual(first.spec.fields.languages.value, ['all languages']);
  assert.equal(first.spec.fields.languages.source, 'reversible-default');
  assert.deepEqual(first.spec.fields.dateLimits.value, {});
  assert.equal(first.spec.fields.dateLimits.source, 'reversible-default');
  assert.ok(first.safeDefaults.includes('languages'));
  assert.ok(first.safeDefaults.includes('dateLimits'));
});

test('missing core intervention dimensions create material issues instead of fabricated values', () => {
  const request = {
    ...fixtureRequest,
    databases: [],
    question: {
      title: 'Incomplete intervention question',
      objective: 'Assess an intervention effect without enough specification',
    },
  };
  const result = compileReviewSpec(request, { now: '2026-08-11T00:00:00.000Z' });
  assert.equal(result.status, 'needs-clarification');
  assert.deepEqual(
    new Set(result.unresolvedMaterialFields),
    new Set(['population', 'interventionOrExposure', 'comparator', 'outcomes', 'eligibleDesigns', 'databases']),
  );
  for (const fieldName of result.unresolvedMaterialFields) {
    assert.equal(result.spec.fields[fieldName].source, 'unresolved');
  }
  assert.ok(result.issues.every((issue) => issue.material));
  assert.ok(result.issues.every((issue) => issue.impacts.length > 0));
});

test('human clarification is attributable, hash-changing, and replay-scoped', () => {
  const before = compileReviewSpec(fixtureRequest, { now: '2026-08-11T00:00:00.000Z' });
  const designIssue = before.issues.find((issue) => issue.field === 'eligibleDesigns');
  assert.ok(designIssue);
  const resolution: ClarificationResolution = {
    issueId: designIssue.id,
    field: 'eligibleDesigns',
    value: ['randomised controlled trial'],
    rationale: 'The protocol is restricted to randomized allocation.',
    actorId: 'reviewer:gm',
    decidedAt: '2026-08-11T00:05:00.000Z',
  };
  validateClarificationResolution(designIssue, resolution);
  const after = compileReviewSpec(fixtureRequest, {
    resolutions: [resolution],
    now: '2026-08-11T00:06:00.000Z',
  });
  assert.equal(after.status, 'complete');
  assert.notEqual(after.spec.hash, before.spec.hash);
  assert.equal(after.spec.fields.eligibleDesigns.source, 'human-amended');
  assert.deepEqual(after.spec.fields.eligibleDesigns.value, ['randomised controlled trial']);
  const amendments = createProtocolAmendments(before.spec, after.spec, [resolution]);
  assert.equal(amendments.length, 1);
  assert.equal(amendments[0]?.field, 'eligibleDesigns');
  assert.equal(amendments[0]?.earliestReplayStage, 'protocol');
  assert.equal(earliestReplayStage(amendments), 'protocol');
  assert.equal(amendments[0]?.actorId, 'reviewer:gm');
});

test('clarification resolution validation rejects mismatched or unattributed answers', () => {
  const result = compileReviewSpec(fixtureRequest, { now: '2026-08-11T00:00:00.000Z' });
  const issue = result.issues[0];
  assert.ok(issue);
  assert.throws(() => validateClarificationResolution(issue, {
    issueId: 'wrong',
    field: issue.field,
    value: ['randomised controlled trial'],
    rationale: 'Explicit protocol decision',
    actorId: 'reviewer',
    decidedAt: '2026-08-11T00:00:00.000Z',
  }), /issueId/);
  assert.throws(() => validateClarificationResolution(issue, {
    issueId: issue.id,
    field: issue.field,
    value: ['randomised controlled trial'],
    rationale: '',
    actorId: '',
    decidedAt: '2026-08-11T00:00:00.000Z',
  }), /actorId|rationale/);
});

test('living review cannot silently invent surveillance policy', () => {
  const request = {
    ...fixtureRequest,
    reviewType: 'living' as const,
    question: {
      ...fixtureRequest.question,
      studyDesigns: ['randomised controlled trial'],
    },
  };
  const result = compileReviewSpec(request, { now: '2026-08-11T00:00:00.000Z' });
  assert.equal(result.status, 'needs-clarification');
  assert.ok(result.unresolvedMaterialFields.includes('livingReviewPolicy'));
  assert.equal(result.spec.fields.livingReviewPolicy.source, 'unresolved');
});

test('autonomous question agent stops before protocol when a material ambiguity remains', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const result = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  assert.match(result.awaitingHuman?.summary ?? '', /study designs/i);
  assert.equal((result.artifacts.reviewSpecCompilation as { status: string }).status, 'needs-clarification');
  assert.equal((result.artifacts.clarificationRequest as { status: string }).status, 'needs-clarification');
});

test('autonomous question agent resumes after an attributable clarification ledger is supplied', async () => {
  const state = createPipelineState(fixtureRequest);
  const agent = new AutonomousQuestionAgent(new QuestionAgent());
  const first = await agent.execute({ state, now: () => '2026-08-11T00:00:00.000Z' });
  const issue = (first.artifacts.clarificationIssues as Array<{ id: string; field: 'eligibleDesigns' }>)[0];
  assert.ok(issue);
  Object.assign(state.artifacts, first.artifacts, {
    clarificationResolutionLedger: {
      version: 1,
      resolutions: [{
        issueId: issue.id,
        field: 'eligibleDesigns',
        value: ['randomised controlled trial'],
        rationale: 'Protocol restricts eligibility to randomized trials.',
        actorId: 'reviewer:gm',
        decidedAt: '2026-08-11T00:05:00.000Z',
      }],
    },
  });
  const resumed = await agent.execute({ state, now: () => '2026-08-11T00:06:00.000Z' });
  assert.equal(resumed.awaitingHuman, undefined);
  assert.equal((resumed.artifacts.reviewSpecCompilation as { status: string }).status, 'complete');
  const amendments = resumed.artifacts.protocolAmendments as Array<{ field: string; actorId: string }>;
  assert.equal(amendments.length, 1);
  assert.equal(amendments[0]?.field, 'eligibleDesigns');
  assert.equal(amendments[0]?.actorId, 'reviewer:gm');
});
