import { stableHash } from '../core/utils.js';

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelInferenceRequest {
  taskId: string;
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  evidenceObjectIds?: string[];
  promptVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelRoutingReceipt {
  gateway: string;
  requestedModel: string;
  budgetCapUsd?: number;
  budgetFallback?: 'strict' | 'cheapest';
  actualProvider?: string;
  actualModel?: string;
  routingDecision?: string;
  requestId?: string;
  gatewayVersion?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  responseCostUsd?: number;
  fallbackAttempts?: number;
  cacheHit?: boolean;
}

export interface ModelInferenceResult {
  text: string;
  requestHash: string;
  outputHash: string;
  receipt: ModelRoutingReceipt;
  rawUsage?: Record<string, unknown>;
}

export interface ModelInferencePort {
  complete(request: ModelInferenceRequest): Promise<ModelInferenceResult>;
}

export function modelInferenceRequestHash(request: ModelInferenceRequest): string {
  return stableHash({
    taskId: request.taskId,
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0,
    maxTokens: request.maxTokens ?? null,
    responseFormat: request.responseFormat ?? 'text',
    evidenceObjectIds: [...(request.evidenceObjectIds ?? [])].sort(),
    promptVersion: request.promptVersion ?? null,
    metadata: request.metadata ?? {},
  });
}

export function modelInferenceOutputHash(text: string): string {
  return stableHash(text);
}
