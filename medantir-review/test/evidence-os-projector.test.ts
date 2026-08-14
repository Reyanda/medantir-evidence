import test from 'node:test';
import assert from 'node:assert/strict';
import type { PipelineState, StageName } from '../src/core/types.js';
import { projectPipelineToEvidenceGraph } from '../src/evidence-os/projector.js';

const stageNames = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve',
  'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
] as StageName[];

function state(): PipelineState {
  return {
    runId: 'eos-projection-run',
    request: {
      reviewType: 'systematic',
      databases: ['PubMed'],
      question: { title: 'Test question', objective: 'Estimate the effect.' },
    },
    stages: Object.fromEntries(stageNames.map((name) => [name, {
      name, status: 'pending', attempts: 0, errors: [],
    }])) as unknown as PipelineState['stages'],
    artifacts: {
      searchResults: [{
        id: 'p1', title: 'Paper', abstract: 'Abstract', authors: [], year: 2024, sourceDatabases: ['PubMed'],
      }],
      uniqueRecords: [{
        id: 'p1', title: 'Paper', abstract: 'Abstract', authors: [], year: 2024, sourceDatabases: ['PubMed'],
      }],
      tiabDecisions: [{ recordId: 'p1', decision: 'include', reason: 'Eligible', confidence: 1, evidence: [] }],
      extractedStudies: [{
        studyId: 's1', reportIds: ['p1'], design: 'randomised controlled trial', population: 'children',
        interventionOrExposure: 'treatment', comparator: 'control',
        outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1 }],
        mechanisms: [], funding: 'Not reported', rationale: 'Rationale', objectives: ['Objective'],
        resultsSummary: 'Results', discussionSummary: 'Discussion', limitations: [],
        sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
        fieldEvidence: {}, sourceQuotes: [],
      }],
      synthesis: { mode: 'meta-analysis', includedStudies: 1, narrative: 'Narrative.' },
      modelReceipt: { requestedModel: 'candidate', actualModel: 'pinned', provider: 'provider-a', inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
    },
    audit: [],
    createdAt: '2026-08-14T08:00:00Z',
    updatedAt: '2026-08-14T08:00:00Z',
  };
}

test('pipeline projection creates linked evidence objects and a clock-stable graph hash', () => {
  const first = projectPipelineToEvidenceGraph(state(), '2026-08-14T08:00:00Z');
  const changedClock = state();
  changedClock.updatedAt = '2026-08-15T08:00:00Z';
  const second = projectPipelineToEvidenceGraph(changedClock, '2026-08-15T08:00:00Z');
  assert.equal(first.graphHash, second.graphHash);
  assert.ok(first.summary.objectCountsByKind.question);
  assert.ok(first.summary.objectCountsByKind.study);
  assert.ok(first.summary.objectCountsByKind['effect-estimate']);
  assert.ok(first.summary.objectCountsByKind['screening-decision']);
  assert.ok(first.edges.some((edge) => edge.relation === 'deduplicated-to'));
  assert.ok(first.edges.some((edge) => edge.relation === 'contributes-to'));
});
