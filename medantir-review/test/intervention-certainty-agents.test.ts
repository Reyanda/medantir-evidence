import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../src/synthesis/intervention-random-effects-agent.js';
import { createProductionInterventionGradeAgent } from '../src/certainty/intervention-certainty-agents.js';
import { freezePublicationBiasUniversePolicy } from '../src/certainty/publication-bias-universe-policy.js';

class CaptureGrade implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return {
      artifacts: {
        capturedGradeEvidence: structuredClone(context.state.artifacts.gradeOutcomeEvidence),
        capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse),
        capturedUniverseAudits: structuredClone(context.state.artifacts.publicationBiasUniverseAudits),
        capturedRegistryReview: structuredClone(context.state.artifacts.registryUniverseReviewPackage),
      },
    };
  }
}

const analysis: InterventionOutcomeRandomEffectsAnalysis = {
  outcome: 'mortality', status: 'computed', effectMeasure: 'RR', analysisScale: 'log', displayTransform: 'exp', studyCount: 2, estimateCount: 2,
  sensitivity: {
    primary: {
      model: 'random-effects-inverse-variance', tauEstimator: 'REML', confidenceMethod: 'wald', confidenceLevel: 0.95, k: 2,
      pooledEffect: -0.2, pooledStandardError: 0.1, confidenceInterval: [-0.4, 0], tauSquared: 0.01, tau: 0.1,
      cochranQ: 1.2, qDegreesOfFreedom: 1, qBasedI2: 16.7, typicalWithinStudyVariance: 0.02, tauBasedI2: 33.3,
      contributions: [
        { studyId: 's1', label: 'S1', effect: -0.2, variance: 0.02, randomWeight: 1, normalizedWeight: 0.5 },
        { studyId: 's2', label: 'S2', effect: -0.2, variance: 0.02, randomWeight: 1, normalizedWeight: 0.5 },
      ], warnings: [],
    },
    sensitivity: [],
    methodAgreement: { pooledEffectRange: [-0.2, -0.2], tauSquaredRange: [0.01, 0.01], confidenceIntervalsCrossNullDifferently: false },
  },
};

function study(studyId: string, reportId: string): ExtractedStudy {
  return {
    studyId, reportIds: [reportId], design: 'randomised controlled trial', population: 'children',
    interventionOrExposure: 'treatment', comparator: 'control', outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1 }],
    mechanisms: [], funding: 'unknown', rationale: 'r', objectives: ['o'], resultsSummary: 'results', discussionSummary: 'discussion', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] }, fieldEvidence: {}, sourceQuotes: [],
  };
}

function registryRecord(id: string) {
  return {
    id: `nct:${id.toLowerCase()}`, title: `Trial ${id}`, abstract: '', authors: [], year: 2020, sourceDatabases: ['clinicaltrials.gov'],
    trialRegistry: {
      source: 'clinicaltrials.gov' as const, registryId: id, overallStatus: 'COMPLETED', hasPostedResults: true,
      conditions: [], keywords: [], design: { phases: [] }, eligibility: { standardAges: [] }, arms: [], interventions: [],
      primaryOutcomes: [{ measure: 'mortality', timeFrame: 'Day 28' }], secondaryOutcomes: [],
      reportedOutcomes: [{ title: 'mortality', type: 'PRIMARY', timeFrame: 'Day 28', reportingStatus: 'POSTED', hasOutcomeData: true }],
      sourceSchema: 'clinicaltrials.gov-api-v2' as const,
    },
  };
}

