import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReviewSpec } from '../src/question/review-spec.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { TrialRegistryMetadata } from '../src/core/trial-registry-metadata.js';
import { assessRegistrySourceEligibility } from '../src/certainty/registry-source-eligibility.js';

function spec() {
  const request = {
    ...fixtureRequest,
    question: {
      ...fixtureRequest.question,
      population: 'Severe acute malnutrition',
      interventionOrExposure: 'Therapeutic food A',
      comparator: 'Control',
      outcomes: ['Mortality'],
      studyDesigns: ['randomised controlled trial'],
    },
  };
  const compilation = compileReviewSpec(request, { now: '2026-08-11T10:00:00.000Z' });
  assert.equal(compilation.status, 'complete');
  return compilation.spec;
}

function metadata(overrides: Partial<TrialRegistryMetadata> = {}): TrialRegistryMetadata {
  return {
    source: 'clinicaltrials.gov', registryId: 'NCT01234567', overallStatus: 'COMPLETED', hasPostedResults: false,
    conditions: ['Severe acute malnutrition'], keywords: ['SAM'],
    design: { studyType: 'INTERVENTIONAL', phases: ['PHASE3'], allocation: 'RANDOMIZED', interventionModel: 'PARALLEL' },
    eligibility: { minimumAge: '6 Months', maximumAge: '59 Months', standardAges: ['CHILD'] },
    arms: [
      { label: 'Treatment', type: 'EXPERIMENTAL', interventionNames: ['Drug: Therapeutic food A'] },
      { label: 'Control', type: 'ACTIVE_COMPARATOR', interventionNames: ['Drug: Standard therapeutic food'] },
    ],
    interventions: [
      { type: 'DRUG', name: 'Therapeutic food A', otherNames: [], armGroupLabels: ['Treatment'] },
      { type: 'DRUG', name: 'Standard therapeutic food', otherNames: [], armGroupLabels: ['Control'] },
    ],
    primaryOutcomes: [{ measure: 'Mortality' }], secondaryOutcomes: [], reportedOutcomes: [],
    sourceSchema: 'clinicaltrials.gov-api-v2',
    ...overrides,
  };
}

test('exact structured PICOD match may auto-classify registry trial as eligible', () => {
  const assessment = assessRegistrySourceEligibility({ reviewSpec: spec(), metadata: metadata(), outcome: 'Mortality' });
  assert.equal(assessment.eligibilityStatus, 'eligible');
  assert.equal(assessment.exactMatchCount, 5);
  assert.deepEqual(assessment.unresolvedFacets, []);
  assert.deepEqual(assessment.contradictedFacets, []);
  assert.equal(assessment.assessmentHash.length, 64);
});

test('explicit observational/non-randomized structure safely contradicts RCT-only eligibility', () => {
  const assessment = assessRegistrySourceEligibility({
    reviewSpec: spec(),
    metadata: metadata({ design: { studyType: 'OBSERVATIONAL', phases: [], allocation: 'NA' } }),
    outcome: 'Mortality',
  });
  assert.equal(assessment.eligibilityStatus, 'ineligible');
  assert.ok(assessment.contradictedFacets.includes('design'));
});

test('non-exact population and outcome wording remain unresolved rather than becoming false exclusion', () => {
  const assessment = assessRegistrySourceEligibility({
    reviewSpec: spec(),
    metadata: metadata({
      conditions: ['Children with severe malnutrition'],
      primaryOutcomes: [{ measure: 'All-cause death' }],
    }),
    outcome: 'Mortality',
  });
  assert.equal(assessment.eligibilityStatus, 'unresolved');
  assert.ok(assessment.unresolvedFacets.includes('population'));
  assert.ok(assessment.unresolvedFacets.includes('outcome'));
  assert.equal(assessment.contradictedFacets.length, 0);
});

test('intervention found only in comparator arm cannot satisfy intervention facet', () => {
  const assessment = assessRegistrySourceEligibility({
    reviewSpec: spec(),
    metadata: metadata({
      arms: [
        { label: 'Experimental', type: 'EXPERIMENTAL', interventionNames: ['Drug: Other therapy'] },
        { label: 'Control', type: 'ACTIVE_COMPARATOR', interventionNames: ['Drug: Therapeutic food A'] },
      ],
      interventions: [
        { type: 'DRUG', name: 'Other therapy', otherNames: [], armGroupLabels: ['Experimental'] },
        { type: 'DRUG', name: 'Therapeutic food A', otherNames: [], armGroupLabels: ['Control'] },
      ],
    }),
    outcome: 'Mortality',
  });
  assert.equal(assessment.eligibilityStatus, 'unresolved');
  assert.ok(assessment.unresolvedFacets.includes('intervention'));
});
