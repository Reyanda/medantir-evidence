import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { PublicationBiasUniverseGradeAgent } from '../src/certainty/publication-bias-universe-grade-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';
import { freezePublicationBiasUniversePolicy } from '../src/certainty/publication-bias-universe-policy.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedEvidence: structuredClone(context.state.artifacts.gradeOutcomeEvidence) } };
  }
}

function row(studyId: string, overrides: Partial<RegistryResultUniverseRecord> = {}): RegistryResultUniverseRecord {
  return {
    version: 2, studyId, outcome: 'mortality', registryId: `NCT-${studyId}`,
    eligibilityStatus: 'eligible', contributesToSynthesis: studyId === 's1', registrySearched: true,
    registrationFound: true, resultsAvailable: true, prespecifiedPrimaryOutcomeFound: true,
    targetOutcomeReported: true, publicationStatus: 'published', evidenceIds: [`ev-${studyId}`], sourceHash: `hash-${studyId}`,
    ...overrides,
  };
}

function state(universe: RegistryResultUniverseRecord[]) {
  const value = createPipelineState(fixtureRequest);
  value.artifacts.interventionRandomEffectsAnalyses = [{
    outcome: 'mortality', status: 'computed', effectMeasure: 'RR', analysisScale: 'log', displayTransform: 'exp', studyCount: 1, estimateCount: 1,
    sensitivity: {
      primary: {
        model: 'random-effects-inverse-variance', tauEstimator: 'REML', confidenceMethod: 'wald', confidenceLevel: 0.95, k: 1,
        pooledEffect: 0, pooledStandardError: 0.1, confidenceInterval: [-0.2, 0.2], tauSquared: 0, tau: 0,
        cochranQ: 0, qDegreesOfFreedom: 0, qBasedI2: 0, typicalWithinStudyVariance: 0, tauBasedI2: 0,
        contributions: [{ studyId: 's1', label: 's1', effect: 0, variance: 0.01, randomWeight: 1, normalizedWeight: 1 }], warnings: [],
      }, sensitivity: [], methodAgreement: { pooledEffectRange: [0, 0], tauSquaredRange: [0, 0], confidenceIntervalsCrossNullDifferently: false },
    },
  }];
  value.artifacts.registeredStudyResultUniverse = universe;
  value.artifacts.publicationBiasUniversePolicy = freezePublicationBiasUniversePolicy({
    protocolHash: 'protocol-1',
    configuration: {
      version: '1', rationale: 'Prospective full-universe audit.', minimumEligibleUniverseRegistryCoverage: 1,
      requireEligibilityResolvedForAssessmentBasis: true,
      requireResultAvailabilityKnownForAssessmentBasis: true,
      requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: true,
      requireTargetOutcomeStatusKnownForAssessmentBasis: true,
    },
    frozenAt: '2026-08-11T09:00:00.000Z',
  });
  return value;
}

test('incomplete eligible universe revokes an earlier Egger-only assessment basis but retains positive signal', async () => {
  const value = state([
    row('s1'),
    row('candidate', {
      eligibilityStatus: 'unresolved', contributesToSynthesis: false,
      resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: 'unknown', targetOutcomeReported: 'unknown', publicationStatus: 'unknown',
    }),
  ]);
  value.artifacts.gradeOutcomeEvidence = [{
    outcome: 'mortality',
    publicationBias: {
      signals: [
        { id: '__assessment-basis__', description: 'Earlier Egger assessment.', strength: 0, evidenceIds: ['egger:basis'] },
        { id: 'egger-small-study-asymmetry', description: 'Positive Egger signal.', strength: 1, evidenceIds: ['egger:signal'] },
      ],
    },
  }];
  const result = await new PublicationBiasUniverseGradeAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:00:00.000Z' });
  const evidence = result.artifacts.capturedEvidence as Array<{ publicationBias?: { signals: Array<{ id: string }> } }>;
  const signals = evidence[0]?.publicationBias?.signals ?? [];
  assert.equal(signals.some((item) => item.id === '__assessment-basis__'), false);
  assert.equal(signals.some((item) => item.id === 'egger-small-study-asymmetry'), true);
  const audit = (result.artifacts.publicationBiasUniverseAudits as Array<{ assessmentBasisComplete: boolean; signals: unknown[]; auditDebt: unknown[] }>)[0]!;
  assert.equal(audit.assessmentBasisComplete, false);
  assert.equal(audit.auditDebt.length > 0, true);
});

test('complete eligible universe restores a universe-backed assessment basis', async () => {
  const value = state([row('s1')]);
  value.artifacts.gradeOutcomeEvidence = [{ outcome: 'mortality' }];
  const result = await new PublicationBiasUniverseGradeAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:00:00.000Z' });
  const evidence = result.artifacts.capturedEvidence as Array<{ publicationBias?: { signals: Array<{ id: string; evidenceIds: string[] }> } }>;
  const basis = evidence[0]?.publicationBias?.signals.find((item) => item.id === '__assessment-basis__');
  assert.ok(basis);
  assert.ok(basis.evidenceIds.some((id) => id.startsWith('publication-bias-universe-audit:')));
  const audit = (result.artifacts.publicationBiasUniverseAudits as Array<{ assessmentBasisComplete: boolean; auditDebt: unknown[] }>)[0]!;
  assert.equal(audit.assessmentBasisComplete, true);
  assert.equal(audit.auditDebt.length, 0);
});

test('known missing-result signal is preserved even when another candidate keeps the universe incomplete', async () => {
  const value = state([
    row('s1'),
    row('missing', { contributesToSynthesis: false, resultsAvailable: false, targetOutcomeReported: false, publicationStatus: 'registry-only' }),
    row('unresolved', { eligibilityStatus: 'unresolved', contributesToSynthesis: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: 'unknown', targetOutcomeReported: 'unknown', publicationStatus: 'unknown' }),
  ]);
  const result = await new PublicationBiasUniverseGradeAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:00:00.000Z' });
  const evidence = result.artifacts.capturedEvidence as Array<{ publicationBias?: { signals: Array<{ id: string }> } }>;
  const signals = evidence[0]?.publicationBias?.signals ?? [];
  assert.equal(signals.some((item) => item.id === '__assessment-basis__'), false);
  assert.ok(signals.some((item) => item.id.startsWith('pb-universe-')));
});
