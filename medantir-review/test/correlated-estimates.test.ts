import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseCorrelatedStudyBlock,
  sharedComparatorCovariance,
  twoContrastSharedComparatorCovarianceMatrix,
} from '../src/synthesis/correlated-estimates.js';
import type { CorrelatedStudyEstimate } from '../src/synthesis/correlated-estimates.js';

function close(actual: number, expected: number, tolerance = 1e-11) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

test('shared comparator covariance for log RR is derived from the control arm', () => {
  const covariance = sharedComparatorCovariance({ measure: 'RR', comparatorEvents: 20, comparatorTotal: 100 });
  close(covariance, 0.04, 1e-15);
});

test('two correlated shared-control log-RR contrasts collapse by GLS rather than naïve independence', () => {
  const covariance = sharedComparatorCovariance({ measure: 'RR', comparatorEvents: 20, comparatorTotal: 100 });
  const firstVariance = (1 / 10) - (1 / 80) + (1 / 20) - (1 / 100);
  const secondVariance = (1 / 15) - (1 / 90) + (1 / 20) - (1 / 100);
  const firstEffect = Math.log((10 / 80) / (20 / 100));
  const secondEffect = Math.log((15 / 90) / (20 / 100));
  const estimates: CorrelatedStudyEstimate[] = [
    {
      studyId: 'multiarm-1', contrastId: 'arm-a-v-control', label: 'Multi-arm trial', outcome: 'mortality',
      effect: firstEffect, standardError: Math.sqrt(firstVariance), provenanceIds: ['arm-a', 'control'],
    },
    {
      studyId: 'multiarm-1', contrastId: 'arm-b-v-control', label: 'Multi-arm trial', outcome: 'mortality',
      effect: secondEffect, standardError: Math.sqrt(secondVariance), provenanceIds: ['arm-b', 'control'],
    },
  ];
  const matrix = twoContrastSharedComparatorCovarianceMatrix({ firstVariance, secondVariance, sharedCovariance: covariance });
  const collapsed = collapseCorrelatedStudyBlock({
    studyId: 'multiarm-1',
    estimates,
    covariance: matrix,
    estimandCompatibilityReceipt: 'estimand-compatibility-verified-001',
  });

  // Independent closed-form 2x2 GLS reference. For V=[[a,c],[c,b]],
  // mu=((b-c)y1+(a-c)y2)/(a+b-2c) and Var(mu)=(ab-c²)/(a+b-2c).
  const determinant = firstVariance * secondVariance - covariance ** 2;
  const denominator = firstVariance + secondVariance - 2 * covariance;
  const closedFormEffect = (
    (secondVariance - covariance) * firstEffect
    + (firstVariance - covariance) * secondEffect
  ) / denominator;
  const closedFormVariance = determinant / denominator;
  const closedFormInformation = 1 / closedFormVariance;

  close(collapsed.effect, closedFormEffect, 2e-12);
  close(collapsed.standardError, Math.sqrt(closedFormVariance), 2e-12);
  close(collapsed.withinStudyInformation, closedFormInformation, 2e-10);
  close(collapsed.effect, -0.29404274997911234, 2e-12);
  close(collapsed.standardError, 0.27199371780295195, 2e-12);
  close(collapsed.withinStudyInformation, 13.517060367454068, 2e-10);
  assert.deepEqual(collapsed.sourceContrastIds, ['arm-a-v-control', 'arm-b-v-control']);
  assert.ok(collapsed.provenanceIds.includes('estimand-compatibility-verified-001'));

  const naiveWeight1 = 1 / firstVariance;
  const naiveWeight2 = 1 / secondVariance;
  const naiveSe = Math.sqrt(1 / (naiveWeight1 + naiveWeight2));
  assert.ok(collapsed.standardError > naiveSe, 'shared-control dependence must reduce information relative to naïve independence');
});

test('shared comparator formulas cover OR, RD, and MD on their analysis scales', () => {
  close(sharedComparatorCovariance({ measure: 'OR', comparatorEvents: 20, comparatorTotal: 100 }), 1 / 20 + 1 / 80, 1e-15);
  close(sharedComparatorCovariance({ measure: 'RD', comparatorEvents: 20, comparatorTotal: 100 }), 0.2 * 0.8 / 100, 1e-15);
  close(sharedComparatorCovariance({ measure: 'MD', comparatorSd: 4, comparatorN: 64 }), 0.25, 1e-15);
});

test('covariance-aware collapse requires explicit estimand compatibility and consistent study identity', () => {
  const estimate: CorrelatedStudyEstimate = {
    studyId: 's', contrastId: 'c1', label: 'S', outcome: 'o', effect: 0.1, standardError: 0.2, provenanceIds: [],
  };
  const second = { ...estimate, contrastId: 'c2', effect: 0.2 };
  assert.throws(() => collapseCorrelatedStudyBlock({
    studyId: 's', estimates: [estimate, second], covariance: [[0.04, 0], [0, 0.04]], estimandCompatibilityReceipt: '',
  }), /compatibility receipt/);
  assert.throws(() => collapseCorrelatedStudyBlock({
    studyId: 's', estimates: [estimate, { ...second, studyId: 'other' }], covariance: [[0.04, 0], [0, 0.04]], estimandCompatibilityReceipt: 'ok',
  }), /block studyId/);
});

test('invalid/singular covariance matrices fail closed', () => {
  const a: CorrelatedStudyEstimate = { studyId: 's', contrastId: 'a', label: 'S', outcome: 'o', effect: 0.1, standardError: 0.2, provenanceIds: [] };
  const b: CorrelatedStudyEstimate = { ...a, contrastId: 'b', effect: 0.2 };
  assert.throws(() => collapseCorrelatedStudyBlock({
    studyId: 's', estimates: [a, b], covariance: [[0.04, 0.04], [0.04, 0.04]], estimandCompatibilityReceipt: 'ok',
  }), /positive definite/);
  assert.throws(() => twoContrastSharedComparatorCovarianceMatrix({ firstVariance: 0.04, secondVariance: 0.04, sharedCovariance: 0.04 }), /singular or invalid/);
});
