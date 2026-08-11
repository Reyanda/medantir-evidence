import type { PipelineState } from '../core/types.js';
import { scientificContentHash } from '../core/canonical-hash.js';
import {
  verifyHistoricalReplayCapsule,
  type HistoricalReplayCapsule,
  type HistoricalReplayCheckpoint,
  type HistoricalSourceSnapshot,
} from './replay-capsule.js';

export const HISTORICAL_REPLAY_CERTIFICATE_SCHEMA_VERSION = 'medantir-historical-replay-certificate/1' as const;

export type HistoricalDivergenceScope =
  | 'capsule-integrity'
  | 'search-contract'
  | 'source-provenance'
  | 'source-corpus'
  | 'pipeline-checkpoint'
  | 'missing-checkpoint'
  | 'unexpected-checkpoint';

export interface HistoricalReplayDivergence {
  scope: HistoricalDivergenceScope;
  database?: string;
  stage?: string;
  artifactKey?: string;
  expectedHash?: string;
  actualHash?: string;
  message: string;
}

export interface HistoricalReplayCertificate {
  schemaVersion: typeof HISTORICAL_REPLAY_CERTIFICATE_SCHEMA_VERSION;
  capsuleId: string;
  benchmarkId: string;
  historicalCutoff: string;
  capsuleValid: boolean;
  exactMachineReplay: boolean;
  publicationExact: boolean;
  reproductionClaim: HistoricalReplayCapsule['reproductionClaim'];
  checkedSources: number;
  checkedCheckpoints: number;
  divergences: HistoricalReplayDivergence[];
  firstDivergence?: HistoricalReplayDivergence;
}

export function historicalCheckpoint(
  stage: string,
  artifactKey: string,
  value: unknown,
): HistoricalReplayCheckpoint {
  return { stage, artifactKey, hash: scientificContentHash(value) };
}

export function historicalCheckpointsFromState(
  state: PipelineState,
  entries: Array<{ stage: string; artifactKey: string }>,
): HistoricalReplayCheckpoint[] {
  return entries.map(({ stage, artifactKey }) => {
    if (!(artifactKey in state.artifacts)) {
      throw new Error(`Cannot freeze historical checkpoint '${stage}:${artifactKey}': artifact is absent.`);
    }
    return historicalCheckpoint(stage, artifactKey, state.artifacts[artifactKey]);
  });
}

function normalizedDatabase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function compareSource(
  expected: HistoricalSourceSnapshot,
  actual: HistoricalSourceSnapshot | undefined,
): HistoricalReplayDivergence[] {
  if (!actual) {
    return [{
      scope: 'source-corpus',
      database: expected.database,
      expectedHash: expected.snapshotHash,
      message: `Historical replay did not produce source '${expected.database}'.`,
    }];
  }
  const divergences: HistoricalReplayDivergence[] = [];
  if (expected.strategyContractHash !== actual.strategyContractHash) {
    divergences.push({
      scope: 'search-contract',
      database: expected.database,
      expectedHash: expected.strategyContractHash,
      actualHash: actual.strategyContractHash,
      message: `Search contract diverged for ${expected.database}.`,
    });
  }
  if (expected.provenanceHash !== actual.provenanceHash) {
    divergences.push({
      scope: 'source-provenance',
      database: expected.database,
      expectedHash: expected.provenanceHash,
      actualHash: actual.provenanceHash,
      message: `Source provenance diverged for ${expected.database}.`,
    });
  }
  if (expected.recordsHash !== actual.recordsHash) {
    divergences.push({
      scope: 'source-corpus',
      database: expected.database,
      expectedHash: expected.recordsHash,
      actualHash: actual.recordsHash,
      message: `Normalized source corpus diverged for ${expected.database}.`,
    });
  }
  return divergences;
}

