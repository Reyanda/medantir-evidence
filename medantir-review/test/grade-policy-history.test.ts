import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { recordGradePolicyConfiguration, type GradePolicyConfiguration } from '../src/certainty/grade-policy.js';

const configuration: GradePolicyConfiguration = {
  version: '1.0.0',
  rationale: 'Prospective certainty policy.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

function baseState() {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.protocolPackage = { checksum: 'protocol-history-test' };
  return state;
}

test('historical scientific result attempt makes later GRADE policy post-results even after stage reset', () => {
  const state = baseState();
  // Current pipeline has been reset, but the append-only run ledger records that
  // synthesis previously executed. History must dominate current pending status.
  state.stages.synthesise.status = 'pending';
  state.artifacts.scientificRunLedger = {
    version: 1,
    attempts: [{ stage: 'synthesise', attempt: 1, status: 'passed' }],
  };
  const result = recordGradePolicyConfiguration({
    state,
    configuration,
    actorId: 'user:methodologist',
    decidedAt: '2026-08-11T07:00:00.000Z',
  });
  assert.equal(result.receipt.timing, 'post-results-amendment');
  assert.match(result.receipt.warning ?? '', /after review results existed/);
});

test('answering prospective policy gate reopens protocol-finalise with fresh operational retry budget', () => {
  const state = baseState();
  state.stages['protocol-finalise'].status = 'awaiting-human';
  state.stages['protocol-finalise'].attempts = 2;
  state.stages['protocol-finalise'].errors = ['old operational warning'];
  state.artifacts.gradePolicyRequirement = {
    version: 1,
    status: 'required',
    protocolHash: 'protocol-history-test',
  };
  const result = recordGradePolicyConfiguration({
    state,
    configuration,
    actorId: 'user:methodologist',
    decidedAt: '2026-08-11T07:00:00.000Z',
  });
  assert.equal(result.receipt.timing, 'prospective');
  assert.equal(state.stages['protocol-finalise'].status, 'pending');
  assert.equal(state.stages['protocol-finalise'].attempts, 0);
  assert.deepEqual(state.stages['protocol-finalise'].errors, []);
  const audit = state.audit.at(-1);
  assert.equal(audit?.event, 'grade-policy-amended');
  assert.equal(audit?.details.prospectiveGateReopened, true);
});
