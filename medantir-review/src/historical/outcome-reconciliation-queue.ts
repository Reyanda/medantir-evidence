import { scientificContentHash } from '../core/canonical-hash.js';
import {
  type HistoricalForestCandidateLedger,
  type HistoricalForestPrimaryReconciliation,
  type HistoricalForestRowCandidate,
} from './forest-row-candidate.js';
import {
  isHistoricalOutcomeRowPoolable,
  type HistoricalOutcomeRow,
  type HistoricalOutcomeRowLedger,
} from './outcome-row-ledger.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';

export const HISTORICAL_OUTCOME_RECONCILIATION_QUEUE_SCHEMA_VERSION = 'medantir-historical-outcome-reconciliation-queue/1' as const;

export type HistoricalOutcomeReconciliationStatus =
  | 'blocked-source-unarchived'
  | 'blocked-primary-row-missing'
  | 'blocked-primary-row-unpoolable'
  | 'ready-for-reconciliation'
  | 'reconciled';

export interface HistoricalOutcomeReconciliationWorkItem {
  workItemId: string;
  candidateId: string;
  candidateHash: string;
  lineageId: string;
  outcome: string;
  measure: 'RR' | 'MD';
  timeHorizon: string | null;
  sourceReportIds: string[];
  primaryRowHashes: string[];
  reconciliationReceiptHash?: string;
  status: HistoricalOutcomeReconciliationStatus;
  blocksExtraction: boolean;
  blocksSynthesis: boolean;
  reasons: string[];
  workItemHash: string;
}

export interface HistoricalOutcomeCandidateCoverage {
  outcome: string;
  expectedStudyRows: number;
  observedCandidateRows: number;
  missingCandidateRows: number;
  excessCandidateRows: number;
  exactCountMatch: boolean;
}

