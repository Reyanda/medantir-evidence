import test from 'node:test';
import assert from 'node:assert/strict';
import type { HumanVerificationPort } from '../src/core/ports.js';
import type {
  Agent,
  AgentContext,
  AgentResult,
  ExtractedStudy,
  HumanVerificationPackage,
  HumanVerificationSubmission,
} from '../src/core/types.js';
import {
  EstimandAdjudicationExtractionAgent,
  estimandVerificationItemId,
} from '../src/agents/estimand-adjudication.js';
import { recomputeCanonicalEstimandId } from '../src/agents/estimand-fingerprint.js';
import {
  EstimandHumanVerificationAgent,
  type EstimandVerificationAcknowledgement,
} from '../src/agents/estimand-human-verification.js';
import type { CanonicalEstimand, EstimandLedgerRow } from '../src/agents/estimand-identity.js';

function estimand(overrides: Partial<CanonicalEstimand> = {}): CanonicalEstimand {
  const base: CanonicalEstimand = {
    estimandId: '',
    outcome: 'mortality',
    effectMeasure: 'RR',
    analysisScale: 'log',
    interventionOrExposure: 'treatment',
    comparator: 'placebo',
    population: 'hospitalized adults',
    timeHorizon: { status: 'unspecified', evidence: [] },
    analysisPopulation: { status: 'resolved', value: 'intention-to-treat', evidence: ['intention-to-treat'] },
    subgroup: { status: 'unspecified', evidence: [] },
    adjustment: { status: 'unspecified', evidence: [] },
    effectTarget: { status: 'unspecified', evidence: [] },
    source: {
      recordId: 'report-1',
      studyId: 'study-1',
      studyFamilyId: 'family-1',
      reportRole: 'primary-results',
      tableId: 'table-1',
      tableHeading: 'Primary efficacy analysis',
      rowLabel: 'Mortality',
      columnHeader: 'Risk ratio (95% CI)',
      page: 7,
      verbatim: 'Mortality | 0.80 | 0.65 to 0.98',
    },
    unresolvedDimensions: ['timeHorizon', 'subgroup', 'adjustment', 'effectTarget'],
  };
  const merged = { ...base, ...overrides } as CanonicalEstimand;
  merged.estimandId = recomputeCanonicalEstimandId(merged);
  return merged;
}

function ledgerRow(value = estimand()): EstimandLedgerRow {
  return {
    studyId: 'study-1',
    recordId: 'report-1',
    studyFamilyId: 'family-1',
    outcome: 'mortality',
    status: 'identified',
    estimand: value,
  };
}

function context(extra: Record<string, unknown> = {}, mode: 'blinded' | 'unblinded' = 'unblinded'): AgentContext {
  return {
    state: {
      runId: 'estimand-human-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Estimand human test', objective: 'Test estimand adjudication.' },
        humanVerification: { enabled: true, mode, requireAllItems: true },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {
        uniqueRecords: [{
          id: 'report-1',
          title: 'Primary trial report',
          abstract: '',
          authors: ['Example Author'],
          year: 2021,
          sourceDatabases: ['pubmed'],
        }],
        estimandLedger: [ledgerRow()],
        ...extra,
      },
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T03:00:00.000Z',
  };
}

function finalBase(counter: { calls: number }): Agent {
  return {
    stage: 'human-verify',
    async execute(): Promise<AgentResult> {
      counter.calls += 1;
      return {
        artifacts: {
          finalReport: {
            title: 'Report',
            abstract: 'Abstract',
            prisma: { identified: 1, afterDeduplication: 1, tiabIncluded: 1, fullTextIncluded: 1 },
            sections: { conclusion: 'Conclusion' },
            appendices: {},
          },
        },
      };
    },
  };
}

class Port implements HumanVerificationPort {
  package?: HumanVerificationPackage;
  constructor(private readonly decide: (pkg: HumanVerificationPackage) => HumanVerificationSubmission | null) {}
  async review(pkg: HumanVerificationPackage): Promise<HumanVerificationSubmission | null> {
    this.package = pkg;
    return this.decide(pkg);
  }
}

