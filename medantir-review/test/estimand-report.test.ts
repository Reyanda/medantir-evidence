import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext } from '../src/core/types.js';
import { EstimandReportAgent } from '../src/agents/estimand-identity.js';

function context(): AgentContext {
  return {
    state: {
      runId: 'estimand-report-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Estimand report', objective: 'Persist estimand evidence.' },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {
        estimandLedger: [{
          studyId: 'study-1',
          recordId: 'report-1',
          studyFamilyId: 'family-1',
          outcome: 'mortality',
          status: 'identified',
          estimand: {
            estimandId: 'estimand-abc',
            outcome: 'mortality',
            effectMeasure: 'RR',
            analysisScale: 'log',
            interventionOrExposure: 'treatment',
            comparator: 'placebo',
            population: 'adults',
            timeHorizon: { status: 'resolved', value: '28-day', evidence: ['Mortality at day 28'] },
            analysisPopulation: { status: 'resolved', value: 'intention-to-treat', evidence: ['ITT analysis'] },
            subgroup: { status: 'resolved', value: 'overall', evidence: ['Overall'] },
            adjustment: { status: 'resolved', value: 'unadjusted', evidence: ['Unadjusted RR'] },
            effectTarget: { status: 'unspecified', evidence: [] },
            source: { recordId: 'report-1', studyId: 'study-1', studyFamilyId: 'family-1', tableId: 'table-1', page: 7 },
            unresolvedDimensions: ['effectTarget'],
          },
        }],
        estimandIdentityQuality: { numericEstimates: 1, fullyResolved: 0, partiallyResolved: 1 },
        estimandSynthesisConflicts: [{ outcome: 'mortality', differingDimensions: ['timeHorizon'] }],
        estimandVerificationDebt: [{ outcome: 'recovery', unresolvedDimensions: ['analysisPopulation'] }],
      },
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

const base: Agent = {
  stage: 'report',
  async execute() {
    return {
      artifacts: {
        draftReport: {
          title: 'Report',
          abstract: 'Abstract',
          prisma: { identified: 1, afterDeduplication: 1, tiabIncluded: 1, fullTextIncluded: 1 },
          sections: { methods: 'Methods', results: 'Results', conclusion: 'Conclusion' },
          appendices: { existing: true },
        },
      },
    };
  },
};

test('estimand ledger, quality, conflicts and verification debt persist separately in report appendices', async () => {
  const result = await new EstimandReportAgent(base).execute(context());
  const appendices = (result.artifacts.draftReport as { appendices: Record<string, unknown> }).appendices;

  assert.equal(appendices.existing, true);
  assert.equal((appendices.estimandLedger as unknown[]).length, 1);
  assert.equal((appendices.estimandSynthesisConflicts as unknown[]).length, 1);
  assert.equal((appendices.estimandVerificationDebt as unknown[]).length, 1);
  assert.equal((appendices.estimandIdentityQuality as { numericEstimates?: number }).numericEstimates, 1);
});
