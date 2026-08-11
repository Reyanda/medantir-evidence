import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { invalidatePipelineFromStage } from '../src/protocols/replay-invalidation.js';

test('replay invalidation resets declared and lineage-tracked downstream science while preserving history', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.searchStrategies = [{ database: 'PubMed' }];
  state.artifacts.protocolPackage = { checksum: 'old-protocol' };
  state.artifacts.searchResults = [{ id: 'r1' }];
  state.artifacts.customExtendedExtraction = { stale: true };
  state.artifacts.upstreamIdentity = { keep: true };
  state.artifacts.scientificRunLedger = { schemaVersion: 'medantir-scientific-run/1', attempts: [{ stage: 'extract' }] };
  state.artifacts.scientificRunManifest = { stale: true };
  state.artifacts.scientificRunSeal = { stale: true };
  state.artifacts.scientificArtifactLineage = [
    { key: 'customExtendedExtraction', producerStage: 'extract' },
    { key: 'upstreamIdentity', producerStage: 'identity' },
  ];
  for (const name of ['search-build', 'search-test', 'protocol-finalise', 'search-execute', 'extract', 'report'] as const) {
    state.stages[name].status = 'passed';
    state.stages[name].attempts = 1;
  }

  const receipt = invalidatePipelineFromStage(state, 'search-build');
  assert.equal(state.artifacts.searchStrategies, undefined);
  assert.equal(state.artifacts.protocolPackage, undefined);
  assert.equal(state.artifacts.searchResults, undefined);
  assert.equal(state.artifacts.customExtendedExtraction, undefined);
  assert.deepEqual(state.artifacts.upstreamIdentity, { keep: true });
  assert.ok(state.artifacts.scientificRunLedger);
  assert.equal(state.artifacts.scientificRunManifest, undefined);
  assert.equal(state.artifacts.scientificRunSeal, undefined);
  assert.equal(state.stages['search-build'].status, 'pending');
  assert.equal(state.stages.extract.status, 'pending');
  assert.equal(state.stages.identity.status, 'pending');
  assert.ok(receipt.removedArtifacts.includes('customExtendedExtraction'));
  assert.ok(receipt.preservedArtifacts.includes('scientificRunLedger'));
});

test('replay invalidation can preserve a prospectively frozen policy while rebuilding its protocol', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.publicationBiasUniversePolicy = { id: 'policy-1', protocolHash: 'old' };
  state.artifacts.protocolPackage = { checksum: 'old' };
  invalidatePipelineFromStage(state, 'search-build', {
    preserveArtifacts: ['publicationBiasUniversePolicy'],
  });
  assert.deepEqual(state.artifacts.publicationBiasUniversePolicy, { id: 'policy-1', protocolHash: 'old' });
  assert.equal(state.artifacts.protocolPackage, undefined);
});
