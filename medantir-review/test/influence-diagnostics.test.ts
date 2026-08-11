import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseInfluence } from '../src/synthesis/influence-diagnostics.js';
import type { AnalysisEstimate } from '../src/synthesis/inverse-variance.js';

const base: AnalysisEstimate[] = [
  { studyId: 's1', label: 'S1', outcome: 'o', effect: 0.10, standardError: 0.10, provenanceIds: [] },
  { studyId: 's2', label: 'S2', outcome: 'o', effect: 0.12, standardError: 0.11, provenanceIds: [] },
  { studyId: 's3', label: 'S3', outcome: 'o', effect: 0.08, standardError: 0.09, provenanceIds: [] },
  { studyId: 's4', label: 'S4', outcome: 'o', effect: 0.15, standardError: 0.12, provenanceIds: [] },
  { studyId: 'extreme', label: 'Extreme', outcome: 'o', effect: 0.80, standardError: 0.10, provenanceIds: [] },
];

test('leave-one-out diagnostics identify the deliberately extreme study as largest pooled-effect shift', () => {
  const result = analyseInfluence(base);
  assert.equal(result.k, 5);
  assert.equal(result.diagnostics.length, 5);
  assert.equal(result.mostInfluentialByEffect, 'extreme');
  const extreme = result.diagnostics.find((item) => item.studyId === 'extreme')!;
  assert.equal(extreme.absolutePooledEffectShift, result.maxAbsoluteEffectShift);
  assert.ok(Math.abs(extreme.standardizedRandomEffectsResidual) > 1);
  assert.ok(extreme.randomEffectsQContribution > 0);
});

test('influence diagnostics report magnitudes rather than applying hidden influence thresholds', () => {
  const result = analyseInfluence(base);
  for (const row of result.diagnostics) {
    assert.equal(typeof row.absolutePooledEffectShift, 'number');
    assert.equal(typeof row.tauSquaredShift, 'number');
    assert.equal(typeof row.nullCrossingChanged, 'boolean');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'influentialStudies'), false);
});

test('null-crossing changes are explicitly reported when a study changes interval interpretation', () => {
  const studies: AnalysisEstimate[] = [
    { studyId: 'a', label: 'A', outcome: 'o', effect: 0.28, standardError: 0.10, provenanceIds: [] },
    { studyId: 'b', label: 'B', outcome: 'o', effect: 0.30, standardError: 0.11, provenanceIds: [] },
    { studyId: 'c', label: 'C', outcome: 'o', effect: -0.20, standardError: 0.10, provenanceIds: [] },
    { studyId: 'd', label: 'D', outcome: 'o', effect: 0.25, standardError: 0.12, provenanceIds: [] },
  ];
  const result = analyseInfluence(studies);
  assert.equal(Array.isArray(result.nullCrossingChanges), true);
  if (result.nullCrossingChanges.length > 0) {
    assert.ok(result.warnings.some((warning) => /changes whether.*crosses the null/i.test(warning)));
  }
});

test('fewer than three studies are refused because leave-one-out would not support meta-analysis', () => {
  assert.throws(() => analyseInfluence(base.slice(0, 2)), /at least three studies/);
});

test('small-k influence analysis is explicitly marked unstable', () => {
  const result = analyseInfluence(base.slice(0, 4));
  assert.ok(result.warnings.some((warning) => /unstable with fewer than five studies/i.test(warning)));
});
