import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext } from '../src/core/types.js';
import { StudyFamilyEvidenceReportAgent } from '../src/agents/study-family-evidence-report.js';

function context(): AgentContext {
  return {
    state: {
      runId: 'family-report-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Family report', objective: 'Persist identity evidence.' },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {
        studyFamilyEvidenceLedger: [{
          recordId: 'report-1',
          familyId: 'family-registry-nct04401579',
          linkageBasis: 'human-adjudicated',
          evidence: [{
            id: 'family-evidence-1',
            recordId: 'report-1',
            section: 'methods',
            page: 4,
            quote: 'Trial registration NCT04401579.',
            source: 'full-text',
          }],
          reasons: ['verified'],
          requiresHumanReview: false,
        }],
        studyFamilyLinks: [{
          recordId: 'report-1',
          familyId: 'family-registry-nct04401579',
          linkageBasis: 'human-adjudicated',
          humanOverride: {
            itemId: 'family:abc',
            rationale: 'Matched against registry evidence.',
            reviewerId: 'reviewer-1',
            decidedAt: '2026-08-10T01:00:00.000Z',
          },
        }],
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
          sections: { methods: 'Methods', results: 'Results', discussion: '', limitations: '', conclusion: 'Conclusion' },
          appendices: { existing: true },
        },
      },
    };
  },
};

test('family evidence and human adjudication receipts persist as separate report appendices', async () => {
  const result = await new StudyFamilyEvidenceReportAgent(base).execute(context());
  const draft = result.artifacts.draftReport as { appendices?: Record<string, unknown> };
  const evidence = draft.appendices?.studyFamilyEvidenceLedger as unknown[];
  const adjudications = draft.appendices?.studyFamilyHumanAdjudications as Array<{ recordId?: string; receipt?: { reviewerId?: string } }>;

  assert.equal(draft.appendices?.existing, true);
  assert.equal(evidence.length, 1);
  assert.equal(adjudications.length, 1);
  assert.equal(adjudications[0]?.recordId, 'report-1');
  assert.equal(adjudications[0]?.receipt?.reviewerId, 'reviewer-1');
});
