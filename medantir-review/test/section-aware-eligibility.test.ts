import test from 'node:test';
import assert from 'node:assert/strict';
import { SectionAwareFullTextEligibilityAgent } from '../src/agents/section-aware-eligibility.js';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, AgentContext, ParsedDocument, ReviewRequest, ScreeningDecision } from '../src/core/types.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  question: {
    title: 'Baricitinib plus remdesivir for hospitalized adults with COVID-19',
    objective: 'Evaluate clinical outcomes of combination treatment.',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    outcomes: ['time to recovery'],
  },
};

function context(documents: ParsedDocument[]): AgentContext {
  const state = createPipelineState(request);
  state.artifacts.parsedDocuments = documents;
  return { state, now: () => '2026-08-09T00:00:00.000Z' };
}

function includeBase(documents: ParsedDocument[]): Agent {
  return {
    stage: 'fulltext-screen',
    async execute() {
      const decisions: ScreeningDecision[] = documents.map((document) => ({
        recordId: document.recordId,
        decision: 'include',
        reason: 'base lexical screener included document',
        confidence: 0.9,
        evidence: ['baricitinib', 'remdesivir', 'patients'],
      }));
      return { artifacts: { fullTextDecisions: decisions, includedDocuments: documents } };
    },
  };
}

const analytical: ParsedDocument = {
  recordId: '10.1038/s41598-026-52054-0',
  text: 'COVID-19 patients may receive remdesivir and baricitinib. A clinical trial reported improved recovery and safety. The present analytical study uses synchronous spectrofluorimetry for simultaneous quantification of both drugs.',
  pages: [{ page: 1, text: 'full article' }],
  sections: [
    {
      name: 'rationale', heading: 'Introduction', pageStart: 1, pageEnd: 1,
      text: 'Hospitalized patients with COVID-19 may receive remdesivir and baricitinib. Clinical trials reported recovery and safety outcomes.',
    },
    {
      name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1,
      text: 'Synthetic mixtures and spiked plasma were prepared. A first-derivative synchronous spectrofluorimetric analytical method was optimized and validated for simultaneous determination of remdesivir and baricitinib in dosage forms.',
    },
    {
      name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1,
      text: 'Linearity, precision and accuracy of the assay were acceptable. The limit of detection and limit of quantification were calculated for both analytes.',
    },
    {
      name: 'discussion', heading: 'Discussion', pageStart: 1, pageEnd: 1,
      text: 'The spectrofluorimetric procedure enables quantification in pharmaceutical formulations and spiked plasma.',
    },
  ],
  extractionMethod: 'native',
};

const clinicalWithAssay: ParsedDocument = {
  recordId: 'actt2',
  text: 'Randomized clinical trial of hospitalized patients. Plasma assays were also performed.',
  pages: [{ page: 1, text: 'clinical trial' }],
  sections: [
    {
      name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1,
      text: 'A total of 1033 participants were randomized to baricitinib plus remdesivir or placebo plus remdesivir. Participants were followed for 29 days. Plasma samples were measured by chromatography.',
    },
    {
      name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1,
      text: 'Patients receiving baricitinib plus remdesivir had a median time to recovery of 7 days compared with 8 days for placebo plus remdesivir. Baseline characteristics and adverse events were reported for both randomized groups.',
    },
  ],
  extractionMethod: 'native',
};

test('clinical language confined to the introduction cannot rescue an analytical evidentiary core', async () => {
  const ctx = context([analytical]);
  const result = await new SectionAwareFullTextEligibilityAgent(includeBase([analytical])).execute(ctx);
  const decisions = result.artifacts.fullTextDecisions as ScreeningDecision[];
  const quality = result.artifacts.fullTextScreeningQuality as { rejectedAsSectionDominantNonClinical?: number };

  assert.equal(decisions[0]?.decision, 'exclude');
  assert.match(decisions[0]?.reason ?? '', /dominant non-clinical evidentiary core/i);
  assert.match(decisions[0]?.reason ?? '', /spectrofluorimetry/i);
  assert.deepEqual(result.artifacts.includedDocuments, []);
  assert.equal(quality.rejectedAsSectionDominantNonClinical, 1);
});

test('a genuine randomized clinical study is retained even when its methods contain laboratory assays', async () => {
  const ctx = context([clinicalWithAssay]);
  const result = await new SectionAwareFullTextEligibilityAgent(includeBase([clinicalWithAssay])).execute(ctx);
  const decisions = result.artifacts.fullTextDecisions as ScreeningDecision[];

  assert.equal(decisions[0]?.decision, 'include');
  assert.ok(decisions[0]?.evidence.includes('participant-flow'));
  assert.deepEqual((result.artifacts.includedDocuments as ParsedDocument[]).map((document) => document.recordId), ['actt2']);
});

test('mixed corpus excludes only the analytical evidence object', async () => {
  const documents = [analytical, clinicalWithAssay];
  const ctx = context(documents);
  const result = await new SectionAwareFullTextEligibilityAgent(includeBase(documents)).execute(ctx);
  const decisions = result.artifacts.fullTextDecisions as ScreeningDecision[];

  assert.equal(decisions.find((decision) => decision.recordId === analytical.recordId)?.decision, 'exclude');
  assert.equal(decisions.find((decision) => decision.recordId === clinicalWithAssay.recordId)?.decision, 'include');
  assert.deepEqual((result.artifacts.includedDocuments as ParsedDocument[]).map((document) => document.recordId), ['actt2']);
});
