import {
  modelInferenceOutputHash,
  modelInferenceRequestHash,
  type ModelInferencePort,
  type ModelInferenceRequest,
  type ModelInferenceResult,
} from './model-inference.js';

export interface OmniRouteInferenceOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  disableGatewayMemory?: boolean;
  disableGatewayCache?: boolean;
  budgetCapUsd?: number;
  budgetFallback?: 'strict' | 'cheapest';
}

function finiteHeaderNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function integerHeader(headers: Headers, name: string): number | undefined {
  const value = finiteHeaderNumber(headers, name);
  return value === undefined ? undefined : Math.max(0, Math.round(value));
}

function booleanHeader(headers: Headers, name: string): boolean | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  if (/^(true|1|yes)$/i.test(raw.trim())) return true;
  if (/^(false|0|no)$/i.test(raw.trim())) return false;
  return undefined;
}

function positiveBudget(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolvedBudgetFallback(value: string | undefined): 'strict' | 'cheapest' {
  return value?.trim().toLowerCase() === 'cheapest' ? 'cheapest' : 'strict';
}

/**
 * Experimental inference transport for frozen MEDANTIR model benchmarks.
 *
 * This adapter does not participate in deterministic evidence decisions by
 * itself. Callers must separately validate any model output before it can alter
 * screening, extraction, appraisal or synthesis state.
 */
export class OmniRouteInferencePort implements ModelInferencePort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly disableGatewayMemory: boolean;
  private readonly disableGatewayCache: boolean;
  private readonly budgetCapUsd: number | undefined;
  private readonly budgetFallback: 'strict' | 'cheapest';

  constructor(options: OmniRouteInferenceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128').replace(/\/$/, '');
    this.apiKey = options.apiKey ?? process.env.OMNIROUTE_API_KEY ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.disableGatewayMemory = options.disableGatewayMemory ?? true;
    this.disableGatewayCache = options.disableGatewayCache ?? true;
    this.budgetCapUsd = positiveBudget(options.budgetCapUsd ?? process.env.OMNIROUTE_BUDGET_USD_PER_REQUEST);
    this.budgetFallback = options.budgetFallback ?? resolvedBudgetFallback(process.env.OMNIROUTE_BUDGET_FALLBACK);
  }

  async complete(request: ModelInferenceRequest): Promise<ModelInferenceResult> {
    if (!this.apiKey.trim()) {
      throw new Error('OmniRoute inference requires OMNIROUTE_API_KEY or an explicit apiKey.');
    }
    if (!request.taskId.trim()) throw new Error('Model inference requires a stable taskId.');
    if (!request.model.trim()) throw new Error('Model inference requires a model or OmniRoute routing mode.');
    if (request.messages.length === 0) throw new Error('Model inference requires at least one message.');

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey.trim()}`,
      ...(this.disableGatewayMemory ? { 'x-omniroute-no-memory': 'true' } : {}),
      ...(this.disableGatewayCache ? { 'x-omniroute-no-cache': 'true' } : {}),
      ...(this.budgetCapUsd !== undefined ? {
        'x-omniroute-budget': String(this.budgetCapUsd),
        'x-omniroute-budget-fallback': this.budgetFallback,
      } : {}),
    };
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };

    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OmniRoute inference failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    let payload: any;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error('OmniRoute returned a non-JSON chat completion response.');
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new Error('OmniRoute response did not contain choices[0].message.content.');
    }

    const routingReceipt = {
      gateway: 'omniroute',
      requestedModel: request.model,
      ...(this.budgetCapUsd !== undefined ? {
        budgetCapUsd: this.budgetCapUsd,
        budgetFallback: this.budgetFallback,
      } : {}),
      ...(response.headers.get('x-omniroute-provider') ? { actualProvider: response.headers.get('x-omniroute-provider')! } : {}),
      ...(response.headers.get('x-omniroute-model') ? { actualModel: response.headers.get('x-omniroute-model')! } : {}),
      ...(response.headers.get('x-omniroute-decision') ? { routingDecision: response.headers.get('x-omniroute-decision')! } : {}),
      ...(response.headers.get('x-omniroute-request-id') ? { requestId: response.headers.get('x-omniroute-request-id')! } : {}),
      ...(response.headers.get('x-omniroute-version') ? { gatewayVersion: response.headers.get('x-omniroute-version')! } : {}),
      ...(finiteHeaderNumber(response.headers, 'x-omniroute-latency-ms') !== undefined
        ? { latencyMs: finiteHeaderNumber(response.headers, 'x-omniroute-latency-ms')! }
        : {}),
      ...(integerHeader(response.headers, 'x-omniroute-tokens-in') !== undefined
        ? { tokensIn: integerHeader(response.headers, 'x-omniroute-tokens-in')! }
        : {}),
      ...(integerHeader(response.headers, 'x-omniroute-tokens-out') !== undefined
        ? { tokensOut: integerHeader(response.headers, 'x-omniroute-tokens-out')! }
        : {}),
      ...(finiteHeaderNumber(response.headers, 'x-omniroute-response-cost') !== undefined
        ? { responseCostUsd: finiteHeaderNumber(response.headers, 'x-omniroute-response-cost')! }
        : {}),
      ...(integerHeader(response.headers, 'x-omniroute-fallback-attempts') !== undefined
        ? { fallbackAttempts: integerHeader(response.headers, 'x-omniroute-fallback-attempts')! }
        : {}),
      ...(booleanHeader(response.headers, 'x-omniroute-cache-hit') !== undefined
        ? { cacheHit: booleanHeader(response.headers, 'x-omniroute-cache-hit')! }
        : {}),
    };

    return {
      text,
      requestHash: modelInferenceRequestHash(request),
      outputHash: modelInferenceOutputHash(text),
      receipt: routingReceipt,
      ...(payload?.usage && typeof payload.usage === 'object' ? { rawUsage: payload.usage } : {}),
    };
  }
}
