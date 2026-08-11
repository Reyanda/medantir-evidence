import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import {
  captureHistoricalSourceSnapshot,
  FrozenHistoricalEvidenceSourceAdapter,
  verifyHistoricalReplayCapsule,
  type HistoricalReplayCapsule,
  type HistoricalSourceSnapshot,
} from './replay-capsule.js';

function normalizedDatabase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function strategiesByDatabase(strategies: SearchStrategy[]): Map<string, SearchStrategy> {
  const map = new Map<string, SearchStrategy>();
  for (const strategy of strategies) {
    const key = normalizedDatabase(strategy.database);
    if (map.has(key)) throw new Error(`Historical replay has multiple search strategies for '${strategy.database}'.`);
    map.set(key, strategy);
  }
  return map;
}

export interface HistoricalEvidenceExecution {
  sources: HistoricalSourceSnapshot[];
  records: EvidenceRecord[];
  provenance: SearchProvenance[];
}

/**
 * Capture is intentionally strict. A forensic time capsule is not valid if one
 * of its declared sources is missing, even when a lineage-recall benchmark could
 * tolerate a transient outage and still meet a recall threshold.
 */
export async function captureHistoricalEvidenceSources(
  adapters: EvidenceSourceAdapter[],
  strategies: SearchStrategy[],
): Promise<HistoricalEvidenceExecution> {
  const strategyMap = strategiesByDatabase(strategies);
  const seenAdapters = new Set<string>();
  const sources: HistoricalSourceSnapshot[] = [];
  for (const adapter of adapters) {
    const key = normalizedDatabase(adapter.database);
    if (seenAdapters.has(key)) throw new Error(`Historical replay has multiple source adapters for '${adapter.database}'.`);
    seenAdapters.add(key);
    const strategy = strategyMap.get(key);
    if (!strategy) throw new Error(`Historical capsule capture requires a search strategy for '${adapter.database}'.`);
    const result = await adapter.execute(strategy);
    sources.push(captureHistoricalSourceSnapshot(strategy, result));
  }
  const unusedStrategies = [...strategyMap.keys()].filter((key) => !seenAdapters.has(key));
  if (unusedStrategies.length > 0) {
    throw new Error(`Historical capsule capture has strategies without source adapters: ${unusedStrategies.join(', ')}.`);
  }
  return {
    sources,
    records: sources.flatMap((source) => source.records),
    provenance: sources.map((source) => source.provenance),
  };
}

/**
 * Replay reads only verified capsule snapshots. Network access is neither
 * required nor permitted by this function.
 */
export async function replayHistoricalEvidenceSources(
  capsule: HistoricalReplayCapsule,
  strategies: SearchStrategy[],
): Promise<HistoricalEvidenceExecution> {
  const verification = verifyHistoricalReplayCapsule(capsule);
  if (!verification.valid) {
    throw new Error(`Historical replay capsule '${capsule.capsuleId}' failed integrity verification.`);
  }
  const strategyMap = strategiesByDatabase(strategies);
  const sources: HistoricalSourceSnapshot[] = [];
  for (const expected of capsule.sources) {
    const strategy = strategyMap.get(normalizedDatabase(expected.database));
    if (!strategy) throw new Error(`Offline historical replay is missing strategy '${expected.database}'.`);
    const adapter = new FrozenHistoricalEvidenceSourceAdapter(expected);
    const result = await adapter.execute(strategy);
    sources.push(captureHistoricalSourceSnapshot(strategy, result));
  }
  const expectedDatabases = new Set(capsule.sources.map((source) => normalizedDatabase(source.database)));
  const unexpectedStrategies = [...strategyMap.keys()].filter((key) => !expectedDatabases.has(key));
  if (unexpectedStrategies.length > 0) {
    throw new Error(`Offline historical replay contains source strategies absent from the capsule: ${unexpectedStrategies.join(', ')}.`);
  }
  return {
    sources,
    records: sources.flatMap((source) => source.records),
    provenance: sources.map((source) => source.provenance),
  };
}
