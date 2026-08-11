import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessGradeOutcome,
  evaluateGradeImprecision,
  evaluateGradeInconsistency,
  evaluateGradeIndirectness,
  evaluateGradePublicationBias,
  evaluateGradeRiskOfBias,
  type GradeDowngradeDecision,
  type GradePolicyIdentity,
} from '../src/certainty/grade.js';

const basePolicy = (id: string): GradePolicyIdentity => ({
  id,
  protocolHash: 'protocol-grade-001',
  version: '1.0.0',
  rationale: 'Frozen protocol decision rule for deterministic GRADE testing.',
  frozenAt: '2026-08-11T05:00:00.000Z',
});

const robPolicy = {
  ...basePolicy('grade-rob-1'),
  highRiskWeightSerious: 0.20,
  highRiskWeightVerySerious: 0.50,
  someConcernsWeightSerious: 0.50,
};
const imprecisionPolicy = {
  ...basePolicy('grade-imp-1'),
  nullValue: 0,
  benefitThreshold: -0.10,
  harmThreshold: 0.10,
  requiredInformationSize: 1000,
  verySeriousOisFraction: 0.50,
};
const inconsistencyPolicy = {
  ...basePolicy('grade-inc-1'),
  i2Serious: 50,
  i2VerySerious: 75,
  predictionIntervalDecisionConflictSerious: true,
};
const indirectnessPolicy = {
  ...basePolicy('grade-ind-1'),
  seriousIfPartialDimensionsAtLeast: 2,
  verySeriousIfIndirectDimensionsAtLeast: 2,
};
const publicationPolicy = {
  ...basePolicy('grade-pb-1'),
  seriousSignalWeight: 1,
  verySeriousSignalWeight: 2,
};

function noConcern(domain: GradeDowngradeDecision['domain']): GradeDowngradeDecision {
  return {
    domain,
    concern: 'no-serious-concern',
    rationale: `No serious ${domain} concern under frozen policy.`,
    evidenceIds: [`e-${domain}`],
    metrics: {},
    source: 'deterministic-policy',
    policyId: `p-${domain}`,
  };
}

test('missing GRADE policy is not interpreted as no serious concern', () => {
  const decision = evaluateGradeRiskOfBias({ studies: [{ studyId: 's1', weight: 1, judgement: 'low', evidenceIds: ['rob1'] }] });
  assert.equal(decision.concern, 'not-assessable');
  const assessment = assessGradeOutcome({
    outcome: 'mortality', population: 'children', interventionOrExposure: 'treatment', comparator: 'control', startingCertainty: 'high',
    downgradeDecisions: [
      decision,
      noConcern('inconsistency'), noConcern('indirectness'), noConcern('imprecision'), noConcern('publication-bias'),
    ],
  });
  assert.equal(assessment.status, 'incomplete');
  assert.equal(assessment.finalCertainty, undefined);
  assert.ok(assessment.unresolvedDomains.includes('risk-of-bias'));
});

test('risk of bias uses outcome-level synthesis weights and frozen thresholds', () => {
  const serious = evaluateGradeRiskOfBias({
    studies: [
      { studyId: 's1', weight: 0.70, judgement: 'low', evidenceIds: ['a'] },
      { studyId: 's2', weight: 0.30, judgement: 'high', evidenceIds: ['b'] },
    ],
  }, robPolicy);
  assert.equal(serious.concern, 'serious');
  assert.equal(serious.metrics.highRiskWeight, 0.30);

  const very = evaluateGradeRiskOfBias({
    studies: [
      { studyId: 's1', weight: 0.45, judgement: 'low', evidenceIds: ['a'] },
      { studyId: 's2', weight: 0.55, judgement: 'high', evidenceIds: ['b'] },
    ],
  }, robPolicy);
  assert.equal(very.concern, 'very-serious');
});

test('imprecision uses decision thresholds and OIS rather than SE alone', () => {
  const precise = evaluateGradeImprecision({ confidenceInterval: [-0.30, -0.15], totalParticipants: 1200, evidenceIds: ['ci'] }, imprecisionPolicy);
  assert.equal(precise.concern, 'no-serious-concern');

  const crosses = evaluateGradeImprecision({ confidenceInterval: [-0.20, 0.05], totalParticipants: 1200, evidenceIds: ['ci'] }, imprecisionPolicy);
  assert.equal(crosses.concern, 'serious');

  const benefitToHarm = evaluateGradeImprecision({ confidenceInterval: [-0.20, 0.20], totalParticipants: 1200, evidenceIds: ['ci'] }, imprecisionPolicy);
  assert.equal(benefitToHarm.concern, 'very-serious');

  const tinyInformation = evaluateGradeImprecision({ confidenceInterval: [-0.30, -0.15], totalParticipants: 300, evidenceIds: ['ci'] }, imprecisionPolicy);
  assert.equal(tinyInformation.concern, 'very-serious');
  assert.equal(tinyInformation.metrics.oisFraction, 0.3);
});

