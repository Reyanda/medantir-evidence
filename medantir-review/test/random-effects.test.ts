import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseRandomEffects,
  analyseRandomEffectsSensitivity,
  estimateTauSquaredDL,
  estimateTauSquaredPM,
  estimateTauSquaredREML,
  studentTCdf,
  studentTQuantile,
} from '../src/synthesis/random-effects.js';
import type { AnalysisEstimate } from '../src/synthesis/inverse-variance.js';

const estimates: AnalysisEstimate[] = [
  { studyId: 's1', label: 'Study 1', outcome: 'outcome', effect: 0.10, standardError: 0.10, provenanceIds: ['p1'] },
  { studyId: 's2', label: 'Study 2', outcome: 'outcome', effect: 0.30, standardError: 0.15, provenanceIds: ['p2'] },
  { studyId: 's3', label: 'Study 3', outcome: 'outcome', effect: -0.05, standardError: 0.08, provenanceIds: ['p3'] },
  { studyId: 's4', label: 'Study 4', outcome: 'outcome', effect: 0.50, standardError: 0.20, provenanceIds: ['p4'] },
  { studyId: 's5', label: 'Study 5', outcome: 'outcome', effect: 0.20, standardError: 0.12, provenanceIds: ['p5'] },
];

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected} (tol=${tolerance})`);
}

test('Student-t implementation reproduces standard 97.5% critical values', () => {
  close(studentTQuantile(0.975, 1), 12.706204736174694, 2e-9);
  close(studentTQuantile(0.975, 2), 4.302652729749462, 2e-10);
  close(studentTQuantile(0.975, 4), 2.7764451051977934, 2e-10);
  close(studentTQuantile(0.975, 9), 2.262157162798205, 2e-10);
  close(studentTQuantile(0.975, 30), 2.0422724563012378, 2e-10);
  close(studentTCdf(2.7764451051977934, 4), 0.975, 2e-11);
});

test('DL, Paule-Mandel and REML tau² match independent numerical references', () => {
  close(estimateTauSquaredDL(estimates), 0.02065035779382974, 1e-12);
  close(estimateTauSquaredPM(estimates), 0.022126484930655173, 5e-11);
  close(estimateTauSquaredREML(estimates), 0.02051345559890044, 2e-8);
});

test('REML Wald summary matches independently optimized reference', () => {
  const result = analyseRandomEffects(estimates, {
    tauEstimator: 'REML',
    confidenceMethod: 'wald',
    predictionInterval: true,
  });
  close(result.pooledEffect, 0.16180662332645013, 2e-8);
  close(result.pooledStandardError, 0.0850195667893236, 2e-8);
  close(result.confidenceInterval[0], -0.004828665561817214, 3e-8);
  close(result.confidenceInterval[1], 0.32844191221471747, 3e-8);
  close(result.cochranQ, 9.973320640499901, 1e-10);
  close(result.qBasedI2, 59.892997085076125, 1e-9);
  close(result.typicalWithinStudyVariance, 0.013828393978262335, 1e-12);
  close(result.tauBasedI2, 59.733112373020894, 2e-5);
  assert.equal(result.k, 5);
  assert.equal(result.contributions.length, 5);
  close(result.contributions.reduce((total, item) => total + item.normalizedWeight, 0), 1, 1e-12);
});

test('REML HKSJ summary uses k-1 t distribution and variance rescaling', () => {
  const result = analyseRandomEffects(estimates, {
    tauEstimator: 'REML',
    confidenceMethod: 'hksj',
    predictionInterval: true,
  });
  close(result.hksjVarianceScale ?? NaN, 1.041983167257176, 2e-8);
  close(result.pooledStandardError, 0.08678591353114341, 2e-8);
  close(result.confidenceInterval[0], -0.07914970149721196, 3e-8);
  close(result.confidenceInterval[1], 0.4027629481501122, 3e-8);
  assert.equal(result.predictionDegreesOfFreedom, 4);
  close(result.predictionInterval?.[0] ?? NaN, -0.3031567592048283, 4e-8);
  close(result.predictionInterval?.[1] ?? NaN, 0.6267700058577286, 4e-8);
});

test('Paule-Mandel solves Q(tau²)=k-1 so HKSJ scale is one', () => {
  const result = analyseRandomEffects(estimates, {
    tauEstimator: 'PM',
    confidenceMethod: 'hksj',
  });
  close(result.hksjVarianceScale ?? NaN, 1, 5e-10);
  close(result.pooledEffect, 0.16360245713519111, 2e-8);
});

test('sensitivity set always compares REML, PM, DL and Wald/HKSJ choices', () => {
  const result = analyseRandomEffectsSensitivity(estimates);
  assert.equal(result.primary.tauEstimator, 'REML');
  assert.equal(result.primary.confidenceMethod, 'wald');
  assert.equal(result.sensitivity.length, 5);
  assert.deepEqual(new Set([result.primary, ...result.sensitivity].map((item) => item.tauEstimator)), new Set(['REML', 'PM', 'DL']));
  assert.deepEqual(new Set([result.primary, ...result.sensitivity].map((item) => item.confidenceMethod)), new Set(['wald', 'hksj']));
  assert.ok(result.methodAgreement.tauSquaredRange[1] > result.methodAgreement.tauSquaredRange[0]);
});

test('dependent estimates from the same study are refused rather than treated as independent', () => {
  assert.throws(() => analyseRandomEffects([
    estimates[0]!,
    { ...estimates[1]!, studyId: estimates[0]!.studyId },
  ]), /Dependent\/duplicate study estimate/);
});

test('prediction interval is withheld with fewer than three studies', () => {
  const result = analyseRandomEffects(estimates.slice(0, 2), { tauEstimator: 'REML', confidenceMethod: 'hksj' });
  assert.equal(result.predictionInterval, undefined);
  assert.ok(result.warnings.some((warning) => /fewer than three studies/i.test(warning)));
});

test('homogeneous data can estimate tau²=0 without numerical instability', () => {
  const homogeneous: AnalysisEstimate[] = [
    { studyId: 'h1', label: 'H1', outcome: 'o', effect: 0.2, standardError: 0.1, provenanceIds: [] },
    { studyId: 'h2', label: 'H2', outcome: 'o', effect: 0.21, standardError: 0.1, provenanceIds: [] },
    { studyId: 'h3', label: 'H3', outcome: 'o', effect: 0.19, standardError: 0.1, provenanceIds: [] },
  ];
  close(estimateTauSquaredDL(homogeneous), 0, 1e-15);
  close(estimateTauSquaredPM(homogeneous), 0, 1e-15);
  close(estimateTauSquaredREML(homogeneous), 0, 1e-10);
  const hksj = analyseRandomEffects(homogeneous, { confidenceMethod: 'hksj' });
  assert.ok(hksj.warnings.some((warning) => /tau²=0/i.test(warning)));
});
