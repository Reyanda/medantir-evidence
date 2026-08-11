import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSrReliabilityEvidenceReport,
  exactZeroFailureReliabilityLowerBound,
  zeroFailureTrialsRequired,
} from '../src/benchmark/sr-reliability-evidence.js';

test('nine perfect independent trials are still weak evidence for unknown true reliability', () => {
  const lower = exactZeroFailureReliabilityLowerBound({ trials: 9, confidenceLevel: 0.95 });
  assert.ok(lower > 0.716 && lower < 0.718);
});

test('95% one-sided confidence requires 29 zero-failure trials for 90% reliability and 59 for 95%', () => {
  assert.equal(zeroFailureTrialsRequired({ targetReliability: 0.90, confidenceLevel: 0.95 }), 29);
  assert.equal(zeroFailureTrialsRequired({ targetReliability: 0.95, confidenceLevel: 0.95 }), 59);
  assert.equal(zeroFailureTrialsRequired({ targetReliability: 0.99, confidenceLevel: 0.95 }), 299);
});

test('default evidence policy labels two perfect prospective reviews as validated but not high-confidence', () => {
  const report = createSrReliabilityEvidenceReport({
    requestedModel: 'model-a',
    independentProspectiveTrials: 2,
    perfectTrials: 2,
  });
  assert.equal(report.tier, 'prospective-validated');
  assert.equal(report.futureTargetMet, false);
  assert.equal(report.livingTargetMet, false);
  assert.equal(report.zeroFailureTrialsRequiredForFutureTarget, 29);
  assert.equal(report.zeroFailureTrialsRequiredForLivingTarget, 59);
});

test('29 perfect prospective reviews meet future-review reliability target but not living target', () => {
  const report = createSrReliabilityEvidenceReport({
    requestedModel: 'model-a',
    independentProspectiveTrials: 29,
    perfectTrials: 29,
  });
  assert.equal(report.futureTargetMet, true);
  assert.equal(report.livingTargetMet, false);
  assert.equal(report.tier, 'high-confidence-future');
});

test('59 perfect prospective reviews meet the default living-review reliability target', () => {
  const report = createSrReliabilityEvidenceReport({
    requestedModel: 'model-a',
    independentProspectiveTrials: 59,
    perfectTrials: 59,
  });
  assert.equal(report.futureTargetMet, true);
  assert.equal(report.livingTargetMet, true);
  assert.equal(report.tier, 'high-confidence-living');
  assert.ok(report.exactZeroFailureLowerBound >= 0.95);
});

test('one prospective review failure is not averaged away in v1 high-confidence evidence', () => {
  const report = createSrReliabilityEvidenceReport({
    requestedModel: 'model-a',
    independentProspectiveTrials: 59,
    perfectTrials: 58,
  });
  assert.equal(report.failures, 1);
  assert.equal(report.exactZeroFailureLowerBound, 0);
  assert.equal(report.futureTargetMet, false);
  assert.equal(report.livingTargetMet, false);
  assert.equal(report.tier, 'insufficient');
});
