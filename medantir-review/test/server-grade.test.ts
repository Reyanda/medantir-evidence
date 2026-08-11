import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';

function runsFile() {
  return `/tmp/medantir-grade-api-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
}

async function seedRun(file: string) {
  const state = createPipelineState({
    ...fixtureRequest,
    question: {
      ...fixtureRequest.question,
      population: 'children',
      interventionOrExposure: 'treatment',
      comparator: 'control',
      outcomes: ['mortality'],
    },
  });
  state.runId = 'grade-api-run';
  state.stages.grade.status = 'awaiting-human';
  state.stages.grade.attempts = 1;
  state.artifacts.protocolPackage = { checksum: 'grade-api-protocol' };
  state.artifacts.gradeEvidenceReviewPackage = {
    version: 1,
    framework: 'GRADE',
    reviewType: 'intervention-rct',
    createdAt: '2026-08-11T06:00:00.000Z',
    items: [{
      outcome: 'mortality',
      unresolvedDomains: ['indirectness', 'publication-bias'],
      proposedDecisions: [],
      reason: 'Source-bound evidence review required.',
    }],
  };
  state.artifacts.gradeOutcomeAssessments = [{ outcome: 'mortality', status: 'incomplete', unresolvedDomains: ['indirectness', 'publication-bias'] }];
  await writeFile(file, JSON.stringify([[state.runId, { ownerSub: 'grade-user', projectId: 'grade-project', state }]]), 'utf8');
  return state;
}

test('GRADE API exposes evidence package/catalog and records source evidence with server identity', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seedRun(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, {
    runsFile: file,
    identityProvider: { authenticate: async () => ({ sub: 'grade-user', projectId: 'grade-project' }) },
  });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const base = `http://127.0.0.1:${server.port}`;

  const get = await fetch(`${base}/runs/grade-api-run/grade`);
  assert.equal(get.status, 200);
  const payload = await get.json() as {
    reviewPackage: { items: Array<{ outcome: string; unresolvedDomains: string[] }> };
    evidenceCatalog: Array<{ id: string; kind: string; allowedUses: string[] }>;
  };
  assert.equal(payload.reviewPackage.items[0]?.outcome, 'mortality');
  assert.ok(payload.evidenceCatalog.some((item) =>
    item.id === 'protocol:grade-api-protocol:review-question'
    && item.kind === 'protocol'
    && item.allowedUses.includes('directness')));

  const post = await fetch(`${base}/runs/grade-api-run/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      outcome: 'mortality',
      directness: {
        population: 'direct',
        interventionOrExposure: 'direct',
        comparator: 'direct',
        outcome: 'direct',
        evidenceIds: ['protocol:grade-api-protocol:review-question'],
      },
      actorId: 'spoofed-client',
      decidedAt: '1900-01-01T00:00:00.000Z',
    }),
  });
  assert.ok([200, 202, 422].includes(post.status));
  const after = await post.json() as {
    artifacts: {
      gradeOutcomeEvidenceLedger?: Array<{ actorId: string; decidedAt: string; addedFields: string[] }>;
      gradeOutcomeEvidence?: Array<{ directness?: { population: string } }>;
    };
    audit: Array<{ event: string; details: Record<string, unknown> }>;
  };
  const receipt = after.artifacts.gradeOutcomeEvidenceLedger?.[0];
  assert.equal(receipt?.actorId, 'user:grade-user');
  assert.notEqual(receipt?.decidedAt, '1900-01-01T00:00:00.000Z');
  assert.ok(receipt?.addedFields.includes('directness'));
  assert.equal(after.artifacts.gradeOutcomeEvidence?.[0]?.directness?.population, 'direct');
  assert.ok(after.audit.some((entry) => entry.event === 'grade-outcome-evidence-submitted'));
});

test('GRADE policy API validates payload before mutating state', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seedRun(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, {
    runsFile: file,
    identityProvider: { authenticate: async () => ({ sub: 'grade-user', projectId: 'grade-project' }) },
  });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const base = `http://127.0.0.1:${server.port}`;

  const invalid = await fetch(`${base}/runs/grade-api-run/grade/policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '1', rationale: 'Incomplete policy' }),
  });
  assert.equal(invalid.status, 400);
  const body = await invalid.json() as { error: string };
  assert.match(body.error, /riskOfBias/i);

  const current = await fetch(`${base}/runs/grade-api-run/grade/policy`);
  assert.equal(current.status, 200);
  const policy = await current.json() as { policy: unknown; amendments: unknown[] };
  assert.equal(policy.policy, null);
  assert.deepEqual(policy.amendments, []);
});
