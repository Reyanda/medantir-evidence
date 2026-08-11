import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHistoricalManualSearchLedger } from '../src/historical/manual-search-ledger.js';
import {
  compareHistoricalScreeningReplay,
  createHistoricalScreeningDecisionLedger,
  type HistoricalScreeningDecisionInput,
} from '../src/historical/screening-decision-ledger.js';

interface PublishedHumanProcess {
  screening: Parameters<typeof createHistoricalScreeningDecisionLedger>[0];
  manualSearch: Parameters<typeof createHistoricalManualSearchLedger>[0];
}

test('JAK/COVID historical human process is represented honestly as aggregate-only screening plus unavailable itemized manual search', async () => {
  const fixture = JSON.parse(await readFile(resolve(process.cwd(), 'benchmarks/jak-covid-2021/published-human-process.json'), 'utf8')) as PublishedHumanProcess;
  const screening = createHistoricalScreeningDecisionLedger(fixture.screening);
  const manual = createHistoricalManualSearchLedger(fixture.manualSearch);

  assert.equal(screening.status, 'aggregate-only');
  assert.equal(screening.decisions.length, 0);
  assert.deepEqual(screening.aggregates.map((item) => [item.stage, item.included, item.excluded]), [
    ['full-text', 14, 51],
    ['title-abstract', 65, 1567],
  ]);
  assert.equal(manual.reportedAsPerformed, true);
  assert.equal(manual.status, 'unavailable');
  assert.equal(manual.actions.length, 0);
  assert.match(manual.missingReason ?? '', /does not publish an itemized/i);
});

test('aggregate screening counts cannot be promoted to exact row-level replay by matching modern decisions', () => {
  const historical = createHistoricalScreeningDecisionLedger({
    reviewId: 'r',
    aggregates: [{ stage: 'title-abstract', included: 1, excluded: 1, sourceReference: 'PRISMA' }],
  });
  const comparison = compareHistoricalScreeningReplay(historical, [
    { stage: 'title-abstract', recordId: 'a', decision: 'include' },
    { stage: 'title-abstract', recordId: 'b', decision: 'exclude' },
  ]);
  assert.equal(comparison.exact, false);
  assert.equal(comparison.comparableRows, 0);
});

test('original reviewer ledger requires archived source, reviewer identity and decision time before it is row-exact', () => {
  const exact: HistoricalScreeningDecisionInput = {
    stage: 'full-text',
    recordId: 'pmid:1',
    decision: 'include',
    reviewerIds: ['reviewer-a'],
    decidedAt: '2021-05-01T10:00:00Z',
    provenanceClass: 'original-reviewer-ledger',
    sourceReference: 'screening-export.csv',
    sourceObjectId: `HOBJ-${'a'.repeat(64)}`,
    sourceSha256: 'a'.repeat(64),
  };
  const ledger = createHistoricalScreeningDecisionLedger({ reviewId: 'r', decisions: [exact] });
  assert.equal(ledger.status, 'row-exact');
  assert.equal(ledger.decisions[0]?.exactOriginalDecision, true);

  const reconstructed = createHistoricalScreeningDecisionLedger({
    reviewId: 'r',
    decisions: [{ ...exact, provenanceClass: 'reconstructed-from-publication', reviewerIds: undefined, decidedAt: undefined }],
  });
  assert.equal(reconstructed.status, 'row-reconstructed');
  assert.equal(reconstructed.decisions[0]?.exactOriginalDecision, false);
});

test('row-level screening replay localizes missing, unexpected and changed decisions', () => {
  const historical = createHistoricalScreeningDecisionLedger({
    reviewId: 'r',
    decisions: [
      { stage: 'title-abstract', recordId: 'a', decision: 'include', provenanceClass: 'reconstructed-from-source', sourceReference: 'x' },
      { stage: 'title-abstract', recordId: 'b', decision: 'exclude', provenanceClass: 'reconstructed-from-source', sourceReference: 'x' },
    ],
  });
  const comparison = compareHistoricalScreeningReplay(historical, [
    { stage: 'title-abstract', recordId: 'a', decision: 'exclude' },
    { stage: 'title-abstract', recordId: 'c', decision: 'include' },
  ]);
  assert.equal(comparison.exact, false);
  assert.deepEqual(comparison.differences.map((item) => item.kind), [
    'decision-mismatch',
    'missing-replay-decision',
    'unexpected-replay-decision',
  ]);
});

test('manual search cannot claim exactness from a reconstructed or aggregate action', () => {
  const reconstructed = createHistoricalManualSearchLedger({
    reviewId: 'r',
    reportedAsPerformed: true,
    actions: [{
      method: 'backward-citation',
      seedId: 'lineage-1',
      seedType: 'included-report',
      provenanceClass: 'reconstructed-from-source',
      sourceReference: 'reference list',
      candidates: [{ candidateId: 'doi:1', decision: 'excluded', reason: 'wrong population' }],
    }],
  });
  assert.equal(reconstructed.status, 'reconstructed');
  assert.equal(reconstructed.actions[0]?.exactSourceBound, false);
});
