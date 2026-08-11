import test from 'node:test';
import assert from 'node:assert/strict';
import { ProvenanceFirstExtractionAgent, type QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import type { Agent, AgentContext, ExtractedStudy } from '../src/core/types.js';

function study(): ExtractedStudy {
  return {
    studyId: 'study-1',
    reportIds: ['r1'],
    design: 'randomised controlled trial',
    population: 'Adults',
    interventionOrExposure: 'Treatment',
    comparator: 'Control',
    outcomes: [{ name: 'Mortality', effect: 9, standardError: 0.1 }],
    mechanisms: [],
    funding: 'Not reported',
    rationale: 'Rationale',
    objectives: ['Objective'],
    resultsSummary: 'Results',
    discussionSummary: 'Discussion',
    limitations: ['Limitations'],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {},
    sourceQuotes: [],
  };
}

function base(): Agent {
  return {
    stage: 'extract',
    async execute() {
      return { artifacts: { extractedStudies: [study()] } };
    },
  };
}

function context(header: string): AgentContext {
  const rows = [
    ['Outcome', header],
    ['Mortality', '1.20 (95% CI 0.90, 1.60)'],
  ];
  return {
    state: {
      runId: 'run-1',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Test', objective: 'Test', outcomes: ['Mortality'] },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {
        includedDocuments: [{
          recordId: 'r1',
          text: 'Clinical results',
          pages: [{ page: 4, text: rows[1]!.join(' | ') }],
          sections: [],
          extractionMethod: 'native',
          tables: [{ id: 'table-1', rows, source: 'liteparse-markdown' }],
          documentIntelligence: { selectedTier: 'liteparse-structured', locatorFidelity: 'page' },
        }],
      },
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

test('ordinary English or in a column header is not interpreted as odds ratio', async () => {
  const result = await new ProvenanceFirstExtractionAgent(base()).execute(context('Benefit or harm'));
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];

  assert.equal(ledger[0]?.status, 'blocked');
  assert.equal(studies[0]?.outcomes[0]?.effect, undefined);
});

test('uppercase OR abbreviation remains a valid odds-ratio effect header', async () => {
  const result = await new ProvenanceFirstExtractionAgent(base()).execute(context('OR (95% CI)'));
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(ledger[0]?.status, 'extracted');
  assert.equal(ledger[0]?.effectMeasure, 'OR');
  assert.equal(ledger[0]?.analysisScale, 'log');
});
