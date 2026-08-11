import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { RegistryResultUniverseAgent } from '../src/certainty/registry-result-universe-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse) } };
  }
}

function state() {
  const value = createPipelineState(fixtureRequest);
  value.artifacts.interventionRandomEffectsAnalyses = [{
    outcome: 'mortality', status: 'computed', effectMeasure: 'RR', analysisScale: 'log', displayTransform: 'exp',
    studyCount: 1, estimateCount: 1,
    sensitivity: {
      primary: {
        model: 'random-effects-inverse-variance', tauEstimator: 'REML', confidenceMethod: 'wald', confidenceLevel: 0.95, k: 1,
        pooledEffect: 0, pooledStandardError: 0.1, confidenceInterval: [-0.2, 0.2], tauSquared: 0, tau: 0,
        cochranQ: 0, qDegreesOfFreedom: 0, qBasedI2: 0, typicalWithinStudyVariance: 0, tauBasedI2: 0,
        contributions: [{ studyId: 's1', label: 'S1', effect: 0, variance: 0.01, randomWeight: 1, normalizedWeight: 1 }], warnings: [],
      },
      sensitivity: [], methodAgreement: { pooledEffectRange: [0, 0], tauSquaredRange: [0, 0], confidenceIntervalsCrossNullDifferently: false },
    },
  }];
  value.artifacts.extractedStudies = [{ studyId: 's1', reportIds: ['doi:report-1'], outcomes: [{ name: 'mortality', effect: 0, standardError: 0.1 }] }];
  value.artifacts.studyFamilyLinks = [{ recordId: 'doi:report-1', familyId: 'family-1', registryIds: ['NCT00000001'], linkageBasis: 'single-registry-id' }];
  value.artifacts.searchProvenance = [{ database: 'ClinicalTrials.gov', platform: 'ClinicalTrials.gov API v2', resultCount: 2 }];
  value.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributing trial', sourceDatabases: ['ClinicalTrials.gov'] },
    { id: 'NCT00000002', title: 'Registry candidate', sourceDatabases: ['ClinicalTrials.gov'] },
  ];
  return value;
}

function registryMetadata(input: {
  hasPostedResults: boolean;
  primary?: string;
  reported?: string;
  reportedHasData?: boolean;
}) {
  return {
    source: 'clinicaltrials.gov' as const,
    registryId: 'NCT00000002',
    overallStatus: 'COMPLETED',
    hasPostedResults: input.hasPostedResults,
    conditions: [], keywords: [],
    design: { phases: [] },
    eligibility: { standardAges: [] },
    arms: [], interventions: [],
    primaryOutcomes: input.primary ? [{ measure: input.primary, timeFrame: 'Day 28' }] : [],
    secondaryOutcomes: [],
    reportedOutcomes: input.reported ? [{ title: input.reported, timeFrame: 'Day 28', hasOutcomeData: input.reportedHasData ?? true }] : [],
    sourceSchema: 'clinicaltrials.gov-api-v2' as const,
  };
}

test('contributing study is eligible and remains a published result-bearing contributor', async () => {
  const value = state();
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const contributor = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.studyId === 's1')!;
  assert.equal(contributor.registryId, 'NCT00000001');
  assert.equal(contributor.eligibilityStatus, 'eligible');
  assert.equal(contributor.contributesToSynthesis, true);
  assert.equal(contributor.resultsAvailable, true);
  assert.equal(contributor.targetOutcomeReported, true);
  assert.equal(contributor.publicationStatus, 'published');
});

test('generic unlinked registry record remains unresolved across eligibility/result/publication dimensions', async () => {
  const value = state();
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const candidate = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.registryId === 'NCT00000002')!;
  assert.equal(candidate.eligibilityStatus, 'unresolved');
  assert.equal(candidate.resultsAvailable, 'unknown');
  assert.equal(candidate.publicationStatus, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ registryId: string; requiredFields: string[] }> };
  const item = review.items.find((entry) => entry.registryId === 'NCT00000002')!;
  assert.ok(item.requiredFields.includes('eligibilityStatus'));
  assert.ok(item.requiredFields.includes('resultsAvailable'));
  assert.ok(item.requiredFields.includes('publicationStatus'));
});

