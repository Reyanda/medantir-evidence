import { scientificContentHash } from '../core/canonical-hash.js';
import { normalizeSemanticText } from './unit-projector.js';
import type {
  ResolvedSemanticEmbeddingProfile,
  SemanticEmbeddingBatch,
  SemanticEmbeddingPort,
  SemanticEmbeddingProfile,
  SemanticEmbeddingReceipt,
} from './types.js';

function finiteDimension(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 32 || parsed > 65_536) throw new Error('Semantic embedding dimensions must be an integer between 32 and 65536.');
  return parsed;
}

function normalizeVector(vector: number[]): number[] {
  let normSquared = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('Semantic embedding contains a non-finite value.');
    normSquared += value * value;
  }
  if (normSquared === 0) return [...vector];
  const norm = Math.sqrt(normSquared);
  return vector.map((value) => value / norm);
}

function lexicalTerms(text: string): string[] {
  return normalizeSemanticText(text).match(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

function featureHash(feature: string): { indexSeed: number; sign: number } {
  const hash = scientificContentHash(feature);
  const indexSeed = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  const signSeed = Number.parseInt(hash.slice(8, 10), 16);
  return { indexSeed, sign: signSeed % 2 === 0 ? 1 : -1 };
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const { indexSeed, sign } = featureHash(feature);
  const index = indexSeed % vector.length;
  vector[index] = (vector[index] ?? 0) + sign * weight;
}

function deterministicVector(text: string, dimensions: number): number[] {
  const terms = lexicalTerms(text);
  const vector = Array.from({ length: dimensions }, () => 0);
  const frequencies = new Map<string, number>();
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  for (const [term, frequency] of frequencies) {
    const tf = 1 + Math.log(frequency);
    addFeature(vector, `u:${term}`, tf);
    const padded = `^${term}$`;
    for (let index = 0; index + 2 < padded.length; index += 1) addFeature(vector, `c3:${padded.slice(index, index + 3)}`, tf * 0.2);
  }
  for (let index = 0; index + 1 < terms.length; index += 1) addFeature(vector, `b:${terms[index]}\u0000${terms[index + 1]}`, 0.75);
  return normalizeVector(vector);
}

export class DeterministicScientificEmbeddingPort implements SemanticEmbeddingPort {
  readonly profile: SemanticEmbeddingProfile;
  private readonly dimensions: number;

  constructor(options: { dimensions?: number; modelVersion?: string } = {}) {
    this.dimensions = finiteDimension(options.dimensions, 384);
    this.profile = {
      provider: 'medantir-local',
      model: 'scientific-feature-hash',
      ...(options.modelVersion ? { modelVersion: options.modelVersion } : { modelVersion: '1' }),
      dimensions: this.dimensions,
      normalization: 'l2',
      embeddingClass: 'deterministic-lexical-dense',
    };
  }

  async embed(texts: string[]): Promise<SemanticEmbeddingBatch> {
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) throw new Error('Semantic embedding input must be an array of strings.');
    const profile: ResolvedSemanticEmbeddingProfile = { ...this.profile, dimensions: this.dimensions };
    return { profile, vectors: texts.map((text) => deterministicVector(text, this.dimensions)), receipts: [] };
  }
}

export interface OpenAiCompatibleEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
  modelVersion?: string;
  provider?: string;
  batchSize?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) throw new Error(`Expected an integer between 1 and ${maximum}.`);
  return selected;
}

