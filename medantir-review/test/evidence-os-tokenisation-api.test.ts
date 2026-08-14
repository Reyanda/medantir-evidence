import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { handleEvidenceOsApi } from '../src/evidence-os/api.js';

const fixedNow = '2026-08-14T00:00:00.000Z';

test('public extraction contract registry exposes versioned IMRAD contracts', async () => {
  const response = await handleEvidenceOsApi({
    method: 'GET',
    pathname: '/evidence-os/extraction-field-contracts',
    stateFor: async () => undefined,
    now: () => fixedNow,
  });
  assert.equal(response?.status, 200);
  const payload = response?.payload as { registryHash: string; contracts: Array<{ field: string; allowedImradRoles: string[] }> };
  assert.match(payload.registryHash, /^[a-f0-9]{64}$/);
  assert.ok(payload.contracts.some((entry) => entry.field === 'outcomes.effect' && entry.allowedImradRoles.includes('results')));
});

test('run tokenisation API exposes manifest and per-artifact token documents', async () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.finalReport = { title: 'Review', sections: { methods: 'Methods text', results: 'Results text' } };
  const stateFor = async (runId: string) => runId === state.runId ? state : undefined;

  const manifest = await handleEvidenceOsApi({
    method: 'GET',
    pathname: `/runs/${state.runId}/tokenisation-manifest`,
    stateFor,
    now: () => fixedNow,
  });
  assert.equal(manifest?.status, 200);
  const manifestPayload = manifest?.payload as { entries: Array<{ artifactKey: string }>; totals: { artifacts: number } };
  assert.ok(manifestPayload.entries.some((entry) => entry.artifactKey === '@request'));
  assert.ok(manifestPayload.entries.some((entry) => entry.artifactKey === 'finalReport'));
  assert.equal(manifestPayload.totals.artifacts, Object.keys(state.artifacts).length + 3);

  const encodedKey = encodeURIComponent('@request');
  const document = await handleEvidenceOsApi({
    method: 'GET',
    pathname: `/runs/${state.runId}/artifact-tokens/${encodedKey}`,
    stateFor,
    now: () => fixedNow,
  });
  assert.equal(document?.status, 200);
  const documentPayload = document?.payload as { artifactKey: string; documentHash: string; tokens: unknown[] };
  assert.equal(documentPayload.artifactKey, '@request');
  assert.match(documentPayload.documentHash, /^[a-f0-9]{64}$/);
  assert.ok(documentPayload.tokens.length > 0);
});

test('tokenisation routes fail closed for unknown runs and artifacts', async () => {
  const state = createPipelineState(fixtureRequest);
  const stateFor = async (runId: string) => runId === state.runId ? state : undefined;

  const unknownRun = await handleEvidenceOsApi({
    method: 'GET',
    pathname: '/runs/unknown/tokenisation-manifest',
    stateFor,
    now: () => fixedNow,
  });
  assert.equal(unknownRun?.status, 404);

  const unknownArtifact = await handleEvidenceOsApi({
    method: 'GET',
    pathname: `/runs/${state.runId}/artifact-tokens/not-present`,
    stateFor,
    now: () => fixedNow,
  });
  assert.equal(unknownArtifact?.status, 404);
});

test('run extraction validation is a stable read-only projection', async () => {
  const state = createPipelineState(fixtureRequest);
  const response = await handleEvidenceOsApi({
    method: 'GET',
    pathname: `/runs/${state.runId}/extraction-validation`,
    stateFor: async () => state,
    now: () => fixedNow,
  });
  assert.equal(response?.status, 200);
  const payload = response?.payload as { runId: string; validationHash: string; reports: unknown[] };
  assert.equal(payload.runId, state.runId);
  assert.match(payload.validationHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.reports, []);
});
