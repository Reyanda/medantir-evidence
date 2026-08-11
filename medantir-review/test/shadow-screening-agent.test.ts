import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, EvidenceRecord, ScreeningDecision } from '../src/core/types.js';
import type { ModelInferencePort, ModelInferenceRequest, ModelInferenceResult } from '../src/inference/model-inference.js';
import { ShadowModelTiabScreeningAgent } from '../src/inference/shadow-screening-agent.js';

const records: EvidenceRecord[] = [
  {
    id: 'r1',
    title: 'Randomized trial of treatment in hospitalized adults',
    abstract: 'Adults were randomized to treatment or placebo.',
    authors: [],
    year: 2021,
    sourceDatabases: ['pubmed'],
  },
  {
    id: 'r2',
    title: 'Editorial on treatment policy',
    abstract: 'Commentary without participant data.',
    authors: [],
    year: 2021,
    sourceDatabases: ['pubmed'],
  },
];

const authoritative: ScreeningDecision[] = [
  { recordId: 'r1', decision: 'include', reason: 'fixture', confidence: 0.9, evidence: [] },
  { recordId: 'r2', decision: 'exclude', reason: 'fixture', confidence: 0.9, evidence: [] },
];

function context(): AgentContext {
  return {
    state: {
      runId: 'shadow-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: {
          title: 'Treatment review',
          objective: 'Evaluate treatment in hospitalized adults.',
          population: 'hospitalized adults',
          interventionOrExposure: 'treatment',
          comparator: 'placebo',
          outcomes: ['mortality'],
        },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: { uniqueRecords: records },
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

const base: Agent = {
  stage: 'tiab-screen',
  async execute(): Promise<AgentResult> {
    return {
      artifacts: {
        tiabDecisions: authoritative,
        tiabIncluded: [records[0]],
      },
    };
  },
};

class FixtureInference implements ModelInferencePort {
  requests: ModelInferenceRequest[] = [];
  async complete(request: ModelInferenceRequest): Promise<ModelInferenceResult> {
    this.requests.push(request);
    const recordId = request.evidenceObjectIds?.[0];
    const decision = recordId === 'r1' ? 'include' : 'exclude';
    const text = JSON.stringify({ decision, confidence: 0.8, rationale: `fixture ${decision}` });
    return {
      text,
      requestHash: `request-${recordId}`,
      outputHash: `output-${recordId}`,
      receipt: {
        gateway: 'omniroute',
        requestedModel: request.model,
        actualProvider: 'fixture-provider',
        actualModel: 'fixture-model',
      },
    };
  }
}

test('shadow screening records model suggestions without changing authoritative decisions or inclusions', async () => {
  const inference = new FixtureInference();
  const result = await new ShadowModelTiabScreeningAgent(base, inference, {
    model: 'auto/cheap',
    maxRecords: 10,
    concurrency: 2,
  }).execute(context());

  assert.deepEqual(result.artifacts.tiabDecisions, authoritative);
  assert.deepEqual(result.artifacts.tiabIncluded, [records[0]]);
  const suggestions = result.artifacts.modelScreeningSuggestions as Array<{ status: string; suggestedDecision?: string; routingReceipt?: { actualProvider?: string } }>;
  const quality = result.artifacts.modelScreeningQuality as { agreementWithAuthoritative: number; authoritativeDecisionsChanged: boolean; completed: number };

  assert.equal(suggestions.length, 2);
  assert.ok(suggestions.every((item) => item.status === 'completed'));
  assert.ok(suggestions.every((item) => item.routingReceipt?.actualProvider === 'fixture-provider'));
  assert.equal(quality.completed, 2);
  assert.equal(quality.agreementWithAuthoritative, 1);
  assert.equal(quality.authoritativeDecisionsChanged, false);
  assert.ok(inference.requests.every((request) => request.temperature === 0));
  assert.ok(inference.requests.every((request) => request.responseFormat === 'json'));
});

test('shadow inference failures become warnings and never abort the scientific screening path', async () => {
  const failing: ModelInferencePort = {
    async complete() {
      throw new Error('free provider unavailable');
    },
  };
  const result = await new ShadowModelTiabScreeningAgent(base, failing, {
    model: 'auto/offline',
    maxRecords: 1,
  }).execute(context());

  assert.deepEqual(result.artifacts.tiabDecisions, authoritative);
  assert.deepEqual(result.artifacts.tiabIncluded, [records[0]]);
  const quality = result.artifacts.modelScreeningQuality as { inferenceErrors: number; authoritativeDecisionsChanged: boolean };
  assert.equal(quality.inferenceErrors, 1);
  assert.equal(quality.authoritativeDecisionsChanged, false);
  assert.ok(result.warnings?.some((warning) => /authoritative screening was unaffected/i.test(warning)));
});

test('invalid model JSON is recorded as invalid-output, not coerced into a screening decision', async () => {
  const invalid: ModelInferencePort = {
    async complete(request) {
      return {
        text: 'Probably include this one.',
        requestHash: 'request',
        outputHash: 'output',
        receipt: { gateway: 'omniroute', requestedModel: request.model },
      };
    },
  };
  const result = await new ShadowModelTiabScreeningAgent(base, invalid, {
    model: 'auto',
    maxRecords: 1,
  }).execute(context());
  const suggestions = result.artifacts.modelScreeningSuggestions as Array<{ status: string; suggestedDecision?: string }>;
  const quality = result.artifacts.modelScreeningQuality as { invalidOutputs: number };

  assert.equal(suggestions[0]?.status, 'invalid-output');
  assert.equal(suggestions[0]?.suggestedDecision, undefined);
  assert.equal(quality.invalidOutputs, 1);
});
