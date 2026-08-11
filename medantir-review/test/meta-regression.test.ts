import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseMetaRegression,
  estimateMetaRegressionTauSquaredREML,
  type MetaRegressionEstimate,
} from '../src/synthesis/meta-regression.js';

const estimates: MetaRegressionEstimate[] = [
  [0.10,0.10,0.0],[0.14,0.11,0.5],[0.18,0.09,1.0],[0.22,0.12,1.5],
  [0.27,0.10,2.0],[0.31,0.13,2.5],[0.36,0.11,3.0],[0.42,0.12,3.5],
  [0.45,0.10,4.0],[0.52,0.14,4.5],[0.58,0.12,5.0],[0.61,0.13,5.5],
].map(([effect, standardError, dose], index) => ({
  studyId: `m${index+1}`,
  label: `M${index+1}`,
  outcome: 'mortality',
  effect: effect!,
  standardError: standardError!,
  provenanceIds: [`p${index+1}`],
  moderators: { dose: dose! },
}));

function close(actual: number, expected: number, tolerance: number) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

test('mixed-effects meta-regression recovers the known positive moderator relation', () => {
  const result = analyseMetaRegression(estimates, ['dose']);
  const intercept = result.coefficients.find((item) => item.term === 'intercept')!;
  const dose = result.coefficients.find((item) => item.term === 'dose')!;
  assert.equal(result.model, 'mixed-effects-meta-regression');
  assert.equal(result.k, 12);
  assert.equal(result.residualDegreesOfFreedom, 10);
  close(intercept.estimate, 0.09, 0.03);
  close(dose.estimate, 0.095, 0.015);
  assert.ok(dose.confidenceInterval[0] > 0);
  assert.ok(result.tauSquared >= 0);
  assert.equal(result.fittedValues.length, 12);
});

test('default stability gate marks 12-study one-moderator analysis as eligible under 10-per-moderator rule', () => {
  const result = analyseMetaRegression(estimates, ['dose']);
  assert.equal(result.applicability.minimumStudiesPerModerator, 10);
  assert.equal(result.applicability.criterionMet, true);
  assert.equal(result.applicability.exploratory, false);
});

test('underpowered moderator model is computed for audit but explicitly marked exploratory', () => {
  const result = analyseMetaRegression(estimates.slice(0, 6), ['dose']);
  assert.equal(result.applicability.criterionMet, false);
  assert.equal(result.applicability.exploratory, true);
  assert.ok(result.applicability.warnings.some((warning) => /requires at least 10 studies per moderator/i.test(warning)));
});

test('REML tau² is non-negative and deterministic', () => {
  const first = estimateMetaRegressionTauSquaredREML(estimates, ['dose']);
  const second = estimateMetaRegressionTauSquaredREML(estimates, ['dose']);
  assert.ok(first >= 0);
  assert.equal(first, second);
});

test('missing moderator values, duplicate studies, and rank-deficient designs fail closed', () => {
  assert.throws(() => analyseMetaRegression([
    estimates[0]!,
    { ...estimates[1]!, moderators: {} },
    ...estimates.slice(2, 5),
  ], ['dose']), /Moderator dose is missing/);
  assert.throws(() => analyseMetaRegression([
    estimates[0]!,
    { ...estimates[1]!, studyId: estimates[0]!.studyId },
    ...estimates.slice(2, 5),
  ], ['dose']), /Duplicate or empty/);

  const constant = estimates.slice(0, 5).map((item) => ({ ...item, moderators: { dose: 1 } }));
  assert.throws(() => analyseMetaRegression(constant, ['dose']), /singular or not full rank/);
});

test('meta-regression requires more studies than coefficients', () => {
  assert.throws(() => analyseMetaRegression(estimates.slice(0, 2), ['dose']), /more studies than coefficients/);
});