test('inconsistency can use both I2 and prediction-interval decision conflict', () => {
  const seriousI2 = evaluateGradeInconsistency({
    k: 8, i2: 60, tauSquared: 0.03, predictionInterval: [-0.4, -0.15], nullValue: 0,
    benefitThreshold: -0.1, harmThreshold: 0.1, evidenceIds: ['het'],
  }, inconsistencyPolicy);
  assert.equal(seriousI2.concern, 'serious');

  const conflict = evaluateGradeInconsistency({
    k: 8, i2: 20, tauSquared: 0.01, predictionInterval: [-0.3, 0.3], nullValue: 0,
    benefitThreshold: -0.1, harmThreshold: 0.1, evidenceIds: ['pi'],
  }, inconsistencyPolicy);
  assert.equal(conflict.concern, 'serious');
  assert.equal(conflict.metrics.predictionConflict, true);

  const very = evaluateGradeInconsistency({ k: 8, i2: 80, tauSquared: 0.2, nullValue: 0, evidenceIds: ['het'] }, inconsistencyPolicy);
  assert.equal(very.concern, 'very-serious');
});

test('indirectness is dimension-specific and policy-bound', () => {
  const no = evaluateGradeIndirectness({
    population: 'direct', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct', evidenceIds: ['pico'],
  }, indirectnessPolicy);
  assert.equal(no.concern, 'no-serious-concern');

  const serious = evaluateGradeIndirectness({
    population: 'partial', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'partial', evidenceIds: ['pico'],
  }, indirectnessPolicy);
  assert.equal(serious.concern, 'serious');

  const very = evaluateGradeIndirectness({
    population: 'indirect', interventionOrExposure: 'direct', comparator: 'indirect', outcome: 'direct', evidenceIds: ['pico'],
  }, indirectnessPolicy);
  assert.equal(very.concern, 'very-serious');
});

test('publication-bias signals are explicit weighted evidence, not an automatic funnel-plot verdict', () => {
  const none = evaluateGradePublicationBias({ signals: [] }, publicationPolicy);
  assert.equal(none.concern, 'no-serious-concern');
  const serious = evaluateGradePublicationBias({
    signals: [{ id: 'registry-gap', description: 'Completed registered trial lacks results.', strength: 1, evidenceIds: ['registry'] }],
  }, publicationPolicy);
  assert.equal(serious.concern, 'serious');
  const very = evaluateGradePublicationBias({
    signals: [
      { id: 'registry-gap', description: 'Completed registered trial lacks results.', strength: 1, evidenceIds: ['registry'] },
      { id: 'small-study', description: 'Prespecified small-study-effect signal.', strength: 1, evidenceIds: ['funnel'] },
    ],
  }, publicationPolicy);
  assert.equal(very.concern, 'very-serious');
});

test('complete RCT assessment applies downgrade levels deterministically', () => {
  const assessment = assessGradeOutcome({
    outcome: 'mortality', population: 'children', interventionOrExposure: 'treatment', comparator: 'control', startingCertainty: 'high',
    downgradeDecisions: [
      { ...noConcern('risk-of-bias'), concern: 'serious' },
      noConcern('inconsistency'),
      noConcern('indirectness'),
      { ...noConcern('imprecision'), concern: 'serious' },
      noConcern('publication-bias'),
    ],
  });
  assert.equal(assessment.status, 'complete');
  assert.equal(assessment.downgradeLevels, 2);
  assert.equal(assessment.finalCertainty, 'low');
  assert.equal(assessment.assessmentHash.length, 64);
});

test('duplicate domain decisions and unattributed human/model decisions are rejected', () => {
  assert.throws(() => assessGradeOutcome({
    outcome: 'mortality', population: 'p', interventionOrExposure: 'i', comparator: 'c', startingCertainty: 'high',
    downgradeDecisions: [
      noConcern('risk-of-bias'), noConcern('risk-of-bias'), noConcern('inconsistency'), noConcern('indirectness'), noConcern('imprecision'), noConcern('publication-bias'),
    ],
  }), /Duplicate GRADE downgrade domain/);

  const bad: GradeDowngradeDecision = {
    domain: 'risk-of-bias', concern: 'serious', rationale: 'Model concern', evidenceIds: ['x'], metrics: {}, source: 'model-proposed',
  };
  assert.throws(() => assessGradeOutcome({
    outcome: 'mortality', population: 'p', interventionOrExposure: 'i', comparator: 'c', startingCertainty: 'high',
    downgradeDecisions: [bad, noConcern('inconsistency'), noConcern('indirectness'), noConcern('imprecision'), noConcern('publication-bias')],
  }), /requires actorId/);
});
