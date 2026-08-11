import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, ReviewRequest } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import type { ReviewProtocol } from '../src/protocols/review-protocol.js';
import { buildVerifierRunGraph } from '../src/core/verifier-graph.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  autoApproveHumanGates: true,
  question: { title: 'Graph replay', objective: 'Audit replay lineage.' },
};

function protocol(): ReviewProtocol {
  return {
    reviewType: 'systematic',
    stages: [
      {
        stage: 'question', requiredArtifacts: [], producedArtifacts: ['normalisedQuestion'], maxRetries: 0, humanGate: 'never',
        validate: (state) => ({ ok: 'normalisedQuestion' in state.artifacts, issues: [] }),
      },
      {
        stage: 'protocol', requiredArtifacts: ['normalisedQuestion'], producedArtifacts: ['reviewPlan'], maxRetries: 0, humanGate: 'never',
        validate: (state) => ({ ok: 'reviewPlan' in state.artifacts, issues: [] }),
      },
    ],
  };
}

test('graph preserves replay history and historical artifact hashes without artifact bodies', async () => {
  let questionRuns = 0;
  let protocolRuns = 0;
  const question: Agent = {
    stage: 'question',
    async execute() {
      questionRuns += 1;
      return {
        artifacts: {
          normalisedQuestion: { version: questionRuns, text: questionRuns === 1 ? 'old question body' : 'current question body' },
          wrapperExtra: { version: questionRuns, secret: questionRuns === 1 ? 'old wrapper body' : 'current wrapper body' },
        },
      };
    },
  };
  const protocolAgent: Agent = {
    stage: 'protocol',
    async execute() {
      protocolRuns += 1;
      if (protocolRuns === 1) {
        return {
          artifacts: {
            reviewPlan: { version: 1, text: 'abandoned plan body' },
            protocolWrapperExtra: { value: 'abandoned wrapper body' },
            humanOverrides: {
              version: 1,
              entries: [{ itemId: 'test', sourceStage: 'question', amendedValue: { ok: true }, rationale: 'Replay', decidedAt: '2026-08-10T00:00:00Z' }],
            },
          },
          rework: { fromStage: 'question', reason: 'Replay from corrected question' },
        };
      }
      return {
        artifacts: {
          reviewPlan: { version: 2, text: 'current plan body' },
          protocolWrapperExtra: { value: 'current wrapper body' },
        },
      };
    },
  };

  const state = await new PipelineOrchestrator([question, protocolAgent]).run(createPipelineState(request), protocol());
  const graph = buildVerifierRunGraph(state);

  assert.equal(graph.sealValid, true);
  assert.equal(graph.counts.attempts, 4);
  assert.equal(graph.counts.replayEdges, 1);
  assert.ok(graph.counts.historicalArtifactVersions >= 2);
  assert.ok(graph.edges.some((edge) => edge.type === 'REWORK_FROM' && edge.to === 'stage:question'));
  assert.ok(graph.edges.some((edge) => edge.type === 'PRODUCED'));
  assert.ok(graph.edges.some((edge) => edge.type === 'USED'));

  const historical = graph.nodes.filter((node) => node.type === 'artifact' && !node.current);
  assert.ok(historical.length > 0);
  assert.equal(historical.every((node) => node.type === 'artifact' && node.readable === false), true);

  const serialized = JSON.stringify(graph);
  assert.doesNotMatch(serialized, /old question body|current question body|abandoned plan body|current plan body|old wrapper body|current wrapper body/);
  assert.doesNotMatch(serialized, /human correction|Replay from corrected question/);
});

test('graph exposes module authority and current artifact readability without copying values', async () => {
  const agent: Agent = {
    stage: 'question',
    async execute() {
      return {
        artifacts: {
          normalisedQuestion: { title: 'Safe value that must not appear in graph' },
          fullTexts: [{ content: 'licensed body must never appear' }],
        },
      };
    },
  };
  const p: ReviewProtocol = {
    reviewType: 'systematic',
    stages: [{
      stage: 'question', requiredArtifacts: [], producedArtifacts: ['normalisedQuestion'], maxRetries: 0, humanGate: 'never',
      validate: () => ({ ok: true, issues: [] }),
    }],
  };
  const state = await new PipelineOrchestrator([agent]).run(createPipelineState(request), p);
  const graph = buildVerifierRunGraph(state);

  const questionArtifact = graph.nodes.find((node) => node.type === 'artifact' && node.key === 'normalisedQuestion');
  const fullTextArtifact = graph.nodes.find((node) => node.type === 'artifact' && node.key === 'fullTexts');
  assert.equal(questionArtifact?.type === 'artifact' && questionArtifact.readable, true);
  assert.equal(fullTextArtifact?.type === 'artifact' && fullTextArtifact.readable, false);
  assert.ok(graph.nodes.some((node) => node.type === 'module' && node.moduleId === 'study-family-linkage'));
  assert.doesNotMatch(JSON.stringify(graph), /Safe value that must not appear|licensed body must never appear/);
});
