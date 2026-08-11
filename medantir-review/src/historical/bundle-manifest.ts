import { createHash } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_BUNDLE_MANIFEST_SCHEMA_VERSION = 'medantir-historical-review-bundle/1' as const;

export type HistoricalBundleEntryKind =
  | 'capsule'
  | 'certificate'
  | 'review-envelope'
  | 'ledger'
  | 'environment'
  | 'algorithm-contract'
  | 'parser-checkpoint'
  | 'source-object'
  | 'analysis-input'
  | 'analysis-result'
  | 'report'
  | 'other-receipt';

export type HistoricalBundleAccessClass = 'public' | 'restricted-source' | 'verifier-receipt-only';

export interface HistoricalBundleEntryInput {
  logicalPath: string;
  kind: HistoricalBundleEntryKind;
  scientificHash: string;
  byteHash?: string;
  byteLength?: number;
  accessClass: HistoricalBundleAccessClass;
  requiredForClaim: boolean;
  description?: string;
}

export interface HistoricalBundleEntry extends HistoricalBundleEntryInput {
  leafHash: string;
}

export interface HistoricalReviewBundleManifest {
  schemaVersion: typeof HISTORICAL_BUNDLE_MANIFEST_SCHEMA_VERSION;
  reviewId: string;
  benchmarkId: string;
  entries: HistoricalBundleEntry[];
  merkleRoot: string;
  entryCount: number;
  requiredEntryCount: number;
  manifestId: string;
}

export interface HistoricalBundleVerification {
  valid: boolean;
  manifestIdValid: boolean;
  merkleRootValid: boolean;
  entryErrors: Array<{ logicalPath: string; error: string }>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function cleanPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!normalized || normalized === '.' || normalized.includes('../') || normalized.includes('/..')) {
    throw new Error(`Historical bundle logical path '${path}' is invalid.`);
  }
  return normalized;
}

function assertHash(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return normalized;
}

function normalizedEntryInput(input: HistoricalBundleEntryInput): HistoricalBundleEntryInput {
  if (input.byteLength !== undefined && (!Number.isInteger(input.byteLength) || input.byteLength < 0)) {
    throw new Error(`${input.logicalPath} byteLength must be a non-negative integer.`);
  }
  if ((input.byteHash === undefined) !== (input.byteLength === undefined)) {
    throw new Error(`${input.logicalPath} byteHash and byteLength must be supplied together.`);
  }
  return {
    logicalPath: cleanPath(input.logicalPath),
    kind: input.kind,
    scientificHash: assertHash(input.scientificHash, `${input.logicalPath} scientificHash`),
    ...(input.byteHash !== undefined ? {
      byteHash: assertHash(input.byteHash, `${input.logicalPath} byteHash`),
      byteLength: input.byteLength!,
    } : {}),
    accessClass: input.accessClass,
    requiredForClaim: input.requiredForClaim,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
}

function leafIdentity(input: HistoricalBundleEntryInput): unknown {
  const normalized = normalizedEntryInput(input);
  return {
    logicalPath: normalized.logicalPath,
    kind: normalized.kind,
    scientificHash: normalized.scientificHash,
    byteHash: normalized.byteHash ?? null,
    byteLength: normalized.byteLength ?? null,
    accessClass: normalized.accessClass,
    requiredForClaim: normalized.requiredForClaim,
    description: normalized.description ?? null,
  };
}

function entryFromInput(input: HistoricalBundleEntryInput): HistoricalBundleEntry {
  const normalized = normalizedEntryInput(input);
  return { ...normalized, leafHash: scientificContentHash(leafIdentity(normalized)) };
}

/**
 * Leaves are path-sorted before tree construction. Pair nodes are domain-
 * separated from leaves; an odd node is promoted unchanged. The root therefore
 * depends on logical receipt identity/content, not archive-file ordering.
 */
export function historicalBundleMerkleRoot(entries: HistoricalBundleEntry[]): string {
  if (entries.length === 0) return sha256('MEDANTIR:HISTORICAL:BUNDLE:EMPTY');
  let level = entries
    .slice()
    .sort((a, b) => a.logicalPath.localeCompare(b.logicalPath))
    .map((entry) => sha256(`MEDANTIR:HISTORICAL:LEAF:${entry.leafHash}`));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      next.push(right ? sha256(`MEDANTIR:HISTORICAL:NODE:${left}:${right}`) : left);
    }
    level = next;
  }
  return level[0]!;
}

function manifestIdentity(input: Omit<HistoricalReviewBundleManifest, 'manifestId'>): unknown {
  return {
    schemaVersion: input.schemaVersion,
    reviewId: input.reviewId,
    benchmarkId: input.benchmarkId,
    entries: input.entries.map((entry) => ({ logicalPath: entry.logicalPath, leafHash: entry.leafHash })),
    merkleRoot: input.merkleRoot,
    entryCount: input.entryCount,
    requiredEntryCount: input.requiredEntryCount,
  };
}

export function createHistoricalReviewBundleManifest(input: {
  reviewId: string;
  benchmarkId: string;
  entries: HistoricalBundleEntryInput[];
}): HistoricalReviewBundleManifest {
  const seen = new Set<string>();
  const entries = input.entries.map(entryFromInput).sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  for (const entry of entries) {
    if (seen.has(entry.logicalPath)) throw new Error(`Historical bundle duplicates logical path '${entry.logicalPath}'.`);
    seen.add(entry.logicalPath);
  }
  const base: Omit<HistoricalReviewBundleManifest, 'manifestId'> = {
    schemaVersion: HISTORICAL_BUNDLE_MANIFEST_SCHEMA_VERSION,
    reviewId: input.reviewId.trim(),
    benchmarkId: input.benchmarkId.trim(),
    entries,
    merkleRoot: historicalBundleMerkleRoot(entries),
    entryCount: entries.length,
    requiredEntryCount: entries.filter((entry) => entry.requiredForClaim).length,
  };
  if (!base.reviewId || !base.benchmarkId) throw new Error('Historical bundle requires reviewId and benchmarkId.');
  return { ...base, manifestId: `HBM-${scientificContentHash(manifestIdentity(base)).slice(0, 24)}` };
}

export function verifyHistoricalReviewBundleManifest(
  manifest: HistoricalReviewBundleManifest,
): HistoricalBundleVerification {
  const entryErrors: Array<{ logicalPath: string; error: string }> = [];
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.logicalPath)) entryErrors.push({ logicalPath: entry.logicalPath, error: 'duplicate logical path' });
    seen.add(entry.logicalPath);
    try {
      const expected = entryFromInput(entry);
      if (expected.leafHash !== entry.leafHash) entryErrors.push({ logicalPath: entry.logicalPath, error: 'leaf hash mismatch' });
    } catch (error) {
      entryErrors.push({ logicalPath: entry.logicalPath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const merkleRootValid = historicalBundleMerkleRoot(manifest.entries) === manifest.merkleRoot;
  const { manifestId: _manifestId, ...base } = manifest;
  const manifestIdValid = manifest.manifestId === `HBM-${scientificContentHash(manifestIdentity(base)).slice(0, 24)}`;
  return {
    valid: entryErrors.length === 0 && merkleRootValid && manifestIdValid,
    manifestIdValid,
    merkleRootValid,
    entryErrors,
  };
}
