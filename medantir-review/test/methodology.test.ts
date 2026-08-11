import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMethodologyPlan, supportedReviewTypes } from '../src/protocols/methodology.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { fixtureRequest } from '../src/fixtures.js';

for (const reviewType of supportedReviewTypes) {
  test(`builds a methodology profile for ${reviewType}`, () => {
    const plan = buildMethodologyPlan({ ...fixtureRequest, reviewType });
    assert.equal(plan.reviewType, reviewType);
    assert.ok(plan.reportingStandards.length > 0);
    assert.ok(plan.protocolStandards.length > 0);
    assert.ok(plan.searchStandards.length > 0);
    assert.ok(plan.requiredModules.includes('human-verification'));
    assert.ok(plan.eligibility.include.length > 0);
  });
}

test('scoping review omits risk-of-bias and certainty stages', () => {
  const protocol = createReviewProtocol('scoping');
  assert.equal(protocol.stages.some((stage) => stage.stage === 'risk-of-bias'), false);
  assert.equal(protocol.stages.some((stage) => stage.stage === 'grade'), false);
});

test('diagnostic accuracy uses PIRD, QUADAS, and specialist synthesis', () => {
  const plan = buildMethodologyPlan({ ...fixtureRequest, reviewType: 'diagnostic-accuracy' });
  assert.equal(plan.questionFramework, 'PIRD');
  assert.ok(plan.appraisalTools.some((tool) => tool.includes('QUADAS')));
  assert.equal(plan.synthesisMode, 'diagnostic-meta-analysis');
  assert.equal(plan.certaintyFramework, 'GRADE-DTA');
});

test('qualitative evidence synthesis uses CERQual rather than intervention GRADE', () => {
  const plan = buildMethodologyPlan({ ...fixtureRequest, reviewType: 'qualitative' });
  assert.equal(plan.synthesisMode, 'qualitative');
  assert.equal(plan.certaintyFramework, 'GRADE-CERQual');
});

test('every review protocol includes the existing-review landscape decision', () => {
  for (const reviewType of supportedReviewTypes) {
    assert.ok(createReviewProtocol(reviewType).stages.some((stage) => stage.stage === 'review-landscape'));
  }
});
