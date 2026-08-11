import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../src/core/types.js';
import type { QuantitativeExtractionLedgerRow } from '../src/agents/provenance-first-extraction.js';
import {
  EstimandAwareSynthesisAgent,
  EstimandIdentityExtractionAgent,
  compareEstimands,
  type CanonicalEstimand,
} from '../src/agents/estimand-identity.js';

function study(
  studyId: string,
  recordId: string,
  familyId: string,
  outcomeName: string,
): ExtractedStudy & { studyFamilyId: string; reportRole: 'primary-results' } {
  return {
    studyId,
    reportIds: [recordId],
    design: 'randomized controlled trial',
    population: 'hospitalized adults with covid 19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    comparator: 'remdesivir plus placebo',
    outcomes: [{
      name: outcomeName,
      effect: Math.log(0.8),
      standardError: 0.1,
      effectMeasure: 'RR',
      analysisScale: 'log',
      reportedEffect: 0.8,
      reportedConfidenceInterval: [0.65, 0.98],
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
    studyFamilyId: familyId,
    reportRole: 'primary-results',
  };
}

function ledger(
  studyId: string,
  recordId: string,
  outcome: string,
  rowLabel: string,
  heading = 'Primary efficacy analysis',
  columnHeader = 'Risk ratio (95% CI)',
): QuantitativeExtractionLedgerRow {
  return {
    studyId,
    recordId,
    outcome,
    status: 'extracted',
    effectMeasure: 'RR',
    analysisScale: 'log',
    effect: 0.8,
    analysisEffect: Math.log(0.8),
    standardError: 0.1,
    confidenceInterval: [0.65, 0.98],
    tableId: `table-${studyId}`,
    tableHeading: heading,
    rowLabel,
    columnHeader,
    page: 7,
    verbatim: `${rowLabel} | 0.80 | 0.65 to 0.98`,
    extractionTool: 'liteparse',
  };
}

function extractionContext(): AgentContext {
  return {
    state: {
      runId: 'estimand-test',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Estimand test', objective: 'Test estimand identity.' },
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

function extractionBase(studies: ExtractedStudy[], rows: QuantitativeExtractionLedgerRow[]): Agent {
  return {
    stage: 'extract',
    async execute(): Promise<AgentResult> {
      return { artifacts: { extractedStudies: studies, quantitativeExtractionLedger: rows } };
    },
  };
}

async function identify(
  studies: ExtractedStudy[],
  rows: QuantitativeExtractionLedgerRow[],
): Promise<Array<ExtractedStudy & { studyFamilyId?: string; outcomes: Array<any> }>> {
  const result = await new EstimandIdentityExtractionAgent(extractionBase(studies, rows)).execute(extractionContext());
  return result.artifacts.extractedStudies as Array<ExtractedStudy & { studyFamilyId?: string; outcomes: Array<any> }>;
}

test('explicit 28-day ITT and 60-day ITT estimates receive demonstrably different estimands', async () => {
  const studies = [
    study('s1', 'r1', 'family-1', 'all-cause mortality'),
    study('s2', 'r2', 'family-1', 'all-cause mortality'),
  ];
  const identified = await identify(studies, [
    ledger('s1', 'r1', 'all-cause mortality', 'All-cause mortality at day 28 — intention-to-treat population'),
    ledger('s2', 'r2', 'all-cause mortality', 'All-cause mortality at day 60 — intention-to-treat population'),
  ]);
  const left = identified[0]!.outcomes[0]!.estimand as CanonicalEstimand;
  const right = identified[1]!.outcomes[0]!.estimand as CanonicalEstimand;
  const comparison = compareEstimands(left, right);

  assert.notEqual(left.estimandId, right.estimandId);
  assert.equal(left.timeHorizon.status, 'resolved');
  assert.equal(left.timeHorizon.value, '28-day');
  assert.equal(left.analysisPopulation.value, 'intention-to-treat');
  assert.equal(right.timeHorizon.value, '60-day');
  assert.equal(comparison.relationship, 'different');
  assert.deepEqual(comparison.differingDimensions, ['timeHorizon']);
});

test('ITT versus per-protocol is an explicit estimand difference even with the same outcome/timepoint', async () => {
  const studies = [
    study('s1', 'r1', 'family-1', 'clinical recovery'),
    study('s2', 'r2', 'family-1', 'clinical recovery'),
  ];
  const identified = await identify(studies, [
    ledger('s1', 'r1', 'clinical recovery', 'Clinical recovery at day 14 — intention-to-treat analysis'),
    ledger('s2', 'r2', 'clinical recovery', 'Clinical recovery at day 14 — per-protocol analysis'),
  ]);
  const comparison = compareEstimands(
    identified[0]!.outcomes[0]!.estimand,
    identified[1]!.outcomes[0]!.estimand,
  );

  assert.equal(comparison.relationship, 'different');
  assert.deepEqual(comparison.differingDimensions, ['analysisPopulation']);
});

test('one explicit timepoint and one unspecified timepoint remain unresolved rather than being treated as different', async () => {
  const studies = [
    study('s1', 'r1', 'family-1', 'mortality'),
    study('s2', 'r2', 'family-1', 'mortality'),
  ];
  const identified = await identify(studies, [
    ledger('s1', 'r1', 'mortality', 'Mortality at day 28'),
    ledger('s2', 'r2', 'mortality', 'Mortality'),
  ]);
  const comparison = compareEstimands(
    identified[0]!.outcomes[0]!.estimand,
    identified[1]!.outcomes[0]!.estimand,
  );

  assert.equal(comparison.relationship, 'unresolved');
  assert.ok(comparison.unresolvedDimensions.includes('timeHorizon'));
});

function synthesisContext(studies: ExtractedStudy[]): AgentContext {
  const context = extractionContext();
  context.state.artifacts.extractedStudies = studies;
  return context;
}

const computedBase: Agent = {
  stage: 'synthesise',
  async execute(): Promise<AgentResult> {
    const synthesis: SynthesisResult = {
      mode: 'meta-analysis',
      status: 'computed',
      includedStudies: 2,
      pooledEffect: -0.2,
      standardError: 0.08,
      narrative: 'base pooled result',
    };
    return { artifacts: { synthesis } };
  },
};

test('same-family estimates with unproven distinctness are blocked even when their estimand IDs differ through partial evidence', async () => {
  const raw = [
    study('s1', 'r1', 'family-1', 'mortality'),
    study('s2', 'r2', 'family-1', 'mortality'),
  ];
  const identified = await identify(raw, [
    ledger('s1', 'r1', 'mortality', 'Mortality at day 28'),
    ledger('s2', 'r2', 'mortality', 'Mortality'),
  ]);
  const result = await new EstimandAwareSynthesisAgent(computedBase).execute(synthesisContext(identified));
  const synthesis = result.artifacts.synthesis as SynthesisResult;
  const conflicts = result.artifacts.studyFamilySynthesisConflicts as Array<{ relationship: string; unresolvedDimensions: string[] }>;

  assert.equal(synthesis.status, 'narrative');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.relationship, 'unresolved');
  assert.ok(conflicts[0]?.unresolvedDimensions.includes('timeHorizon'));
});

test('same-family reports with a proven different time horizon do not trigger duplicate-family blocking', async () => {
  const raw = [
    study('s1', 'r1', 'family-1', 'mortality'),
    study('s2', 'r2', 'family-1', 'mortality'),
  ];
  const identified = await identify(raw, [
    ledger('s1', 'r1', 'mortality', 'Mortality at day 28 — intention-to-treat'),
    ledger('s2', 'r2', 'mortality', 'Mortality at day 60 — intention-to-treat'),
  ]);
  const result = await new EstimandAwareSynthesisAgent(computedBase).execute(synthesisContext(identified));
  const familyConflicts = result.artifacts.studyFamilySynthesisConflicts as unknown[];
  const synthesisConflicts = result.artifacts.estimandSynthesisConflicts as unknown[];

  assert.equal(familyConflicts.length, 0);
  // The reports are dependent members of one family but target genuinely
  // different timepoint estimands, so they are not duplicate reports. They also
  // must never be pooled together as if they were two independent studies.
  assert.equal(synthesisConflicts.length, 0);
});

test('different independent-study time horizons block a same-named outcome pool', async () => {
  const raw = [
    study('s1', 'r1', 'family-1', 'mortality'),
    study('s2', 'r2', 'family-2', 'mortality'),
  ];
  const identified = await identify(raw, [
    ledger('s1', 'r1', 'mortality', 'Mortality at day 28 — intention-to-treat'),
    ledger('s2', 'r2', 'mortality', 'Mortality at day 60 — intention-to-treat'),
  ]);
  const result = await new EstimandAwareSynthesisAgent(computedBase).execute(synthesisContext(identified));
  const synthesis = result.artifacts.synthesis as SynthesisResult;
  const conflicts = result.artifacts.estimandSynthesisConflicts as Array<{ differingDimensions: string[] }>;

  assert.equal(synthesis.status, 'narrative');
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.differingDimensions, ['timeHorizon']);
});

test('independent studies with the same resolved estimand leave the base synthesis intact', async () => {
  const raw = [
    study('s1', 'r1', 'family-1', 'mortality'),
    study('s2', 'r2', 'family-2', 'mortality'),
  ];
  const identified = await identify(raw, [
    ledger('s1', 'r1', 'mortality', 'Overall mortality at day 28 — intention-to-treat', 'Unadjusted primary efficacy analysis', 'Unadjusted risk ratio (95% CI)'),
    ledger('s2', 'r2', 'mortality', 'Overall mortality at day 28 — intention-to-treat', 'Unadjusted primary efficacy analysis', 'Unadjusted risk ratio (95% CI)'),
  ]);
  const result = await new EstimandAwareSynthesisAgent(computedBase).execute(synthesisContext(identified));
  const synthesis = result.artifacts.synthesis as SynthesisResult;

  assert.equal(synthesis.status, 'computed');
  assert.equal(result.artifacts.estimandSynthesisConflicts as unknown[] instanceof Array, true);
  assert.equal((result.artifacts.estimandSynthesisConflicts as unknown[]).length, 0);
});