export class OpenAiCompatibleEmbeddingPort implements SemanticEmbeddingPort {
  readonly profile: SemanticEmbeddingProfile;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly requestedDimensions: number | undefined;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatibleEmbeddingOptions) {
    if (!options.baseUrl.trim()) throw new Error('Semantic embedding baseUrl is required.');
    if (!options.apiKey.trim()) throw new Error('Semantic embedding apiKey is required.');
    if (!options.model.trim()) throw new Error('Semantic embedding model is required.');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.requestedDimensions = options.dimensions === undefined ? undefined : finiteDimension(options.dimensions, options.dimensions);
    this.batchSize = positiveInteger(options.batchSize, 64, 2048);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = positiveInteger(options.timeoutMs, 60_000, 600_000);
    this.profile = {
      provider: options.provider?.trim() || 'openai-compatible',
      model: this.model,
      ...(options.modelVersion?.trim() ? { modelVersion: options.modelVersion.trim() } : {}),
      ...(this.requestedDimensions !== undefined ? { dimensions: this.requestedDimensions } : {}),
      normalization: 'l2',
      embeddingClass: 'provider-semantic',
    };
  }

  async embed(texts: string[]): Promise<SemanticEmbeddingBatch> {
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) throw new Error('Semantic embedding input must be an array of strings.');
    if (texts.length === 0) {
      if (this.requestedDimensions === undefined) throw new Error('Cannot resolve provider embedding dimensions from an empty request.');
      return { profile: { ...this.profile, dimensions: this.requestedDimensions }, vectors: [], receipts: [] };
    }
    const vectors: number[][] = [];
    const receipts: SemanticEmbeddingReceipt[] = [];
    let resolvedModel = this.model;
    let resolvedDimensions = this.requestedDimensions;
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/v1/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, input: batch, encoding_format: 'float', ...(this.requestedDimensions !== undefined ? { dimensions: this.requestedDimensions } : {}) }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Semantic embedding provider failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
      let payload: unknown;
      try { payload = JSON.parse(responseText); } catch { throw new Error('Semantic embedding provider returned non-JSON output.'); }
      const record = payload as { model?: unknown; data?: unknown; usage?: { total_tokens?: unknown } };
      if (typeof record.model === 'string' && record.model.trim()) resolvedModel = record.model;
      if (!Array.isArray(record.data) || record.data.length !== batch.length) throw new Error('Semantic embedding provider returned a mismatched data array.');
      const ordered = [...record.data].sort((left, right) => Number((left as { index?: unknown }).index ?? 0) - Number((right as { index?: unknown }).index ?? 0));
      for (const item of ordered) {
        const vector = (item as { embedding?: unknown }).embedding;
        if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Semantic embedding provider returned an invalid vector.');
        resolvedDimensions ??= vector.length;
        if (vector.length !== resolvedDimensions) throw new Error('Semantic embedding provider changed vector dimensions within one index build.');
        vectors.push(normalizeVector(vector as number[]));
      }
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-omniroute-request-id');
      const totalTokens = Number(record.usage?.total_tokens);
      const responseCost = Number(response.headers.get('x-omniroute-response-cost') ?? response.headers.get('x-embedding-cost-usd'));
      receipts.push({
        ...(requestId ? { requestId } : {}),
        ...(Number.isFinite(totalTokens) ? { inputTokens: Math.max(0, Math.round(totalTokens)) } : {}),
        ...(Number.isFinite(responseCost) ? { costUsd: Math.max(0, responseCost) } : {}),
        latencyMs: Date.now() - startedAt,
      });
    }
    if (resolvedDimensions === undefined) throw new Error('Semantic embedding provider did not resolve vector dimensions.');
    const profile: ResolvedSemanticEmbeddingProfile = {
      ...this.profile,
      model: this.model,
      ...(resolvedModel !== this.model && !this.profile.modelVersion ? { modelVersion: resolvedModel } : {}),
      dimensions: resolvedDimensions,
    };
    return { profile, vectors, receipts };
  }
}

export function createSemanticEmbeddingPortFromEnvironment(): SemanticEmbeddingPort {
  const mode = (process.env.SEMANTIC_EMBEDDING_MODE ?? 'local').trim().toLowerCase();
  if (mode === 'local') {
    return new DeterministicScientificEmbeddingPort({
      dimensions: process.env.SEMANTIC_EMBEDDING_DIMENSIONS ? finiteDimension(process.env.SEMANTIC_EMBEDDING_DIMENSIONS, 384) : 384,
      modelVersion: process.env.SEMANTIC_EMBEDDING_MODEL_VERSION?.trim() || '1',
    });
  }
  if (mode !== 'openai-compatible') throw new Error('SEMANTIC_EMBEDDING_MODE must be local or openai-compatible.');
  const required = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required when SEMANTIC_EMBEDDING_MODE=openai-compatible.`);
    return value;
  };
  return new OpenAiCompatibleEmbeddingPort({
    baseUrl: required('SEMANTIC_EMBEDDING_BASE_URL'),
    apiKey: required('SEMANTIC_EMBEDDING_API_KEY'),
    model: required('SEMANTIC_EMBEDDING_MODEL'),
    ...(process.env.SEMANTIC_EMBEDDING_DIMENSIONS ? { dimensions: finiteDimension(process.env.SEMANTIC_EMBEDDING_DIMENSIONS, 384) } : {}),
    ...(process.env.SEMANTIC_EMBEDDING_MODEL_VERSION?.trim() ? { modelVersion: process.env.SEMANTIC_EMBEDDING_MODEL_VERSION.trim() } : {}),
    ...(process.env.SEMANTIC_EMBEDDING_PROVIDER?.trim() ? { provider: process.env.SEMANTIC_EMBEDDING_PROVIDER.trim() } : {}),
    ...(process.env.SEMANTIC_EMBEDDING_BATCH_SIZE ? { batchSize: positiveInteger(Number(process.env.SEMANTIC_EMBEDDING_BATCH_SIZE), 64, 2048) } : {}),
  });
}
