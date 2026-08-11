import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessGradeOutcome,
  evaluateGradeRiskOfBias,
  type GradeDowngradeDecision,
  type GradePolicyIdentity,
} from '../src/certainty/grade.js';

const basePolicy = (id: string): GradePolicyIdentity => ({
  id,
  protocolHash: 'protocol-grade-hardening',
  version: '1.0.0',
  rationale: 'Frozen policy for GRADE hardening tests.',
  frozenAt: '2026-08-11T06:00:00.000Z',
});

const robPolicy = {
  ...basePolicy('grade-rob-hardening'),
  highRiskWeightSerious: 0.20,
  highRiskWeightVerySerious: 0.50,
  someConcernsWeightSerious: 0.50,
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

test('missing policy produces an unresolved receipt that remains valid but incomplete', () => {
  const unresolved = evaluateGradeRiskOfBias({
    studies: [{ studyId: 's1', weight: 1, judgement: 'low', evidenceIds: ['rob-s1'] }],
  });
  assert.equal(unresolved.source, 'unresolved');
  assert.equal(unresolved.policyId, undefined);
  assert.equal(unresolved.concern, 'not-assessable');

  const assessment = assessGradeOutcome({
    outcome: 'mortality',
    population: 'children',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    startingCertainty: 'high',
    downgradeDecisions: [
      unresolved,
      noConcern('inconsistency'),
      noConcern('indirectness'),
      noConcern('imprecision'),
      noConcern('publication-bias'),
    ],
  });
  assert.equal(assessment.status, 'incomplete');
  assert.equal(assessment.finalCertainty, undefined);
  assert.ok(assessment.unresolvedDomains.includes('risk-of-bias'));
});

test('partial RoB coverage is not renormalized into a false low-risk verdict', () => {
  const decision = evaluateGradeRiskOfBias({
    studies: [{ studyId: 's1', weight: 0.50, judgement: 'low', evidenceIds: ['rob-s1'] }],
  }, robPolicy);
  assert.equal(decision.concern, 'not-assessable');
  assert.equal(decision.metrics.coveredWeight, 0.5);
  assert.match(decision.rationale, /50\.00% of synthesis weight/);
});

test('complete synthesis-weight coverage remains eligible for deterministic RoB grading', () => {
  const decision = evaluateGradeRiskOfBias({
    studies: [
      { studyId: 's1', weight: 0.50, judgement: 'low', evidenceIds: ['rob-s1'] },
      { studyId: 's2', weight: 0.50, judgement: 'low', evidenceIds: ['rob-s2'] },
    ],
  }, robPolicy);
  assert.equal(decision.concern, 'no-serious-concern');
  assert.equal(decision.metrics.coveredWeight, 1);
  assert.equal(decision.source, 'deterministic-policy');
  assert.equal(decision.policyId, robPolicy.id);
});

test('unresolved receipts cannot counterfeit policy or human authority', () => {
  const counterfeit: GradeDowngradeDecision = {
    domain: 'risk-of-bias',
    concern: 'not-assessable',
    rationale: 'Missing evidence.',
    evidenceIds: [],
    metrics: {},
    source: 'unresolved',
    policyId: 'fake-policy',
  };
  assert.throws(() => assessGradeOutcome({
    outcome: 'mortality',
    population: 'children',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    startingCertainty: 'high',
    downgradeDecisions: [
      counterfeit,
      noConcern('inconsistency'),
      noConcern('indirectness'),
      noConcern('imprecision'),
      noConcern('publication-bias'),
    ],
  }), /cannot claim policy or actor authority/);
});
