import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../src/core/types.js';
import type { QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import { EstimandDependenceGuardAgent } from '../src/agents/estimand-dependence-guard.js';
import { EstimandAwareSynthesisAgent, EstimandIdentityExtractionAgent } from '../src/agents/estimand-identity.js';

function study(studyId: string, recordId: string) {
  return {
    studyId,
    reportIds: [recordId],
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
    studyFamilyId: 'family-1',
    reportRole: 'primary-results' as const,
  };
}

function ledger(studyId: string, recordId: string, day: number): QuantitativeExtractionLedgerRow {
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
    tableHeading: 'Primary efficacy analysis',
    rowLabel: `Overall mortality at day ${day} — intention-to-treat`,
    columnHeader: 'Unadjusted risk ratio (95% CI)',
    page: 7,
    verbatim: `Overall mortality at day ${day} — intention-to-treat | 0.80 | 0.65 to 0.98`,
    extractionTool: 'liteparse',
  };
}

function ctx(artifacts: Record<string, unknown> = {}): AgentContext {
  return {
    state: {
      runId: 'dependence-test',
      request: { reviewType: 'systematic', databases: ['pubmed'], question: { title: 'Test', objective: 'Test dependence.' } },
      stages: {} as AgentContext['state']['stages'],
      artifacts,
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

test('day-28 and day-60 reports from one family are distinct estimands but not independent studies', async () => {
  const studies = [study('s1', 'r1'), study('s2', 'r2')];
  const extractionBase: Agent = {
    stage: 'extract',
    async execute() {
      return { artifacts: { extractedStudies: studies, quantitativeExtractionLedger: [ledger('s1', 'r1', 28), ledger('s2', 'r2', 60)] } };
    },
  };
  const extraction = await new EstimandIdentityExtractionAgent(extractionBase).execute(ctx());
  const identified = extraction.artifacts.extractedStudies as ExtractedStudy[];

  const synthesisBase: Agent = {
    stage: 'synthesise',
    async execute(): Promise<AgentResult> {
      const synthesis: SynthesisResult = {
        mode: 'meta-analysis', status: 'computed', includedStudies: 2, pooledEffect: -0.2, standardError: 0.08, narrative: 'base pool',
      };
      return { artifacts: { synthesis } };
    },
  };
  const guard = new EstimandDependenceGuardAgent(new EstimandAwareSynthesisAgent(synthesisBase));
  const result = await guard.execute(ctx({ extractedStudies: identified }));
  const synthesis = result.artifacts.synthesis as SynthesisResult;
  const familyConflicts = result.artifacts.studyFamilySynthesisConflicts as unknown[];
  const estimandConflicts = result.artifacts.estimandSynthesisConflicts as Array<{ familyId?: string; differingDimensions: string[] }>;

  assert.equal(familyConflicts.length, 0, 'distinct estimands should not be mislabeled duplicate report estimands');
  assert.equal(synthesis.status, 'narrative', 'same cohort must not contribute both rows as independent studies');
  assert.equal(estimandConflicts.length, 1);
  assert.equal(estimandConflicts[0]?.familyId, 'family-1');
  assert.deepEqual(estimandConflicts[0]?.differingDimensions, ['timeHorizon']);
  assert.match(synthesis.narrative, /does not establish statistical independence/i);
});