export interface HistoricalOutcomeReconciliationQueue {
  schemaVersion: typeof HISTORICAL_OUTCOME_RECONCILIATION_QUEUE_SCHEMA_VERSION;
  workItems: HistoricalOutcomeReconciliationWorkItem[];
  candidateCoverage: HistoricalOutcomeCandidateCoverage[];
  expectedCandidateRows: number;
  observedCandidateRows: number;
  missingCandidateRows: number;
  excessCandidateRows: number;
  candidateCoverageComplete: boolean;
  unresolvedWorkItems: number;
  readyWorkItems: number;
  reconciledWorkItems: number;
  extractionBlocked: boolean;
  synthesisBlocked: boolean;
  queueHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedOutcome(value: string): string {
  return clean(value).toLowerCase();
}

function candidateRowsForPrimary(candidate: HistoricalForestRowCandidate, rows: HistoricalOutcomeRow[]): HistoricalOutcomeRow[] {
  return rows.filter((row) => {
    if (row.lineageId !== candidate.lineageId) return false;
    if (normalizedOutcome(row.outcome) !== normalizedOutcome(candidate.outcome)) return false;
    if (row.measure !== candidate.measure) return false;
    if (candidate.timeHorizon && row.timeHorizon
      && normalizedOutcome(candidate.timeHorizon) !== normalizedOutcome(row.timeHorizon)) return false;
    return true;
  });
}

function sourceReportsForCandidate(candidate: HistoricalForestRowCandidate, manifest: HistoricalStudySourceManifest) {
  return manifest.reports.filter((report) =>
    report.lineageId === candidate.lineageId
    && report.requiredForReproduction
    && report.resultBearing
    && report.availableByHistoricalCutoff);
}

function matchingReconciliation(
  candidate: HistoricalForestRowCandidate,
  primaryRows: HistoricalOutcomeRow[],
  receipts: HistoricalForestPrimaryReconciliation[],
): HistoricalForestPrimaryReconciliation | undefined {
  const hashes = new Set(primaryRows.map((row) => row.rowHash));
  return receipts.find((receipt) =>
    receipt.candidateId === candidate.candidateId
    && receipt.candidateHash === candidate.candidateHash
    && hashes.has(receipt.primaryRowHash));
}

function workItem(input: {
  candidate: HistoricalForestRowCandidate;
  manifest: HistoricalStudySourceManifest;
  primaryRows: HistoricalOutcomeRow[];
  reconciliations: HistoricalForestPrimaryReconciliation[];
}): HistoricalOutcomeReconciliationWorkItem {
  const reports = sourceReportsForCandidate(input.candidate, input.manifest);
  const exactSourceReports = reports.filter((report) => report.sourceStatus === 'archived-exact' && report.sourceReceiptExact);
  const primaryRows = candidateRowsForPrimary(input.candidate, input.primaryRows);
  const poolableRows = primaryRows.filter(isHistoricalOutcomeRowPoolable);
  const receipt = matchingReconciliation(input.candidate, poolableRows, input.reconciliations);
  let status: HistoricalOutcomeReconciliationStatus;
  const reasons: string[] = [];

  if (exactSourceReports.length === 0) {
    status = 'blocked-source-unarchived';
    reasons.push('No required result-bearing report for this lineage is archived with an exact content-addressed source receipt.');
  } else if (primaryRows.length === 0) {
    status = 'blocked-primary-row-missing';
    reasons.push('No primary/registry historical outcome row matches the candidate lineage, outcome and measure.');
  } else if (poolableRows.length === 0) {
    status = 'blocked-primary-row-unpoolable';
    reasons.push('A matching primary row exists but lacks the provenance/estimand/numeric completeness required for authoritative synthesis.');
  } else if (!receipt || !receipt.reconciled) {
    status = 'ready-for-reconciliation';
    reasons.push('An authoritative primary row is available; the published forest witness still requires a matching reconciliation receipt.');
  } else {
    status = 'reconciled';
  }

  const base = {
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    lineageId: input.candidate.lineageId,
    outcome: input.candidate.outcome,
    measure: input.candidate.measure,
    timeHorizon: input.candidate.timeHorizon ?? null,
    sourceReportIds: reports.map((report) => report.reportId).sort(),
    primaryRowHashes: primaryRows.map((row) => row.rowHash).sort(),
    ...(receipt ? { reconciliationReceiptHash: receipt.receiptHash } : {}),
    status,
    blocksExtraction: status !== 'reconciled',
    blocksSynthesis: status !== 'reconciled',
    reasons,
  };
  const workItemHash = scientificContentHash(base);
  return { ...base, workItemId: `HORQ-${workItemHash.slice(0, 24)}`, workItemHash };
}

export function createHistoricalOutcomeReconciliationQueue(input: {
  candidateLedger: HistoricalForestCandidateLedger;
  primaryLedger: HistoricalOutcomeRowLedger;
  sourceManifest: HistoricalStudySourceManifest;
  reconciliations?: HistoricalForestPrimaryReconciliation[];
  expectedStudyRowsByOutcome: Record<string, number>;
}): HistoricalOutcomeReconciliationQueue {
  const expected = Object.entries(input.expectedStudyRowsByOutcome)
    .map(([outcome, count]) => ({ outcome: clean(outcome), expectedStudyRows: count }))
    .sort((a, b) => a.outcome.localeCompare(b.outcome));
  if (expected.length === 0) throw new Error('Historical outcome reconciliation queue requires published expected study-row counts by outcome.');
  for (const item of expected) {
    if (!Number.isInteger(item.expectedStudyRows) || item.expectedStudyRows < 0) {
      throw new Error(`Expected study-row count for '${item.outcome}' must be a non-negative integer.`);
    }
  }
  const expectedNames = new Set(expected.map((item) => normalizedOutcome(item.outcome)));
  const unexpected = input.candidateLedger.candidates.filter((candidate) => !expectedNames.has(normalizedOutcome(candidate.outcome)));
  if (unexpected.length > 0) throw new Error(`Historical candidate ledger contains outcome '${unexpected[0]!.outcome}' absent from the published target set.`);

  const candidateCoverage = expected.map((item) => {
    const observedCandidateRows = input.candidateLedger.candidates.filter((candidate) =>
      normalizedOutcome(candidate.outcome) === normalizedOutcome(item.outcome)).length;
    return {
      outcome: item.outcome,
      expectedStudyRows: item.expectedStudyRows,
      observedCandidateRows,
      missingCandidateRows: Math.max(0, item.expectedStudyRows - observedCandidateRows),
      excessCandidateRows: Math.max(0, observedCandidateRows - item.expectedStudyRows),
      exactCountMatch: observedCandidateRows === item.expectedStudyRows,
    };
  });
  const workItems = input.candidateLedger.candidates
    .map((candidate) => workItem({
      candidate,
      manifest: input.sourceManifest,
      primaryRows: input.primaryLedger.rows,
      reconciliations: input.reconciliations ?? [],
    }))
    .sort((a, b) => `${a.outcome}:${a.lineageId}:${a.candidateId}`.localeCompare(`${b.outcome}:${b.lineageId}:${b.candidateId}`));
  const candidateCoverageComplete = candidateCoverage.every((item) => item.exactCountMatch);
  const expectedCandidateRows = candidateCoverage.reduce((sum, item) => sum + item.expectedStudyRows, 0);
  const observedCandidateRows = candidateCoverage.reduce((sum, item) => sum + item.observedCandidateRows, 0);
  const missingCandidateRows = candidateCoverage.reduce((sum, item) => sum + item.missingCandidateRows, 0);
  const excessCandidateRows = candidateCoverage.reduce((sum, item) => sum + item.excessCandidateRows, 0);
  const base = {
    schemaVersion: HISTORICAL_OUTCOME_RECONCILIATION_QUEUE_SCHEMA_VERSION,
    workItems,
    candidateCoverage,
    expectedCandidateRows,
    observedCandidateRows,
    missingCandidateRows,
    excessCandidateRows,
    candidateCoverageComplete,
    unresolvedWorkItems: workItems.filter((item) => item.status.startsWith('blocked-')).length,
    readyWorkItems: workItems.filter((item) => item.status === 'ready-for-reconciliation').length,
    reconciledWorkItems: workItems.filter((item) => item.status === 'reconciled').length,
    extractionBlocked: !candidateCoverageComplete || workItems.some((item) => item.blocksExtraction),
    synthesisBlocked: !candidateCoverageComplete || workItems.some((item) => item.blocksSynthesis),
  };
  return { ...base, queueHash: scientificContentHash(base) };
}
