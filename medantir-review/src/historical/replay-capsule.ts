import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import { canonicalScientificValue, scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalDateRange } from '../adapters/source-query-compiler.js';

export const HISTORICAL_REPLAY_CAPSULE_SCHEMA_VERSION = 'medantir-historical-replay-capsule/1' as const;

export type HistoricalReproductionClaim =
  | 'publication-exact'
  | 'machine-exact-publication-incomplete'
  | 'historically-approximate';

export interface HistoricalPublicationSearchClaim {
  database: string;
  platform?: string;
  reportedResultCount?: number;
  queryAvailable: boolean;
  dateRestrictionAvailable: boolean;
  languageRestrictionAvailable: boolean;
  manualSearchesDisclosed: boolean;
  sourceReference: string;
  notes?: string[];
}

export interface HistoricalReplayCheckpoint {
  stage: string;
  artifactKey: string;
  hash: string;
}

export interface HistoricalSourceSnapshot {
  database: string;
  platform: string;
  strategyContractHash: string;
  strategy: SearchStrategy & { dateRange?: HistoricalDateRange };
  executedQuery: string;
  resultCount: number;
  records: EvidenceRecord[];
  recordsHash: string;
  provenance: SearchProvenance;
  provenanceHash: string;
  snapshotHash: string;
}

export interface HistoricalReplayCapsule {
  schemaVersion: typeof HISTORICAL_REPLAY_CAPSULE_SCHEMA_VERSION;
  capsuleId: string;
  benchmarkId: string;
  historicalCutoff: string;
  searchStart?: string;
  publicationClaims: HistoricalPublicationSearchClaim[];
  sources: HistoricalSourceSnapshot[];
  importedCorpusHash: string;
  checkpoints: HistoricalReplayCheckpoint[];
  reproductionClaim: HistoricalReproductionClaim;
  reproductionReasons: string[];
}

export interface HistoricalCapsuleVerification {
  valid: boolean;
  capsuleIdValid: boolean;
  sourceErrors: Array<{ database: string; error: string }>;
  checkpointCount: number;
}

type DatedSearchStrategy = SearchStrategy & { dateRange?: HistoricalDateRange };

function cloneScientific<T>(value: T): T {
  return canonicalScientificValue(value) as T;
}

function normalizedDatabase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A search strategy's generation timestamp is operational noise. Historical
 * replay identity is the source/platform/query/date contract that controls
 * retrieval, not the wall-clock time at which MEDANTIR rendered the object.
 */
export function historicalStrategyContract(strategy: DatedSearchStrategy): unknown {
  return {
    database: normalizedDatabase(strategy.database),
    platform: strategy.platform.trim(),
    purpose: strategy.purpose ?? null,
    query: strategy.query,
    dateRange: strategy.dateRange ?? null,
  };
}

export function historicalStrategyContractHash(strategy: DatedSearchStrategy): string {
  return scientificContentHash(historicalStrategyContract(strategy));
}

/** Search execution time is retained for audit but excluded from semantic identity. */
export function historicalProvenanceContract(provenance: SearchProvenance): unknown {
  return {
    database: normalizedDatabase(provenance.database),
    platform: provenance.platform.trim(),
    executedQuery: provenance.executedQuery,
    resultCount: provenance.resultCount,
    exportFormat: provenance.exportFormat,
    warnings: provenance.warnings,
  };
}

export function historicalProvenanceContractHash(provenance: SearchProvenance): string {
  return scientificContentHash(historicalProvenanceContract(provenance));
}

function sourceSnapshotIdentity(snapshot: Omit<HistoricalSourceSnapshot, 'snapshotHash'>): unknown {
  return {
    database: normalizedDatabase(snapshot.database),
    platform: snapshot.platform,
    strategyContractHash: snapshot.strategyContractHash,
    executedQuery: snapshot.executedQuery,
    resultCount: snapshot.resultCount,
    recordsHash: snapshot.recordsHash,
    provenanceHash: snapshot.provenanceHash,
  };
}

