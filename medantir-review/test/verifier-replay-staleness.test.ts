import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { refreshScientificRunArtifacts } from '../src/core/scientific-run-manifest.js';
import { buildVerifierRunView, verifierManifest } from '../src/core/verifier-view.js';

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

test('old scientific seal becomes unavailable immediately when a replay resets stage status', () => {
  const state = createPipelineState({
    reviewType: 'systematic',
    databases: ['PubMed'],
    question: {
      title: 'Replay verifier test',
      objective: 'Ensure stale scientific seals are not served during replay.',
      population: 'adults',
      interventionOrExposure: 'treatment',
      comparator: 'control',
      outcomes: ['mortality'],
    },
  });
  state.artifacts.synthesis = { mode: 'meta-analysis', status: 'computed', includedStudies: 2, narrative: 'test' };
  for (const stage of Object.values(state.stages)) stage.status = 'passed';
  refreshScientificRunArtifacts(state, createReviewProtocol('systematic'));
  assert.equal(buildVerifierRunView(state).sealValid, true);

  // A protocol/certainty amendment reopens downstream science while the old
  // manifest/seal still exists in storage. The verifier must reject it as stale.
  state.stages.grade.status = 'pending';
  state.stages.report.status = 'pending';
  state.stages['human-verify'].status = 'pending';

  for (const read of [() => buildVerifierRunView(state), () => verifierManifest(state)]) {
    assert.throws(
      read,
      (error) => statusOf(error) === 409 && /stale|replay|changed state/i.test((error as Error).message),
    );
  }
});
