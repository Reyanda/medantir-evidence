import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, ExtractedStudy } from '../src/core/types.js';
import { ProvenanceFirstExtractionAgent, type QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';

function study(effect = 9, standardError = 0.1): ExtractedStudy {
  return {
    studyId: 'study-r1',
    reportIds: ['r1'],
    design: 'randomised controlled trial',
    population: 'Adults',
    interventionOrExposure: 'Treatment',
    comparator: 'Control',
    outcomes: [{ name: 'Mortality', effect, standardError }],
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

function baseAgent(outcomeName = 'Mortality'): Agent {
  return {
    stage: 'extract',
    async execute() {
      const value = study();
      value.outcomes = [{ name: outcomeName, effect: 9, standardError: 0.1 }];
      return { artifacts: { extractedStudies: [value] } };
    },
  };
}

function context(document: unknown): AgentContext {
  return {
    state: {
      runId: 'run-1',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Test', objective: 'Test', outcomes: ['Mortality'] },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: { includedDocuments: [document] },
      audit: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
    now: () => '2026-08-09T00:00:00.000Z',
  };
}

function liteParseDocument(rows: string[][]) {
  return {
    recordId: 'r1',
    text: 'Clinical results',
    pages: [{ page: 7, text: rows.slice(1).map((row) => row.join(' | ')).join('\n') }],
    sections: [],
    extractionMethod: 'native',
    tables: [{ id: 'table-2', heading: 'Clinical outcomes', rows, source: 'liteparse-markdown' }],
    documentIntelligence: {
      selectedTier: 'liteparse-structured',
      locatorFidelity: 'page',
    },
  };
}

function spatialLiteParseDocument(duplicateEffect = false) {
  const rows = [
    ['Outcome', 'Risk Ratio (95% CI)'],
    ['Mortality', '1.20 (95% CI 0.90, 1.60)'],
  ];
  return {
    ...liteParseDocument(rows),
    documentIntelligence: {
      selectedTier: 'liteparse-structured',
      locatorFidelity: 'page-coordinate',
    },
    spatialPages: [{
      page: 7,
      width: 612,
      height: 792,
      coordinateSystem: 'top-left-72dpi',
      textItems: [
        { text: 'Outcome', page: 7, x: 72, y: 180, width: 50, height: 11, coordinateSystem: 'top-left-72dpi' },
        { text: 'Risk Ratio (95% CI)', page: 7, x: 300, y: 180, width: 105, height: 11, coordinateSystem: 'top-left-72dpi' },
        { text: 'Mortality', page: 7, x: 72, y: 220, width: 55, height: 11, coordinateSystem: 'top-left-72dpi' },
        { text: '1.20', page: 7, x: 300, y: 220, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
        { text: '0.90', page: 7, x: 345, y: 220, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
        { text: '1.60', page: 7, x: 390, y: 220, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
        ...(duplicateEffect
          ? [
              { text: '1.20', page: 7, x: 300, y: 500, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
              { text: '0.90', page: 7, x: 345, y: 500, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
              { text: '1.60', page: 7, x: 390, y: 500, width: 24, height: 11, coordinateSystem: 'top-left-72dpi' },
            ]
          : []),
      ],
    }],
  };
}

test('replaces upstream ratio values with log-scale analysis values while preserving reported RR provenance', async () => {
  const document = liteParseDocument([
    ['Outcome', 'Risk Ratio (95% CI)'],
    ['Mortality', '1.20 (95% CI 0.90, 1.60)'],
  ]);
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(document));
  const studies = result.artifacts.extractedStudies as Array<ExtractedStudy & { outcomes: Array<ExtractedStudy['outcomes'][number] & { effectMeasure?: string; analysisScale?: string }> }>;
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  const expectedEffect = Math.log(1.2);
  const expectedSe = (Math.log(1.6) - Math.log(0.9)) / (2 * 1.96);
  assert.ok(Math.abs((studies[0]?.outcomes[0]?.effect ?? 0) - expectedEffect) < 1e-12);
  assert.ok(Math.abs((studies[0]?.outcomes[0]?.standardError ?? 0) - expectedSe) < 1e-12);
  assert.equal(studies[0]?.outcomes[0]?.effectMeasure, 'RR');
  assert.equal(studies[0]?.outcomes[0]?.analysisScale, 'log');
  assert.equal(ledger[0]?.effect, 1.2);
  assert.ok(Math.abs((ledger[0]?.analysisEffect ?? 0) - expectedEffect) < 1e-12);
  assert.deepEqual(ledger[0]?.confidenceInterval, [0.9, 1.6]);
  assert.equal(ledger[0]?.analysisScale, 'log');
  assert.equal(ledger[0]?.rowLabel, 'Mortality');
  assert.equal(ledger[0]?.columnHeader, 'Risk Ratio (95% CI)');
  assert.equal(ledger[0]?.page, 7);
  assert.equal(ledger[0]?.tableId, 'table-2');
  assert.equal(ledger[0]?.extractionTool, 'liteparse');
  assert.equal(ledger[0]?.status, 'extracted');
  assert.match(ledger[0]?.verbatim ?? '', /Mortality \| 1\.20/);
});

test('coordinate-aware evidence binds row label, column header and numeric cell to exact boxes', async () => {
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(spatialLiteParseDocument()));
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];
  const quality = result.artifacts.quantitativeExtractionQuality as { coordinateBound?: number };

  assert.equal(ledger[0]?.status, 'extracted');
  assert.equal(ledger[0]?.spatialLocator?.coordinateSystem, 'top-left-72dpi');
  assert.deepEqual(ledger[0]?.spatialLocator?.rowLabelBox, {
    page: 7, x: 72, y: 220, width: 55, height: 11, text: 'Mortality', coordinateSystem: 'top-left-72dpi',
  });
  assert.equal(ledger[0]?.spatialLocator?.columnHeaderBox.x, 300);
  assert.equal(ledger[0]?.spatialLocator?.effectCellBox.x, 300);
  assert.equal(ledger[0]?.spatialLocator?.effectCellBox.width, 114);
  assert.equal(quality.coordinateBound, 1);
});

test('coordinate-aware evidence fails closed when a complete effect cell has multiple spatial matches', async () => {
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(spatialLiteParseDocument(true)));
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(studies[0]?.outcomes[0]?.effect, undefined);
  assert.equal(ledger[0]?.status, 'blocked');
  assert.match(ledger[0]?.reason ?? '', /spatial page coordinates/);
});

test('keeps difference measures on the identity analysis scale', async () => {
  const document = liteParseDocument([
    ['Outcome', 'Mean Difference (95% CI)'],
    ['Length of stay', '-2.00 (-3.00, -1.00)'],
  ]);
  const agent = new ProvenanceFirstExtractionAgent(baseAgent('Length of stay'));
  const result = await agent.execute(context(document));
  const studies = result.artifacts.extractedStudies as Array<ExtractedStudy & { outcomes: Array<ExtractedStudy['outcomes'][number] & { effectMeasure?: string; analysisScale?: string }> }>;
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(studies[0]?.outcomes[0]?.effect, -2);
  assert.equal(studies[0]?.outcomes[0]?.effectMeasure, 'MD');
  assert.equal(studies[0]?.outcomes[0]?.analysisScale, 'identity');
  assert.equal(ledger[0]?.analysisScale, 'identity');
  assert.equal(ledger[0]?.analysisEffect, -2);
});

test('does not mistake English or in a column label for an odds-ratio measure', async () => {
  const document = liteParseDocument([
    ['Outcome', 'Death or hospitalization (95% CI)'],
    ['Mortality', '1.20 (0.90, 1.60)'],
  ]);
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(document));
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(studies[0]?.outcomes[0]?.effect, undefined);
  assert.equal(ledger[0]?.status, 'blocked');
});

test('strips upstream numeric values when the document was downgraded below LiteParse structured evidence', async () => {
  const document = {
    ...liteParseDocument([
      ['Outcome', 'Risk Ratio (95% CI)'],
      ['Mortality', '1.20 (0.90, 1.60)'],
    ]),
    documentIntelligence: { selectedTier: 'native-structured', locatorFidelity: 'synthetic-chunk' },
  };
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(document));
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(studies[0]?.outcomes[0]?.effect, undefined);
  assert.equal(studies[0]?.outcomes[0]?.standardError, undefined);
  assert.equal(ledger[0]?.status, 'blocked');
  assert.equal(ledger[0]?.extractionTool, 'blocked-needs-manual');
  assert.match(ledger[0]?.reason ?? '', /requires LiteParse structured evidence/);
});

test('does not guess between multiple matching rows or subgroups', async () => {
  const document = liteParseDocument([
    ['Outcome', 'Risk Ratio (95% CI)'],
    ['Mortality overall', '1.20 (0.90, 1.60)'],
    ['Mortality subgroup A', '0.80 (0.60, 1.10)'],
  ]);
  const agent = new ProvenanceFirstExtractionAgent(baseAgent());
  const result = await agent.execute(context(document));
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];
  const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[];

  assert.equal(studies[0]?.outcomes[0]?.effect, undefined);
  assert.equal(ledger[0]?.status, 'blocked');
  assert.match(ledger[0]?.reason ?? '', /Ambiguous quantitative evidence: 2 labelled estimates/);
});