export function captureHistoricalSourceSnapshot(
  strategy: DatedSearchStrategy,
  result: { records: EvidenceRecord[]; provenance: SearchProvenance },
): HistoricalSourceSnapshot {
  if (normalizedDatabase(strategy.database) !== normalizedDatabase(result.provenance.database)) {
    throw new Error(`Historical source snapshot database mismatch: strategy=${strategy.database}, provenance=${result.provenance.database}`);
  }
  if (!Number.isFinite(result.provenance.resultCount) || result.provenance.resultCount < 0) {
    throw new Error(`Historical source snapshot for ${strategy.database} has no finite source-reported result count.`);
  }
  const records = cloneScientific(result.records);
  const provenance = cloneScientific(result.provenance);
  const base: Omit<HistoricalSourceSnapshot, 'snapshotHash'> = {
    database: strategy.database,
    platform: result.provenance.platform,
    strategyContractHash: historicalStrategyContractHash(strategy),
    strategy: cloneScientific(strategy),
    executedQuery: result.provenance.executedQuery,
    resultCount: result.provenance.resultCount,
    records,
    recordsHash: scientificContentHash(records),
    provenance,
    provenanceHash: historicalProvenanceContractHash(provenance),
  };
  return {
    ...base,
    snapshotHash: scientificContentHash(sourceSnapshotIdentity(base)),
  };
}

function importedCorpusFromSources(sources: HistoricalSourceSnapshot[]): EvidenceRecord[] {
  return sources.flatMap((source) => source.records);
}

function reproductionClaim(
  publicationClaims: HistoricalPublicationSearchClaim[],
  sources: HistoricalSourceSnapshot[],
  checkpoints: HistoricalReplayCheckpoint[],
): { claim: HistoricalReproductionClaim; reasons: string[] } {
  const reasons: string[] = [];
  if (sources.length === 0) {
    return { claim: 'historically-approximate', reasons: ['No frozen source snapshots are available.'] };
  }
  const covered = new Set(sources.map((source) => normalizedDatabase(source.database)));
  const publicationDatabases = new Set(publicationClaims.map((claim) => normalizedDatabase(claim.database)));
  const allPublicationSourcesFrozen = publicationClaims.length > 0
    && [...publicationDatabases].every((database) => covered.has(database));
  const allQueriesDisclosed = publicationClaims.length > 0 && publicationClaims.every((claim) => claim.queryAvailable);
  const allDateRestrictionsDisclosed = publicationClaims.length > 0 && publicationClaims.every((claim) => claim.dateRestrictionAvailable);
  const allLanguageRestrictionsDisclosed = publicationClaims.length > 0 && publicationClaims.every((claim) => claim.languageRestrictionAvailable);
  const allManualSearchesDisclosed = publicationClaims.length > 0 && publicationClaims.every((claim) => claim.manualSearchesDisclosed);
  const allReportedCountsReconcile = publicationClaims.length > 0 && publicationClaims.every((claim) => {
    if (claim.reportedResultCount === undefined) return false;
    const source = sources.find((candidate) => normalizedDatabase(candidate.database) === normalizedDatabase(claim.database));
    return source?.resultCount === claim.reportedResultCount;
  });

  if (!allPublicationSourcesFrozen) reasons.push('Not every publication-declared source has a frozen machine snapshot.');
  if (!allQueriesDisclosed) reasons.push('The publication record does not disclose every executable database query completely.');
  if (!allDateRestrictionsDisclosed) reasons.push('The publication record does not disclose every source-native date restriction completely.');
  if (!allLanguageRestrictionsDisclosed) reasons.push('The publication record does not disclose every source-native language restriction completely.');
  if (!allManualSearchesDisclosed) reasons.push('Reference-list/manual-search execution is not completely reconstructable from the publication record.');
  if (!allReportedCountsReconcile) reasons.push('Frozen source result counts do not reconcile exactly with every publication-reported source count.');
  if (checkpoints.length === 0) reasons.push('No downstream stage checkpoints are frozen yet.');

  if (
    allPublicationSourcesFrozen
    && allQueriesDisclosed
    && allDateRestrictionsDisclosed
    && allLanguageRestrictionsDisclosed
    && allManualSearchesDisclosed
    && allReportedCountsReconcile
    && checkpoints.length > 0
  ) {
    return { claim: 'publication-exact', reasons: ['Published search claims, frozen source corpus, and downstream checkpoints reconcile.'] };
  }
  return {
    claim: 'machine-exact-publication-incomplete',
    reasons: reasons.length > 0 ? reasons : ['Frozen machine inputs are exact, but publication-level completeness has not been independently established.'],
  };
}

function capsuleIdentity(input: Omit<HistoricalReplayCapsule, 'capsuleId'>): unknown {
  return {
    schemaVersion: input.schemaVersion,
    benchmarkId: input.benchmarkId,
    historicalCutoff: input.historicalCutoff,
    searchStart: input.searchStart ?? null,
    publicationClaims: input.publicationClaims,
    sourceReceipts: input.sources.map((source) => ({
      database: source.database,
      snapshotHash: source.snapshotHash,
      recordsHash: source.recordsHash,
      provenanceHash: source.provenanceHash,
      strategyContractHash: source.strategyContractHash,
    })),
    importedCorpusHash: input.importedCorpusHash,
    checkpoints: input.checkpoints,
    reproductionClaim: input.reproductionClaim,
    reproductionReasons: input.reproductionReasons,
  };
}

