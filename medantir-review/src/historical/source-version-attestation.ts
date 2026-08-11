import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalVerifierObjectReceipt } from './evidence-plane-archive.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';

export const HISTORICAL_SOURCE_VERSION_ATTESTATION_SCHEMA_VERSION = 'medantir-historical-source-version-attestation/1' as const;

export type HistoricalSourceVersionStatus =
  | 'verified-as-of-cutoff'
  | 'current-copy-unverified'
  | 'post-cutoff-version'
  | 'unknown';

export type HistoricalSourceVersionBasis =
  | 'trusted-archive-timestamp'
  | 'publisher-version-history'
  | 'repository-version-record'
  | 'version-of-record-immutability-record'
  | 'other';

export interface HistoricalSourceVersionAttestationInput {
  reportId: string;
  status: HistoricalSourceVersionStatus;
  basis?: HistoricalSourceVersionBasis;
  historicalVersionDate?: string;
  evidenceReference: string;
  evidenceObject?: HistoricalVerifierObjectReceipt;
  notes?: string[];
}

export interface HistoricalSourceVersionAttestation extends HistoricalSourceVersionAttestationInput {
  attestationHash: string;
  evidenceObjectExact: boolean;
}

export interface HistoricalSourceVersionVerification {
  schemaVersion: typeof HISTORICAL_SOURCE_VERSION_ATTESTATION_SCHEMA_VERSION;
  historicalCutoff: string;
  attestations: HistoricalSourceVersionAttestation[];
  requiredReportIds: string[];
  verifiedRequiredReportIds: string[];
  unverifiedRequiredReportIds: string[];
  exactHistoricalVersionCoverage: boolean;
  verificationHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function exactObject(receipt: HistoricalVerifierObjectReceipt | undefined): boolean {
  return Boolean(receipt
    && /^[a-f0-9]{64}$/i.test(receipt.sha256)
    && receipt.objectId === `HOBJ-${receipt.sha256.toLowerCase()}`
    && Number.isInteger(receipt.byteLength)
    && receipt.byteLength > 0);
}

function validDate(value: string | undefined, label: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is not a valid date/date-time.`);
}

export function createHistoricalSourceVersionVerification(input: {
  sourceManifest: HistoricalStudySourceManifest;
  attestations: HistoricalSourceVersionAttestationInput[];
}): HistoricalSourceVersionVerification {
  const reportById = new Map(input.sourceManifest.reports.map((report) => [report.reportId, report]));
  const seen = new Set<string>();
  const cutoffMs = Date.parse(input.sourceManifest.historicalCutoff);
  if (Number.isNaN(cutoffMs)) throw new Error('Historical source manifest cutoff is invalid.');

  const attestations = input.attestations.map((attestation) => {
    const reportId = clean(attestation.reportId);
    const report = reportById.get(reportId);
    if (!report) throw new Error(`Historical version attestation references unknown report '${reportId}'.`);
    if (seen.has(reportId)) throw new Error(`Historical version attestation duplicates report '${reportId}'.`);
    seen.add(reportId);
    if (!clean(attestation.evidenceReference)) throw new Error(`Historical version attestation '${reportId}' requires an evidence reference.`);
    validDate(attestation.historicalVersionDate, `${reportId} historical version date`);

    if (attestation.status === 'verified-as-of-cutoff') {
      if (!attestation.basis) throw new Error(`Verified historical version '${reportId}' requires an attestation basis.`);
      if (!attestation.historicalVersionDate) throw new Error(`Verified historical version '${reportId}' requires a historical version date.`);
      if (Date.parse(attestation.historicalVersionDate) > cutoffMs) {
        throw new Error(`Verified historical version '${reportId}' is dated after the review cutoff.`);
      }
      if (report.sourceStatus !== 'archived-exact' || !report.sourceReceiptExact) {
        throw new Error(`Historical version '${reportId}' cannot be verified without exact archived report bytes.`);
      }
    }

    const normalized = {
      ...attestation,
      reportId,
      evidenceReference: clean(attestation.evidenceReference),
      ...(attestation.notes ? { notes: attestation.notes.map(clean).filter(Boolean) } : {}),
    };
    return {
      ...normalized,
      evidenceObjectExact: exactObject(attestation.evidenceObject),
      attestationHash: scientificContentHash(normalized),
    };
  }).sort((a, b) => a.reportId.localeCompare(b.reportId));

  const requiredReportIds = input.sourceManifest.reports
    .filter((report) => report.requiredForReproduction && report.resultBearing)
    .map((report) => report.reportId)
    .sort();
  const verifiedSet = new Set(attestations
    .filter((attestation) => attestation.status === 'verified-as-of-cutoff')
    .map((attestation) => attestation.reportId));
  const verifiedRequiredReportIds = requiredReportIds.filter((reportId) => verifiedSet.has(reportId));
  const unverifiedRequiredReportIds = requiredReportIds.filter((reportId) => !verifiedSet.has(reportId));
  const base = {
    schemaVersion: HISTORICAL_SOURCE_VERSION_ATTESTATION_SCHEMA_VERSION,
    historicalCutoff: input.sourceManifest.historicalCutoff,
    attestations,
    requiredReportIds,
    verifiedRequiredReportIds,
    unverifiedRequiredReportIds,
    exactHistoricalVersionCoverage: requiredReportIds.length > 0 && unverifiedRequiredReportIds.length === 0,
  };
  return { ...base, verificationHash: scientificContentHash(base) };
}