test('unresolved estimand is presented with the exact source table quote and page', async () => {
  const counter = { calls: 0 };
  const result = await new EstimandHumanVerificationAgent(finalBase(counter)).execute(context());
  const pkg = result.artifacts.estimandVerificationPackage as HumanVerificationPackage;
  const item = pkg.items[0]!;

  assert.equal(counter.calls, 0);
  assert.ok(result.awaitingHuman);
  assert.equal(item.id, estimandVerificationItemId(estimand()));
  assert.equal(item.sourceStage, 'extract');
  assert.equal(item.category, 'extraction');
  assert.equal(item.evidence[0]?.recordId, 'report-1');
  assert.equal(item.evidence[0]?.page, 7);
  assert.equal(item.evidence[0]?.quote, 'Mortality | 0.80 | 0.65 to 0.98');
  assert.deepEqual((item.proposedValue as any).unresolvedDimensions, ['timeHorizon', 'subgroup', 'adjustment', 'effectTarget']);
});

test('blinded estimand package pseudonymizes source identity while retaining proof and a separate audit index', async () => {
  const result = await new EstimandHumanVerificationAgent(finalBase({ calls: 0 })).execute(context({}, 'blinded'));
  const pkg = result.artifacts.estimandVerificationPackage as HumanVerificationPackage;
  const item = pkg.items[0]!;
  const index = result.artifacts.estimandVerificationIndex as Array<{ recordId: string; studyFamilyId?: string }>;

  assert.equal(pkg.mode, 'blinded');
  assert.equal(item.context, undefined);
  assert.equal(item.machine, undefined);
  assert.match(item.evidence[0]?.recordId ?? '', /^EST-/);
  assert.equal((item.proposedValue as any).source, undefined);
  assert.equal(JSON.stringify(item.proposedValue).includes('family-1'), false);
  assert.equal(index[0]?.recordId, 'report-1');
  assert.equal(index[0]?.studyFamilyId, 'family-1');
});

test('human estimand amendment enters the shared override ledger and rolls back from extract', async () => {
  const port = new Port((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'amend',
      rationale: 'The table footnote defines the endpoint at day 28.',
      reviewerId: 'reviewer-1',
      decidedAt: '2026-08-10T03:01:00.000Z',
      amendedValue: { timeHorizon: '28-day' },
    }],
  }));
  const result = await new EstimandHumanVerificationAgent(finalBase({ calls: 0 }), port).execute(context());
  const overrides = result.artifacts.humanOverrides as { entries: Array<{ sourceStage: string; amendedValue: any }> };

  assert.equal(result.rework?.fromStage, 'extract');
  assert.equal(overrides.entries[0]?.sourceStage, 'extract');
  assert.equal(overrides.entries[0]?.amendedValue.timeHorizon, '28-day');
  assert.equal((result.artifacts.estimandVerificationOutcome as any).requiresRerunFrom, 'extract');
});

test('sequential partial estimand amendments merge instead of erasing the earlier correction', async () => {
  const itemId = estimandVerificationItemId(estimand());
  const existing = {
    version: 1,
    entries: [{
      itemId,
      sourceStage: 'extract',
      amendedValue: { timeHorizon: '28-day' },
      rationale: 'Resolved time horizon.',
      reviewerId: 'reviewer-1',
      decidedAt: '2026-08-10T03:01:00.000Z',
    }],
  };
  const port = new Port((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'amend',
      rationale: 'The row is the overall population rather than a subgroup.',
      reviewerId: 'reviewer-2',
      decidedAt: '2026-08-10T03:02:00.000Z',
      amendedValue: { subgroup: { value: 'overall' } },
    }],
  }));
  const result = await new EstimandHumanVerificationAgent(finalBase({ calls: 0 }), port).execute(
    context({ humanOverrides: existing }),
  );
  const overrides = result.artifacts.humanOverrides as { entries: Array<{ amendedValue: any }> };

  assert.equal(overrides.entries[0]?.amendedValue.timeHorizon, '28-day');
  assert.equal(overrides.entries[0]?.amendedValue.subgroup.value, 'overall');
});

