import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalVerifierObjectReceipt } from './evidence-plane-archive.js';

export const HISTORICAL_STUDY_SOURCE_MANIFEST_SCHEMA_VERSION = 'medantir-historical-study-source-manifest/1' as const;

export type HistoricalReportRole =
  | 'primary-results'
  | 'secondary-analysis'
  | 'follow-up'
  | 'protocol'
  | 'registry-report'
  | 'preprint'
  | 'supplement'
  | 'other';

export type HistoricalReportSourceStatus =
  | 'archived-exact'
  | 'identified-unarchived'
  | 'historically-unavailable';

export interface HistoricalReportIdentifierSet {
  doi?: string;
  pmid?: string;
  pmcid?: string;
  registryId?: string;
  url?: string;
}

export interface HistoricalStudyReportInput {
  lineageId: string;
  reportId: string;
  role: HistoricalReportRole;
  title?: string;
  identifiers: HistoricalReportIdentifierSet;
  publicationDate?: string;
  availableByHistoricalCutoff: boolean;
  requiredForReproduction: boolean;
  resultBearing: boolean;
  sourceStatus: HistoricalReportSourceStatus;
  sourceObject?: HistoricalVerifierObjectReceipt;
  notes?: string[];
}

export interface HistoricalStudyReport extends HistoricalStudyReportInput {
  reportHash: string;
  sourceReceiptExact: boolean;
}

export interface HistoricalStudySourceManifest {
  schemaVersion: typeof HISTORICAL_STUDY_SOURCE_MANIFEST_SCHEMA_VERSION;
  historicalCutoff: string;
  reports: HistoricalStudyReport[];
  requiredLineageIds: string[];
  missingLineageIds: string[];
  lineagesWithoutArchivedResultSource: string[];
  requiredReportCount: number;
  archivedRequiredReportCount: number;
  exactSourceCoverage: boolean;
  manifestHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeIdentifiers(input: HistoricalReportIdentifierSet): HistoricalReportIdentifierSet {
  return {
    ...(input.doi?.trim() ? { doi: input.doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') } : {}),
    ...(input.pmid?.trim() ? { pmid: input.pmid.trim() } : {}),
    ...(input.pmcid?.trim() ? { pmcid: input.pmcid.trim().toUpperCase() } : {}),
    ...(input.registryId?.trim() ? { registryId: input.registryId.trim().toUpperCase() } : {}),
    ...(input.url?.trim() ? { url: input.url.trim() } : {}),
  };
}

function exactSourceReceipt(receipt: HistoricalVerifierObjectReceipt | undefined): boolean {
  if (!receipt) return false;
  return /^[a-f0-9]{64}$/i.test(receipt.sha256)
    && receipt.objectId === `HOBJ-${receipt.sha256.toLowerCase()}`
    && Number.isInteger(receipt.byteLength)
    && receipt.byteLength > 0;
}

function validateDate(value: string | undefined, label: string): void {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date/date-time.`);
  }
}

export function createHistoricalStudySourceManifest(input: {
  historicalCutoff: string;
  requiredLineageIds: Iterable<string>;
  reports: HistoricalStudyReportInput[];
}): HistoricalStudySourceManifest {
  validateDate(input.historicalCutoff, 'Historical cutoff');
  const requiredLineageIds = [...new Set([...input.requiredLineageIds].map(clean))].sort();
  if (requiredLineageIds.length === 0) throw new Error('Historical study-source manifest requires canonical lineage IDs.');
  const allowed = new Set(requiredLineageIds);
  const seenReports = new Set<string>();

  const reports = input.reports.map((report) => {
    const lineageId = clean(report.lineageId);
    const reportId = clean(report.reportId);
    if (!allowed.has(lineageId)) throw new Error(`Historical report '${reportId}' references unknown canonical lineage '${lineageId}'.`);
    if (!reportId) throw new Error(`Historical source report for '${lineageId}' requires a report ID.`);
    if (seenReports.has(reportId)) throw new Error(`Historical source manifest duplicates report ID '${reportId}'.`);
    seenReports.add(reportId);
    validateDate(report.publicationDate, `${reportId} publication date`);
    const identifiers = normalizeIdentifiers(report.identifiers);
    if (Object.keys(identifiers).length === 0) throw new Error(`Historical report '${reportId}' requires at least one stable identifier or URL.`);
    const sourceReceiptExact = exactSourceReceipt(report.sourceObject);
    if (report.sourceStatus === 'archived-exact' && !sourceReceiptExact) {
      throw new Error(`Historical report '${reportId}' is marked archived-exact without a valid content-addressed source receipt.`);
    }
    if (report.sourceStatus !== 'archived-exact' && report.sourceObject) {
      throw new Error(`Historical report '${reportId}' has a source object but sourceStatus is '${report.sourceStatus}'.`);
    }
    if (report.requiredForReproduction && !report.availableByHistoricalCutoff) {
      throw new Error(`Historical report '${reportId}' cannot be required for the original review if it was unavailable by the bound cutoff.`);
    }
    const normalized = {
      ...report,
      lineageId,
      reportId,
      identifiers,
      ...(report.title?.trim() ? { title: clean(report.title) } : {}),
      ...(report.notes ? { notes: report.notes.map(clean).filter(Boolean) } : {}),
    };
    return { ...normalized, sourceReceiptExact, reportHash: scientificContentHash(normalized) };
  }).sort((a, b) => `${a.lineageId}:${a.reportId}`.localeCompare(`${b.lineageId}:${b.reportId}`));

  const represented = new Set(reports.map((report) => report.lineageId));
  const missingLineageIds = requiredLineageIds.filter((lineageId) => !represented.has(lineageId));
  const lineagesWithoutArchivedResultSource = requiredLineageIds.filter((lineageId) => !reports.some((report) =>
    report.lineageId === lineageId
    && report.resultBearing
    && report.requiredForReproduction
    && report.availableByHistoricalCutoff
    && report.sourceStatus === 'archived-exact'
    && report.sourceReceiptExact));
  const requiredReports = reports.filter((report) => report.requiredForReproduction);
  const archivedRequiredReportCount = requiredReports.filter((report) => report.sourceStatus === 'archived-exact' && report.sourceReceiptExact).length;
  const base = {
    schemaVersion: HISTORICAL_STUDY_SOURCE_MANIFEST_SCHEMA_VERSION,
    historicalCutoff: input.historicalCutoff,
    reports,
    requiredLineageIds,
    missingLineageIds,
    lineagesWithoutArchivedResultSource,
    requiredReportCount: requiredReports.length,
    archivedRequiredReportCount,
    exactSourceCoverage: missingLineageIds.length === 0
      && lineagesWithoutArchivedResultSource.length === 0
      && archivedRequiredReportCount === requiredReports.length,
  };
  return { ...base, manifestHash: scientificContentHash(base) };
}