function compareCheckpoints(
  expected: HistoricalReplayCheckpoint[],
  actual: HistoricalReplayCheckpoint[],
): HistoricalReplayDivergence[] {
  const divergences: HistoricalReplayDivergence[] = [];
  const actualByKey = new Map(actual.map((checkpoint) => [`${checkpoint.stage}:${checkpoint.artifactKey}`, checkpoint]));
  const expectedKeys = new Set<string>();
  for (const checkpoint of expected) {
    const key = `${checkpoint.stage}:${checkpoint.artifactKey}`;
    expectedKeys.add(key);
    const observed = actualByKey.get(key);
    if (!observed) {
      divergences.push({
        scope: 'missing-checkpoint',
        stage: checkpoint.stage,
        artifactKey: checkpoint.artifactKey,
        expectedHash: checkpoint.hash,
        message: `Historical replay is missing checkpoint ${key}.`,
      });
      continue;
    }
    if (checkpoint.hash !== observed.hash) {
      divergences.push({
        scope: 'pipeline-checkpoint',
        stage: checkpoint.stage,
        artifactKey: checkpoint.artifactKey,
        expectedHash: checkpoint.hash,
        actualHash: observed.hash,
        message: `Historical replay checkpoint diverged at ${key}.`,
      });
    }
  }
  for (const checkpoint of actual) {
    const key = `${checkpoint.stage}:${checkpoint.artifactKey}`;
    if (expectedKeys.has(key)) continue;
    divergences.push({
      scope: 'unexpected-checkpoint',
      stage: checkpoint.stage,
      artifactKey: checkpoint.artifactKey,
      actualHash: checkpoint.hash,
      message: `Historical replay produced an unregistered checkpoint ${key}.`,
    });
  }
  return divergences;
}

export function buildHistoricalReplayCertificate(input: {
  capsule: HistoricalReplayCapsule;
  actualSources: HistoricalSourceSnapshot[];
  actualCheckpoints?: HistoricalReplayCheckpoint[];
}): HistoricalReplayCertificate {
  const verification = verifyHistoricalReplayCapsule(input.capsule);
  const divergences: HistoricalReplayDivergence[] = [];
  if (!verification.valid) {
    for (const error of verification.sourceErrors) {
      divergences.push({
        scope: 'capsule-integrity',
        ...(error.database === '*' ? {} : { database: error.database }),
        message: error.error,
      });
    }
    if (!verification.capsuleIdValid) {
      divergences.push({ scope: 'capsule-integrity', message: 'Historical capsule ID does not match its scientific content.' });
    }
  }
  const actualByDatabase = new Map(input.actualSources.map((source) => [normalizedDatabase(source.database), source]));
  for (const expected of input.capsule.sources) {
    divergences.push(...compareSource(expected, actualByDatabase.get(normalizedDatabase(expected.database))));
  }
  const expectedDatabases = new Set(input.capsule.sources.map((source) => normalizedDatabase(source.database)));
  for (const actual of input.actualSources) {
    if (expectedDatabases.has(normalizedDatabase(actual.database))) continue;
    divergences.push({
      scope: 'source-corpus',
      database: actual.database,
      actualHash: actual.snapshotHash,
      message: `Historical replay produced unexpected source '${actual.database}'.`,
    });
  }
  divergences.push(...compareCheckpoints(input.capsule.checkpoints, input.actualCheckpoints ?? []));

  return {
    schemaVersion: HISTORICAL_REPLAY_CERTIFICATE_SCHEMA_VERSION,
    capsuleId: input.capsule.capsuleId,
    benchmarkId: input.capsule.benchmarkId,
    historicalCutoff: input.capsule.historicalCutoff,
    capsuleValid: verification.valid,
    exactMachineReplay: verification.valid && divergences.length === 0,
    publicationExact: verification.valid
      && divergences.length === 0
      && input.capsule.reproductionClaim === 'publication-exact',
    reproductionClaim: input.capsule.reproductionClaim,
    checkedSources: input.capsule.sources.length,
    checkedCheckpoints: input.capsule.checkpoints.length,
    divergences,
    ...(divergences[0] ? { firstDivergence: divergences[0] } : {}),
  };
}
