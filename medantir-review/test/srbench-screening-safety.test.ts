import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSrScreeningSafetyReport,
  defaultHighRecallScreeningPolicy,
  wilson95,
} from '../src/benchmark/sr-screening-safety.js';

test('perfect high-recall screening passes and still reports finite uncertainty', () => {
  const report = createSrScreeningSafetyReport({
    confusion: { truePositive: 200, falseNegative: 0, trueNegative: 300, falsePositive: 0 },
    projectedCorpusSize: 12_894,
  });
  assert.equal(report.gatePassed, true);
  assert.equal(report.observedSensitivity, 1);
  assert.equal(report.observedFalseNegativeRate, 0);
  assert.equal(report.observedMissedPer1000Candidates, 0);
  assert.ok(report.sensitivityWilson95.lower < 1);
  assert.ok(report.projectedMissedConservative! > 0, 'finite validation samples retain uncertainty even after zero observed misses');
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test('Nature-Medicine-like 500-record screening profile fails the high-recall safety gate despite strong average agreement', () => {
  const report = createSrScreeningSafetyReport({
    confusion: { truePositive: 154, falseNegative: 15, trueNegative: 305, falsePositive: 26 },
    projectedCorpusSize: 12_894,
  });
  assert.equal(report.validationSampleSize, 500);
  assert.equal(report.observedSensitivity.toFixed(3), '0.911');
  assert.equal(report.observedSpecificity.toFixed(3), '0.921');
  assert.equal(report.observedMissedPer1000Candidates, 30);
  assert.ok(Math.abs(report.projectedMissedObserved! - 386.82) < 1e-9);
  assert.equal(report.gatePassed, false);
  assert.ok(report.failures.some((failure) => /Observed sensitivity/i.test(failure)));
  assert.ok(report.failures.some((failure) => /false-negative rate/i.test(failure)));
});

test('a configurable policy can be used for descriptive benchmarking without changing strict SR100 semantics', () => {
  const policy = {
    ...defaultHighRecallScreeningPolicy(),
    policyId: 'DESCRIPTIVE-CALIBRATION',
    minObservedSensitivity: 0.90,
    minSensitivityLower95: 0.85,
    maxObservedFalseNegativeRate: 0.10,
    maxConservativeMissedPer1000: 100,
  };
  const report = createSrScreeningSafetyReport({
    confusion: { truePositive: 154, falseNegative: 15, trueNegative: 305, falsePositive: 26 },
    policy,
  });
  assert.equal(report.gatePassed, true);
  assert.equal(report.policy.policyId, 'DESCRIPTIVE-CALIBRATION');
});

test('Wilson interval and invalid confusion matrices fail deterministically', () => {
  const interval = wilson95(95, 100);
  assert.ok(interval.lower < 0.95 && interval.upper > 0.95);
  assert.throws(() => wilson95(0, 0), /positive denominator/i);
  assert.throws(() => createSrScreeningSafetyReport({
    confusion: { truePositive: 0, falseNegative: 0, trueNegative: 10, falsePositive: 0 },
  }), /gold-positive validation record/i);
  assert.throws(() => createSrScreeningSafetyReport({
    confusion: { truePositive: 1.5, falseNegative: 0, trueNegative: 10, falsePositive: 0 },
  }), /truePositive must be a non-negative integer/i);
});