test('accepted unresolved proposal is skipped only while the reviewed evidence hash is unchanged', async () => {
  const port = new Port((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'accept',
      rationale: 'The source does not resolve these dimensions; retain explicit uncertainty.',
      reviewerId: 'reviewer-3',
      decidedAt: '2026-08-10T03:03:00.000Z',
    }],
  }));
  const firstCounter = { calls: 0 };
  const first = await new EstimandHumanVerificationAgent(finalBase(firstCounter), port).execute(context());
  const acknowledgements = first.artifacts.estimandVerificationAcknowledgements as EstimandVerificationAcknowledgement[];

  assert.equal(firstCounter.calls, 1);
  assert.equal(acknowledgements.length, 1);

  const forbidden = new Port(() => { throw new Error('unchanged accepted estimand should not reopen'); });
  const secondCounter = { calls: 0 };
  await new EstimandHumanVerificationAgent(finalBase(secondCounter), forbidden).execute(
    context({ estimandVerificationAcknowledgements: acknowledgements }),
  );
  assert.equal(secondCounter.calls, 1);

  const changed = estimand({
    source: { ...estimand().source, verbatim: 'Mortality at day 28 | 0.80 | 0.65 to 0.98' },
  });
  const changedPort = new Port(() => null);
  const changedResult = await new EstimandHumanVerificationAgent(finalBase({ calls: 0 }), changedPort).execute(
    context({
      estimandLedger: [ledgerRow(changed)],
      estimandVerificationAcknowledgements: acknowledgements,
    }),
  );
  assert.ok(changedResult.awaitingHuman);
  assert.equal(changedPort.package?.items.length, 1);
});

test('extraction replay regenerates the estimand ID, resolves amended dimensions, and preserves source provenance', async () => {
  const original = estimand();
  const studies: ExtractedStudy[] = [{
    studyId: 'study-1',
    reportIds: ['report-1'],
    design: 'randomized controlled trial',
    population: 'hospitalized adults',
    interventionOrExposure: 'treatment',
    comparator: 'placebo',
    outcomes: [{ name: 'mortality', effect: Math.log(0.8), standardError: 0.1, estimandId: original.estimandId, estimand: original } as any],
    mechanisms: [], funding: '', rationale: '', objectives: [], resultsSummary: '', discussionSummary: '', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [] },
    sourceQuotes: [],
  }];
  const base: Agent = {
    stage: 'extract',
    async execute() {
      return {
        artifacts: {
          extractedStudies: studies,
          estimandLedger: [ledgerRow(original)],
          estimandIdentityQuality: { numericEstimates: 1, fullyResolved: 0, partiallyResolved: 1 },
        },
      };
    },
  };
  const overrides = {
    version: 1,
    entries: [{
      itemId: estimandVerificationItemId(original),
      sourceStage: 'extract',
      amendedValue: {
        timeHorizon: '28-day',
        subgroup: { value: 'overall' },
        adjustment: 'unadjusted',
        effectTarget: 'total-effect',
      },
      rationale: 'Verifier resolved all remaining dimensions from the table footnote and analysis note.',
      reviewerId: 'reviewer-4',
      decidedAt: '2026-08-10T03:04:00.000Z',
    }],
  };
  const result = await new EstimandAdjudicationExtractionAgent(base).execute(
    context({ humanOverrides: overrides }),
  );
  const extracted = result.artifacts.extractedStudies as Array<ExtractedStudy & { outcomes: Array<any> }>;
  const amended = extracted[0]!.outcomes[0]!.estimand;
  const receipts = result.artifacts.estimandHumanAdjudications as Array<{ previousEstimandId: string; amendedEstimandId: string }>;

  assert.notEqual(amended.estimandId, original.estimandId);
  assert.equal(amended.timeHorizon.value, '28-day');
  assert.equal(amended.subgroup.value, 'overall');
  assert.equal(amended.adjustment.value, 'unadjusted');
  assert.equal(amended.effectTarget.value, 'total-effect');
  assert.deepEqual(amended.unresolvedDimensions, []);
  assert.equal(amended.source.recordId, original.source.recordId);
  assert.equal(amended.source.tableId, original.source.tableId);
  assert.equal(amended.source.page, original.source.page);
  assert.equal(receipts[0]?.previousEstimandId, original.estimandId);
  assert.equal(receipts[0]?.amendedEstimandId, amended.estimandId);
});
