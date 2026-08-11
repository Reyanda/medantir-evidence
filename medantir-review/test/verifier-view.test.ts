import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { refreshScientificRunArtifacts } from '../src/core/scientific-run-manifest.js';
import {
  VERIFIER_READABLE_ARTIFACTS,
  buildVerifierRunView,
  verifierArtifact,
  verifierAttempts,
  verifierLineage,
  verifierManifest,
  verifierSeal,
} from '../src/core/verifier-view.js';

function sealedState() {
  const state = createPipelineState({
    reviewType: 'systematic',
    databases: ['PubMed'],
    question: {
      title: 'Verifier review',
      objective: 'Verify the audit surface.',
      population: 'adults',
      interventionOrExposure: 'treatment',
      outcomes: ['mortality'],
    },
  });
  state.artifacts.quantitativeExtractionLedger = [{
    studyId: 'study-1',
    recordId: 'report-1',
    outcome: 'mortality',
    status: 'extracted',
    effectMeasure: 'RR',
    effect: 0.8,
    page: 7,
    tableId: 'table-1',
    authorization: 'Bearer should-never-leak',
  }];
  state.artifacts.estimandLedger = [{
    studyId: 'study-1', recordId: 'report-1', outcome: 'mortality', status: 'identified',
    estimand: { estimandId: 'estimand-1', source: { recordId: 'report-1', tableId: 'table-1', page: 7 } },
  }];
  state.artifacts.fullTexts = [{ recordId: 'report-1', content: 'licensed full text body' }];
  state.artifacts.parsedDocuments = [{ recordId: 'report-1', text: 'full parsed article body' }];
  refreshScientificRunArtifacts(state, createReviewProtocol('systematic'));
  return state;
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

test('verifier summary exposes seal/module/lineage metadata but only allowlists safe artifacts', () => {
  const state = sealedState();
  const view = buildVerifierRunView(state);
  assert.equal(view.sealValid, true);
  assert.equal(view.sealDigest, (state.artifacts.scientificRunSeal as { digest: string }).digest);
  assert.ok(view.moduleContracts.some((contract) => contract.id === 'quantitative-provenance'));
  assert.equal(view.artifactIndex.find((entry) => entry.key === 'quantitativeExtractionLedger')?.readable, true);
  assert.equal(view.artifactIndex.find((entry) => entry.key === 'fullTexts')?.readable, false);
  assert.equal(VERIFIER_READABLE_ARTIFACTS.has('parsedDocuments'), false);
});

test('allowlisted artifact is hash-reconciled and secret-like fields are redacted', () => {
  const state = sealedState();
  const response = verifierArtifact(state, 'quantitativeExtractionLedger') as {
    key: string;
    receipt: { hash: string };
    value: Array<{ authorization?: string }>;
  };
  assert.equal(response.key, 'quantitativeExtractionLedger');
  assert.ok(response.receipt.hash.length > 40);
  assert.equal(response.value[0]?.authorization, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(response), /should-never-leak/);
});

test('raw full-text and parsed-document artifacts are denied by construction', () => {
  const state = sealedState();
  for (const key of ['fullTexts', 'parsedDocuments']) {
    assert.throws(() => verifierArtifact(state, key), (error) => statusOf(error) === 403);
  }
  assert.throws(() => verifierArtifact(state, 'someNewInternalArtifact'), (error) => statusOf(error) === 403);
});

test('tampered allowlisted artifact fails closed instead of being served', () => {
  const state = sealedState();
  (state.artifacts.quantitativeExtractionLedger as Array<Record<string, unknown>>)[0]!.effect = 1.3;
  assert.throws(
    () => verifierArtifact(state, 'quantitativeExtractionLedger'),
    (error) => statusOf(error) === 409 && /no longer matches/i.test((error as Error).message),
  );
});

test('tampered manifest/seal fails all verifier control reads', () => {
  const state = sealedState();
  (state.artifacts.scientificRunSeal as { digest: string }).digest = 'tampered';
  for (const read of [
    () => buildVerifierRunView(state),
    () => verifierSeal(state),
    () => verifierLineage(state),
    () => verifierAttempts(state),
  ]) {
    assert.throws(read, (error) => statusOf(error) === 409);
  }
});

test('manifest and seal reads expose receipts, never artifact bodies or secret values', () => {
  const state = sealedState();
  const manifest = verifierManifest(state) as {
    sealedContent?: { scientificArtifacts?: Array<Record<string, unknown>> };
    operationalArtifacts?: Array<Record<string, unknown>>;
    experimentalArtifacts?: Array<Record<string, unknown>>;
  };
  const seal = verifierSeal(state);
  assert.ok(manifest);
  assert.ok(seal);
  assert.doesNotMatch(JSON.stringify({ manifest, seal }), /should-never-leak/);

  const receipts = [
    ...(manifest.sealedContent?.scientificArtifacts ?? []),
    ...(manifest.operationalArtifacts ?? []),
    ...(manifest.experimentalArtifacts ?? []),
  ];
  const fullTextReceipt = receipts.find((entry) => entry.key === 'fullTexts');
  assert.ok(fullTextReceipt, 'manifest should reveal that a full-text artifact existed');
  assert.equal('value' in fullTextReceipt, false);
  assert.equal('content' in fullTextReceipt, false);
  assert.equal('text' in fullTextReceipt, false);
  assert.deepEqual(
    Object.keys(fullTextReceipt).filter((key) => !['producerStage'].includes(key)).sort(),
    ['hash', 'key', 'moduleIds', 'plane'],
  );
});
