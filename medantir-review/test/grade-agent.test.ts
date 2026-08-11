import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { InterventionGradeAgent } from '../src/certainty/grade-agent.js';
import type { Rob2Assessment } from '../src/appraisal/rob2.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../src/synthesis/intervention-random-effects-agent.js';
import type { GradePolicySet } from '../src/certainty/grade.js';

const rob2: Rob2Assessment = {
  version: 1,
  assessmentId: 'rob2-grade-s1',
  studyId: 's1',
  resultId: 'r1',
  outcome: 'mortality',
  trialDesign: 'individual-parallel',
  effectOfInterest: 'assignment',
  domains: ['D1', 'D2', 'D3', 'D4', 'D5'].map((domain) => ({
    domain: domain as 'D1' | 'D2' | 'D3' | 'D4' | 'D5',
    title: domain,
    activeQuestionIds: [],
    responses: [],
    algorithmJudgement: 'low' as const,
    proposedJudgement: 'low' as const,
    finalJudgement: 'low' as const,
    rationale: ['low'],
    finalRationale: ['low'],
    complete: true,
    unsupportedQuestionIds: [],
    inactiveResponseQuestionIds: [],
  })),
  algorithmOverall: 'low',
  proposedOverall: 'low',
  domainAdjustedOverall: 'low',
  finalOverall: 'low',
  overrides: [],
  multipleSomeConcernsEscalation: false,
  complete: true,
  authority: {
    tool: 'RoB 2', toolVersion: '2019-08-22', trialDesign: 'individual-parallel', effectOfInterest: 'assignment',
    implementation: 'MEDANTIR-ROB2-ASSIGNMENT-CONSERVATIVE-1', signallingStructureAuthority: 'official-rob2-2019',
    exactExcelAlgorithmParity: 'pending', productionCertificationBlockedOnExactParity: true,
  },
  assessmentHash: 'a'.repeat(64),
};

const analysis: InterventionOutcomeRandomEffectsAnalysis = {
  outcome: 'mortality', status: 'computed', effectMeasure: 'RR', analysisScale: 'log', displayTransform: 'exp',
  studyCount: 2, estimateCount: 2,
  sensitivity: {
    primary: {
      model: 'random-effects-inverse-variance', tauEstimator: 'REML', confidenceMethod: 'wald', confidenceLevel: 0.95, k: 2,
      pooledEffect: -0.30, pooledStandardError: 0.10, confidenceInterval: [-0.50, -0.10],
      tauSquared: 0.01, tau: 0.1, cochranQ: 1.5, qDegreesOfFreedom: 1, qBasedI2: 33,
      typicalWithinStudyVariance: 0.02, tauBasedI2: 33,
      contributions: [
        { studyId: 's1', label: 'S1', effect: -0.30, variance: 0.02, randomWeight: 50, normalizedWeight: 0.5 },
        { studyId: 's2', label: 'S2', effect: -0.30, variance: 0.02, randomWeight: 50, normalizedWeight: 0.5 },
      ],
      warnings: [],
    },
    sensitivity: [],
    methodAgreement: { pooledEffectRange: [-0.30, -0.30], tauSquaredRange: [0.01, 0.01], confidenceIntervalsCrossNullDifferently: false },
  },
};

