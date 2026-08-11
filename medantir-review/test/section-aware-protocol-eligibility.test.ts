import test from 'node:test';
import assert from 'node:assert/strict';
import { SectionAwareFullTextEligibilityAgent } from '../src/agents/section-aware-eligibility.js';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, ParsedDocument, ReviewRequest, ScreeningDecision } from '../src/core/types.js';

type SearchAwareRequest = ReviewRequest & {
  searchConcepts: { blocks: Array<{ code: string; role: string; terms: string[] }> };
};

const request: SearchAwareRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  question: {
    title: 'Baricitinib plus remdesivir for hospitalized adults with COVID-19',
    objective: 'Evaluate the combination treatment.',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    outcomes: ['time to recovery'],
  },
  searchConcepts: {
    blocks: [
      { code: 'I1', role: 'intervention', terms: ['baricitinib'] },
      { code: 'I2', role: 'intervention', terms: ['remdesivir'] },
    ],
  },
};

function parsed(recordId: string, methods: string, results: string, introduction = ''): ParsedDocument {
  return {
    recordId,
    text: `${introduction}\n${methods}\n${results}`,
    pages: [{ page: 1, text: `${methods}\n${results}` }],
    sections: [
      ...(introduction ? [{ name: 'rationale' as const, heading: 'Introduction', pageStart: 1, pageEnd: 1, text: introduction }] : []),
      { name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: methods },
      { name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: results },
    ],
    extractionMethod: 'native',
  };
}

function base(documents: ParsedDocument[]): Agent {
  return {
    stage: 'fulltext-screen',
    async execute() {
      const fullTextDecisions: ScreeningDecision[] = documents.map((document) => ({
        recordId: document.recordId,
        decision: 'include',
        reason: 'base lexical match',
        confidence: 0.9,
        evidence: [],
      }));
      return { artifacts: { fullTextDecisions, includedDocuments: documents } };
    },
  };
}

async function screen(documents: ParsedDocument[], activeRequest: SearchAwareRequest = request) {
  const state = createPipelineState(activeRequest);
  state.artifacts.parsedDocuments = documents;
  return new SectionAwareFullTextEligibilityAgent(base(documents)).execute({
    state,
    now: () => '2026-08-10T00:00:00.000Z',
  });
}

