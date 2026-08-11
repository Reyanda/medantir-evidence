import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import { StructuredParticipantCountAgent } from '../src/certainty/structured-participant-count-agent.js';
import type { OutcomeParticipantCountReceipt } from '../src/certainty/automatic-grade-evidence-agent.js';

class Inner implements Agent {
  readonly stage = 'extract' as const;
  constructor(private readonly ledger: QuantitativeExtractionLedgerRow[]) {}
  async execute(_context: AgentContext): Promise<AgentResult> {
    return { artifacts: { quantitativeExtractionLedger: this.ledger, extractedStudies: [] } };
  }
}

function ledger(row: string[]): QuantitativeExtractionLedgerRow {
  return {
    studyId: 's1',
    recordId: 'r1',
    outcome: 'mortality',
    status: 'extracted',
    effectMeasure: 'RR',
    analysisScale: 'log',
    effect: 0.8,
    analysisEffect: Math.log(0.8),
    standardError: 0.1,
    confidenceInterval: [0.65, 0.98],
    tableId: 't1',
    rowLabel: 'Mortality',
    columnHeader: 'RR',
    page: 4,
    verbatim: row.join(' | '),
    extractionTool: 'liteparse',
  };
}

async function run(headers: string[], row: string[], extraRows: string[][] = []) {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.includedDocuments = [{
    recordId: 'r1',
    tables: [{ id: 't1', page: 4, rows: [headers, row, ...extraRows] }],
  }];
  const result = await new StructuredParticipantCountAgent(new Inner([ledger(row)])).execute({
    state,
    now: () => '2026-08-11T08:00:00.000Z',
  });
  return (result.artifacts.outcomeParticipantCountLedger as OutcomeParticipantCountReceipt[])[0]!;
}

test('accepts one unambiguous total participant column on the quantitative row', async () => {
  const receipt = await run(
    ['Outcome', 'RR', '95% CI', 'Total N'],
    ['Mortality', '0.80', '0.65 to 0.98', '420'],
  );
  assert.equal(receipt.status, 'exact');
  assert.equal(receipt.totalParticipants, 420);
  assert.equal(receipt.source, 'structured-arm-counts');
  assert.equal(receipt.evidenceIds.length, 1);
});

test('sums one explicit intervention-N and comparator-N pair', async () => {
  const receipt = await run(
    ['Outcome', 'RR', 'Treatment N', 'Control N'],
    ['Mortality', '0.80', '210', '205'],
  );
  assert.equal(receipt.status, 'exact');
  assert.equal(receipt.totalParticipants, 415);
  assert.equal(receipt.evidenceIds.length, 2);
});

test('rejects ambiguous duplicate total-N columns instead of choosing one', async () => {
  const receipt = await run(
    ['Outcome', 'RR', 'N', 'Total N'],
    ['Mortality', '0.80', '400', '420'],
  );
  assert.equal(receipt.status, 'unresolved');
  assert.equal(receipt.totalParticipants, undefined);
});

test('does not take a participant count from another table row', async () => {
  const receipt = await run(
    ['Outcome', 'RR', '95% CI', 'Total N'],
    ['Mortality', '0.80', '0.65 to 0.98', ''],
    [['Hospitalization', '0.90', '0.75 to 1.10', '999']],
  );
  assert.equal(receipt.status, 'unresolved');
  assert.equal(receipt.totalParticipants, undefined);
});

test('ambiguous row reconstruction fails closed', async () => {
  const row = ['Mortality', '0.80', '420'];
  const state = createPipelineState(fixtureRequest);
  state.artifacts.includedDocuments = [{
    recordId: 'r1',
    tables: [{ id: 't1', rows: [['Outcome', 'RR', 'Total N'], row, row] }],
  }];
  const result = await new StructuredParticipantCountAgent(new Inner([ledger(row)])).execute({ state, now: () => '2026-08-11T08:00:00.000Z' });
  const receipt = (result.artifacts.outcomeParticipantCountLedger as OutcomeParticipantCountReceipt[])[0]!;
  assert.equal(receipt.status, 'unresolved');
});
