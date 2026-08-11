import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, ReviewRequest } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import type { ReviewProtocol } from '../src/protocols/review-protocol.js';
import {
  verifyScientificRunSeal,
  type ScientificRunLedger,
  type ScientificRunManifest,
  type ScientificRunSeal,
} from '../src/core/scientific-run-manifest.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  autoApproveHumanGates: true,
  question: { title: 'Rework test', objective: 'Test scientific lineage replay.' },
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

test('rework retains attempt history, invalidates dynamic wrapper outputs, and preserves human overrides', async () => {
  let questionRuns = 0;
  let protocolRuns = 0;
  const question: Agent = {
    stage: 'question',
    async execute(context) {
      questionRuns += 1;
      if (questionRuns === 2) {
        assert.equal('wrapperExtra' in context.state.artifacts, false, 'rollback left an undeclared wrapper artifact stale');
        assert.equal('protocolWrapperExtra' in context.state.artifacts, false, 'rollback left a downstream wrapper artifact stale');
        assert.equal('humanOverrides' in context.state.artifacts, true, 'human amendment ledger must survive rework');
      }
      return {
        artifacts: {
          normalisedQuestion: { version: questionRuns },
          wrapperExtra: questionRuns === 1 ? 'first' : 'replayed',
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
            reviewPlan: { mode: 'first' },
            protocolWrapperExtra: 'stale',
            humanOverrides: {
              version: 1,
              entries: [{
                itemId: 'estimand:test', sourceStage: 'extract', amendedValue: { timeHorizon: '28-day' },
                rationale: 'human correction', decidedAt: '2026-08-10T00:00:00Z',
              }],
            },
          },
          rework: { fromStage: 'question', reason: 'human correction requires replay' },
        };
      }
      return { artifacts: { reviewPlan: { mode: 'replayed' }, protocolWrapperExtra: 'current' } };
    },
  };

  const state = await new PipelineOrchestrator([question, protocolAgent]).run(createPipelineState(request), protocol());
  assert.equal(state.stages.question.status, 'passed');
  assert.equal(state.stages.protocol.status, 'passed');
  assert.equal(state.artifacts.wrapperExtra, 'replayed');
  assert.equal(state.artifacts.protocolWrapperExtra, 'current');
  assert.equal((state.artifacts.humanOverrides as { entries?: unknown[] }).entries?.length, 1);

  const ledger = state.artifacts.scientificRunLedger as ScientificRunLedger;
  assert.ok(ledger.attempts.some((receipt) => receipt.stage === 'protocol' && receipt.status === 'rework'));
  assert.equal(ledger.attempts.filter((receipt) => receipt.stage === 'question' && receipt.status === 'passed').length, 2);
  assert.ok(ledger.attempts.some((receipt) => receipt.changedOutputs.wrapperExtra));
  assert.ok(ledger.attempts.some((receipt) => receipt.changedOutputs.protocolWrapperExtra));

  const manifest = state.artifacts.scientificRunManifest as ScientificRunManifest;
  const seal = state.artifacts.scientificRunSeal as ScientificRunSeal;
  assert.equal(verifyScientificRunSeal(manifest, seal), true);
  const wrapperReceipt = (state.artifacts.scientificArtifactLineage as Array<{ key: string; producerStage?: string }>).find((entry) => entry.key === 'wrapperExtra');
  assert.equal(wrapperReceipt?.producerStage, 'question');
});

test('an undeclared wrapper output is still captured in lineage', async () => {
  const question: Agent = {
    stage: 'question',
    async execute() {
      return { artifacts: { normalisedQuestion: { ok: true }, undeclaredScientificReceipt: { evidence: 'exact' } } };
    },
  };
  const p: ReviewProtocol = {
    reviewType: 'systematic',
    stages: [{
      stage: 'question', requiredArtifacts: [], producedArtifacts: ['normalisedQuestion'], maxRetries: 0, humanGate: 'never',
      validate: () => ({ ok: true, issues: [] }),
    }],
  };
  const state = await new PipelineOrchestrator([question]).run(createPipelineState(request), p);
  const lineage = state.artifacts.scientificArtifactLineage as Array<{ key: string; producerStage?: string }>;
  assert.equal(lineage.find((entry) => entry.key === 'undeclaredScientificReceipt')?.producerStage, 'question');
});
