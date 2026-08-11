import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustBinaryEffectiveCounts,
  adjustUnclusteredStandardError,
  deriveClusterAdjustment,
  requireClusterAdjustment,
} from '../src/synthesis/cluster-adjustment.js';

function close(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

const icc = {
  icc: 0.02,
  sourceId: 'trial-report-table-icc',
  rationale: 'ICC reported for the primary outcome in the trial methods.',
  sourceType: 'study-reported' as const,
};

test('equal-cluster design effect and effective sample size are deterministic', () => {
  const result = deriveClusterAdjustment({ clusters: 20, participants: 400, icc });
  close(result.meanClusterSize, 20);
  close(result.designEffect, 1.38);
  close(result.effectiveSampleSize, 400 / 1.38);
  assert.equal(result.method, 'equal-cluster-size-design-effect');
  assert.equal(result.iccSourceId, 'trial-report-table-icc');
  assert.equal(result.inputHash.length, 64);
});

test('cluster-size CV increases the design effect when cluster sizes vary', () => {
  const equal = deriveClusterAdjustment({ clusters: 20, participants: 400, icc });
  const varied = deriveClusterAdjustment({ clusters: 20, participants: 400, icc, clusterSizeCv: 0.5 });
  assert.ok(varied.designEffect > equal.designEffect);
  close(varied.designEffect, 1 + (((1.25 * 20) - 1) * 0.02));
  assert.equal(varied.method, 'cv-adjusted-design-effect');
});

test('unadjusted individual-level SE is inflated by sqrt(design effect)', () => {
  const adjusted = adjustUnclusteredStandardError({
    standardError: 0.10,
    design: { clusters: 20, participants: 400, icc },
  });
  close(adjusted.varianceInflation, 1.38);
  close(adjusted.standardError, 0.10 * Math.sqrt(1.38));
});

test('binary effective counts divide both events and participants by design effect', () => {
  const adjusted = adjustBinaryEffectiveCounts({
    events: 40,
    participants: 400,
    design: { clusters: 20, participants: 400, icc },
  });
  close(adjusted.effectiveParticipants, 400 / 1.38);
  close(adjusted.effectiveEvents, 40 / 1.38);
});

test('cluster-randomized evidence without adjustment is blocked from synthesis', () => {
  assert.throws(() => requireClusterAdjustment({
    isClusterRandomized: true,
    effectAlreadyClusterAdjusted: false,
  }), /cannot enter synthesis/);
  assert.doesNotThrow(() => requireClusterAdjustment({
    isClusterRandomized: true,
    effectAlreadyClusterAdjusted: true,
  }));
  const adjustment = deriveClusterAdjustment({ clusters: 20, participants: 400, icc });
  assert.doesNotThrow(() => requireClusterAdjustment({
    isClusterRandomized: true,
    effectAlreadyClusterAdjusted: false,
    adjustment,
  }));
});

test('ICC cannot be silently imputed without a source receipt', () => {
  assert.throws(() => deriveClusterAdjustment({
    clusters: 20,
    participants: 400,
    icc: { icc: 0.02, sourceId: '', rationale: 'guessed', sourceType: 'external-empirical' },
  }), /sourceId/);
  assert.throws(() => deriveClusterAdjustment({
    clusters: 20,
    participants: 400,
    icc: { icc: 1.2, sourceId: 'x', rationale: 'bad', sourceType: 'study-reported' },
  }), /ICC must be within/);
});
