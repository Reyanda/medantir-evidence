import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_INDEX_STATE_ATTESTATION_SCHEMA_VERSION = 'medantir-historical-index-state-attestation/1' as const;

export type HistoricalIndexStateProvenance =
  | 'original-export'
  | 'trusted-historical-snapshot'
  | 'database-versioned-snapshot'
  | 'current-index-reconstruction';

export interface HistoricalIndexStateAttestationInput {
  database: string;
  queryExecutedAt: string;
  historicalSearchEnd: string;
  provenance: HistoricalIndexStateProvenance;
  resultSetHash: string;
  resultCount: number;
  sourceObjectId?: string;
  sourceSha256?: string;
  sourceReference: string;
  notes?: string[];
}

export interface HistoricalIndexStateAttestation extends HistoricalIndexStateAttestationInput {
  exactHistoricalIndexState: boolean;
  attestationHash: string;
}

export interface HistoricalIndexStateVerification {
  schemaVersion: typeof HISTORICAL_INDEX_STATE_ATTESTATION_SCHEMA_VERSION;
  historicalSearchEnd: string;
  attestations: HistoricalIndexStateAttestation[];
  databases: string[];
  exactDatabases: string[];
  reconstructedDatabases: string[];
  exactHistoricalIndexCoverage: boolean;
  verificationHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function validSha(value: string | undefined): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

function exactArchiveBinding(input: HistoricalIndexStateAttestationInput): boolean {
  return validSha(input.sourceSha256)
    && input.sourceObjectId === `HOBJ-${input.sourceSha256!.toLowerCase()}`;
}

function isExactHistoricalProvenance(value: HistoricalIndexStateProvenance): boolean {
  return value === 'original-export'
    || value === 'trusted-historical-snapshot'
    || value === 'database-versioned-snapshot';
}

export function createHistoricalIndexStateVerification(input: {
  historicalSearchEnd: string;
  attestations: HistoricalIndexStateAttestationInput[];
  requiredDatabases?: Iterable<string>;
}): HistoricalIndexStateVerification {
  const searchEndMs = Date.parse(input.historicalSearchEnd);
  if (Number.isNaN(searchEndMs)) throw new Error('Historical index-state verification requires a valid search-end date.');
  const required = new Set([...(input.requiredDatabases ?? input.attestations.map((item) => item.database))].map(clean));
  if (required.size === 0) throw new Error('Historical index-state verification requires at least one database.');
  const seen = new Set<string>();
  const attestations = input.attestations.map((attestation) => {
    const database = clean(attestation.database);
    if (!required.has(database)) throw new Error(`Historical index-state attestation references undeclared database '${database}'.`);
    if (seen.has(database)) throw new Error(`Historical index-state attestation duplicates database '${database}'.`);
    seen.add(database);
    const executedMs = Date.parse(attestation.queryExecutedAt);
    if (Number.isNaN(executedMs)) throw new Error(`${database} queryExecutedAt is invalid.`);
    if (!Number.isInteger(attestation.resultCount) || attestation.resultCount < 0) {
      throw new Error(`${database} resultCount must be a non-negative integer.`);
    }
    if (!validSha(attestation.resultSetHash)) throw new Error(`${database} resultSetHash must be SHA-256.`);
    if (!clean(attestation.sourceReference)) throw new Error(`${database} index-state attestation requires a source reference.`);
    if (attestation.provenance !== 'current-index-reconstruction' && !exactArchiveBinding(attestation)) {
      throw new Error(`${database} exact historical index provenance requires an immutable source export/snapshot receipt.`);
    }
    // Original exports/historical snapshots may have been archived later, but
    // the query execution represented by them must not be after the review's
    // bound search end unless the source itself explicitly versions the index.
    if (attestation.provenance === 'original-export' && executedMs > searchEndMs) {
      throw new Error(`${database} original-export query execution is after the historical search end.`);
    }
    const normalized: HistoricalIndexStateAttestationInput = {
      ...attestation,
      database,
      sourceReference: clean(attestation.sourceReference),
      resultSetHash: attestation.resultSetHash.toLowerCase(),
      ...(attestation.notes ? { notes: attestation.notes.map(clean).filter(Boolean) } : {}),
    };
    const exactHistoricalIndexState = isExactHistoricalProvenance(normalized.provenance)
      && exactArchiveBinding(normalized);
    return {
      ...normalized,
      exactHistoricalIndexState,
      attestationHash: scientificContentHash(normalized),
    };
  }).sort((a, b) => a.database.localeCompare(b.database));

  const missing = [...required].filter((database) => !seen.has(database));
  if (missing.length > 0) throw new Error(`Historical index-state verification is missing database(s): ${missing.sort().join(', ')}.`);
  const exactDatabases = attestations.filter((item) => item.exactHistoricalIndexState).map((item) => item.database);
  const reconstructedDatabases = attestations.filter((item) => !item.exactHistoricalIndexState).map((item) => item.database);
  const base = {
    schemaVersion: HISTORICAL_INDEX_STATE_ATTESTATION_SCHEMA_VERSION,
    historicalSearchEnd: input.historicalSearchEnd,
    attestations,
    databases: [...required].sort(),
    exactDatabases,
    reconstructedDatabases,
    exactHistoricalIndexCoverage: reconstructedDatabases.length === 0,
  };
  return { ...base, verificationHash: scientificContentHash(base) };
}
