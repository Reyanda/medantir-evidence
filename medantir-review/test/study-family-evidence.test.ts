import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Agent,
  AgentContext,
  EvidenceRecord,
  ParsedDocument,
  ScreeningDecision,
} from '../src/core/types.js';
import { StudyFamilyLinkageAgent } from '../src/agents/study-family-linkage.js';
import {
  EvidenceBoundStudyFamilyAgent,
  studyFamilyVerificationItemId,
  type EvidenceBoundStudyFamilyLink,
} from '../src/agents/study-family-evidence.js';

function record(id: string, title: string, abstract = '', keywords: string[] = []): EvidenceRecord {
  return {
    id,
    title,
    abstract,
    authors: ['Example Author'],
    year: 2021,
    sourceDatabases: ['pubmed'],
    keywords,
  };
}

function document(recordId: string, methods: string): ParsedDocument {
  return {
    recordId,
    text: methods,
    pages: [{ page: 4, text: methods }],
    sections: [{ name: 'methods', heading: 'Methods', pageStart: 4, pageEnd: 4, text: methods }],
    extractionMethod: 'native',
  };
}

function decision(recordId: string, value: ScreeningDecision['decision']): ScreeningDecision {
  return { recordId, decision: value, reason: 'fixture', confidence: 0.9, evidence: [] };
}

function base(decisions: ScreeningDecision[]): Agent {
  return {
    stage: 'fulltext-screen',
    async execute() {
      return { artifacts: { fullTextDecisions: decisions, includedDocuments: [] } };
    },
  };
}

function context(artifacts: Record<string, unknown>): AgentContext {
  return {
    state: {
      runId: 'family-evidence-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: {
          title: 'Family test',
          objective: 'Test family evidence.',
          population: 'hospitalized adults',
          interventionOrExposure: 'treatment',
          outcomes: ['mortality'],
        },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts,
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

test('registry-based family proposal retains the exact source excerpt that exposed the registry ID', async () => {
  const rec = record('report-1', 'Primary trial report', '', ['NCT04401579']);
  const doc = document('report-1', 'Eligible participants in NCT04401579 were randomly assigned to treatment or placebo.');
  const linkage = new StudyFamilyLinkageAgent(base([decision('report-1', 'include')]));
  const agent = new EvidenceBoundStudyFamilyAgent(linkage);
  const result = await agent.execute(context({ uniqueRecords: [rec], parsedDocuments: [doc] }));
  const links = result.artifacts.studyFamilyLinks as EvidenceBoundStudyFamilyLink[];
  const ledger = result.artifacts.studyFamilyEvidenceLedger as Array<{ recordId: string; evidence: Array<{ id: string; quote: string; source: string }> }>;

  assert.equal(links[0]?.familyId, 'family-registry-nct04401579');
  assert.ok((links[0]?.evidence.length ?? 0) >= 1);
  assert.ok(links[0]?.evidence.some((item) => /NCT04401579/.test(item.quote)));
  assert.ok(links[0]?.evidence.every((item) => item.id.startsWith('family-evidence-')));
  assert.equal(ledger[0]?.recordId, 'report-1');
  assert.ok(ledger[0]?.evidence.some((item) => /NCT04401579/.test(item.quote)));
});

test('human family amendment is replayed into links and regenerated family aggregates', async () => {
  const rec = record('secondary-report', 'Biomarker secondary analysis');
  const doc = document('secondary-report', 'This secondary analysis evaluated biomarkers in participants from a parent clinical trial.');
  const itemId = studyFamilyVerificationItemId('secondary-report');
  const linkage = new StudyFamilyLinkageAgent(base([decision('secondary-report', 'uncertain')]));
  const agent = new EvidenceBoundStudyFamilyAgent(linkage);
  const result = await agent.execute(context({
    uniqueRecords: [rec],
    parsedDocuments: [doc],
    humanOverrides: {
      version: 1,
      entries: [{
        itemId,
        sourceStage: 'fulltext-screen',
        amendedValue: {
          familyId: 'family-registry-nct04401579',
          role: 'secondary-analysis',
          registryIds: ['NCT04401579'],
        },
        rationale: 'Verifier matched the report to the parent ACTT-2 registration.',
        reviewerId: 'reviewer-1',
        decidedAt: '2026-08-10T01:00:00.000Z',
      }],
    },
  }));

  const links = result.artifacts.studyFamilyLinks as EvidenceBoundStudyFamilyLink[];
  const families = result.artifacts.studyFamilies as Array<{ familyId: string; memberReportIds: string[]; roles: Record<string, string[]> }>;
  const quality = result.artifacts.studyFamilyQuality as { humanAdjudicatedReports?: number; singletonReportsWithoutRegistry?: number };

  assert.equal(links[0]?.familyId, 'family-registry-nct04401579');
  assert.equal(links[0]?.role, 'secondary-analysis');
  assert.deepEqual(links[0]?.registryIds, ['NCT04401579']);
  assert.equal(links[0]?.linkageBasis, 'human-adjudicated');
  assert.equal(links[0]?.requiresHumanReview, false);
  assert.equal(links[0]?.confidence, 1);
  assert.equal(links[0]?.humanOverride?.itemId, itemId);
  assert.equal(families[0]?.familyId, 'family-registry-nct04401579');
  assert.deepEqual(families[0]?.memberReportIds, ['secondary-report']);
  assert.deepEqual(families[0]?.roles['secondary-analysis'], ['secondary-report']);
  assert.equal(quality.humanAdjudicatedReports, 1);
  assert.equal(quality.singletonReportsWithoutRegistry, 0);
});
