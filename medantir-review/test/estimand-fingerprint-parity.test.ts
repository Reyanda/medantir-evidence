import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, ExtractedStudy } from '../src/core/types.js';
import type { QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import { recomputeCanonicalEstimandId } from '../src/agents/estimand-fingerprint.js';
import { EstimandIdentityExtractionAgent } from '../src/agents/estimand-identity.js';

function context(): AgentContext {
  return {
    state: {
      runId: 'fingerprint-parity',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Parity', objective: 'Keep estimand hashes aligned.' },
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

test('adjudication recomputation exactly matches extraction fingerprint including population and subgroup label', async () => {
  const study: ExtractedStudy = {
    studyId: 'study-1',
    reportIds: ['report-1'],
    design: 'randomized controlled trial',
    population: 'hospitalized adults',
    interventionOrExposure: 'treatment',
    comparator: 'placebo',
    outcomes: [{
      name: 'mortality',
      effect: Math.log(0.8),
      standardError: 0.1,
      effectMeasure: 'RR',
      analysisScale: 'log',
    } as any],
    mechanisms: [], funding: '', rationale: '', objectives: [], resultsSummary: '', discussionSummary: '', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [] },
    sourceQuotes: [],
  };
  const row: QuantitativeExtractionLedgerRow = {
    studyId: 'study-1',
    recordId: 'report-1',
    outcome: 'mortality',
    status: 'extracted',
    effectMeasure: 'RR',
    analysisScale: 'log',
    effect: 0.8,
    analysisEffect: Math.log(0.8),
    standardError: 0.1,
    confidenceInterval: [0.65, 0.98],
    tableId: 'table-1',
    tableHeading: 'Unadjusted total effect analysis',
    rowLabel: 'Subgroup: age 65 years or older — mortality at day 28 — intention-to-treat',
    columnHeader: 'Unadjusted risk ratio (95% CI)',
    page: 7,
    verbatim: 'Subgroup: age 65 years or older — mortality at day 28 — intention-to-treat | 0.80 | 0.65 to 0.98',
    extractionTool: 'liteparse',
  };
  const base: Agent = {
    stage: 'extract',
    async execute() {
      return { artifacts: { extractedStudies: [study], quantitativeExtractionLedger: [row] } };
    },
  };

  const result = await new EstimandIdentityExtractionAgent(base).execute(context());
  const extracted = result.artifacts.extractedStudies as Array<ExtractedStudy & { outcomes: Array<any> }>;
  const value = extracted[0]!.outcomes[0]!.estimand;

  assert.equal(value.population, 'hospitalized adults');
  assert.equal(value.subgroup.value, 'subgroup');
  assert.match(value.subgroup.label, /age 65 years or older/i);
  assert.equal(recomputeCanonicalEstimandId(value), value.estimandId);
});