test('secondary research is excluded even when it summarizes randomized participants and both protocol drugs', async () => {
  const review = parsed(
    'systematic-review',
    'We conducted a systematic review and meta-analysis following PRISMA. We searched PubMed and Embase for studies of baricitinib plus remdesivir in COVID-19.',
    'Included studies randomized 1033 participants to baricitinib plus remdesivir or placebo plus remdesivir and reported time to recovery.',
  );
  const result = await screen([review]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { rejectedAsSecondaryResearch?: number };

  assert.equal(decision.decision, 'exclude');
  assert.match(decision.reason, /secondary research/i);
  assert.equal(quality.rejectedAsSecondaryResearch, 1);
  assert.deepEqual(result.artifacts.includedDocuments, []);
});

test('a primary clinical study missing one required intervention concept is unresolved rather than auto-included', async () => {
  const wrongIntervention = parsed(
    'remdesivir-only',
    'A total of 400 hospitalized participants were randomized to remdesivir or placebo and followed for 29 days.',
    'The primary outcome was time to recovery after remdesivir treatment.',
    'Baricitinib has also been studied for COVID-19 in other trials.',
  );
  const result = await screen([wrongIntervention]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { retainedAsUncertainWithoutProtocolInterventionEvidence?: number };

  assert.equal(decision.decision, 'uncertain');
  assert.match(decision.reason, /baricitinib/i);
  assert.equal(quality.retainedAsUncertainWithoutProtocolInterventionEvidence, 1);
  assert.deepEqual(result.artifacts.includedDocuments, []);
});

test('a secondary analysis of a qualifying trial is unresolved when the reported outcome contrast belongs to another exposure', async () => {
  const cmvAnalysis = parsed(
    'cmv-secondary-analysis',
    'Participants in the parent randomized trial were assigned to baricitinib plus remdesivir or placebo plus remdesivir. This secondary analysis evaluated cytomegalovirus serostatus.',
    'CMV seropositivity was associated with delayed time to recovery (hazard ratio 0.77, 95% CI 0.63 to 0.93). The model adjusted for randomization group.',
  );
  const result = await screen([cmvAnalysis]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { retainedAsUncertainWithoutProtocolEstimandLink?: number };

  assert.equal(decision.decision, 'uncertain');
  assert.match(decision.reason, /treatment\/exposure-to-outcome contrast/i);
  assert.equal(quality.retainedAsUncertainWithoutProtocolEstimandLink, 1);
  assert.deepEqual(result.artifacts.includedDocuments, []);
});

test('a primary paper cannot inherit a protocol result merely by narrating a prior trial in its Results section', async () => {
  const adjacentPaper = parsed(
    'protocol-adjacent-primary-paper',
    'We enrolled 250 hospitalized patients into a prospective clinical cohort and measured inflammatory biomarkers. Baricitinib and remdesivir exposure were recorded.',
    'The ACTT-2 trial reported that patients receiving baricitinib plus remdesivir had a median time to recovery of 7 days compared with 8 days in the control group. In our cohort, IL-6 levels were associated with mortality (hazard ratio 1.42, 95% CI 1.10 to 1.84).',
  );
  const result = await screen([adjacentPaper]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { retainedAsUncertainWithoutProtocolEstimandLink?: number };

  assert.equal(decision.decision, 'uncertain');
  assert.match(decision.reason, /report's own/i);
  assert.equal(quality.retainedAsUncertainWithoutProtocolEstimandLink, 1);
  assert.deepEqual(result.artifacts.includedDocuments, []);
});

test('a primary study with a bounded protocol treatment-to-outcome result is automatically includable', async () => {
  const trial = parsed(
    'actt2-like',
    'Hospitalized participants were randomized to baricitinib plus remdesivir or placebo plus remdesivir and followed for 29 days.',
    'Patients receiving baricitinib plus remdesivir had a median time to recovery of 7 days compared with 8 days for placebo plus remdesivir.',
  );
  const result = await screen([trial]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;

  assert.equal(decision.decision, 'include');
  assert.equal((result.artifacts.includedDocuments as ParsedDocument[]).length, 1);
});

test('ACTT-2 live wording maps quantified recovery language to time-to-recovery without a literal phrase match', async () => {
  const actt2 = parsed(
    '10.1056/nejmoa2031994',
    'Eligible patients were randomly assigned in a 1:1 ratio to receive either remdesivir and baricitinib or remdesivir and placebo. Treatment assignment was double blind and placebo controlled.',
    'A total of 1033 patients underwent randomization. Patients who received combination treatment with baricitinib plus remdesivir recovered a median of 1 day faster than patients who received remdesivir and placebo (median, 7 days vs. 8 days; rate ratio for recovery, 1.16; 95% CI, 1.01 to 1.32; P=0.03).',
  );
  const result = await screen([actt2]);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;

  assert.equal(decision.decision, 'include');
  assert.ok(decision.evidence.includes('participant-flow'));
  assert.ok(decision.evidence.includes('time to recovery'));
  assert.equal((result.artifacts.includedDocuments as ParsedDocument[])[0]?.recordId, '10.1056/nejmoa2031994');
});

test('prespecified comparator and study design are executable eligibility constraints', async () => {
  const constrainedRequest: SearchAwareRequest = {
    ...request,
    question: {
      ...request.question,
      comparator: 'placebo plus remdesivir',
      studyDesigns: ['randomized controlled trial'],
    },
  };
  const wrongDesign = parsed(
    'observational',
    'We conducted a retrospective cohort study of hospitalized patients receiving baricitinib plus remdesivir and placebo plus remdesivir.',
    'Baricitinib plus remdesivir was associated with a lower mean time to recovery compared with placebo plus remdesivir.',
  );
  const result = await screen([wrongDesign], constrainedRequest);
  const decision = (result.artifacts.fullTextDecisions as ScreeningDecision[])[0]!;
  const quality = result.artifacts.fullTextScreeningQuality as { retainedAsUncertainWithoutRequestedStudyDesign?: number };

  assert.equal(decision.decision, 'uncertain');
  assert.match(decision.reason, /eligible study designs/i);
  assert.equal(quality.retainedAsUncertainWithoutRequestedStudyDesign, 1);
});
