import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalOutcomeRowLedger, type HistoricalOutcomeRowInput } from '../src/historical/outcome-row-ledger.js';
import { replayHistoricalSynthesis } from '../src/historical/synthesis-replay.js';

const lineages = new Set(['J1', 'J2', 'J3', 'J4']);
const source = (id: string) => ({
  sourceType: 'primary-report' as const,
  objectId: `HOBJ-${id.repeat(64)}`,
  sha256: id.repeat(64),
  page: 7,
  tableOrFigure: 'Results table',
  rowLabel: 'Mortality',
  verbatimEvidence: 'Exact arm events and totals.',
});

function row(
  lineageId: string,
  experimentalEvents: number,
  experimentalTotal: number,
  controlEvents: number,
  controlTotal: number,
): HistoricalOutcomeRowInput {
  const id = ({ J1: 'a', J2: 'b', J3: 'c', J4: 'd' } as const)[lineageId as 'J1' | 'J2' | 'J3' | 'J4'];
  return {
    lineageId,
    outcome: 'mortality',
    contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28-day',
    analysisPopulation: 'mITT',
    subgroupLabel: null,
    source: source(id),
    dataShape: 'binary-2x2',
    measure: 'RR',
    experimentalEvents,
    experimentalTotal,
    controlEvents,
    controlTotal,
  };
}

const plan = {
  selector: {
    outcome: 'mortality',
    measure: 'RR' as const,
    timeHorizon: '28-day',
    analysisPopulation: 'mITT' as const,
    subgroupLabel: null,
  },
  publishedTarget: {
    outcome: 'mortality',
    studies: 3,
    participants: 500,
    measure: 'RR' as const,
    estimate: 0.7259213075158082,
    ciLower: 0.3726138873696219,
    ciUpper: 1.4142300181708745,
    i2: 63.95595105472653,
    model: 'random effects',
  },
};

test('historical row ledger feeds RevMan compatibility engine and reconciles a published target end to end', () => {
  const ledger = createHistoricalOutcomeRowLedger([
    row('J1', 10, 100, 20, 100),
    row('J2', 30, 100, 25, 100),
    row('J3', 5, 50, 10, 50),
  ], lineages);
  const replay = replayHistoricalSynthesis(ledger, plan);
  assert.equal(replay.publishedComparison.exactWithinTolerance, true);
  assert.deepEqual(replay.selectedLineageIds, ['J1', 'J2', 'J3']);
  assert.equal(replay.reproducedResult.participants, 500);
  assert.equal(replay.algorithmResult.method, 'MH-DL-random');
  assert.match(replay.synthesisInputsHash, /^[a-f0-9]{64}$/);
  assert.match(replay.replayHash, /^[a-f0-9]{64}$/);
});

test('published result mismatch is retained as a structured divergence, not rounded away', () => {
  const ledger = createHistoricalOutcomeRowLedger([
    row('J1', 10, 100, 20, 100), row('J2', 30, 100, 25, 100), row('J3', 5, 50, 10, 50),
  ], lineages);
  const replay = replayHistoricalSynthesis(ledger, {
    ...plan,
    publishedTarget: { ...plan.publishedTarget, estimate: 0.80 },
  });
  assert.equal(replay.publishedComparison.exactWithinTolerance, false);
  assert.equal(replay.publishedComparison.firstDifference?.field, 'estimate');
});

test('one unresolved potentially contributing row blocks synthesis even if the remaining rows reproduce the printed estimate', () => {
  const unresolved: HistoricalOutcomeRowInput = {
    ...row('J4', 1, 10, 1, 10),
    contributionStatus: 'unresolved',
    reconstructionStatus: 'unresolved',
    experimentalEvents: null,
    experimentalTotal: null,
    controlEvents: null,
    controlTotal: null,
    timeHorizon: null,
  };
  const ledger = createHistoricalOutcomeRowLedger([
    row('J1', 10, 100, 20, 100), row('J2', 30, 100, 25, 100), row('J3', 5, 50, 10, 50), unresolved,
  ], lineages);
  assert.throws(() => replayHistoricalSynthesis(ledger, plan), /unresolved potentially contributing row/i);
});

test('explicitly non-contributing rows do not contaminate the selected published estimand', () => {
  const nonContributing: HistoricalOutcomeRowInput = {
    ...row('J4', 1, 10, 1, 10),
    contributionStatus: 'non-contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    notes: ['Primary report did not contribute to the published 28-day mortality analysis.'],
  };
  const ledger = createHistoricalOutcomeRowLedger([
    row('J1', 10, 100, 20, 100), row('J2', 30, 100, 25, 100), row('J3', 5, 50, 10, 50), nonContributing,
  ], lineages);
  const replay = replayHistoricalSynthesis(ledger, plan);
  assert.equal(replay.publishedComparison.exactWithinTolerance, true);
  assert.equal(replay.selectedLineageIds.includes('J4'), false);
});

test('source object ID/hash mismatch leaves a contributing row non-poolable and synthesis fails closed', () => {
  const bad = row('J1', 10, 100, 20, 100);
  bad.source = { ...bad.source, objectId: `HOBJ-${'f'.repeat(64)}` };
  const ledger = createHistoricalOutcomeRowLedger([bad], lineages);
  assert.equal(ledger.poolableRows, 0);
  assert.throws(() => replayHistoricalSynthesis(ledger, plan), /non-poolable source rows/i);
});
