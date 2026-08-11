import test from 'node:test';
import assert from 'node:assert/strict';
import { OmniRouteInferencePort } from '../src/inference/omniroute-inference.js';

const request = {
  taskId: 'screening:pmid-123',
  model: 'auto/cheap',
  messages: [
    { role: 'system' as const, content: 'Return only an include/exclude suggestion with rationale.' },
    { role: 'user' as const, content: 'Trial report text.' },
  ],
  temperature: 0,
  evidenceObjectIds: ['pmid:123'],
  promptVersion: 'screening-benchmark-v1',
};

test('OmniRoute review inference captures actual routed provider/model and reproducibility hashes', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"decision":"include","rationale":"eligible RCT"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-omniroute-provider': 'qwen',
        'x-omniroute-model': 'qwen3-free',
        'x-omniroute-decision': 'strategy=auto-cheap; provider=qwen; latency_ms=92',
        'x-omniroute-request-id': 'omni-req-1',
        'x-omniroute-version': '3.8.50',
        'x-omniroute-latency-ms': '92',
        'x-omniroute-tokens-in': '100',
        'x-omniroute-tokens-out': '20',
        'x-omniroute-response-cost': '0.0000000000',
        'x-omniroute-fallback-attempts': '1',
        'x-omniroute-cache-hit': 'false',
      },
    });
  };
  const port = new OmniRouteInferencePort({ apiKey: 'test-key', fetchImpl });

  const first = await port.complete(request);
  const second = await port.complete(request);

  assert.equal(seenUrl, 'http://localhost:20128/v1/chat/completions');
  const headers = seenInit?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.equal(headers['x-omniroute-no-memory'], 'true');
  assert.equal(headers['x-omniroute-no-cache'], 'true');
  const body = JSON.parse(String(seenInit?.body));
  assert.equal(body.model, 'auto/cheap');
  assert.equal(body.temperature, 0);

  assert.equal(first.receipt.requestedModel, 'auto/cheap');
  assert.equal(first.receipt.actualProvider, 'qwen');
  assert.equal(first.receipt.actualModel, 'qwen3-free');
  assert.equal(first.receipt.requestId, 'omni-req-1');
  assert.equal(first.receipt.gatewayVersion, '3.8.50');
  assert.equal(first.receipt.latencyMs, 92);
  assert.equal(first.receipt.tokensIn, 100);
  assert.equal(first.receipt.tokensOut, 20);
  assert.equal(first.receipt.responseCostUsd, 0);
  assert.equal(first.receipt.fallbackAttempts, 1);
  assert.equal(first.receipt.cacheHit, false);
  assert.equal(first.requestHash, second.requestHash);
  assert.equal(first.outputHash, second.outputHash);
});

test('OmniRoute review inference sends and records a strict per-request cost ceiling', async () => {
  let seenHeaders: Record<string, string> | undefined;
  const port = new OmniRouteInferencePort({
    apiKey: 'test-key',
    budgetCapUsd: 0.000001,
    budgetFallback: 'strict',
    fetchImpl: async (_input, init) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"decision":"include","rationale":"eligible"}' } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-omniroute-response-cost': '0' },
      });
    },
  });

  const result = await port.complete(request);

  assert.equal(seenHeaders?.['x-omniroute-budget'], '0.000001');
  assert.equal(seenHeaders?.['x-omniroute-budget-fallback'], 'strict');
  assert.equal(result.receipt.budgetCapUsd, 0.000001);
  assert.equal(result.receipt.budgetFallback, 'strict');
  assert.equal(result.receipt.responseCostUsd, 0);
});

test('OmniRoute review inference fails closed without a gateway key', async () => {
  const port = new OmniRouteInferencePort({ apiKey: '' });
  await assert.rejects(() => port.complete(request), /requires OMNIROUTE_API_KEY/);
});

test('OmniRoute review inference surfaces gateway HTTP failure instead of fabricating a model result', async () => {
  const port = new OmniRouteInferencePort({
    apiKey: 'test-key',
    fetchImpl: async () => new Response('{"error":"no route available"}', { status: 503 }),
  });
  await assert.rejects(() => port.complete(request), /HTTP 503.*no route available/);
});
