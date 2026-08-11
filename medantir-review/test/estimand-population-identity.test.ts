import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, ExtractedStudy } from '../src/core/types.js';
import type { QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import { EstimandIdentityExtractionAgent, compareEstimands } from '../src/agents/estimand-identity.js';

function study(studyId: string, recordId: string, population: string): ExtractedStudy {
  return {
    studyId,
    reportIds: [recordId],
    design: 'randomized controlled trial',
    population,
    interventionOrExposure: 'treatment',
    comparator: 'placebo',
    outcomes: [{
      name: 'mortality',
      effect: Math.log(0.8),
      standardError: 0.1,
      effectMeasure: 'RR',
      analysisScale: 'log',
    } as any],
    mechanisms: [],
    funding: '',
    rationale: '',
    objectives: [],
    resultsSummary: '',
    discussionSummary: '',
    limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [] },
    sourceQuotes: [],
  };
}

function ledger(studyId: string, recordId: string): QuantitativeExtractionLedgerRow {
  return {
    studyId,
    recordId,
    outcome: 'mortality',
    status: 'extracted',
    effectMeasure: 'RR',
    analysisScale: 'log',
    effect: 0.8,
    analysisEffect: Math.log(0.8),
    standardError: 0.1,
    confidenceInterval: [0.65, 0.98],
    tableId: `table-${studyId}`,
    tableHeading: 'Unadjusted primary analysis',
    rowLabel: 'Overall mortality at day 28 — intention-to-treat',
    columnHeader: 'Unadjusted risk ratio (95% CI)',
    page: 7,
    verbatim: 'Overall mortality at day 28 — intention-to-treat | 0.80 | 0.65 to 0.98',
    extractionTool: 'liteparse',
  };
}

function context(): AgentContext {
  return {
    state: {
      runId: 'estimand-population-test',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Population identity', objective: 'Test population in estimand identity.' },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {},
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

test('otherwise identical adult and pediatric effects have different estimand IDs and compare as different populations', async () => {
  const studies = [
    study('adult-study', 'adult-report', 'hospitalized adults'),
    study('child-study', 'child-report', 'hospitalized children'),
  ];
  const base: Agent = {
    stage: 'extract',
    async execute() {
      return {
        artifacts: {
          extractedStudies: studies,
          quantitativeExtractionLedger: [
            ledger('adult-study', 'adult-report'),
            ledger('child-study', 'child-report'),
          ],
        },
      };
    },
  };

  const result = await new EstimandIdentityExtractionAgent(base).execute(context());
  const extracted = result.artifacts.extractedStudies as Array<ExtractedStudy & { outcomes: Array<any> }>;
  const adult = extracted[0]!.outcomes[0]!.estimand;
  const child = extracted[1]!.outcomes[0]!.estimand;
  const comparison = compareEstimands(adult, child);

  assert.notEqual(adult.estimandId, child.estimandId);
  assert.equal(adult.population, 'hospitalized adults');
  assert.equal(child.population, 'hospitalized children');
  assert.equal(comparison.relationship, 'different');
  assert.ok(comparison.differingDimensions.includes('population'));
});
