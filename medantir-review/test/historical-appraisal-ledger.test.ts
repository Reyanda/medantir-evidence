import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createHistoricalAppraisalLedger,
  type HistoricalAppraisalRowInput,
} from '../src/historical/appraisal-ledger.js';

interface GoldLineage { lineageId: string }

async function fixture() {
  const root = process.cwd();
  const directory = resolve(root, 'benchmarks/jak-covid-2021');
  const gold = JSON.parse(await readFile(resolve(directory, 'gold-set.json'), 'utf8')) as GoldLineage[];
  const appraisal = JSON.parse(await readFile(resolve(directory, 'published-appraisal.json'), 'utf8')) as HistoricalAppraisalRowInput[];
  return { gold, appraisal };
}

test('published appraisal reconstructs exactly one quality row for every canonical JAK/COVID lineage', async () => {
  const { gold, appraisal } = await fixture();
  const allowed = new Set(gold.map((lineage) => lineage.lineageId));
  const ledger = createHistoricalAppraisalLedger(appraisal, allowed);

  assert.equal(ledger.rows.length, 14);
  assert.equal(new Set(ledger.rows.map((row) => row.lineageId)).size, 14);
  assert.deepEqual(new Set(ledger.rows.map((row) => row.lineageId)), allowed);
  assert.equal(ledger.exactSourceBoundRows, 0);
  assert.equal(ledger.reconstructionOnlyRows, 14);
  assert.match(ledger.ledgerHash, /^[a-f0-9]{64}$/);
});

test('JAK/COVID published appraisal reproduces the six Jadad and eight NOS rows and reported score distributions', async () => {
  const { gold, appraisal } = await fixture();
  const ledger = createHistoricalAppraisalLedger(appraisal, new Set(gold.map((lineage) => lineage.lineageId)));
  const jadad = ledger.rows.filter((row) => row.tool === 'modified-jadad-7');
  const nos = ledger.rows.filter((row) => row.tool === 'newcastle-ottawa-cohort-9');

  assert.equal(jadad.length, 6);
  assert.equal(jadad.filter((row) => row.interpretation === 'high').length, 4);
  assert.equal(jadad.filter((row) => row.interpretation === 'low').length, 2);
  assert.equal(nos.length, 8);
  assert.ok(nos.every((row) => row.interpretation === 'good'));
  assert.deepEqual(jadad.map((row) => row.totalScore).sort((a, b) => a - b), [1, 1, 5, 5, 6, 7]);
  assert.deepEqual(nos.map((row) => row.totalScore).sort((a, b) => a - b), [7, 7, 7, 8, 8, 8, 8, 8]);
});

test('appraisal component arithmetic and canonical identity fail closed', () => {
  const allowed = new Set(['JAKCOVID-001']);
  assert.throws(
    () => createHistoricalAppraisalLedger([{
      lineageId: 'JAKCOVID-001',
      tool: 'newcastle-ottawa-cohort-9',
      selection: 3,
      comparability: 2,
      outcome: 3,
      totalScore: 7,
      interpretation: 'good',
      source: { sourceType: 'published-table', sourceReference: 'fixture', rowLabel: 'row', verbatimEvidence: '3 2 3 total 7' },
    }], allowed),
    /component sum 8 does not equal reported total 7/i,
  );
  assert.throws(
    () => createHistoricalAppraisalLedger([{
      lineageId: 'JAKCOVID-999',
      tool: 'modified-jadad-7',
      randomAllocation: 1,
      concealment: 1,
      blinding: 2,
      withdrawalsDropouts: 1,
      totalScore: 5,
      interpretation: 'high',
      source: { sourceType: 'published-table', sourceReference: 'fixture', rowLabel: 'row', verbatimEvidence: 'score 5' },
    }], allowed),
    /unknown canonical lineage/i,
  );
});

test('appraisal exact-source binding requires objectId to equal HOBJ-sha256', () => {
  const allowed = new Set(['JAKCOVID-001']);
  const sha = 'a'.repeat(64);
  const base: HistoricalAppraisalRowInput = {
    lineageId: 'JAKCOVID-001',
    tool: 'newcastle-ottawa-cohort-9',
    selection: 3,
    comparability: 2,
    outcome: 3,
    totalScore: 8,
    interpretation: 'good',
    source: {
      sourceType: 'published-table',
      sourceReference: 'fixture',
      rowLabel: 'row',
      verbatimEvidence: 'Selection 3; comparability 2; outcome 3; total 8; good.',
      sha256: sha,
      objectId: `HOBJ-${'b'.repeat(64)}`,
      bindingFidelity: 'verbatim-exact',
    },
  };
  assert.throws(
    () => createHistoricalAppraisalLedger([base], allowed),
    /objectId must equal HOBJ-<sha256>/i,
  );

  const ledger = createHistoricalAppraisalLedger([{
    ...base,
    source: { ...base.source, objectId: `HOBJ-${sha}` },
  }], allowed);
  assert.equal(ledger.exactSourceBoundRows, 1);
  assert.equal(ledger.reconstructionOnlyRows, 0);
});
