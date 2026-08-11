import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';

function runsFile() {
  return `/tmp/medantir-pb-api-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
}

async function seed(file: string) {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  });
  state.runId = 'pb-server-run';
  state.artifacts.publicationBiasUniversePolicy = { id: 'pb-policy', protocolHash: 'protocol-1' };
  state.artifacts.publicationBiasUniversePolicyAmendments = [{ amendmentId: 'a1', actorId: 'user:owner' }];
  state.artifacts.publicationBiasUniversePolicyRequirement = {
    version: 1,
    status: 'search-plan-incompatible',
    protocolHash: 'protocol-1',
    endpoint: '/runs/:runId/grade/publication-bias-policy',
    searchAmendmentEndpoint: '/runs/:runId/grade/publication-bias-search',
    requiredParameters: [],
    reason: 'registry required',
    searchPlanCompatible: false,
    plannedRegistrySources: [],
    supportedAutomaticRegistrySources: ['clinicaltrials.gov'],
  };
  state.artifacts.registryUniverseReviewPackage = { version: 1, items: [], createdAt: '2026-08-11T09:00:00.000Z' };
  state.artifacts.registeredStudyResultUniverse = [{ studyId: 's1', outcome: 'mortality' }];
  await writeFile(file, JSON.stringify([[state.runId, { ownerSub: 'owner', projectId: 'project', state }]]), 'utf8');
}

function auth(sub: string) {
  return { authenticate: async () => ({ sub, projectId: 'project' }) };
}

test('publication-bias HTTP routes are ownership-scoped and expose audit state', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seed(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, { runsFile: file, identityProvider: auth('owner') });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const base = `http://127.0.0.1:${server.port}`;

  const policy = await fetch(`${base}/runs/pb-server-run/grade/publication-bias-policy`);
  assert.equal(policy.status, 200);
  const policyBody = await policy.json() as { policy: { id: string }; amendments: unknown[]; requirement: { status: string } };
  assert.equal(policyBody.policy.id, 'pb-policy');
  assert.equal(policyBody.amendments.length, 1);
  assert.equal(policyBody.requirement.status, 'search-plan-incompatible');

  const search = await fetch(`${base}/runs/pb-server-run/grade/publication-bias-search`);
  assert.equal(search.status, 200);
  const searchBody = await search.json() as { requirement: { searchPlanCompatible: boolean } };
  assert.equal(searchBody.requirement.searchPlanCompatible, false);

  const universe = await fetch(`${base}/runs/pb-server-run/grade/registry-universe`);
  assert.equal(universe.status, 200);
  const universeBody = await universe.json() as { universe: unknown[]; reviewPackage: unknown };
  assert.equal(universeBody.universe.length, 1);
  assert.ok(universeBody.reviewPackage);
});

test('publication-bias policy parser rejects malformed POST through actual server without mutating run', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seed(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, { runsFile: file, identityProvider: auth('owner') });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const base = `http://127.0.0.1:${server.port}`;

  const invalid = await fetch(`${base}/runs/pb-server-run/grade/publication-bias-policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '1', rationale: 'incomplete' }),
  });
  assert.equal(invalid.status, 400);
  const body = await invalid.json() as { error: string };
  assert.match(body.error, /minimumEligibleUniverseRegistryCoverage/);

  const current = await fetch(`${base}/runs/pb-server-run/grade/publication-bias-policy`);
  const currentBody = await current.json() as { policy: { id: string } };
  assert.equal(currentBody.policy.id, 'pb-policy');
});

test('publication-bias routes do not reveal another owner project run', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seed(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, { runsFile: file, identityProvider: auth('different-user') });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.port}/runs/pb-server-run/grade/registry-universe`);
  assert.equal(response.status, 404);
});
