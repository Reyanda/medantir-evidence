import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldSetHistoricalSourceDebt } from '../src/historical/gold-source-debt.js';

test('gold-set source debt extracts only existing stable IDs and stays explicitly incomplete/unarchived', () => {
  const result = createGoldSetHistoricalSourceDebt({
    historicalCutoff: '2021-06-02',
    goldSet: [
      { lineageId: 'L1', label: 'Trial one', acceptableIds: ['doi:10.1000/ABC', 'PMID:12345678'] },
      { lineageId: 'L2', title: 'Trial two', identifiers: { registry: 'NCT04401579' } },
    ],
  });
  assert.equal(result.sourceManifest.reports.length, 2);
  assert.equal(result.sourceManifest.reports[0]?.sourceStatus, 'identified-unarchived');
  assert.equal(result.sourceManifest.exactSourceCoverage, false);
  assert.deepEqual(result.sourceManifest.lineagesWithoutArchivedResultSource, ['L1', 'L2']);
  assert.equal(result.inventoryVerification.computationalInventoryComplete, false);
  assert.deepEqual(result.inventoryVerification.incompleteLineageIds, ['L1', 'L2']);
  assert.equal(result.sourceManifest.reports.find((report) => report.lineageId === 'L1')?.identifiers.doi, '10.1000/abc');
  assert.equal(result.sourceManifest.reports.find((report) => report.lineageId === 'L2')?.identifiers.registryId, 'NCT04401579');
});

test('source-debt derivation refuses to invent an identifier when canonical gold data has none', () => {
  assert.throws(() => createGoldSetHistoricalSourceDebt({
    historicalCutoff: '2021-06-02',
    goldSet: [{ lineageId: 'L1', label: 'No machine-stable identifier here' }],
  }), /no stable primary-report identifier/i);
});

test('source-debt derivation rejects duplicate canonical lineage IDs', () => {
  assert.throws(() => createGoldSetHistoricalSourceDebt({
    historicalCutoff: '2021-06-02',
    goldSet: [
      { lineageId: 'L1', acceptableIds: ['doi:10.1000/a'] },
      { lineageId: 'L1', acceptableIds: ['doi:10.1000/b'] },
    ],
  }), /duplicate lineage IDs/i);
});
