import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mantelHaenszelOddsRatio,
  mantelHaenszelRiskRatio,
  petoOddsRatio,
  type BinaryStudy2x2,
} from '../src/synthesis/rare-events.js';

const studies: BinaryStudy2x2[] = [
  { studyId: 's1', label: 'S1', interventionEvents: 0, interventionTotal: 50, comparatorEvents: 3, comparatorTotal: 50, provenanceIds: ['p1'] },
  { studyId: 's2', label: 'S2', interventionEvents: 2, interventionTotal: 60, comparatorEvents: 4, comparatorTotal: 60, provenanceIds: ['p2'] },
  { studyId: 's3', label: 'S3', interventionEvents: 1, interventionTotal: 40, comparatorEvents: 0, comparatorTotal: 40, provenanceIds: ['p3'] },
  { studyId: 's4', label: 'S4 double-zero', interventionEvents: 0, interventionTotal: 30, comparatorEvents: 0, comparatorTotal: 30, provenanceIds: ['p4'] },
];

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

test('MH RR retains single-zero studies without continuity correction and audits double-zero study', () => {
  const result = mantelHaenszelRiskRatio(studies);
  close(result.pooledEffect, 3 / 7, 1e-14);
  close(result.pooledLogEffect, Math.log(3 / 7), 1e-14);
  close(result.standardError, 0.6526300069150406, 1e-12);
  assert.equal(result.kInput, 4);
  assert.equal(result.kInformative, 3);
  assert.deepEqual(result.excludedDoubleZeroStudyIds, ['s4']);
  assert.ok(result.diagnostics.find((item) => item.studyId === 's1')?.singleZero);
  assert.ok(result.warnings.some((warning) => /double-zero/i.test(warning)));
});

test('MH OR uses Robins-Breslow-Greenland variance and no arbitrary 0.5 correction', () => {
  const result = mantelHaenszelOddsRatio(studies);
  close(result.pooledEffect, 0.4059159254766038, 2e-12);
  close(result.pooledLogEffect, -0.9017744499025598, 2e-12);
  close(result.standardError, 0.6686867263303539, 2e-12);
  assert.deepEqual(result.excludedDoubleZeroStudyIds, ['s4']);
});

test('Peto OR returns estimate plus applicability diagnostics instead of silently selecting itself', () => {
  const result = petoOddsRatio(studies);
  close(result.pooledLogOddsRatio, -0.8806488701075008, 2e-12);
  close(result.pooledOddsRatio, 0.4145132668292073, 2e-12);
  close(result.standardError, 0.6446623739789926, 2e-12);
  assert.equal(result.applicability.rareEventsCriterionMet, true);
  assert.equal(result.applicability.allocationBalanceCriterionMet, true);
  assert.equal(typeof result.applicability.smallEffectCriterionMet, 'boolean');
  assert.deepEqual(result.excludedDoubleZeroStudyIds, ['s4']);
});

test('Peto diagnostics reject its own preferred regime when events or allocation are not rare/balanced', () => {
  const unsuitable: BinaryStudy2x2[] = [
    { studyId: 'u1', label: 'U1', interventionEvents: 40, interventionTotal: 50, comparatorEvents: 12, comparatorTotal: 20, provenanceIds: [] },
    { studyId: 'u2', label: 'U2', interventionEvents: 25, interventionTotal: 30, comparatorEvents: 10, comparatorTotal: 10, provenanceIds: [] },
  ];
  const result = petoOddsRatio(unsuitable, { maxEventRate: 0.10, maxAllocationRatio: 2 });
  assert.equal(result.applicability.rareEventsCriterionMet, false);
  assert.equal(result.applicability.allocationBalanceCriterionMet, false);
  assert.ok(result.applicability.warnings.length >= 2);
});

test('all double-zero studies do not manufacture a relative-effect estimate', () => {
  const doubleZero: BinaryStudy2x2[] = [
    { studyId: 'z1', label: 'Z1', interventionEvents: 0, interventionTotal: 100, comparatorEvents: 0, comparatorTotal: 100, provenanceIds: [] },
    { studyId: 'z2', label: 'Z2', interventionEvents: 0, interventionTotal: 50, comparatorEvents: 0, comparatorTotal: 50, provenanceIds: [] },
  ];
  assert.throws(() => mantelHaenszelRiskRatio(doubleZero), /no informative studies/);
  assert.throws(() => mantelHaenszelOddsRatio(doubleZero), /no informative studies/);
  assert.throws(() => petoOddsRatio(doubleZero), /no informative studies/);
});

test('dependent duplicate study IDs are rejected before rare-event pooling', () => {
  assert.throws(() => mantelHaenszelRiskRatio([
    studies[0]!,
    { ...studies[1]!, studyId: studies[0]!.studyId },
  ]), /Duplicate\/dependent binary study/);
});
