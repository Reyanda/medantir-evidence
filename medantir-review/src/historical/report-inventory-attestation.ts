import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';

export const HISTORICAL_REPORT_INVENTORY_SCHEMA_VERSION = 'medantir-historical-report-inventory/1' as const;

export type HistoricalReportInventoryStatus =
  | 'complete-original-ledger'
  | 'complete-source-reconstructed'
  | 'incomplete'
  | 'unknown';

export interface HistoricalLineageReportInventoryInput {
  lineageId: string;
  status: HistoricalReportInventoryStatus;
  expectedReportIds: string[];
  evidenceReference: string;
  evidenceObjectId?: string;
  evidenceSha256?: string;
  notes?: string[];
}

export interface HistoricalLineageReportInventory extends HistoricalLineageReportInventoryInput {
  attestationHash: string;
  exactEvidenceObject: boolean;
}

export interface HistoricalReportInventoryVerification {
  schemaVersion: typeof HISTORICAL_REPORT_INVENTORY_SCHEMA_VERSION;
  lineages: HistoricalLineageReportInventory[];
  requiredLineageIds: string[];
  incompleteLineageIds: string[];
  unlistedReportIds: string[];
  undeclaredExpectedReportIds: string[];
  computationalInventoryComplete: boolean;
  originalInventoryComplete: boolean;
  verificationHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function exactObject(objectId: string | undefined, sha256: string | undefined): boolean {
  return Boolean(sha256 && /^[a-f0-9]{64}$/i.test(sha256) && objectId === `HOBJ-${sha256.toLowerCase()}`);
}

export function createHistoricalReportInventoryVerification(input: {
  sourceManifest: HistoricalStudySourceManifest;
  lineages: HistoricalLineageReportInventoryInput[];
}): HistoricalReportInventoryVerification {
  const requiredLineageIds = [...input.sourceManifest.requiredLineageIds].sort();
  const requiredLineages = new Set(requiredLineageIds);
  const manifestReportIds = new Set(input.sourceManifest.reports.map((report) => report.reportId));
  const manifestRequiredReportIds = new Set(input.sourceManifest.reports
    .filter((report) => report.requiredForReproduction)
    .map((report) => report.reportId));
  const seen = new Set<string>();
  const lineages = input.lineages.map((lineage) => {
    const lineageId = clean(lineage.lineageId);
    if (!requiredLineages.has(lineageId)) throw new Error(`Historical report inventory references unknown canonical lineage '${lineageId}'.`);
    if (seen.has(lineageId)) throw new Error(`Historical report inventory duplicates lineage '${lineageId}'.`);
    seen.add(lineageId);
    if (!clean(lineage.evidenceReference)) throw new Error(`Historical report inventory '${lineageId}' requires an evidence reference.`);
    const expectedReportIds = [...new Set(lineage.expectedReportIds.map(clean).filter(Boolean))].sort();
    if ((lineage.status === 'complete-original-ledger' || lineage.status === 'complete-source-reconstructed') && expectedReportIds.length === 0) {
      throw new Error(`Complete historical report inventory '${lineageId}' must identify at least one expected report.`);
    }
    const normalized: HistoricalLineageReportInventoryInput = {
      ...lineage,
      lineageId,
      expectedReportIds,
      evidenceReference: clean(lineage.evidenceReference),
      ...(lineage.notes ? { notes: lineage.notes.map(clean).filter(Boolean) } : {}),
    };
    return {
      ...normalized,
      exactEvidenceObject: exactObject(lineage.evidenceObjectId, lineage.evidenceSha256),
      attestationHash: scientificContentHash(normalized),
    };
  }).sort((a, b) => a.lineageId.localeCompare(b.lineageId));

  const missingAttestations = requiredLineageIds.filter((lineageId) => !seen.has(lineageId));
  const incompleteLineageIds = requiredLineageIds.filter((lineageId) => {
    const attestation = lineages.find((item) => item.lineageId === lineageId);
    return !attestation || attestation.status === 'incomplete' || attestation.status === 'unknown';
  });
  const expectedAll = new Set(lineages.flatMap((lineage) => lineage.expectedReportIds));
  const unlistedReportIds = [...expectedAll].filter((reportId) => !manifestReportIds.has(reportId)).sort();
  const undeclaredExpectedReportIds = [...manifestRequiredReportIds].filter((reportId) => !expectedAll.has(reportId)).sort();
  const computationalInventoryComplete = missingAttestations.length === 0
    && incompleteLineageIds.length === 0
    && unlistedReportIds.length === 0
    && undeclaredExpectedReportIds.length === 0;
  const originalInventoryComplete = computationalInventoryComplete
    && lineages.every((lineage) => lineage.status === 'complete-original-ledger' && lineage.exactEvidenceObject);
  const base = {
    schemaVersion: HISTORICAL_REPORT_INVENTORY_SCHEMA_VERSION,
    lineages,
    requiredLineageIds,
    incompleteLineageIds,
    unlistedReportIds,
    undeclaredExpectedReportIds,
    computationalInventoryComplete,
    originalInventoryComplete,
  };
  return { ...base, verificationHash: scientificContentHash(base) };
}