export function createHistoricalReplayCapsule(input: {
  benchmarkId: string;
  historicalCutoff: string;
  searchStart?: string;
  publicationClaims?: HistoricalPublicationSearchClaim[];
  sources: HistoricalSourceSnapshot[];
  checkpoints?: HistoricalReplayCheckpoint[];
}): HistoricalReplayCapsule {
  const sources = cloneScientific(input.sources);
  const publicationClaims = cloneScientific(input.publicationClaims ?? []);
  const checkpoints = cloneScientific(input.checkpoints ?? []);
  const importedCorpusHash = scientificContentHash(importedCorpusFromSources(sources));
  const classification = reproductionClaim(publicationClaims, sources, checkpoints);
  const base: Omit<HistoricalReplayCapsule, 'capsuleId'> = {
    schemaVersion: HISTORICAL_REPLAY_CAPSULE_SCHEMA_VERSION,
    benchmarkId: input.benchmarkId,
    historicalCutoff: input.historicalCutoff,
    ...(input.searchStart ? { searchStart: input.searchStart } : {}),
    publicationClaims,
    sources,
    importedCorpusHash,
    checkpoints,
    reproductionClaim: classification.claim,
    reproductionReasons: classification.reasons,
  };
  return {
    ...base,
    capsuleId: `HRC-${scientificContentHash(capsuleIdentity(base)).slice(0, 24)}`,
  };
}

export function verifyHistoricalReplayCapsule(capsule: HistoricalReplayCapsule): HistoricalCapsuleVerification {
  const sourceErrors: Array<{ database: string; error: string }> = [];
  for (const source of capsule.sources) {
    if (historicalStrategyContractHash(source.strategy) !== source.strategyContractHash) {
      sourceErrors.push({ database: source.database, error: 'strategy contract hash mismatch' });
    }
    if (scientificContentHash(source.records) !== source.recordsHash) {
      sourceErrors.push({ database: source.database, error: 'records hash mismatch' });
    }
    if (historicalProvenanceContractHash(source.provenance) !== source.provenanceHash) {
      sourceErrors.push({ database: source.database, error: 'provenance contract hash mismatch' });
    }
    const { snapshotHash: _ignored, ...withoutHash } = source;
    if (scientificContentHash(sourceSnapshotIdentity(withoutHash)) !== source.snapshotHash) {
      sourceErrors.push({ database: source.database, error: 'source snapshot hash mismatch' });
    }
  }
  if (scientificContentHash(importedCorpusFromSources(capsule.sources)) !== capsule.importedCorpusHash) {
    sourceErrors.push({ database: '*', error: 'imported corpus hash mismatch' });
  }
  const { capsuleId: _capsuleId, ...base } = capsule;
  const expectedCapsuleId = `HRC-${scientificContentHash(capsuleIdentity(base)).slice(0, 24)}`;
  const capsuleIdValid = capsule.capsuleId === expectedCapsuleId;
  return {
    valid: capsuleIdValid && sourceErrors.length === 0,
    capsuleIdValid,
    sourceErrors,
    checkpointCount: capsule.checkpoints.length,
  };
}

/**
 * Offline evidence adapter backed by a verified historical source snapshot.
 * It rejects query/platform/date drift instead of silently replaying a snapshot
 * under a different search contract.
 */
export class FrozenHistoricalEvidenceSourceAdapter implements EvidenceSourceAdapter {
  readonly database: string;

  constructor(private readonly snapshot: HistoricalSourceSnapshot) {
    this.database = snapshot.database;
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const verification = verifyHistoricalReplayCapsule(createHistoricalReplayCapsule({
      benchmarkId: 'source-verification',
      historicalCutoff: 'source-verification',
      sources: [this.snapshot],
    }));
    if (!verification.valid) {
      throw new Error(`Frozen historical source '${this.database}' failed integrity verification: ${verification.sourceErrors.map((error) => error.error).join(', ')}`);
    }
    const actualContract = historicalStrategyContractHash(strategy as DatedSearchStrategy);
    if (actualContract !== this.snapshot.strategyContractHash) {
      throw new Error(`Historical replay search contract drift for ${this.database}: expected ${this.snapshot.strategyContractHash}, received ${actualContract}.`);
    }
    return {
      records: cloneScientific(this.snapshot.records),
      provenance: cloneScientific(this.snapshot.provenance),
    };
  }
}
