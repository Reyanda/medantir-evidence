import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { DocumentAwareReviewAttentionObserver } from '../src/cognitive/document-aware-attention.js';
import type { ParsedDocument, ReviewRequest } from '../src/core/types.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['pubmed'],
  question: {
    title: 'Test family identity',
    objective: 'Verify participant-study identity independently of report identity.',
    population: 'hospitalized adults',
    interventionOrExposure: 'treatment',
    outcomes: ['mortality'],
  },
};

function eligibleDocument(recordId: string): ParsedDocument {
  const methods = 'A total of 100 hospitalized participants were randomly assigned to treatment or placebo and followed for 28 days.';
  const results = 'Patients receiving treatment had lower mortality, 10% compared with 20% in the placebo group.';
  return {
    recordId,
    text: `${methods}\n${results}`,
    pages: [{ page: 1, text: `${methods}\n${results}` }],
    sections: [
      { name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: methods },
      { name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: results },
    ],
    extractionMethod: 'native',
  };
}

test('ambiguous registry identity becomes explicit cognitive VERIFY debt', () => {
  const state = createPipelineState(request);
  state.artifacts.parsedDocuments = [];
  state.artifacts.fullTextDecisions = [];
  state.artifacts.includedDocuments = [];
  state.artifacts.studyFamilyQuality = {
    totalReports: 1,
    totalFamilies: 1,
    multiReportFamilies: 0,
    registryLinkedReports: 0,
    singletonReportsWithoutRegistry: 0,
    ambiguousRegistryReports: 1,
    familiesWithoutPrimaryResults: 1,
    duplicateFamilyPoolingBlocked: true,
  };
  state.artifacts.studyFamilyLinks = [{
    recordId: 'report-1',
    familyId: 'family-report-1',
    linkageBasis: 'ambiguous-multiple-registry-ids',
    requiresHumanReview: true,
  }];

  const decision = new DocumentAwareReviewAttentionObserver().assess({
    state,
    stage: 'fulltext-screen',
    attempt: 1,
    result: { artifacts: {} },
    validation: { ok: true, issues: [] },
    warnings: [],
    requiredArtifacts: ['parsedDocuments'],
    producedArtifacts: ['fullTextDecisions', 'includedDocuments'],
  });

  assert.equal(decision.action, 'VERIFY');
  assert.ok(decision.reasons.some((reason) => /multiple registry identifiers/i.test(reason)));
});

test('eligible report with unresolved family identity becomes VERIFY debt before synthesis', () => {
  const state = createPipelineState(request);
  const included = eligibleDocument('eligible-1');
  state.artifacts.parsedDocuments = [included];
  state.artifacts.fullTextDecisions = [{
    recordId: 'eligible-1',
    decision: 'include',
    reason: 'eligible fixture',
    confidence: 0.99,
    evidence: ['participant-flow', 'mortality'],
  }];
  state.artifacts.includedDocuments = [included];
  state.artifacts.studyFamilyQuality = {
    totalReports: 1,
    totalFamilies: 1,
    multiReportFamilies: 0,
    registryLinkedReports: 0,
    singletonReportsWithoutRegistry: 1,
    ambiguousRegistryReports: 0,
    familiesWithoutPrimaryResults: 0,
    duplicateFamilyPoolingBlocked: true,
  };
  state.artifacts.studyFamilyLinks = [{
    recordId: 'eligible-1',
    familyId: 'family-report-eligible-1',
    linkageBasis: 'singleton-no-registry',
    requiresHumanReview: true,
  }];

  const decision = new DocumentAwareReviewAttentionObserver().assess({
    state,
    stage: 'fulltext-screen',
    attempt: 1,
    result: { artifacts: {} },
    validation: { ok: true, issues: [] },
    warnings: [],
    requiredArtifacts: ['parsedDocuments'],
    producedArtifacts: ['fullTextDecisions', 'includedDocuments'],
  });

  assert.equal(decision.action, 'VERIFY');
  assert.ok(decision.reasons.some((reason) => /unresolved study-family identity/i.test(reason)));
});