function context(): AgentContext {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
    databases: [...fixtureRequest.databases, 'ClinicalTrials.gov'],
  });
  state.artifacts.interventionRandomEffectsAnalyses = [analysis];
  state.artifacts.extractedStudies = [study('s1', 'r1'), study('s2', 'r2')];
  state.artifacts.studyFamilyLinks = [
    { recordId: 'r1', familyId: 'f1', registryIds: ['NCT00000001'], linkageBasis: 'single-registry-id', role: 'primary-results' },
    { recordId: 'r2', familyId: 'f2', registryIds: ['NCT00000002'], linkageBasis: 'single-registry-id', role: 'primary-results' },
  ];
  state.artifacts.searchProvenance = [{
    database: 'clinicaltrials.gov', platform: 'ClinicalTrials.gov API v2', executedQuery: 'q', executedAt: '2026-08-11T08:00:00.000Z',
    resultCount: 3, exportFormat: 'JSON', warnings: [],
  }];
  state.artifacts.searchResults = [
    registryRecord('NCT00000001'),
    registryRecord('NCT00000002'),
    { id: 'nct:nct00000003', title: 'Eligible trial NCT00000003', abstract: '', authors: [], year: 2020, sourceDatabases: ['clinicaltrials.gov'] },
  ];
  state.artifacts.registryUniverseAdjudications = [{
    version: 1,
    registryId: 'NCT00000003', outcome: 'mortality', eligibilityStatus: 'eligible',
    resultsAvailable: false, prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: false,
    publicationStatus: 'registry-only', evidenceIds: ['registry-adjudication-evidence'],
    rationale: 'Independent evidence-universe reconciliation found no available result or peer-reviewed publication.',
    actorId: 'user:reviewer', decidedAt: '2026-08-11T08:30:00.000Z', adjudicationHash: 'adjudication-hash',
  }];
  state.artifacts.publicationBiasUniversePolicy = freezePublicationBiasUniversePolicy({
    protocolHash: 'protocol-1',
    configuration: {
      version: '1', rationale: 'Prospective full-universe audit.', minimumEligibleUniverseRegistryCoverage: 1,
      requireEligibilityResolvedForAssessmentBasis: true,
      requireResultAvailabilityKnownForAssessmentBasis: true,
      requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: true,
      requireTargetOutcomeStatusKnownForAssessmentBasis: true,
      requirePublicationStatusKnownForAssessmentBasis: true,
    },
    frozenAt: '2026-08-11T07:00:00.000Z',
  });
  return { state, now: () => '2026-08-11T09:00:00.000Z' };
}

test('eligible missing-result non-contributor becomes positive evidence before deterministic GRADE boundary', async () => {
  const result = await createProductionInterventionGradeAgent(new CaptureGrade()).execute(context());
  const universe = result.artifacts.capturedUniverse as Array<{
    studyId: string; eligibilityStatus: string; contributesToSynthesis: boolean; resultsAvailable: boolean | string; publicationStatus: string;
  }>;
  const missing = universe.find((row) => row.studyId === 'registry:NCT00000003');
  assert.ok(missing);
  assert.equal(missing.eligibilityStatus, 'eligible');
  assert.equal(missing.contributesToSynthesis, false);
  assert.equal(missing.resultsAvailable, false);
  assert.equal(missing.publicationStatus, 'registry-only');

  const audits = result.artifacts.capturedUniverseAudits as Array<{
    assessmentBasisComplete: boolean; eligibleUniverseCount: number; knownPublicationStatusCount: number;
    signals: Array<{ kind: string }>; auditDebt: unknown[];
  }>;
  assert.equal(audits[0]?.assessmentBasisComplete, true);
  assert.equal(audits[0]?.eligibleUniverseCount, 3);
  assert.equal(audits[0]?.knownPublicationStatusCount, 3);
  assert.equal(audits[0]?.auditDebt.length, 0);
  assert.ok(audits[0]?.signals.some((signal) => signal.kind === 'eligible-registered-study-without-results'));
  assert.ok(audits[0]?.signals.some((signal) => signal.kind === 'eligible-primary-outcome-not-reported'));
  assert.ok(audits[0]?.signals.some((signal) => signal.kind === 'eligible-unpublished-study'));

  const review = result.artifacts.capturedRegistryReview as { items: unknown[] };
  assert.equal(review.items.length, 0, 'complete contributor registry metadata and adjudicated missing trial leave no registry debt');

  const evidence = result.artifacts.capturedGradeEvidence as Array<{
    outcome: string; publicationBias?: { signals: Array<{ id: string; strength: number }> };
  }>;
  const signals = evidence.find((item) => item.outcome === 'mortality')?.publicationBias?.signals ?? [];
  assert.ok(signals.some((signal) => signal.id === '__assessment-basis__' && signal.strength === 0));
  assert.ok(signals.filter((signal) => signal.strength === 1).length >= 3);
});

test('certainty composition refuses a non-grade inner agent', () => {
  const bad: Agent = { stage: 'report', async execute() { return { artifacts: {} }; } };
  assert.throws(() => createProductionInterventionGradeAgent(bad), /grade-stage/);
});
