import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  freezeGradePolicySet,
  gradePolicyHash,
  recordGradePolicyConfiguration,
  type GradePolicyConfiguration,
} from '../src/certainty/grade-policy.js';

const configuration: GradePolicyConfiguration = {
  version: '1.0.0',
  rationale: 'Prespecified GRADE decision thresholds.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

function state() {
  const value = createPipelineState(fixtureRequest);
  value.artifacts.protocolPackage = { checksum: 'protocol-checksum-001' };
  return value;
}

test('GRADE policy set is deterministically bound to protocol checksum', () => {
  const a = freezeGradePolicySet({ protocolHash: 'protocol-checksum-001', configuration, frozenAt: '2026-08-11T06:00:00.000Z' });
  const b = freezeGradePolicySet({ protocolHash: 'protocol-checksum-001', configuration, frozenAt: '2026-08-11T06:00:00.000Z' });
  const c = freezeGradePolicySet({ protocolHash: 'protocol-checksum-002', configuration, frozenAt: '2026-08-11T06:00:00.000Z' });
  assert.equal(gradePolicyHash(a), gradePolicyHash(b));
  assert.notEqual(gradePolicyHash(a), gradePolicyHash(c));
  assert.equal(a.imprecision?.protocolHash, 'protocol-checksum-001');
});

test('prospective policy freeze records an attributable amendment and resets GRADE only', () => {
  const value = state();
  value.stages.grade.status = 'awaiting-human';
  value.stages.grade.attempts = 2;
  const result = recordGradePolicyConfiguration({
    state: value,
    configuration,
    actorId: 'user:reviewer-1',
    decidedAt: '2026-08-11T06:05:00.000Z',
  });
  assert.equal(result.changed, true);
  assert.equal(result.receipt.timing, 'prospective');
  assert.equal(result.receipt.earliestReplayStage, 'grade');
  assert.equal(value.stages.grade.status, 'pending');
  assert.equal(value.stages.grade.attempts, 0);
  assert.equal(value.artifacts.gradePolicyLateAmendment, undefined);
});

test('policy introduced after synthesis is explicitly labelled post-results', () => {
  const value = state();
  value.stages['search-execute'].status = 'passed';
  value.stages.synthesise.status = 'passed';
  const result = recordGradePolicyConfiguration({
    state: value,
    configuration,
    actorId: 'user:reviewer-1',
    decidedAt: '2026-08-11T06:05:00.000Z',
  });
  assert.equal(result.receipt.timing, 'post-results-amendment');
  assert.match(result.receipt.warning ?? '', /after review results existed/);
  assert.ok(value.artifacts.gradePolicyLateAmendment);
});

test('identical policy retry is idempotent', () => {
  const value = state();
  const first = recordGradePolicyConfiguration({ state: value, configuration, actorId: 'user:r', decidedAt: '2026-08-11T06:00:00.000Z' });
  const second = recordGradePolicyConfiguration({ state: value, configuration, actorId: 'user:r', decidedAt: '2026-08-11T06:00:00.000Z' });
  assert.equal(first.receipt.amendmentId, second.receipt.amendmentId);
  assert.equal(second.changed, false);
  assert.equal((value.artifacts.gradePolicyAmendments as unknown[]).length, 1);
});

test('GRADE policy cannot be frozen without final protocol checksum', () => {
  const value = createPipelineState(fixtureRequest);
  assert.throws(() => recordGradePolicyConfiguration({
    state: value,
    configuration,
    actorId: 'user:r',
    decidedAt: '2026-08-11T06:00:00.000Z',
  }), /final protocol checksum/);
});
