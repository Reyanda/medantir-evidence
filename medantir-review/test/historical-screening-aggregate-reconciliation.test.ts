import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalScreeningDecisionLedger } from '../src/historical/screening-decision-ledger.js';
import { reconcileHistoricalScreeningAggregates } from '../src/historical/screening-aggregate-reconciliation.js';

const historical = createHistoricalScreeningDecisionLedger({
  reviewId: 'r',
  aggregates: [
    { stage: 'title-abstract', included: 2, excluded: 3, sourceReference: 'PRISMA' },
    { stage: 'full-text', included: 1, excluded: 1, sourceReference: 'PRISMA' },
  ],
});

test('aggregate-only historical screening can match replay counts without becoming row-history exact', () => {
  const replay = [
    { stage: 'title-abstract' as const, recordId: 'a', decision: 'include' as const },
    { stage: 'title-abstract' as const, recordId: 'b', decision: 'include' as const },
    { stage: 'title-abstract' as const, recordId: 'c', decision: 'exclude' as const },
    { stage: 'title-abstract' as const, recordId: 'd', decision: 'exclude' as const },
    { stage: 'title-abstract' as const, recordId: 'e', decision: 'exclude' as const },
    { stage: 'full-text' as const, recordId: 'a', decision: 'include' as const },
    { stage: 'full-text' as const, recordId: 'b', decision: 'exclude' as const },
  ];
  const result = reconcileHistoricalScreeningAggregates(historical, replay);
  assert.equal(result.aggregateComparable, true);
  assert.equal(result.aggregateMatch, true);
  assert.equal(result.rowHistoryExact, false);
  assert.deepEqual(result.differences, []);
});

test('aggregate reconciliation localizes first count drift', () => {
  const replay = [
    { stage: 'title-abstract' as const, recordId: 'a', decision: 'include' as const },
    { stage: 'title-abstract' as const, recordId: 'b', decision: 'exclude' as const },
  ];
  const result = reconcileHistoricalScreeningAggregates(historical, replay);
  assert.equal(result.aggregateMatch, false);
  assert.equal(result.firstDifference?.stage, 'title-abstract');
  assert.equal(result.firstDifference?.field, 'included');
  assert.ok(result.differences.some((difference) => difference.field === 'total'));
});

test('no published aggregate means aggregate comparison is unavailable, not vacuously exact', () => {
  const unavailable = createHistoricalScreeningDecisionLedger({ reviewId: 'r' });
  const result = reconcileHistoricalScreeningAggregates(unavailable, []);
  assert.equal(result.aggregateComparable, false);
  assert.equal(result.aggregateMatch, false);
  assert.equal(result.rowHistoryExact, false);
});
