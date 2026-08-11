import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { compileReviewSpec } from '../src/question/review-spec.js';
import { RegistryResultUniverseAgent } from '../src/certainty/registry-result-universe-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse) } };
  }
}

function base() {
  const request = {
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
    databases: [...fixtureRequest.databases, 'ClinicalTrials.gov'],
  };
  const state = createPipelineState(request);
  const compilation = compileReviewSpec(request, { now: '2026-08-11T10:00:00.000Z' });
  assert.equal(compilation.status, 'complete');
  state.artifacts.reviewSpec = compilation.spec;
  state.artifacts.interventionRandomEffectsAnalyses = [{
    outcome: 'mortality', status: 'computed', effectMeasure: 'RR', analysisScale: 'log', displayTransform: 'exp', studyCount: 1, estimateCount: 1,
    sensitivity: {
      primary: {
        model: 'random-effects-inverse-variance', tauEstimator: 'REML', confidenceMethod: 'wald', confidenceLevel: 0.95, k: 1,
        pooledEffect: 0, pooledStandardError: 0.1, confidenceInterval: [-0.2, 0.2], tauSquared: 0, tau: 0,
        cochranQ: 0, qDegreesOfFreedom: 0, qBasedI2: 0, typicalWithinStudyVariance: 0, tauBasedI2: 0,
        contributions: [{ studyId: 's1', label: 'S1', effect: 0, variance: 0.01, randomWeight: 1, normalizedWeight: 1 }], warnings: [],
      }, sensitivity: [], methodAgreement: { pooledEffectRange: [0, 0], tauSquaredRange: [0, 0], confidenceIntervalsCrossNullDifferently: false },
    },
  }];
  state.artifacts.extractedStudies = [{ studyId: 's1', reportIds: ['r1'], outcomes: [{ name: 'mortality', effect: 0, standardError: 0.1 }] }];
  state.artifacts.studyFamilyLinks = [{ recordId: 'r1', familyId: 'f1', registryIds: ['NCT00000001'], linkageBasis: 'single-registry-id' }];
  state.artifacts.searchProvenance = [{ database: 'clinicaltrials.gov', platform: 'ClinicalTrials.gov API v2', resultCount: 2 }];
  return state;
}

function sourceRichRecord(input: { id: string; studyType?: string; allocation?: string; population?: string; intervention?: string; comparator?: string; outcome?: string }) {
  return {
    id: `nct:${input.id.toLowerCase()}`,
    title: `Trial ${input.id}`,
    abstract: '', authors: [], year: 2022, sourceDatabases: ['clinicaltrials.gov'],
    trialRegistry: {
      source: 'clinicaltrials.gov' as const,
      registryId: input.id,
      overallStatus: 'COMPLETED', hasPostedResults: false,
      conditions: [input.population ?? 'children with severe acute malnutrition'], keywords: [],
      design: { studyType: input.studyType ?? 'INTERVENTIONAL', phases: [], allocation: input.allocation ?? 'RANDOMIZED', interventionModel: 'PARALLEL' },
      eligibility: { standardAges: ['CHILD'] },
      arms: [
        { label: 'Treatment', type: 'EXPERIMENTAL', interventionNames: [input.intervention ?? 'therapeutic food'] },
        { label: 'Control', type: 'ACTIVE_COMPARATOR', interventionNames: [input.comparator ?? 'standard nutritional treatment'] },
      ],
      interventions: [
        { name: input.intervention ?? 'therapeutic food', otherNames: [], armGroupLabels: ['Treatment'] },
        { name: input.comparator ?? 'standard nutritional treatment', otherNames: [], armGroupLabels: ['Control'] },
      ],
      primaryOutcomes: [{ measure: input.outcome ?? 'mortality' }], secondaryOutcomes: [], reportedOutcomes: [],
      sourceSchema: 'clinicaltrials.gov-api-v2' as const,
    },
  };
}

test('exact structured PICOD resolves eligibility but not global result/publication facts', async () => {
  const state = base();
  state.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributor', sourceDatabases: ['clinicaltrials.gov'] },
    sourceRichRecord({ id: 'NCT00000002' }),
  ];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state, now: () => '2026-08-11T10:00:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((item) => item.registryId === 'NCT00000002')!;
  assert.equal(row.eligibilityStatus, 'eligible');
  assert.equal(row.contributesToSynthesis, false);
  assert.equal(row.resultsAvailable, 'unknown');
  assert.equal(row.prespecifiedPrimaryOutcomeFound, true);
  assert.equal(row.targetOutcomeReported, 'unknown');
  assert.equal(row.publicationStatus, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ registryId: string; requiredFields: string[] }> };
  const item = review.items.find((candidate) => candidate.registryId === 'NCT00000002')!;
  assert.deepEqual(item.requiredFields, ['resultsAvailable', 'targetOutcomeReported', 'publicationStatus']);
  const quality = result.artifacts.registryUniverseQuality as { sourceAutoEligible: number };
  assert.equal(quality.sourceAutoEligible, 1);
});

test('explicit observational structure against RCT-only ReviewSpec auto-excludes without result-status question', async () => {
  const state = base();
  state.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributor', sourceDatabases: ['clinicaltrials.gov'] },
    sourceRichRecord({ id: 'NCT00000002', studyType: 'OBSERVATIONAL', allocation: 'NA', outcome: 'all-cause death' }),
  ];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state, now: () => '2026-08-11T10:00:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((item) => item.registryId === 'NCT00000002')!;
  assert.equal(row.eligibilityStatus, 'ineligible');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ registryId: string }> };
  assert.equal(review.items.some((item) => item.registryId === 'NCT00000002'), false);
  const quality = result.artifacts.registryUniverseQuality as { sourceAutoIneligible: number };
  assert.equal(quality.sourceAutoIneligible, 1);
});

test('one non-exact PICOD facet keeps eligibility unresolved while retaining other evidence debt separately', async () => {
  const state = base();
  state.artifacts.searchResults = [
    { id: 'NCT00000001', title: 'Contributor', sourceDatabases: ['clinicaltrials.gov'] },
    sourceRichRecord({ id: 'NCT00000002', population: 'pediatric severe malnutrition' }),
  ];
  const result = await new RegistryResultUniverseAgent(new Capture()).execute({ state, now: () => '2026-08-11T10:00:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]).find((item) => item.registryId === 'NCT00000002')!;
  assert.equal(row.eligibilityStatus, 'unresolved');
  const review = result.artifacts.registryUniverseReviewPackage as {
    items: Array<{ registryId: string; sourceDerived: { eligibilityUnresolvedFacets: string[] }; requiredFields: string[]; reason: string }>;
  };
  const item = review.items.find((entry) => entry.registryId === 'NCT00000002')!;
  assert.deepEqual(item.sourceDerived.eligibilityUnresolvedFacets, ['population']);
  assert.ok(item.requiredFields.includes('eligibilityStatus'));
  assert.ok(item.requiredFields.includes('resultsAvailable'));
  assert.ok(item.requiredFields.includes('targetOutcomeReported'));
  assert.ok(item.requiredFields.includes('publicationStatus'));
  assert.match(item.reason, /eligibility \(population\)/);
});
