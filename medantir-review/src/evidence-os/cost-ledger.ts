import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
import type { EvidenceCostLedger, ModelCostEntry } from './types.js';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function maybeEntry(value: Record<string, unknown>, sourcePath: string): ModelCostEntry | null {
  const requestedModel = stringValue(value.requestedModel);
  const actualModel = stringValue(value.actualModel);
  const provider = stringValue(value.provider);
  const requestId = stringValue(value.requestId);
  const inputTokens = nonNegative(value.inputTokens);
  const outputTokens = nonNegative(value.outputTokens);
  const latencyMs = nonNegative(value.latencyMs);
  const costUsd = nonNegative(value.costUsd);
  if (!requestedModel && !actualModel && !provider && !requestId
    && inputTokens === undefined && outputTokens === undefined && latencyMs === undefined && costUsd === undefined) return null;
  const base = {
    sourcePath,
    ...(requestedModel ? { requestedModel } : {}),
    ...(actualModel ? { actualModel } : {}),
    ...(provider ? { provider } : {}),
    ...(requestId ? { requestId } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
  return {
    entryId: `cost-${scientificContentHash(base).slice(0, 40)}`,
    ...base,
  };
}

function walk(
  value: unknown,
  path: string,
  entries: Map<string, ModelCostEntry>,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== 'object') return;
  const object = value as object;
  if (seen.has(object)) return;
  seen.add(object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, entries, seen));
    return;
  }
  const record = value as Record<string, unknown>;
  const entry = maybeEntry(record, path);
  if (entry) entries.set(entry.entryId, entry);
  for (const [key, child] of Object.entries(record)) walk(child, path ? `${path}.${key}` : key, entries, seen);
}

export function buildEvidenceCostLedger(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
): EvidenceCostLedger {
  const byId = new Map<string, ModelCostEntry>();
  walk(state.artifacts, 'artifacts', byId, new WeakSet<object>());
  const entries = [...byId.values()].sort((a, b) => a.entryId.localeCompare(b.entryId));
  const totals = entries.reduce((accumulator, entry) => ({
    calls: accumulator.calls + 1,
    pricedCalls: accumulator.pricedCalls + (entry.costUsd !== undefined ? 1 : 0),
    unpricedCalls: accumulator.unpricedCalls + (entry.costUsd === undefined ? 1 : 0),
    inputTokens: accumulator.inputTokens + (entry.inputTokens ?? 0),
    outputTokens: accumulator.outputTokens + (entry.outputTokens ?? 0),
    latencyMs: accumulator.latencyMs + (entry.latencyMs ?? 0),
    costUsd: accumulator.costUsd + (entry.costUsd ?? 0),
  }), {
    calls: 0,
    pricedCalls: 0,
    unpricedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: 0,
  });
  return {
    schemaVersion: 'medantir-cost-ledger/1',
    generatedAt,
    ledgerHash: scientificContentHash({ entries, totals }),
    entries,
    totals,
  };
}
