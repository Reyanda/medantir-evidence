import { createHash } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrModelTaskResponse, SrReviewModelPort } from './sr-reproduction-benchmark.js';

export interface OpenAiCompatibleSrModelOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function endpointUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('SRBench model endpoint must be an HTTP(S) URL.');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function parseStrictJson(content: unknown): unknown {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Model returned no textual JSON content.');
  const trimmed = content.trim();
  if (trimmed.startsWith('```')) throw new Error('Model returned Markdown fencing; SRBench requires raw JSON only.');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberHeader(headers: Headers, key: string): number | undefined {
  const value = headers.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class OpenAiCompatibleSrModelPort implements SrReviewModelPort {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleSrModelOptions) {
    this.endpoint = endpointUrl(options.endpoint);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]): Promise<SrModelTaskResponse> {
    const body = {
      model: input.model,
      temperature: 0,
      messages: [
        { role: 'system', content: input.system },
        {
          role: 'user',
          content: JSON.stringify({
            benchmarkCase: input.caseId,
            taskId: input.task.id,
            stage: input.task.stage,
            instruction: input.task.instruction,
            outputSchema: input.task.outputSchema ?? null,
            input: input.task.input,
            upstreamPipelineOutputs: input.task.upstream,
          }),
        },
      ],
    };
    const requestText = JSON.stringify(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          'x-medantir-benchmark': 'srbench-v1',
          'x-omniroute-no-memory': 'true',
          'x-omniroute-no-cache': 'true',
          ...(this.options.extraHeaders ?? {}),
        },
        body: requestText,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - started;
    const text = await response.text();
    if (!response.ok) throw new Error(`SRBench model call failed HTTP ${response.status}: ${text.slice(0, 500)}`);
    let payload: any;
    try { payload = JSON.parse(text); } catch { throw new Error('OpenAI-compatible endpoint returned non-JSON response envelope.'); }
    const content = payload?.choices?.[0]?.message?.content;
    const output = parseStrictJson(content);
    const actualModel = response.headers.get('x-omniroute-model') ?? payload?.model ?? undefined;
    const provider = response.headers.get('x-omniroute-provider') ?? undefined;
    const costUsd = numberHeader(response.headers, 'x-omniroute-cost');
    const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-omniroute-request-id') ?? undefined;
    return {
      output,
      requestHash: sha256(requestText),
      outputHash: scientificContentHash(output),
      routing: {
        requestedModel: input.model,
        ...(actualModel ? { actualModel } : {}),
        ...(provider ? { provider } : {}),
        ...(requestId ? { requestId } : {}),
        latencyMs,
        ...(typeof payload?.usage?.prompt_tokens === 'number' ? { inputTokens: payload.usage.prompt_tokens } : {}),
        ...(typeof payload?.usage?.completion_tokens === 'number' ? { outputTokens: payload.usage.completion_tokens } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      },
    };
  }
}
