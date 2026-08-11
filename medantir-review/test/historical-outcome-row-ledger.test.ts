import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistoricalOutcomeRowLedger,
  isHistoricalOutcomeRowPoolable,
  type HistoricalOutcomeRowInput,
} from '../src/historical/outcome-row-ledger.js';

const lineages = new Set(['JAKCOVID-001', 'JAKCOVID-007']);
const source = {
  sourceType: 'primary-report' as const,
  objectId: `HOBJ-${'a'.repeat(64)}`,
  sha256: 'a'.repeat(64),
  page: 7,
  tableOrFigure: 'Table 2',
  rowLabel: 'Mortality',
  verbatimEvidence: 'Treatment 12/341; control 25/356.',
};

function binary(overrides: Partial<HistoricalOutcomeRowInput> = {}): HistoricalOutcomeRowInput {
  return {
    lineageId: 'JAKCOVID-007',
    outcome: 'mortality',
    contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28-day',
    analysisPopulation: 'mITT',
    subgroupLabel: null,
    source,
    dataShape: 'binary-2x2',
    measure: 'RR',
    experimentalEvents: 12,
    experimentalTotal: 341,
    controlEvents: 25,
    controlTotal: 356,
    ...overrides,
  } as HistoricalOutcomeRowInput;
}

test('canonical lineage + estimand + exact source binding yields a poolable historical row', () => {
  const ledger = createHistoricalOutcomeRowLedger([binary()], lineages);
  assert.equal(ledger.poolableRows, 1);
  assert.equal(ledger.unresolvedRows, 0);
  assert.equal(isHistoricalOutcomeRowPoolable(ledger.rows[0]!), true);
  assert.match(ledger.rows[0]!.rowHash, /^[a-f0-9]{64}$/);
  assert.match(ledger.ledgerHash, /^[a-f0-9]{64}$/);
});

test('unknown historical lineage fails before any numeric synthesis object is created', () => {
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary({ lineageId: 'JAKCOVID-999' })], lineages),
    /unknown canonical lineage/i,
  );
});

test('contributing rows require complete arm data and cannot be authorized by unresolved/secondary-only reconstruction', () => {
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary({ experimentalEvents: null })], lineages),
    /missing numeric arm data/i,
  );
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary({ reconstructionStatus: 'unresolved' })], lineages),
    /cannot have unresolved reconstruction/i,
  );
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary({ reconstructionStatus: 'secondary-corroboration-only' })], lineages),
    /secondary corroboration alone/i,
  );
});

test('missing time horizon, analysis population or immutable source binding retains a row as verification debt rather than pooling it', () => {
  const ledger = createHistoricalOutcomeRowLedger([
    binary({ timeHorizon: null, contributionStatus: 'unresolved', reconstructionStatus: 'unresolved' }),
    binary({ lineageId: 'JAKCOVID-001', analysisPopulation: 'unspecified', contributionStatus: 'unresolved', reconstructionStatus: 'unresolved' }),
  ], lineages);
  assert.equal(ledger.poolableRows, 0);
  assert.equal(ledger.unresolvedRows, 2);

  const weakSource = binary({
    lineageId: 'JAKCOVID-001',
    source: { sourceType: 'primary-report', uri: 'https://example.org', verbatimEvidence: '12 versus 25' },
  });
  const weakLedger = createHistoricalOutcomeRowLedger([weakSource], lineages);
  assert.equal(weakLedger.poolableRows, 0);
});

test('same lineage/outcome/estimand cannot appear twice; explicit time horizon separates repeated-measure estimands', () => {
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary(), binary({ experimentalEvents: 13 })], lineages),
    /duplicate historical estimand row/i,
  );
  const repeated = createHistoricalOutcomeRowLedger([
    binary({ timeHorizon: '14-day' }),
    binary({ timeHorizon: '28-day' }),
  ], lineages);
  assert.equal(repeated.rows.length, 2);
});

test('binary counts and continuous SD/arm summaries are validated before hashing', () => {
  assert.throws(
    () => createHistoricalOutcomeRowLedger([binary({ experimentalEvents: 342 })], lineages),
    /events exceed total/i,
  );

  const continuous: HistoricalOutcomeRowInput = {
    lineageId: 'JAKCOVID-007',
    outcome: 'time to recovery',
    contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28-day follow-up',
    analysisPopulation: 'mITT',
    subgroupLabel: null,
    source: {
      ...source,
      rowLabel: 'Time to recovery',
      verbatimEvidence: 'Mean 10.0 (SD 2.0) vs 11.0 (SD 2.5).',
    },
    dataShape: 'continuous-arm-summary',
    measure: 'MD',
    experimentalMean: 10,
    experimentalSd: 2,
    experimentalTotal: 341,
    controlMean: 11,
    controlSd: 2.5,
    controlTotal: 356,
  };
  const ledger = createHistoricalOutcomeRowLedger([continuous], lineages);
  assert.equal(ledger.poolableRows, 1);

  assert.throws(
    () => createHistoricalOutcomeRowLedger([{ ...continuous, experimentalSd: -1 }], lineages),
    /SD cannot be negative/i,
  );
});
