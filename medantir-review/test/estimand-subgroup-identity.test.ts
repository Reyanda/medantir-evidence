import test from 'node:test';
import assert from 'node:assert/strict';
import { stableHash } from '../src/core/utils.js';
import { compareEstimands, type CanonicalEstimand } from '../src/agents/estimand-identity.js';

function subgroupEstimand(label?: string): CanonicalEstimand {
  const value: CanonicalEstimand = {
    estimandId: '',
    outcome: 'mortality',
    effectMeasure: 'RR',
    analysisScale: 'log',
    interventionOrExposure: 'treatment',
    comparator: 'placebo',
    population: 'hospitalized adults',
    timeHorizon: { status: 'resolved', value: '28-day', evidence: ['day 28'] },
    analysisPopulation: { status: 'resolved', value: 'intention-to-treat', evidence: ['ITT'] },
    subgroup: { status: 'resolved', value: 'subgroup', ...(label ? { label } : {}), evidence: label ? [label] : [] },
    adjustment: { status: 'resolved', value: 'unadjusted', evidence: ['unadjusted'] },
    effectTarget: { status: 'resolved', value: 'total-effect', evidence: ['total effect'] },
    source: { recordId: 'report', studyId: 'study', tableId: 'table', page: 7 },
    unresolvedDimensions: label ? [] : ['subgroupLabel'],
  };
  // Fixture IDs only need to differ consistently with the label for this direct
  // comparison test; extraction-level fingerprint parity is covered elsewhere.
  value.estimandId = `fixture-${stableHash({ label: label ?? null }).slice(0, 12)}`;
  return value;
}

test('two explicitly different subgroup labels compare as different estimands', () => {
  const older = subgroupEstimand('Subgroup: age 65 years or older');
  const younger = subgroupEstimand('Subgroup: age younger than 65 years');
  const comparison = compareEstimands(older, younger);

  assert.equal(comparison.relationship, 'different');
  assert.ok(comparison.differingDimensions.includes('subgroupLabel'));
});

test('missing subgroup label leaves subgroup estimand relationship unresolved rather than guessed', () => {
  const labeled = subgroupEstimand('Subgroup: women');
  const unlabeled = subgroupEstimand();
  const comparison = compareEstimands(labeled, unlabeled);

  assert.equal(comparison.relationship, 'unresolved');
  assert.ok(comparison.unresolvedDimensions.includes('subgroupLabel'));
});
