import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRequest } from '../src/fixtures.js';

const testRunsFile = () => `/tmp/actiora-review-clarification-${process.pid}-${Math.random().toString(36).slice(2)}.json`;

async function pollForQuestionGate(base: string, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${base}/runs/${runId}`);
    assert.equal(response.status, 200);
    const state = await response.json() as {
      stages: { question: { status: string }; 'search-execute': { status: string } };
      artifacts: Record<string, unknown>;
    };
    if (state.stages.question.status === 'awaiting-human') return state;
    if (state.stages.question.status === 'failed') throw new Error('question stage failed before clarification gate');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('question stage did not reach clarification gate');
}

test('live API exposes one material clarification at a time and derives actor from authenticated identity', async (t) => {
  process.env.REVIEW_LIVE = '1';
  const { startServer } = await import('../src/server.js');
  const identityProvider = { authenticate: async () => ({ sub: 'clarification-user', projectId: 'clarification-project' }) };
  const server = await startServer(0, { identityProvider, runsFile: testRunsFile() });
  t.after(async () => {
    await server.close();
    delete process.env.REVIEW_LIVE;
  });
  const base = `http://127.0.0.1:${server.port}`;

  const request = {
    ...fixtureRequest,
    question: {
      ...fixtureRequest.question,
      comparator: undefined,
      studyDesigns: undefined,
    },
  };
  const created = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  assert.equal(created.status, 202);
  const accepted = await created.json() as { runId: string };
  const firstState = await pollForQuestionGate(base, accepted.runId);
  assert.equal(firstState.stages['search-execute'].status, 'pending');
  assert.equal(firstState.artifacts.searchProvenance, undefined);

  const current = await fetch(`${base}/runs/${accepted.runId}/clarification`);
  assert.equal(current.status, 200);
  const currentPayload = await current.json() as {
    request: { issue: { id: string; field: string; question: string } };
    issues: Array<{ field: string }>;
  };
  assert.equal(currentPayload.request.issue.field, 'comparator');
  assert.match(currentPayload.request.issue.question, /comparator/i);
  assert.ok(currentPayload.issues.some((issue) => issue.field === 'eligibleDesigns'));

  const resolvedFirst = await fetch(`${base}/runs/${accepted.runId}/clarification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      issueId: currentPayload.request.issue.id,
      field: 'comparator',
      value: 'standard nutritional treatment',
      rationale: 'The protocol comparison is standard nutritional treatment.',
      actorId: 'spoofed-client-identity',
      decidedAt: '1900-01-01T00:00:00.000Z',
    }),
  });
  const secondState = await resolvedFirst.json() as {
    stages: Record<string, { status: string; errors?: string[] }> & {
      question: { status: string; errors?: string[] };
      'search-execute': { status: string; errors?: string[] };
    };
    artifacts: {
      clarificationRequest: { issue: { field: string } };
      clarificationResolutionLedger: { resolutions: Array<{ actorId: string; decidedAt: string }> };
      searchProvenance?: unknown;
    };
    audit: Array<{ event: string; details: Record<string, unknown> }>;
  };
  const failedStages = Object.entries(secondState.stages)
    .filter(([, stage]) => stage.status === 'failed')
    .map(([name, stage]) => ({ name, errors: stage.errors ?? [] }));
  assert.equal(resolvedFirst.status, 202, `Clarification replay failed: ${JSON.stringify(failedStages)}`);
  assert.equal(secondState.stages.question.status, 'awaiting-human');
  assert.equal(secondState.stages['search-execute'].status, 'pending');
  assert.equal(secondState.artifacts.searchProvenance, undefined);
  assert.equal(secondState.artifacts.clarificationRequest.issue.field, 'eligibleDesigns');
  assert.equal(secondState.artifacts.clarificationResolutionLedger.resolutions[0]?.actorId, 'user:clarification-user');
  assert.notEqual(secondState.artifacts.clarificationResolutionLedger.resolutions[0]?.decidedAt, '1900-01-01T00:00:00.000Z');
  assert.ok(secondState.audit.some((event) => event.event === 'clarification-resolved'));

  const next = await fetch(`${base}/runs/${accepted.runId}/clarification`);
  assert.equal(next.status, 200);
  const nextPayload = await next.json() as { request: { issue: { field: string } } };
  assert.equal(nextPayload.request.issue.field, 'eligibleDesigns');
});

test('clarification API rejects malformed submissions before state mutation', async (t) => {
  process.env.REVIEW_LIVE = '1';
  const { startServer } = await import('../src/server.js');
  const identityProvider = { authenticate: async () => ({ sub: 'clarification-user-2', projectId: 'clarification-project-2' }) };
  const server = await startServer(0, { identityProvider, runsFile: testRunsFile() });
  t.after(async () => {
    await server.close();
    delete process.env.REVIEW_LIVE;
  });
  const base = `http://127.0.0.1:${server.port}`;
  const request = {
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: undefined },
  };
  const created = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const accepted = await created.json() as { runId: string };
  await pollForQuestionGate(base, accepted.runId);

  const invalid = await fetch(`${base}/runs/${accepted.runId}/clarification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issueId: 'x', field: 'eligibleDesigns', value: ['randomised controlled trial'], rationale: '' }),
  });
  assert.equal(invalid.status, 400);
  const body = await invalid.json() as { error: string };
  assert.match(body.error, /rationale/i);
});