const rob2s: Rob2Assessment[] = [rob2, { ...rob2, assessmentId: 'rob2-grade-s2', studyId: 's2', resultId: 'r2', assessmentHash: 'b'.repeat(64) }];
const basePolicy = (id: string) => ({ id, protocolHash: 'protocol-grade', version: '1', rationale: 'Prespecified policy', frozenAt: '2026-08-11T05:00:00.000Z' });
const policies: GradePolicySet = {
  riskOfBias: { ...basePolicy('rob'), highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { ...basePolicy('inc'), i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { ...basePolicy('imp'), nullValue: 0, benefitThreshold: -0.10, harmThreshold: 0.10, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { ...basePolicy('ind'), seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { ...basePolicy('pb'), seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

const direct = { population: 'direct' as const, interventionOrExposure: 'direct' as const, comparator: 'direct' as const, outcome: 'direct' as const, evidenceIds: ['pico-mortality'] };
const assessedNoSignals = {
  signals: [{ id: '__assessment-basis__', description: 'Registry/search assessment completed.', strength: 0, evidenceIds: ['registry-audit'] }],
};

function state() {
  const value = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, population: 'children', interventionOrExposure: 'treatment', comparator: 'control', outcomes: ['mortality'] },
  });
  value.artifacts.interventionRandomEffectsAnalyses = [analysis];
  value.artifacts.rob2Assessments = rob2s;
  return value;
}

test('missing policies/evidence leaves GRADE incomplete rather than fabricating high certainty', async () => {
  const value = state();
  const result = await new InterventionGradeAgent().execute({ state: value, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  assert.deepEqual(result.artifacts.grade, []);
  const assessments = result.artifacts.gradeOutcomeAssessments as Array<{ status: string; finalCertainty?: string; unresolvedDomains: string[] }>;
  assert.equal(assessments[0]?.status, 'incomplete');
  assert.equal(assessments[0]?.finalCertainty, undefined);
  assert.ok(assessments[0]?.unresolvedDomains.includes('imprecision'));
  assert.ok(assessments[0]?.unresolvedDomains.includes('indirectness'));
  assert.ok(assessments[0]?.unresolvedDomains.includes('publication-bias'));
});

test('fully specified low-concern RCT outcome produces high certainty deterministically', async () => {
  const value = state();
  value.artifacts.gradePolicySet = policies;
  value.artifacts.gradeOutcomeEvidence = [{
    outcome: 'mortality', totalParticipants: 1500, totalParticipantsEvidenceIds: ['n-mortality'],
    directness: direct, publicationBias: assessedNoSignals,
  }];
  const result = await new InterventionGradeAgent().execute({ state: value, now: () => '2026-08-11T05:00:00.000Z' });
  assert.equal(result.awaitingHuman, undefined);
  const grade = result.artifacts.grade as Array<{ outcome: string; certainty: string; rationale: string[] }>;
  assert.equal(grade[0]?.outcome, 'mortality');
  assert.equal(grade[0]?.certainty, 'high');
  assert.equal(grade[0]?.rationale.length, 5);
  const assessment = (result.artifacts.gradeOutcomeAssessments as Array<{ status: string; finalCertainty: string }>)[0]!;
  assert.equal(assessment.status, 'complete');
  assert.equal(assessment.finalCertainty, 'high');
});

test('imprecision downgrade from frozen policy lowers final certainty without changing other domains', async () => {
  const value = state();
  value.artifacts.gradePolicySet = policies;
  value.artifacts.gradeOutcomeEvidence = [{
    outcome: 'mortality', totalParticipants: 300, totalParticipantsEvidenceIds: ['small-n'],
    directness: direct, publicationBias: assessedNoSignals,
  }];
  const result = await new InterventionGradeAgent().execute({ state: value, now: () => '2026-08-11T05:00:00.000Z' });
  const assessment = (result.artifacts.gradeOutcomeAssessments as Array<{ finalCertainty?: string; downgradeDecisions: Array<{ domain: string; concern: string }> }>)[0]!;
  assert.equal(assessment.downgradeDecisions.find((item) => item.domain === 'imprecision')?.concern, 'very-serious');
  assert.equal(assessment.finalCertainty, 'low');
});

test('missing matching RoB 2 assessment makes risk-of-bias domain not-assessable', async () => {
  const value = state();
  value.artifacts.gradePolicySet = policies;
  value.artifacts.rob2Assessments = [rob2];
  value.artifacts.gradeOutcomeEvidence = [{
    outcome: 'mortality', totalParticipants: 1500, totalParticipantsEvidenceIds: ['n'],
    directness: direct, publicationBias: assessedNoSignals,
  }];
  const result = await new InterventionGradeAgent().execute({ state: value, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  const assessment = (result.artifacts.gradeOutcomeAssessments as Array<{ unresolvedDomains: string[] }>)[0]!;
  assert.ok(assessment.unresolvedDomains.includes('risk-of-bias'));
});

test('publication-bias policy cannot resolve without an assessment-basis receipt', async () => {
  const value = state();
  value.artifacts.gradePolicySet = policies;
  value.artifacts.gradeOutcomeEvidence = [{
    outcome: 'mortality', totalParticipants: 1500, totalParticipantsEvidenceIds: ['n'],
    directness: direct, publicationBias: { signals: [] },
  }];
  const result = await new InterventionGradeAgent().execute({ state: value, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  const assessment = (result.artifacts.gradeOutcomeAssessments as Array<{ unresolvedDomains: string[] }>)[0]!;
  assert.ok(assessment.unresolvedDomains.includes('publication-bias'));
});
