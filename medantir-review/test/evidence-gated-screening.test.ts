import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceGatedFullTextScreeningAgent, EvidenceGatedTiabScreeningAgent } from '../src/agents/live-pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, AgentContext, EvidenceRecord, ParsedDocument, ReviewRequest, ScreeningDecision } from '../src/core/types.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  autoApproveHumanGates: true,
  question: {
    title: 'Baricitinib plus remdesivir for hospitalized adults with COVID-19',
    objective: 'Evaluate clinical outcomes of baricitinib plus remdesivir in hospitalized adults with COVID-19.',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    outcomes: ['time to recovery'],
  },
};

function context(): AgentContext {
  return { state: createPipelineState(request), now: () => new Date().toISOString() };
}

const chemistry: EvidenceRecord = {
  id: 'chemistry',
  title: 'Green spectrofluorimetric simultaneous determination of baricitinib and remdesivir in pharmaceutical formulations',
  abstract: 'A validated analytical method was developed for simultaneous determination of both drugs in tablets using spectrofluorimetry.',
  authors: ['A Analyst'],
  year: 2026,
  sourceDatabases: ['pubmed'],
};

const clinical: EvidenceRecord = {
  id: 'actt2',
  title: 'Baricitinib plus Remdesivir for Hospitalized Adults with Covid-19',
  abstract: 'In this randomized double-blind placebo-controlled clinical trial, hospitalized patients received baricitinib plus remdesivir and were followed for recovery and safety outcomes.',
  authors: ['A Clinician'],
  year: 2020,
  sourceDatabases: ['pubmed'],
};

const vague: EvidenceRecord = {
  id: 'vague',
  title: 'Baricitinib and remdesivir in COVID-19',
  abstract: 'A report describing use of these treatments during the pandemic.',
  authors: ['A Author'],
  year: 2021,
  sourceDatabases: ['pubmed'],
};

test('TIAB evidence gate excludes high-specificity analytical chemistry but keeps true clinical evidence', async () => {
  const ctx = context();
  ctx.state.artifacts.uniqueRecords = [chemistry, clinical, vague];
  const decisions: ScreeningDecision[] = [chemistry, clinical, vague].map((record) => ({
    recordId: record.id,
    decision: 'include',
    reason: 'base lexical screener included record',
    confidence: 0.9,
    evidence: ['baricitinib', 'remdesivir'],
  }));
  const base: Agent = {
    stage: 'tiab-screen',
    async execute() {
      return { artifacts: { tiabDecisions: decisions, tiabIncluded: [chemistry, clinical, vague] } };
    },
  };

  const result = await new EvidenceGatedTiabScreeningAgent(base).execute(ctx);
  const screened = result.artifacts.tiabDecisions as ScreeningDecision[];

  assert.equal(screened.find((decision) => decision.recordId === 'chemistry')?.decision, 'exclude');
  assert.match(screened.find((decision) => decision.recordId === 'chemistry')?.reason ?? '', /non-clinical/i);
  assert.equal(screened.find((decision) => decision.recordId === 'actt2')?.decision, 'include');
  assert.equal(screened.find((decision) => decision.recordId === 'vague')?.decision, 'uncertain');
  assert.deepEqual((result.artifacts.tiabIncluded as EvidenceRecord[]).map((record) => record.id).sort(), ['actt2', 'vague']);
});

test('full-text evidence gate stops analytical-method documents before extraction', async () => {
  const ctx = context();
  const chemistryDoc: ParsedDocument = {
    recordId: 'chemistry',
    text: `${chemistry.title}. ${chemistry.abstract} Method validation, assay precision and chromatographic comparison were performed.`,
    pages: [{ page: 1, text: chemistry.abstract }],
    sections: [{ name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: chemistry.abstract }],
    extractionMethod: 'native',
  };
  const clinicalDoc: ParsedDocument = {
    recordId: 'actt2',
    text: `${clinical.title}. Randomized patients in hospital received treatment or placebo. Results reported recovery, mortality and adverse events.`,
    pages: [{ page: 1, text: clinical.abstract }],
    sections: [{ name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: clinical.abstract }],
    extractionMethod: 'native',
  };
  ctx.state.artifacts.parsedDocuments = [chemistryDoc, clinicalDoc];
  const decisions: ScreeningDecision[] = ['chemistry', 'actt2'].map((recordId) => ({
    recordId,
    decision: 'include',
    reason: 'base full-text screener included document',
    confidence: 0.9,
    evidence: ['baricitinib'],
  }));
  const base: Agent = {
    stage: 'fulltext-screen',
    async execute() {
      return { artifacts: { fullTextDecisions: decisions, includedDocuments: [chemistryDoc, clinicalDoc] } };
    },
  };

  const result = await new EvidenceGatedFullTextScreeningAgent(base).execute(ctx);
  const screened = result.artifacts.fullTextDecisions as ScreeningDecision[];

  assert.equal(screened.find((decision) => decision.recordId === 'chemistry')?.decision, 'exclude');
  assert.equal(screened.find((decision) => decision.recordId === 'actt2')?.decision, 'include');
  assert.deepEqual((result.artifacts.includedDocuments as ParsedDocument[]).map((document) => document.recordId), ['actt2']);
});
