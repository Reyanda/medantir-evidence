import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ReviewRequest } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { compileReviewSpec } from '../src/question/review-spec.js';
import type { CanonicalEstimand, EstimandLedgerRow } from '../src/agents/estimand-identity.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../src/synthesis/intervention-random-effects-agent.js';
import {
  AutomaticGradeEvidenceAgent,
  type AutomaticGradeEvidenceReceipt,
  type OutcomeParticipantCountReceipt,
} from '../src/certainty/automatic-grade-evidence-agent.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  question: {
    title: 'Automatic GRADE evidence test',
    objective: 'Evaluate treatment versus control for mortality.',
    population: 'children with disease',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    outcomes: ['mortality'],
    studyDesigns: ['randomised controlled trial'],
  },
};

class CaptureAgent implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedGradeEvidence: structuredClone(context.state.artifacts.gradeOutcomeEvidence) } };
  }
}

function estimand(studyId: string): CanonicalEstimand {
  return {
    estimandId: `estimand-${studyId}`,
    outcome: 'mortality',
    effectMeasure: 'RR',
    analysisScale: 'log',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    population: 'children with disease',
    timeHorizon: { status: 'resolved', value: '28-day', evidence: ['28 day'] },
    analysisPopulation: { status: 'resolved', value: 'intention-to-treat', evidence: ['ITT'] },
    subgroup: { status: 'resolved', value: 'overall', evidence: ['overall'] },
    adjustment: { status: 'resolved', value: 'unadjusted', evidence: ['unadjusted'] },
    effectTarget: { status: 'resolved', value: 'total-effect', evidence: ['total effect'] },
    source: { recordId: `record-${studyId}`, studyId },
    unresolvedDimensions: [],
  };
}

function analysis(k: number, asymmetry: boolean): InterventionOutcomeRandomEffectsAnalysis {
  const contributions = Array.from({ length: k }, (_, index) => {
    const standardError = 0.10 + 0.02 * index;
    const noise = index % 2 === 0 ? -0.10 : 0.10;
    const effect = asymmetry
      ? (2 * standardError) + 0.20 + (noise * standardError)
      : 0.20 + (noise * standardError);
    return {
      studyId: `s${index + 1}`,
      label: `Study ${index + 1}`,
      effect,
      variance: standardError ** 2,
      randomWeight: 1,
      normalizedWeight: 1 / k,
    };
  });
  return {
    outcome: 'mortality',
    status: 'computed',
    effectMeasure: 'RR',
    analysisScale: 'log',
    displayTransform: 'exp',
    studyCount: k,
    estimateCount: k,
    sensitivity: {
      primary: {
        model: 'random-effects-inverse-variance',
        tauEstimator: 'REML',
        confidenceMethod: 'wald',
        confidenceLevel: 0.95,
        k,
        pooledEffect: 0.2,
        pooledStandardError: 0.05,
        confidenceInterval: [0.1, 0.3],
        tauSquared: 0.01,
        tau: 0.1,
        cochranQ: 8,
        qDegreesOfFreedom: Math.max(1, k - 1),
        qBasedI2: 20,
        typicalWithinStudyVariance: 0.02,
        tauBasedI2: 20,
        contributions,
        warnings: [],
      },
      sensitivity: [],
      methodAgreement: {
        pooledEffectRange: [0.2, 0.2],
        tauSquaredRange: [0.01, 0.01],
        confidenceIntervalsCrossNullDifferently: false,
      },
    },
  };
}

function prepare(k = 10, asymmetry = true) {
  const state = createPipelineState(request);
  const compilation = compileReviewSpec(request, { now: '2026-08-11T08:00:00.000Z' });
  assert.equal(compilation.status, 'complete');
  state.artifacts.reviewSpec = compilation.spec;
  state.artifacts.estimandLedger = Array.from({ length: k }, (_, index): EstimandLedgerRow => ({
    studyId: `s${index + 1}`,
    recordId: `record-s${index + 1}`,
    outcome: 'mortality',
    status: 'identified',
    estimand: estimand(`s${index + 1}`),
  }));
  state.artifacts.interventionRandomEffectsAnalyses = [analysis(k, asymmetry)];
  state.artifacts.outcomeParticipantCountLedger = Array.from({ length: k }, (_, index): OutcomeParticipantCountReceipt => ({
    version: 1,
    studyId: `s${index + 1}`,
    outcome: 'mortality',
    status: 'exact',
    totalParticipants: 100 + index,
    evidenceIds: [`n-s${index + 1}`],
    source: 'reported-analysis-count',
    sourceHash: `count-hash-${index + 1}`,
  }));
  return state;
}

