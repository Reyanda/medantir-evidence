import test from 'node:test';
import assert from 'node:assert/strict';
import { SectionAwareFullTextEligibilityAgent } from '../src/agents/section-aware-eligibility.js';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, ParsedDocument, ReviewRequest, ScreeningDecision } from '../src/core/types.js';

const request: ReviewRequest = {
  reviewType: 'systematic', databases: ['PubMed'],
  question: {
    title: 'Clinical review', objective: 'Evaluate treatment',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir', outcomes: ['recovery'],
  },
};

const narrative: ParsedDocument = {
  recordId: 'narrative-review',
  text: 'Baricitinib and remdesivir have been used in hospitalized patients. Prior trials reported recovery and safety.',
  pages: [{ page: 1, text: 'review' }],
  sections: [
    { name: 'rationale', heading: 'Background', pageStart: 1, pageEnd: 1, text: 'Hospitalized patients and prior clinical trials are discussed.' },
    { name: 'discussion', heading: 'Discussion', pageStart: 1, pageEnd: 1, text: 'The literature suggests possible benefit and additional research is needed.' },
  ],
  extractionMethod: 'native',
};

test('concept-matching full text without Methods/Results study anchors becomes uncertain and cannot enter extraction', async () => {
  const state = createPipelineState(request);
  state.artifacts.parsedDocuments = [narrative];
  const base: Agent = {
    stage: 'fulltext-screen',
    async execute() {
      const decision: ScreeningDecision = {
        recordId: narrative.recordId, decision: 'include', reason: 'lexical match', confidence: 0.9,
        evidence: ['baricitinib', 'remdesivir', 'patients'],
      };
      return { artifacts: { fullTextDecisions: [decision], includedDocuments: [narrative] } };
    },
  };

  const result = await new SectionAwareFullTextEligibilityAgent(base).execute({ state, now: () => '2026-08-09T00:00:00.000Z' });
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { retainedAsUncertainWithoutClinicalStudyAnchor?: number };

  assert.equal(decision.decision, 'uncertain');
  assert.match(decision.reason, /withhold from extraction/i);
  assert.deepEqual(result.artifacts.includedDocuments, []);
  assert.equal(quality.retainedAsUncertainWithoutClinicalStudyAnchor, 1);
});
