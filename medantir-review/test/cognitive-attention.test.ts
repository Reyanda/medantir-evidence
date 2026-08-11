import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewAttentionObserver, type CognitiveStageObserver } from '../src/cognitive/review-attention.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, ReviewRequest } from '../src/core/types.js';
import type { ReviewProtocol } from '../src/protocols/review-protocol.js';

type LiveReviewRequest = ReviewRequest & {
  searchConcepts?: {
    population?: string[];
    interventionGroups?: string[][];
  };
};

function request(): LiveReviewRequest {
  return {
    reviewType: 'systematic',
    databases: ['PubMed', 'EuropePMC'],
    autoApproveHumanGates: true,
    question: {
      title: 'Baricitinib and remdesivir for COVID-19',
      objective: 'Evaluate baricitinib and remdesivir in adults with COVID-19.',
      population: 'adults with COVID-19',
      interventionOrExposure: 'baricitinib and remdesivir',
      outcomes: ['time to recovery'],
    },
    searchConcepts: {
      population: ['COVID-19', 'SARS-CoV-2'],
      interventionGroups: [['baricitinib'], ['remdesivir']],
    },
  };
}

const recallFirstStrategies = [
  {
    database: 'PubMed',
    query: 'semantic',
    searchRationale: {
      mode: 'recall-first-intervention',
      omittedMandatoryConcepts: ['outcome'],
      protocolOutcomesRetainedForEligibility: ['time to recovery'],
    },
  },
  {
    database: 'EuropePMC',
    query: 'semantic',
    searchRationale: {
      mode: 'recall-first-intervention',
      omittedMandatoryConcepts: ['outcome'],
      protocolOutcomesRetainedForEligibility: ['time to recovery'],
    },
  },
];

test('attention rolls search back when required semantic concept groups disappear', () => {
  const state = createPipelineState(request());
  state.artifacts.searchStrategies = recallFirstStrategies;
  state.artifacts.searchResults = [{ id: 'x' }];
  state.artifacts.searchProvenance = [
    { database: 'PubMed', executedQuery: '"COVID-19"[Title/Abstract]', executedAt: new Date().toISOString(), resultCount: 1 },
    { database: 'EuropePMC', executedQuery: 'TITLE_ABS:"COVID-19"', executedAt: new Date().toISOString(), resultCount: 1 },
  ];

  const decision = new ReviewAttentionObserver().assess({
    state,
    stage: 'search-execute',
    attempt: 1,
    result: { artifacts: {} },
    validation: { ok: true, issues: [] },
    warnings: [],
    requiredArtifacts: ['searchStrategies'],
    producedArtifacts: ['searchResults', 'searchProvenance'],
  });

  assert.equal(decision.action, 'ROLLBACK');
  assert.equal(decision.rollbackFrom, 'search-build');
  assert.ok(decision.metrics.semanticDrift >= 0.5);
  assert.ok(decision.reasons.some((reason) => reason.includes('baricitinib')));
  assert.ok(decision.reasons.some((reason) => reason.includes('remdesivir')));
});

test('incomplete lawful full-text acquisition triggers verification instead of silent completeness', () => {
  const state = createPipelineState(request());
  state.artifacts.tiabIncluded = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
  state.artifacts.fullTexts = Array.from({ length: 6 }, (_, i) => ({ recordId: `r${i}` }));
  state.artifacts.retrievalReport = { requested: 10, retrieved: 6, missing: ['r6', 'r7', 'r8', 'r9'] };

  const decision = new ReviewAttentionObserver().assess({
    state,
    stage: 'fulltext-retrieve',
    attempt: 1,
    result: { artifacts: {}, warnings: ['4 full texts require manual retrieval'] },
    validation: { ok: true, issues: [] },
    warnings: ['4 full texts require manual retrieval'],
    requiredArtifacts: ['tiabIncluded'],
    producedArtifacts: ['fullTexts', 'retrievalReport'],
  });

  assert.equal(decision.metrics.evidenceCoverage, 0.6);
  assert.equal(decision.action, 'VERIFY');
  assert.ok(decision.reasons.some((reason) => reason.includes('lawful full text')));
});

test('orchestrator executes a cognitive rollback and re-runs the affected stage', async () => {
  const state = createPipelineState(request());
  let executions = 0;
  let observations = 0;
  const agent: Agent = {
    stage: 'question',
    async execute() {
      executions += 1;
      return { artifacts: { normalisedQuestion: { ok: true, execution: executions } } };
    },
  };
  const observer: CognitiveStageObserver = {
    assess(input) {
      observations += 1;
      return {
        stage: input.stage,
        action: observations === 1 ? 'ROLLBACK' : 'CONTINUE',
        score: observations === 1 ? 0.8 : 0,
        reasons: observations === 1 ? ['fault injection: attention requested replay'] : [],
        metrics: {
          goalAlignment: 1,
          protocolAlignment: 1,
          stageAlignment: 1,
          evidenceCoverage: 1,
          contradictionBurden: 0,
          semanticDrift: 0,
          sourceCoverageDrift: 0,
          methodDrift: 0,
          downstreamContaminationRisk: 0,
          budgetDeviation: 0,
          temporalStaleness: 0,
          agentDisagreement: 0,
        },
        rollbackFrom: 'question',
        observedAt: new Date().toISOString(),
      };
    },
  };
  const protocol: ReviewProtocol = {
    reviewType: 'systematic',
    stages: [{
      stage: 'question',
      requiredArtifacts: [],
      producedArtifacts: ['normalisedQuestion'],
      maxRetries: 0,
      humanGate: 'never',
      validate: (current) => ({ ok: 'normalisedQuestion' in current.artifacts, issues: [] }),
    }],
  };

  const finalState = await new PipelineOrchestrator([agent], {
    cognitiveObserver: observer,
    maxCognitiveRollbacks: 2,
  }).run(state, protocol);

  assert.equal(finalState.stages.question.status, 'passed');
  assert.equal(executions, 2);
  assert.equal(observations, 2);
  assert.ok(finalState.audit.some((event) => event.event === 'cognitive-rollback'));
  const cognitive = finalState.artifacts.cognitiveControl as { records: unknown[] };
  assert.equal(cognitive.records.length, 2);
});
