import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareHistoricalPublishedResult,
  compareHistoricalResultSet,
  reproducedResultFromRevMan54,
} from '../src/historical/published-result-comparator.js';
import { revMan54RandomEffectsRiskRatio } from '../src/historical/revman-5.4-compat.js';

test('published-result comparator tolerates only publication rounding, not substantive statistical drift', () => {
  const target = {
    outcome: 'mortality',
    studies: 13,
    participants: 4339,
    measure: 'RR' as const,
    estimate: 0.52,
    ciLower: 0.36,
    ciUpper: 0.76,
    i2: 33,
    model: 'random effects',
  };
  const exactPrinted = compareHistoricalPublishedResult(target, {
    outcome: 'Mortality',
    studies: 13,
    participants: 4339,
    measure: 'RR',
    estimate: 0.5239,
    ciLower: 0.357,
    ciUpper: 0.764,
    i2: 33.4,
    model: 'Random Effects',
    analysisEngine: 'fixture',
  });
  assert.equal(exactPrinted.exactWithinTolerance, true);

  const drifted = compareHistoricalPublishedResult(target, {
    outcome: 'mortality',
    studies: 12,
    participants: 4200,
    measure: 'RR',
    estimate: 0.56,
    ciLower: 0.40,
    ciUpper: 0.81,
    i2: 39,
    model: 'fixed effect',
    analysisEngine: 'fixture',
  });
  assert.equal(drifted.exactWithinTolerance, false);
  assert.equal(drifted.firstDifference?.field, 'studies');
  assert.ok(drifted.differences.some((difference) => difference.field === 'estimate'));
  assert.ok(drifted.differences.some((difference) => difference.field === 'model'));
});

test('result-set reconciliation fails closed for missing and unexpected outcomes', () => {
  const comparison = compareHistoricalResultSet({
    targets: [
      { outcome: 'mortality', measure: 'RR', estimate: 0.5, ciLower: 0.3, ciUpper: 0.8 },
      { outcome: 'recovery', measure: 'RR', estimate: 1.2, ciLower: 1.0, ciUpper: 1.4 },
    ],
    actual: [
      { outcome: 'mortality', studies: 2, measure: 'RR', estimate: 0.5, ciLower: 0.3, ciUpper: 0.8, i2: 0, model: 'random effects', analysisEngine: 'fixture' },
      { outcome: 'adverse events', studies: 2, measure: 'RR', estimate: 1.0, ciLower: 0.8, ciUpper: 1.2, i2: 0, model: 'random effects', analysisEngine: 'fixture' },
    ],
  });
  assert.equal(comparison.allExactWithinTolerance, false);
  assert.deepEqual(comparison.missingOutcomes, ['recovery']);
  assert.deepEqual(comparison.unexpectedOutcomes, ['adverse events']);
});

test('RevMan compatibility output is projected into the same published-target schema', () => {
  const result = revMan54RandomEffectsRiskRatio([
    { studyId: 's1', experimentalEvents: 10, experimentalTotal: 100, controlEvents: 20, controlTotal: 100 },
    { studyId: 's2', experimentalEvents: 30, experimentalTotal: 100, controlEvents: 25, controlTotal: 100 },
    { studyId: 's3', experimentalEvents: 5, experimentalTotal: 50, controlEvents: 10, controlTotal: 50 },
  ]);
  const projected = reproducedResultFromRevMan54({ outcome: 'fixture outcome', participants: 500, result });
  assert.equal(projected.measure, 'RR');
  assert.equal(projected.studies, 3);
  assert.equal(projected.participants, 500);
  assert.equal(projected.model, 'random effects');
  assert.equal(projected.analysisEngine, 'revman-5.4-compat/1');
});
