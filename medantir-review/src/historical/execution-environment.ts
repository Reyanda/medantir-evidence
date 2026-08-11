import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_EXECUTION_ENVIRONMENT_SCHEMA_VERSION = 'medantir-historical-execution-environment/1' as const;

export interface HistoricalLockfileReceipt {
  name: string;
  sha256: string;
  byteLength: number;
}

export interface HistoricalExternalToolReceipt {
  name: string;
  version: string;
  contractHash?: string;
}

export interface HistoricalContainerReceipt {
  name: string;
  image: string;
  digest: string;
}

export interface HistoricalExecutionEnvironmentFingerprint {
  schemaVersion: typeof HISTORICAL_EXECUTION_ENVIRONMENT_SCHEMA_VERSION;
  codeIdentity: string;
  runtime: {
    engine: 'node';
    version: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  locale: string;
  timezone: string;
  lockfiles: HistoricalLockfileReceipt[];
  moduleContractHashes: string[];
  algorithmContractHashes: string[];
  externalTools: HistoricalExternalToolReceipt[];
  containers: HistoricalContainerReceipt[];
  randomness: {
    policy: 'deterministic-no-rng' | 'seeded';
    seed?: string;
  };
  environmentHash: string;
}

export type HistoricalEnvironmentComparison =
  | 'runtime-identical'
  | 'scientific-contract-equivalent'
  | 'scientific-contract-drift';

function rawSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeTool(tool: HistoricalExternalToolReceipt): HistoricalExternalToolReceipt {
  return {
    name: tool.name.trim(),
    version: tool.version.trim(),
    ...(tool.contractHash ? { contractHash: tool.contractHash.trim().toLowerCase() } : {}),
  };
}

function normalizeContainer(container: HistoricalContainerReceipt): HistoricalContainerReceipt {
  const digest = container.digest.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Container '${container.name}' requires an immutable sha256 image digest.`);
  }
  return { name: container.name.trim(), image: container.image.trim(), digest };
}

function identityWithoutHash(input: Omit<HistoricalExecutionEnvironmentFingerprint, 'environmentHash'>): unknown {
  return {
    ...input,
    lockfiles: [...input.lockfiles].sort((a, b) => a.name.localeCompare(b.name)),
    moduleContractHashes: [...input.moduleContractHashes].sort(),
    algorithmContractHashes: [...input.algorithmContractHashes].sort(),
    externalTools: [...input.externalTools].sort((a, b) => a.name.localeCompare(b.name)),
    containers: [...input.containers].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function historicalLockfileReceipt(name: string, path: string): Promise<HistoricalLockfileReceipt> {
  const bytes = new Uint8Array(await readFile(path));
  return { name: name.trim(), sha256: rawSha256(bytes), byteLength: bytes.byteLength };
}

export function createHistoricalExecutionEnvironmentFingerprint(input: {
  codeIdentity: string;
  lockfiles?: HistoricalLockfileReceipt[];
  moduleContractHashes?: string[];
  algorithmContractHashes?: string[];
  externalTools?: HistoricalExternalToolReceipt[];
  containers?: HistoricalContainerReceipt[];
  locale?: string;
  timezone?: string;
  randomness?: HistoricalExecutionEnvironmentFingerprint['randomness'];
  runtime?: HistoricalExecutionEnvironmentFingerprint['runtime'];
}): HistoricalExecutionEnvironmentFingerprint {
  if (!input.codeIdentity.trim()) throw new Error('Historical execution environment requires a code identity.');
  const runtime = input.runtime ?? {
    engine: 'node' as const,
    version: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  const locale = input.locale ?? Intl.DateTimeFormat().resolvedOptions().locale ?? 'und';
  const timezone = input.timezone ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  const randomness = input.randomness ?? { policy: 'deterministic-no-rng' as const };
  if (randomness.policy === 'seeded' && !randomness.seed?.trim()) {
    throw new Error('Seeded historical execution environment requires an explicit seed.');
  }
  const base: Omit<HistoricalExecutionEnvironmentFingerprint, 'environmentHash'> = {
    schemaVersion: HISTORICAL_EXECUTION_ENVIRONMENT_SCHEMA_VERSION,
    codeIdentity: input.codeIdentity.trim(),
    runtime,
    locale,
    timezone,
    lockfiles: [...(input.lockfiles ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    moduleContractHashes: [...new Set(input.moduleContractHashes ?? [])].sort(),
    algorithmContractHashes: [...new Set(input.algorithmContractHashes ?? [])].sort(),
    externalTools: (input.externalTools ?? []).map(normalizeTool).sort((a, b) => a.name.localeCompare(b.name)),
    containers: (input.containers ?? []).map(normalizeContainer).sort((a, b) => a.name.localeCompare(b.name)),
    randomness,
  };
  return {
    ...base,
    environmentHash: scientificContentHash(identityWithoutHash(base)),
  };
}

function scientificContractProjection(environment: HistoricalExecutionEnvironmentFingerprint): unknown {
  return {
    moduleContractHashes: environment.moduleContractHashes,
    algorithmContractHashes: environment.algorithmContractHashes,
    externalTools: environment.externalTools,
    randomness: environment.randomness,
    locale: environment.locale,
    timezone: environment.timezone,
  };
}

export function compareHistoricalExecutionEnvironments(
  expected: HistoricalExecutionEnvironmentFingerprint,
  actual: HistoricalExecutionEnvironmentFingerprint,
): HistoricalEnvironmentComparison {
  if (expected.environmentHash === actual.environmentHash) return 'runtime-identical';
  if (scientificContentHash(scientificContractProjection(expected)) === scientificContentHash(scientificContractProjection(actual))) {
    return 'scientific-contract-equivalent';
  }
  return 'scientific-contract-drift';
}
