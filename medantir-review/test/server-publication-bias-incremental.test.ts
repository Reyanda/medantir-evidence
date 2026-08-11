import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';

function runsFile() {
  return `/tmp/medantir-pb-incremental-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
}

function identity() {
  return { authenticate: async () => ({ sub: 'owner', projectId: 'project' }) };
}

async function seed(file: string) {
  const state = createPipelineState(fixtureRequest);
  state.runId = 'pb-incremental-run';
  state.stages.grade.status = 'awaiting-human';
  state.artifacts.registryUniverseReviewPackage = {
    version: 1,
    createdAt: '2026-08-11T11:00:00.000Z',
    items: [{
      registryId: 'NCT01234567', outcome: 'mortality', reason: 'publication linkage unresolved',
      requiredFields: ['publicationStatus'],
      evidenceIds: ['publication-source'],
      sourceDerived: {
        eligibilityStatus: 'eligible', eligibilityExactMatches: 5,
        eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
        registryResultsPosted: true, resultsAvailable: true, prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: true, publicationStatus: 'unknown',
        exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: ['mortality'],
      },
    }],
  };
  await writeFile(file, JSON.stringify([[state.runId, { ownerSub: 'owner', projectId: 'project', state }]]), 'utf8');
}

test('authenticated HTTP route accepts one currently-required registry field and records actor-bound receipt', async (t) => {
  delete process.env.REVIEW_LIVE;
  const file = runsFile();
  await seed(file);
  const { startServer } = await import('../src/server.js');
  const server = await startServer(0, { runsFile: file, identityProvider: identity() });
  t.after(async () => { await server.close(); await rm(file, { force: true }); });
  const base = `http://127.0.0.1:${server.port}`;

  const response = await fetch(`${base}/runs/pb-incremental-run/grade/registry-universe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'published',
      evidenceIds: ['publication-source'], rationale: 'Exact NCT-linked peer-reviewed publication located.',
    }),
  });
  assert.notEqual(response.status, 400, 'one-field payload must not be rejected as missing redundant fields');
  assert.notEqual(response.status, 409, 'currently required publicationStatus must be mutable');

  const current = await fetch(`${base}/runs/pb-incremental-run/grade/registry-universe`);
  assert.equal(current.status, 200);
  const body = await current.json() as {
    resolutionHistory: Array<{ actorId: string; resolvedFields: string[] }>;
    adjudications: Array<{ publicationStatus: string }>;
  };
  assert.equal(body.resolutionHistory[0]?.actorId, 'user:owner');
  assert.deepEqual(body.resolutionHistory[0]?.resolvedFields, ['publicationStatus']);
  assert.equal(body.adjudications[0]?.publicationStatus, 'published');
});
