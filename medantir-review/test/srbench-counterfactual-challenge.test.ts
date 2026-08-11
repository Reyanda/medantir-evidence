import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadSrBenchmarkCase } from '../src/benchmark/sr-benchmark-suite.js';
import {
  createSrCounterfactualChallenge,
  type SrCounterfactualChallengePlan,
} from '../src/benchmark/sr-counterfactual-challenge.js';
import {
  runSrBenchmarkCase,
  type SrBenchmarkCase,
  type SrReviewModelPort,
} from '../src/benchmark/sr-reproduction-benchmark.js';

const fixturePath = resolve('benchmarks/srbench-v1/synthetic-complete/case.json');
const secret = 'correct-horse-battery-staple-counterfactual-seed-001';

function oracle(caseDefinition: SrBenchmarkCase): Map<string, unknown> {
  return new Map(caseDefinition.tasks.map((task) => [task.id, structuredClone(task.gold)]));
}

class MapOraclePort implements SrReviewModelPort {
  constructor(private readonly values: Map<string, unknown>) {}
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    const value = this.values.get(input.task.id);
    if (value === undefined) throw new Error(`No oracle value for '${input.task.id}'.`);
    return {
      output: structuredClone(value),
      routing: { requestedModel: input.model, actualModel: `${input.model}-pinned`, provider: 'fixture' },
    };
  }
}

function plan(): SrCounterfactualChallengePlan {
  return {
    schemaVersion: 'medantir-sr-counterfactual-challenge/1',
    planId: 'SYNTHESIS-CF',
    planVersion: '1.0.0',
    mutations: [{
      mutationId: 'CHANGE-STUDY-2-EFFECT',
      variants: [
        {
          variantId: 'NULL-STUDY-2',
          rationale: 'Make the second study null while preserving the first study.',
          patches: [
            { taskId: 'fixture-synthesis', surface: 'input', path: 'effects.1.logRR', value: 0 },
            { taskId: 'fixture-synthesis', surface: 'gold', path: 'pooledLogRR', value: -0.34657359027997264 },
            { taskId: 'fixture-synthesis', surface: 'gold', path: 'pooledRR', value: 0.7071067811865476 },
            { taskId: 'fixture-report', surface: 'gold', path: 'estimate', value: 0.7071067811865476 }
          ]
        },
        {
          variantId: 'STRONGER-STUDY-2',
          rationale: 'Make the second study substantially more protective while preserving the first study.',
          patches: [
            { taskId: 'fixture-synthesis', surface: 'input', path: 'effects.1.logRR', value: -1.3862943611198906 },
            { taskId: 'fixture-synthesis', surface: 'gold', path: 'pooledLogRR', value: -1.039720770839918 },
            { taskId: 'fixture-synthesis', surface: 'gold', path: 'pooledRR', value: 0.3535533905932738 },
            { taskId: 'fixture-report', surface: 'gold', path: 'estimate', value: 0.3535533905932738 }
          ]
        }
      ]
    }]
  };
}

test('counterfactual challenge selection is deterministic, seed-hidden and hash-bound', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const first = createSrCounterfactualChallenge({ baseCase: loaded.definition, plan: plan(), secretSeed: secret, challengeRound: 1 });
  const second = createSrCounterfactualChallenge({ baseCase: loaded.definition, plan: plan(), secretSeed: secret, challengeRound: 1 });
  assert.equal(first.caseDefinition.caseHash, second.caseDefinition.caseHash);
  assert.deepEqual(first.receipt, second.receipt);
  assert.notEqual(first.caseDefinition.caseHash, loaded.definition.caseHash);
  assert.match(first.receipt.seedHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first.receipt).includes(secret), false);
  assert.equal(first.receipt.challengeCaseId, 'SRBENCH-FIXTURE-001::CF1');
  assert.equal(first.receipt.challengeCaseHash, first.caseDefinition.caseHash);
  assert.match(first.receipt.receiptHash, /^[a-f0-9]{64}$/);

  assert.notEqual(
    first.caseDefinition.stageGold.synthesis.receiptHash,
    loaded.definition.stageGold.synthesis.receiptHash,
  );
  assert.notEqual(
    first.caseDefinition.stageGold.report.receiptHash,
    loaded.definition.stageGold.report.receiptHash,
  );
  assert.equal(
    first.caseDefinition.stageGold.appraisal.receiptHash,
    loaded.definition.stageGold.appraisal.receiptHash,
  );
});

test('reasoning against counterfactual evidence can still achieve SR100 while memorized base answers fail', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const challenge = createSrCounterfactualChallenge({ baseCase: loaded.definition, plan: plan(), secretSeed: secret, challengeRound: 1 });

  const reasoning = await runSrBenchmarkCase({
    caseDefinition: challenge.caseDefinition,
    model: 'counterfactual-reasoner',
    port: new MapOraclePort(oracle(challenge.caseDefinition)),
  });
  assert.equal(reasoning.reproductionScore, 100);
  assert.equal(reasoning.pipelineCoverage, 100);
  assert.equal(reasoning.sr100, true);

  const memorizing = await runSrBenchmarkCase({
    caseDefinition: challenge.caseDefinition,
    model: 'memorizer',
    port: new MapOraclePort(oracle(loaded.definition)),
  });
  assert.equal(memorizing.sr100, false);
  assert.ok(memorizing.taskScores.find((score) => score.taskId === 'fixture-synthesis' && !score.exact));
  assert.ok(memorizing.taskScores.find((score) => score.taskId === 'fixture-report' && !score.exact));
});

test('counterfactual challenge refuses engine-bound gold stages and malformed patches', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  const engineBound = structuredClone(loaded.definition);
  engineBound.stageGold.synthesis = { status: 'complete', receiptHash: 'f'.repeat(64) };
  delete engineBound.caseHash;
  assert.throws(() => createSrCounterfactualChallenge({
    baseCase: engineBound,
    plan: plan(),
    secretSeed: secret,
    challengeRound: 1,
  }), /not model-gold-only/i);

  const invalidPlan = plan();
  invalidPlan.mutations[0]!.variants[0]!.patches[0] = {
    taskId: 'fixture-synthesis',
    surface: 'input',
    path: 'does.not.exist',
    value: 1,
  };
  assert.throws(() => createSrCounterfactualChallenge({
    baseCase: loaded.definition,
    plan: invalidPlan,
    secretSeed: secret,
    challengeRound: 1,
  }), /does not exist/i);
});

test('counterfactual challenge requires a high-entropy secret seed', async () => {
  const loaded = await loadSrBenchmarkCase(fixturePath);
  assert.throws(() => createSrCounterfactualChallenge({
    baseCase: loaded.definition,
    plan: plan(),
    secretSeed: 'too-short',
    challengeRound: 1,
  }), /at least 32 characters/i);
});