test('automatically derives exact directness and information size with receipts', async () => {
  const state = prepare(3, false);
  const result = await new AutomaticGradeEvidenceAgent(new CaptureAgent()).execute({
    state,
    now: () => '2026-08-11T08:00:00.000Z',
  });
  const evidence = (result.artifacts.gradeOutcomeEvidence as Array<{
    outcome: string;
    totalParticipants?: number;
    totalParticipantsEvidenceIds?: string[];
    directness?: { population: string; evidenceIds: string[] };
  }>)[0]!;
  assert.equal(evidence.totalParticipants, 303);
  assert.equal(evidence.totalParticipantsEvidenceIds?.length, 6, 'source and count-receipt IDs are both retained');
  assert.equal(evidence.directness?.population, 'direct');
  assert.ok(evidence.directness?.evidenceIds.some((id) => id.startsWith('reviewspec:')));
  const receipts = result.artifacts.gradeAutomaticEvidenceReceipts as AutomaticGradeEvidenceReceipt[];
  assert.equal(receipts.find((item) => item.domain === 'directness')?.status, 'derived');
  assert.equal(receipts.find((item) => item.domain === 'information-size')?.status, 'derived');
});

test('semantic PICO mismatch remains unresolved rather than being guessed indirect or direct', async () => {
  const state = prepare(2, false);
  const ledger = state.artifacts.estimandLedger as EstimandLedgerRow[];
  ledger[0]!.estimand = { ...ledger[0]!.estimand!, comparator: 'usual care' };
  const result = await new AutomaticGradeEvidenceAgent(new CaptureAgent()).execute({ state, now: () => '2026-08-11T08:00:00.000Z' });
  const evidence = (result.artifacts.gradeOutcomeEvidence as Array<{ directness?: unknown }>)[0]!;
  assert.equal(evidence.directness, undefined);
  const receipt = (result.artifacts.gradeAutomaticEvidenceReceipts as AutomaticGradeEvidenceReceipt[])
    .find((item) => item.domain === 'directness');
  assert.equal(receipt?.status, 'not-derived');
  assert.match(receipt?.reason ?? '', /does not exactly match/);
});

test('applicable Egger asymmetry creates a publication-bias signal but client certainty is still policy-derived', async () => {
  const state = prepare(10, true);
  const result = await new AutomaticGradeEvidenceAgent(new CaptureAgent()).execute({ state, now: () => '2026-08-11T08:00:00.000Z' });
  const evidence = (result.artifacts.gradeOutcomeEvidence as Array<{
    publicationBias?: { signals: Array<{ id: string; strength: number }> };
  }>)[0]!;
  assert.ok(evidence.publicationBias);
  assert.equal(evidence.publicationBias?.signals.find((item) => item.id === 'egger-small-study-asymmetry')?.strength, 1);
  assert.equal(evidence.publicationBias?.signals.find((item) => item.id === '__assessment-basis__')?.strength, 0);
  const receipt = (result.artifacts.gradeAutomaticEvidenceReceipts as AutomaticGradeEvidenceReceipt[])
    .find((item) => item.domain === 'publication-bias');
  assert.equal(receipt?.status, 'derived');
  assert.equal(receipt?.details.signal, true);
  assert.ok(Number(receipt?.details.pValue) < 0.10);
});

test('negative or inapplicable small-study test never auto-clears publication bias', async () => {
  for (const [k, asymmetry] of [[10, false], [9, true]] as const) {
    const state = prepare(k, asymmetry);
    const result = await new AutomaticGradeEvidenceAgent(new CaptureAgent()).execute({ state, now: () => '2026-08-11T08:00:00.000Z' });
    const evidence = (result.artifacts.gradeOutcomeEvidence as Array<{ publicationBias?: unknown }>)[0]!;
    assert.equal(evidence.publicationBias, undefined);
    const receipt = (result.artifacts.gradeAutomaticEvidenceReceipts as AutomaticGradeEvidenceReceipt[])
      .find((item) => item.domain === 'publication-bias');
    assert.equal(receipt?.status, 'not-derived');
  }
});

test('missing one exact participant-count receipt blocks automatic information-size derivation', async () => {
  const state = prepare(3, false);
  (state.artifacts.outcomeParticipantCountLedger as OutcomeParticipantCountReceipt[])[1]!.status = 'unresolved';
  delete (state.artifacts.outcomeParticipantCountLedger as OutcomeParticipantCountReceipt[])[1]!.totalParticipants;
  const result = await new AutomaticGradeEvidenceAgent(new CaptureAgent()).execute({ state, now: () => '2026-08-11T08:00:00.000Z' });
  const evidence = (result.artifacts.gradeOutcomeEvidence as Array<{ totalParticipants?: number }>)[0]!;
  assert.equal(evidence.totalParticipants, undefined);
  const receipt = (result.artifacts.gradeAutomaticEvidenceReceipts as AutomaticGradeEvidenceReceipt[])
    .find((item) => item.domain === 'information-size');
  assert.equal(receipt?.status, 'not-derived');
});