test('no registry-posted results can prove primary prespecification but not global result absence', async () => {
  const value = state();
  value.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributing trial', sourceDatabases: ['ClinicalTrials.gov'] },
    {
      id: 'nct:nct00000002', title: 'Registry candidate', abstract: '', authors: [], year: 2021, sourceDatabases: ['clinicaltrials.gov'],
      trialRegistry: registryMetadata({ hasPostedResults: false, primary: 'mortality' }),
    },
  ];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const candidate = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.registryId === 'NCT00000002')!;
  assert.equal(candidate.resultsAvailable, 'unknown');
  assert.equal(candidate.prespecifiedPrimaryOutcomeFound, true);
  assert.equal(candidate.targetOutcomeReported, 'unknown');
  assert.equal(candidate.publicationStatus, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as {
    items: Array<{ registryId: string; requiredFields: string[]; sourceDerived: { registryResultsPosted: boolean | string; exactPrimaryOutcomeMatches: string[] } }>;
  };
  const item = review.items.find((entry) => entry.registryId === 'NCT00000002')!;
  assert.equal(item.sourceDerived.registryResultsPosted, false);
  assert.deepEqual(item.sourceDerived.exactPrimaryOutcomeMatches, ['mortality']);
  assert.ok(item.requiredFields.includes('resultsAvailable'));
  assert.ok(item.requiredFields.includes('targetOutcomeReported'));
  assert.ok(item.requiredFields.includes('publicationStatus'));
});

test('posted registry results prove result availability but non-exact outcome wording is never semantically mapped', async () => {
  const value = state();
  value.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributing trial', sourceDatabases: ['ClinicalTrials.gov'] },
    {
      id: 'nct:nct00000002', title: 'Registry candidate', abstract: '', authors: [], year: 2021, sourceDatabases: ['clinicaltrials.gov'],
      trialRegistry: registryMetadata({ hasPostedResults: true, primary: 'all-cause death', reported: 'all-cause death' }),
    },
  ];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const candidate = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.registryId === 'NCT00000002')!;
  assert.equal(candidate.resultsAvailable, true);
  assert.equal(candidate.prespecifiedPrimaryOutcomeFound, 'unknown');
  assert.equal(candidate.targetOutcomeReported, 'unknown');
});

test('cumulative attributable adjudication is applied to its exact registry/outcome subject', async () => {
  const value = state();
  value.artifacts.registryUniverseAdjudications = [{
    version: 1,
    registryId: 'NCT00000002', outcome: 'mortality', eligibilityStatus: 'eligible',
    resultsAvailable: false, prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: false,
    publicationStatus: 'registry-only', evidenceIds: ['evidence:publication-search'],
    rationale: 'Independent publication/result reconciliation found no available result.',
    actorId: 'user:reviewer', decidedAt: '2026-08-11T09:00:00.000Z', adjudicationHash: 'adjudication-1',
  }];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const candidate = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.registryId === 'NCT00000002')!;
  assert.equal(candidate.eligibilityStatus, 'eligible');
  assert.equal(candidate.resultsAvailable, false);
  assert.equal(candidate.targetOutcomeReported, false);
  assert.equal(candidate.publicationStatus, 'registry-only');
});

test('registry search not executed remains visible on contributing studies', async () => {
  const value = state();
  value.artifacts.searchProvenance = [{ database: 'PubMed', platform: 'NCBI PubMed', resultCount: 1 }];
  value.artifacts.searchResults = [];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T09:00:00.000Z' });
  const contributor = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((row) => row.studyId === 's1')!;
  assert.equal(contributor.registrySearched, false);
  assert.equal(contributor.registrationFound, true, 'linkage proves registration identity but not a completed registry search');
});
