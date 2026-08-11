import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { recordGradePolicyConfiguration, type GradePolicyConfiguration } from '../src/certainty/grade-policy.js';

const configuration: GradePolicyConfiguration = {
  version: '2.0.0',
  rationale: 'Updated protocol-bound decision thresholds.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1200, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

test('post-results GRADE policy change invalidates certainty, report and verification outputs', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.protocolPackage = { checksum: 'protocol-grade-replay' };
  state.stages.synthesise.status = 'passed';
  state.stages.grade = { name: 'grade', status: 'passed', attempts: 1, errors: [], completedAt: '2026-08-11T06:00:00.000Z' };
  state.stages.report = { name: 'report', status: 'passed', attempts: 1, errors: [], completedAt: '2026-08-11T06:01:00.000Z' };
  state.stages['human-verify'] = { name: 'human-verify', status: 'passed', attempts: 1, errors: [], completedAt: '2026-08-11T06:02:00.000Z' };
  Object.assign(state.artifacts, {
    grade: [{ outcome: 'mortality', certainty: 'high' }],
    gradeOutcomeAssessments: [{ outcome: 'mortality', finalCertainty: 'high' }],
    gradeEvidenceReviewPackage: { items: [] },
    gradeQuality: { complete: true },
    draftReport: { title: 'stale draft' },
    verificationPackage: { packageId: 'stale' },
    verificationOutcome: { status: 'approved' },
    finalReport: { title: 'stale final' },
  });

  const result = recordGradePolicyConfiguration({
    state,
    configuration,
    actorId: 'user:methodologist',
    decidedAt: '2026-08-11T06:10:00.000Z',
  });

  assert.equal(result.receipt.timing, 'post-results-amendment');
  for (const stage of ['grade', 'report', 'human-verify'] as const) {
    assert.equal(state.stages[stage].status, 'pending');
    assert.equal(state.stages[stage].attempts, 0);
  }
  for (const artifact of [
    'grade', 'gradeOutcomeAssessments', 'gradeEvidenceReviewPackage', 'gradeQuality',
    'draftReport', 'verificationPackage', 'verificationOutcome', 'finalReport',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(state.artifacts, artifact), false, `${artifact} must be invalidated`);
  }
  assert.ok(state.artifacts.gradePolicySet);
  assert.ok(state.artifacts.gradePolicyLateAmendment);
  const audit = state.audit.at(-1);
  assert.equal(audit?.event, 'grade-policy-amended');
  assert.deepEqual(audit?.details.invalidatedStages, ['grade', 'report', 'human-verify']);
});
