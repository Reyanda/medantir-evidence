import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBinaryEffect,
  deriveContinuousEffect,
  deriveEffectFromConfidenceInterval,
} from '../src/synthesis/effect-measures.js';

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

test('raw binary table produces log RR with auditable derivation', () => {
  const result = deriveBinaryEffect({
    measure: 'RR',
    interventionEvents: 10,
    interventionTotal: 100,
    comparatorEvents: 20,
    comparatorTotal: 120,
  });
  assert.equal(result.analysisScale, 'log');
  close(result.effect, -0.5108256237659907);
  close(result.standardError, 0.362859017617954);
  close(result.displayEffect, 0.6);
  assert.equal(result.derivation.continuityCorrectionApplied, undefined);
  assert.equal(result.derivation.inputHash.length, 64);
});

test('raw binary table produces log OR and risk difference on correct scales', () => {
  const or = deriveBinaryEffect({
    measure: 'OR',
    interventionEvents: 10,
    interventionTotal: 100,
    comparatorEvents: 20,
    comparatorTotal: 120,
  });
  close(or.effect, -0.587786664902119, 1e-12);
  close(or.standardError, 0.4123105625617661, 1e-12);
  close(or.displayEffect, 0.5555555555555556, 1e-12);

  const rd = deriveBinaryEffect({
    measure: 'RD',
    interventionEvents: 10,
    interventionTotal: 100,
    comparatorEvents: 20,
    comparatorTotal: 120,
  });
  assert.equal(rd.analysisScale, 'identity');
  close(rd.effect, -0.06666666666666665, 1e-15);
  close(rd.standardError, 0.04626788104883269, 1e-12);
});

test('zero-cell RR/OR require an explicit correction policy rather than hidden arithmetic', () => {
  assert.throws(() => deriveBinaryEffect({
    measure: 'RR', interventionEvents: 0, interventionTotal: 50, comparatorEvents: 4, comparatorTotal: 50,
  }), /zero event arm/);
  assert.throws(() => deriveBinaryEffect({
    measure: 'OR', interventionEvents: 0, interventionTotal: 50, comparatorEvents: 4, comparatorTotal: 50,
  }), /zero 2x2 cell/);

  const corrected = deriveBinaryEffect({
    measure: 'OR',
    interventionEvents: 0,
    interventionTotal: 50,
    comparatorEvents: 4,
    comparatorTotal: 50,
    continuityCorrection: 'constant-0.5-if-any-zero',
  });
  assert.equal(corrected.derivation.continuityCorrectionApplied, 0.5);
  assert.ok(Number.isFinite(corrected.effect));
  assert.ok(corrected.standardError > 0);
});

test('mean difference matches independent-group standard error', () => {
  const result = deriveContinuousEffect({
    measure: 'MD',
    interventionMean: 12,
    interventionSd: 4,
    interventionN: 50,
    comparatorMean: 10,
    comparatorSd: 3,
    comparatorN: 60,
  });
  close(result.effect, 2);
  close(result.standardError, 0.6855654600401044, 1e-12);
  assert.equal(result.analysisScale, 'identity');
});

test('SMD uses exact Hedges small-sample correction and records intermediate quantities', () => {
  const result = deriveContinuousEffect({
    measure: 'SMD',
    interventionMean: 12,
    interventionSd: 4,
    interventionN: 50,
    comparatorMean: 10,
    comparatorSd: 3,
    comparatorN: 60,
  });
  close(result.effect, 0.5637433337661273, 2e-12);
  close(result.standardError, 0.19442282381002551, 2e-12);
  assert.match(result.derivation.method, /Hedges g/);
  assert.ok(Number(result.derivation.inputs.hedgesCorrection) < 1);
  assert.ok(Number(result.derivation.inputs.pooledSd) > 0);
});

test('reported ratio and 95% CI are converted to log scale before SE derivation', () => {
  const result = deriveEffectFromConfidenceInterval({
    measure: 'HR',
    reportedEffect: 0.75,
    confidenceLow: 0.60,
    confidenceHigh: 0.94,
  });
  close(result.effect, Math.log(0.75), 1e-14);
  close(result.standardError, (Math.log(0.94) - Math.log(0.60)) / (2 * 1.959963984540054), 1e-14);
  close(result.displayEffect, 0.75, 1e-14);
  assert.equal(result.analysisScale, 'log');
});

test('CI derivation rejects invalid ratio limits and non-95% shortcuts', () => {
  assert.throws(() => deriveEffectFromConfidenceInterval({
    measure: 'RR', reportedEffect: 1, confidenceLow: 0, confidenceHigh: 2,
  }), /must be > 0/);
  assert.throws(() => deriveEffectFromConfidenceInterval({
    measure: 'MD', reportedEffect: 1, confidenceLow: 0, confidenceHigh: 2, confidenceLevel: 0.9 as never,
  }), /Only 95%/);
});

test('input validation rejects impossible event totals and undersized continuous groups', () => {
  assert.throws(() => deriveBinaryEffect({
    measure: 'RR', interventionEvents: 51, interventionTotal: 50, comparatorEvents: 4, comparatorTotal: 50,
  }), /cannot exceed/);
  assert.throws(() => deriveContinuousEffect({
    measure: 'MD', interventionMean: 1, interventionSd: 1, interventionN: 1, comparatorMean: 0, comparatorSd: 1, comparatorN: 10,
  }), /at least two/);
});
