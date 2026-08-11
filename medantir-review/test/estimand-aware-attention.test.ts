import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { assessSectionEligibility } from '../src/agents/section-aware-eligibility.js';
import { recomputeCanonicalEstimandId } from '../src/agents/estimand-fingerprint.js';
import type { CanonicalEstimand } from '../src/agents/estimand-identity.js';
import type { ParsedDocument, ReviewRequest } from '../src/core/types.js';
import { EstimandAwareReviewAttentionObserver } from '../src/cognitive/estimand-aware-attention.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  humanVerification: { enabled: false },
  question: {
    title: 'Baricitinib plus remdesivir for hospitalized adults with COVID-19',
    objective: 'Evaluate clinical outcomes of combination treatment.',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    outcomes: ['time to recovery'],
  },
};

function estimand(): CanonicalEstimand {
  const value: CanonicalEstimand = {
    estimandId: '',
    outcome: 'time to recovery',
    effectMeasure: 'RR',
    analysisScale: 'log',
    interventionOrExposure: 'baricitinib plus remdesivir',
    comparator: 'placebo plus remdesivir',
    population: 'hospitalized adults with covid 19',
    timeHorizon: { status: 'unspecified', evidence: [] },
    analysisPopulation: { status: 'resolved', value: 'intention-to-treat', evidence: ['ITT'] },
    subgroup: { status: 'unspecified', evidence: [] },
    adjustment: { status: 'resolved', value: 'unadjusted', evidence: ['Unadjusted RR'] },
    effectTarget: { status: 'unspecified', evidence: [] },
    source: { recordId: 'actt2', studyId: 'study-actt2', tableId: 'table-1', page: 7 },
    unresolvedDimensions: ['timeHorizon', 'subgroup', 'effectTarget'],
  };
  value.estimandId = recomputeCanonicalEstimandId(value);
  return value;
}

function eligibleDocument(): ParsedDocument {
  const methods = 'A total of 1033 participants were randomized to baricitinib plus remdesivir or placebo plus remdesivir. Participants were followed for 29 days. Plasma samples were measured by chromatography.';
  const results = 'Patients receiving baricitinib plus remdesivir had a median time to recovery of 7 days compared with 8 days for placebo plus remdesivir. Baseline characteristics and adverse events were reported for both randomized groups.';
  return {
    recordId: 'actt2',
    text: 'Randomized clinical trial of hospitalized patients. Plasma assays were also performed.',
    pages: [{ page: 1, text: `${methods}\n${results}` }],
    sections: [
      { name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: methods },
      { name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: results },
    ],
    extractionMethod: 'native',
  };
}

test('unresolved provenance-valid estimand dimensions become VERIFY debt even without interactive human verification', () => {
  const state = createPipelineState(request);
  const included = eligibleDocument();
  const eligibility = assessSectionEligibility(included, request);
  assert.ok(eligibility.clinicalStudyAnchors.length > 0);
  assert.deepEqual(eligibility.missingInterventionGroups, []);
  assert.equal(eligibility.comparatorEstablished, true);
  assert.equal(eligibility.requestedDesignEstablished, true);
  assert.ok(eligibility.linkedProtocolOutcomes.includes('time to recovery'));

  state.artifacts.parsedDocuments = [included];
  state.artifacts.includedDocuments = [included];
  state.artifacts.extractedStudies = [{ studyId: 'study-actt2' }];
  state.artifacts.estimandLedger = [{
    studyId: 'study-actt2',
    recordId: 'actt2',
    outcome: 'time to recovery',
    status: 'identified',
    estimand: estimand(),
  }];

  const decision = new EstimandAwareReviewAttentionObserver().assess({
    state,
    stage: 'extract',
    attempt: 1,
    result: { artifacts: {} },
    validation: { ok: true, issues: [] },
    warnings: [],
    requiredArtifacts: [],
    producedArtifacts: [],
  });

  assert.equal(decision.action, 'VERIFY');
  assert.ok(decision.reasons.some((reason) => /unresolved target dimensions/i.test(reason)));
  assert.ok(decision.reasons.some((reason) => /timeHorizon/i.test(reason)));
  assert.ok(decision.metrics.methodDrift > 0);
});

test('replayed human estimand amendments are visible in cognitive reasons', () => {
  const state = createPipelineState({
    reviewType: 'systematic',
    databases: ['pubmed'],
    question: { title: 'Treatment review', objective: 'Evaluate treatment.' },
  });
  state.artifacts.includedDocuments = [];
  state.artifacts.extractedStudies = [];
  state.artifacts.estimandLedger = [];
  state.artifacts.estimandHumanAdjudications = [{ itemId: 'estimand:1' }];

  const decision = new EstimandAwareReviewAttentionObserver().assess({
    state,
    stage: 'extract',
    attempt: 1,
    result: { artifacts: {} },
    validation: { ok: true, issues: [] },
    warnings: [],
    requiredArtifacts: [],
    producedArtifacts: [],
  });

  assert.ok(decision.reasons.some((reason) => /human estimand amendment/i.test(reason)));
});
