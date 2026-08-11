import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import {
  buildScientificRunManifest,
  refreshScientificRunArtifacts,
  verifyScientificRunSeal,
} from '../src/core/scientific-run-manifest.js';

function stateWith(overrides: Record<string, unknown> = {}) {
  const state = createPipelineState({
    reviewType: 'systematic',
    databases: ['PubMed'],
    registration: { credentialRefs: { orcid: 'vault/orcid/researcher' } },
    question: {
      title: 'Treatment review',
      objective: 'Estimate treatment effect on mortality.',
      population: 'adults',
      interventionOrExposure: 'treatment',
      outcomes: ['mortality'],
    },
  });
  state.artifacts.normalisedQuestion = { outcome: 'mortality' };
  state.artifacts.searchResults = [{ id: 'pmid:1', title: 'Trial', retrievedAt: '2026-08-10T01:00:00Z' }];
  state.artifacts.humanOverrides = {
    version: 1,
    entries: [{
      itemId: 'estimand:1',
      sourceStage: 'extract',
      amendedValue: { timeHorizon: '28-day' },
      rationale: 'Table explicitly reports day 28',
      reviewerId: 'reviewer-a',
      decidedAt: '2026-08-10T02:00:00Z',
    }],
  };
  Object.assign(state.artifacts, overrides);
  return state;
}

test('run/package IDs, timestamps, reviewer identity and secret rotation do not perturb the scientific seal', () => {
  const protocol = createReviewProtocol('systematic');
  const left = stateWith({ connectorConfig: { authorization: 'Bearer one', createdAt: '2026-08-10T01:00:00Z' } });
  const right = stateWith({ connectorConfig: { authorization: 'Bearer two', createdAt: '2026-08-12T01:00:00Z' } });
  right.runId = 'different-run-id';
  right.createdAt = '2030-01-01T00:00:00Z';
  right.updatedAt = '2030-01-02T00:00:00Z';
  (right.artifacts.searchResults as Array<Record<string, unknown>>)[0]!.retrievedAt = '2030-01-02T00:00:00Z';
  const rightOverrides = right.artifacts.humanOverrides as { entries: Array<Record<string, unknown>> };
  rightOverrides.entries[0]!.reviewerId = 'reviewer-b';
  rightOverrides.entries[0]!.decidedAt = '2030-01-03T00:00:00Z';

  const a = buildScientificRunManifest(left, protocol);
  const b = buildScientificRunManifest(right, protocol);
  assert.equal(a.seal.digest, b.seal.digest);
  assert.equal(verifyScientificRunSeal(a.manifest, a.seal), true);
  assert.doesNotMatch(JSON.stringify(a.manifest), /Bearer one/);
});

test('substantive evidence or human amendment changes alter the scientific seal', () => {
  const protocol = createReviewProtocol('systematic');
  const base = buildScientificRunManifest(stateWith(), protocol).seal.digest;
  const evidenceChanged = stateWith({ searchResults: [{ id: 'pmid:2', title: 'Different trial' }] });
  const amendmentChanged = stateWith();
  const ledger = amendmentChanged.artifacts.humanOverrides as { entries: Array<Record<string, unknown>> };
  ledger.entries[0]!.amendedValue = { timeHorizon: '60-day' };
  assert.notEqual(buildScientificRunManifest(evidenceChanged, protocol).seal.digest, base);
  assert.notEqual(buildScientificRunManifest(amendmentChanged, protocol).seal.digest, base);
});

test('non-authoritative model shadow output is receipted outside the scientific seal', () => {
  const protocol = createReviewProtocol('systematic');
  const left = stateWith({ modelScreeningSuggestions: [{ recordId: 'pmid:1', decision: 'include', actualModel: 'free-a' }] });
  const right = stateWith({ modelScreeningSuggestions: [{ recordId: 'pmid:1', decision: 'exclude', actualModel: 'free-b' }] });
  const a = buildScientificRunManifest(left, protocol);
  const b = buildScientificRunManifest(right, protocol);
  assert.equal(a.seal.digest, b.seal.digest);
  assert.equal(a.manifest.experimentalArtifacts.some((entry) => entry.key === 'modelScreeningSuggestions'), true);
  assert.notEqual(
    a.manifest.experimentalArtifacts.find((entry) => entry.key === 'modelScreeningSuggestions')?.hash,
    b.manifest.experimentalArtifacts.find((entry) => entry.key === 'modelScreeningSuggestions')?.hash,
  );
});

test('manifest never hashes itself into the current artifact lineage', () => {
  const state = stateWith();
  state.artifacts.scientificRunManifest = { stale: true };
  state.artifacts.scientificRunSeal = { stale: true };
  state.artifacts.scientificArtifactLineage = [{ stale: true }];
  const built = buildScientificRunManifest(state, createReviewProtocol('systematic'));
  const keys = [
    ...built.manifest.sealedContent.scientificArtifacts,
    ...built.manifest.operationalArtifacts,
    ...built.manifest.experimentalArtifacts,
  ].map((entry) => entry.key);
  assert.equal(keys.some((key) => key.startsWith('scientificRun') || key === 'scientificArtifactLineage'), false);
});

test('reports carry current run controls without recursively changing their scientific hash', () => {
  const protocol = createReviewProtocol('systematic');
  const state = stateWith({
    draftReport: { title: 'Draft', appendices: { estimandLedger: [{ estimandId: 'estimand-1' }] } },
    finalReport: { title: 'Final', appendices: { estimandLedger: [{ estimandId: 'estimand-1' }] } },
  });
  const draftBefore = scientificContentHash(state.artifacts.draftReport);
  const finalBefore = scientificContentHash(state.artifacts.finalReport);

  refreshScientificRunArtifacts(state, protocol);

  assert.equal(scientificContentHash(state.artifacts.draftReport), draftBefore);
  assert.equal(scientificContentHash(state.artifacts.finalReport), finalBefore);
  for (const key of ['draftReport', 'finalReport'] as const) {
    const report = state.artifacts[key] as { appendices?: Record<string, unknown> };
    assert.ok(report.appendices?.scientificRunManifest);
    assert.ok(report.appendices?.scientificRunSeal);
    assert.ok(report.appendices?.scientificArtifactLineage);
    assert.ok(report.appendices?.scientificRunLedger);
  }
  const manifest = state.artifacts.scientificRunManifest as Parameters<typeof verifyScientificRunSeal>[0];
  const seal = state.artifacts.scientificRunSeal as Parameters<typeof verifyScientificRunSeal>[1];
  assert.equal(verifyScientificRunSeal(manifest, seal), true);
});
