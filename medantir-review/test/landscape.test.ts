import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewLandscapeAgent, SynthesisAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import type { ExtractedStudy, ReviewPlan, ReviewRequest } from '../src/core/types.js';
import { buildMethodologyPlan } from '../src/protocols/methodology.js';
import { fixtureRequest } from '../src/fixtures.js';

function contextFor(request: ReviewRequest) {
  const state = createPipelineState(request);
  state.artifacts.reviewPlan = buildMethodologyPlan(request);
  return { state, now: () => '2026-07-13T00:00:00.000Z' };
}

test('adopts or adapts a current, direct, trustworthy, extractable review', async () => {
  const request: ReviewRequest = {
    ...fixtureRequest,
    existingReviewCandidates: [{
      id: 'review-1',
      title: 'Direct high-quality review',
      publicationYear: 2025,
      lastSearchDate: '2025-12-01',
      questionMatch: 0.98,
      populationMatch: 0.98,
      interventionOrExposureMatch: 0.95,
      outcomeMatch: 0.95,
      hasReproducibleSearch: true,
      hasExtractableStudyData: true,
      hasRiskOfBiasAssessment: true,
      hasCertaintyAssessment: true,
      trustworthinessTool: 'AMSTAR 2',
      trustworthinessRating: 'high',
    }],
  };
  const result = await new ReviewLandscapeAgent().execute(contextFor(request));
  const decision = result.artifacts.reviewCommissionDecision as { strategy: string; requiresPrimaryStudySearch: boolean };
  assert.equal(decision.strategy, 'adopt-adapt');
  assert.equal(decision.requiresPrimaryStudySearch, false);
});

test('updates an older but otherwise reusable review', async () => {
  const request: ReviewRequest = {
    ...fixtureRequest,
    existingReviewCandidates: [{
      id: 'review-old',
      title: 'Older direct review',
      publicationYear: 2017,
      lastSearchDate: '2018-01-01',
      questionMatch: 0.95,
      populationMatch: 0.95,
      interventionOrExposureMatch: 0.95,
      outcomeMatch: 0.95,
      hasReproducibleSearch: true,
      hasExtractableStudyData: true,
      hasRiskOfBiasAssessment: true,
      hasCertaintyAssessment: true,
      trustworthinessRating: 'high',
    }],
  };
  const result = await new ReviewLandscapeAgent().execute(contextFor(request));
  const decision = result.artifacts.reviewCommissionDecision as { strategy: string };
  assert.equal(decision.strategy, 'update');
});

test('defaults to de novo when no reusable review is available', async () => {
  const result = await new ReviewLandscapeAgent().execute(contextFor(fixtureRequest));
  const decision = result.artifacts.reviewCommissionDecision as { strategy: string };
  assert.equal(decision.strategy, 'de-novo');
});

test('specialised review synthesis fails safe into a designated adapter', async () => {
  const request: ReviewRequest = { ...fixtureRequest, reviewType: 'diagnostic-accuracy' };
  const state = createPipelineState(request);
  const plan = buildMethodologyPlan(request);
  state.artifacts.reviewPlan = plan;
  const emptyEvidence = { rationale: [], objectives: [], results: [], discussion: [], limitations: [] };
  const studies: ExtractedStudy[] = [{
    studyId: 'dta-study',
    reportIds: ['dta-report'],
    design: 'diagnostic accuracy',
    population: 'participants',
    interventionOrExposure: 'index test',
    comparator: 'reference standard',
    outcomes: [{ name: 'sensitivity', effect: 0.9, standardError: 0.03 }],
    mechanisms: [],
    funding: 'Not reported',
    rationale: 'Diagnostic uncertainty',
    objectives: ['Estimate accuracy'],
    resultsSummary: 'Sensitivity reported',
    discussionSummary: 'Interpretation',
    limitations: ['Threshold variation'],
    sectionEvidence: emptyEvidence,
    fieldEvidence: {},
    sourceQuotes: [],
  }];
  state.artifacts.extractedStudies = studies;
  const result = await new SynthesisAgent().execute({ state, now: () => '2026-07-13T00:00:00.000Z' });
  const synthesis = result.artifacts.synthesis as { status: string; specialistAdapter?: string };
  assert.equal(synthesis.status, 'deferred-specialist');
  assert.equal(synthesis.specialistAdapter, 'bivariate-hsroc-adapter');
});
