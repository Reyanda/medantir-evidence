import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatibleSrModelPort } from '../src/benchmark/openai-compatible-sr-model.js';
import type { SrModelVisibleTask } from '../src/benchmark/sr-reproduction-benchmark.js';

const task: SrModelVisibleTask = {
  id: 'task-1',
  stage: 'protocol',
  instruction: 'Return the structured protocol.',
  input: { text: 'example' },
  outputSchema: { answer: 'string' },
  upstream: [{
    taskId: 'question-1',
    stage: 'question',
    output: { population: 'adults' },
    outputHash: 'a'.repeat(64),
  }],
};

test('OpenAI-compatible SRBench adapter sends deterministic headers, actual upstream artifacts and routed identity', async () => {
  let observedUrl = '';
  let observedHeaders: Headers | null = null;
  let observedBody: any = null;
  const port = new OpenAiCompatibleSrModelPort({
    endpoint: 'http://127.0.0.1:20128/v1',
    apiKey: 'test-key',
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init?.headers);
      observedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: 'fallback-model',
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-omniroute-provider': 'provider-a',
          'x-omniroute-model': 'actual-model-a',
          'x-omniroute-request-id': 'request-123',
          'x-omniroute-cost': '0.001',
        },
      });
    },
  });
  const response = await port.completeJson({
    model: 'requested-model',
    caseId: 'case-1',
    task,
    system: 'system',
  });
  assert.equal(observedUrl, 'http://127.0.0.1:20128/v1/chat/completions');
  assert.equal(observedHeaders!.get('authorization'), 'Bearer test-key');
  assert.equal(observedHeaders!.get('x-omniroute-no-memory'), 'true');
  assert.equal(observedHeaders!.get('x-omniroute-no-cache'), 'true');
  assert.equal(observedHeaders!.get('x-medantir-benchmark'), 'srbench-v1');
  assert.equal(observedBody.model, 'requested-model');
  assert.equal(observedBody.temperature, 0);
  const userPayload = JSON.parse(observedBody.messages[1].content);
  assert.deepEqual(userPayload.upstreamPipelineOutputs, task.upstream);
  assert.equal(Object.prototype.hasOwnProperty.call(userPayload, 'gold'), false);
  assert.deepEqual(response.output, { answer: 'ok' });
  assert.equal(response.routing.requestedModel, 'requested-model');
  assert.equal(response.routing.actualModel, 'actual-model-a');
  assert.equal(response.routing.provider, 'provider-a');
  assert.equal(response.routing.requestId, 'request-123');
  assert.equal(response.routing.inputTokens, 12);
  assert.equal(response.routing.outputTokens, 4);
  assert.equal(response.routing.costUsd, 0.001);
  assert.match(response.requestHash!, /^[a-f0-9]{64}$/);
  assert.match(response.outputHash!, /^[a-f0-9]{64}$/);
});

test('OpenAI-compatible SRBench adapter rejects markdown-fenced or invalid JSON outputs', async () => {
  const port = new OpenAiCompatibleSrModelPort({
    endpoint: 'https://example.invalid/v1',
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"answer":"ok"}\n```' } }] }), { status: 200 }),
  });
  await assert.rejects(() => port.completeJson({ model: 'm', caseId: 'c', task, system: 's' }), /Markdown fencing/i);
});
