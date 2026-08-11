import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalPublishedResultTarget } from './published-result-comparator.js';
import type { HistoricalSynthesisReplayReceipt } from './synthesis-replay.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';

export const HISTORICAL_REPORT_CORE_SCHEMA_VERSION = 'medantir-historical-report-core/1' as const;

export interface HistoricalPublishedReportCore {
  schemaVersion: typeof HISTORICAL_REPORT_CORE_SCHEMA_VERSION;
  reviewId: string;
  includedLineageIds: string[];
  flow: Record<string, number>;
  resultTargets: HistoricalPublishedResultTarget[];
  appraisalLedgerHash?: string;
  publicationObjectSha256?: string;
}

export interface HistoricalReproducedReportCore {
  reviewId: string;
  includedLineageIds: string[];
  flow: Record<string, number>;
  synthesisReceipts: HistoricalSynthesisReplayReceipt[];
  appraisalLedgerHash?: string;
}

export type HistoricalReportCoreDifference =
  | { kind: 'review-id'; expected: string; actual: string }
  | { kind: 'missing-lineage'; lineageId: string }
  | { kind: 'unexpected-lineage'; lineageId: string }
  | { kind: 'flow'; field: string; expected: number; actual?: number }
  | { kind: 'missing-result'; outcome: string }
  | { kind: 'unexpected-result'; outcome: string }
  | { kind: 'result-mismatch'; outcome: string; field?: string }
  | { kind: 'appraisal-ledger'; expected?: string; actual?: string };

export interface HistoricalReportCoreReconciliation {
  schemaVersion: 'medantir-historical-report-core-reconciliation/1';
  coreExact: boolean;
  differences: HistoricalReportCoreDifference[];
  firstDifference?: HistoricalReportCoreDifference;
  targetHash: string;
  reproducedHash: string;
  reconciliationHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function outcomeKey(value: string): string {
  return clean(value).toLowerCase();
}

function sortedIds(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

export function createHistoricalPublishedReportCore(input: Omit<HistoricalPublishedReportCore, 'schemaVersion'>): HistoricalPublishedReportCore {
  const flow: Record<string, number> = {};
  for (const [field, value] of Object.entries(input.flow)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Historical report flow '${field}' must be a non-negative integer.`);
    flow[clean(field)] = value;
  }
  const outcomes = new Set<string>();
  const resultTargets = input.resultTargets.map((target) => {
    const key = outcomeKey(target.outcome);
    if (!key) throw new Error('Historical report result target requires an outcome.');
    if (outcomes.has(key)) throw new Error(`Historical report duplicates published result outcome '${target.outcome}'.`);
    outcomes.add(key);
    return { ...target, outcome: clean(target.outcome) };
  }).sort((a, b) => outcomeKey(a.outcome).localeCompare(outcomeKey(b.outcome)));
  return {
    schemaVersion: HISTORICAL_REPORT_CORE_SCHEMA_VERSION,
    reviewId: clean(input.reviewId),
    includedLineageIds: sortedIds(input.includedLineageIds),
    flow,
    resultTargets,
    ...(input.appraisalLedgerHash ? { appraisalLedgerHash: input.appraisalLedgerHash.toLowerCase() } : {}),
    ...(input.publicationObjectSha256 ? { publicationObjectSha256: input.publicationObjectSha256.toLowerCase() } : {}),
  };
}

export function reconcileHistoricalReportCore(input: {
  target: HistoricalPublishedReportCore;
  reproduced: HistoricalReproducedReportCore;
}): HistoricalReportCoreReconciliation {
  const differences: HistoricalReportCoreDifference[] = [];
  if (clean(input.target.reviewId) !== clean(input.reproduced.reviewId)) {
    differences.push({ kind: 'review-id', expected: input.target.reviewId, actual: input.reproduced.reviewId });
  }
  const targetIds = new Set(sortedIds(input.target.includedLineageIds));
  const actualIds = new Set(sortedIds(input.reproduced.includedLineageIds));
  for (const lineageId of [...targetIds].sort()) if (!actualIds.has(lineageId)) differences.push({ kind: 'missing-lineage', lineageId });
  for (const lineageId of [...actualIds].sort()) if (!targetIds.has(lineageId)) differences.push({ kind: 'unexpected-lineage', lineageId });

  for (const [field, expected] of Object.entries(input.target.flow).sort(([a], [b]) => a.localeCompare(b))) {
    const actual = input.reproduced.flow[field];
    if (actual !== expected) differences.push({ kind: 'flow', field, expected, ...(actual !== undefined ? { actual } : {}) });
  }

  const targetOutcomes = new Map(input.target.resultTargets.map((target) => [outcomeKey(target.outcome), target]));
  const actualOutcomes = new Map(input.reproduced.synthesisReceipts.map((receipt) => [outcomeKey(receipt.selector.outcome), receipt]));
  for (const [key, target] of targetOutcomes) {
    const receipt = actualOutcomes.get(key);
    if (!receipt) {
      differences.push({ kind: 'missing-result', outcome: target.outcome });
      continue;
    }
    if (!receipt.publishedComparison.exactWithinTolerance) {
      differences.push({
        kind: 'result-mismatch',
        outcome: target.outcome,
        ...(receipt.publishedComparison.firstDifference?.field ? { field: receipt.publishedComparison.firstDifference.field } : {}),
      });
    }
  }
  for (const [key, receipt] of actualOutcomes) {
    if (!targetOutcomes.has(key)) differences.push({ kind: 'unexpected-result', outcome: receipt.selector.outcome });
  }

  if ((input.target.appraisalLedgerHash ?? null) !== (input.reproduced.appraisalLedgerHash ?? null)) {
    differences.push({
      kind: 'appraisal-ledger',
      ...(input.target.appraisalLedgerHash ? { expected: input.target.appraisalLedgerHash } : {}),
      ...(input.reproduced.appraisalLedgerHash ? { actual: input.reproduced.appraisalLedgerHash } : {}),
    });
  }

  const targetHash = scientificContentHash(input.target);
  const reproducedHash = scientificContentHash({
    reviewId: clean(input.reproduced.reviewId),
    includedLineageIds: sortedIds(input.reproduced.includedLineageIds),
    flow: input.reproduced.flow,
    synthesisReplayHashes: input.reproduced.synthesisReceipts.map((receipt) => receipt.replayHash).sort(),
    appraisalLedgerHash: input.reproduced.appraisalLedgerHash ?? null,
  });
  const withoutHash = {
    schemaVersion: 'medantir-historical-report-core-reconciliation/1' as const,
    coreExact: differences.length === 0,
    differences,
    ...(differences[0] ? { firstDifference: differences[0] } : {}),
    targetHash,
    reproducedHash,
  };
  return { ...withoutHash, reconciliationHash: scientificContentHash(withoutHash) };
}

export function buildHistoricalReportPlane(input: {
  reconciliation: HistoricalReportCoreReconciliation;
  originalPublicationVersionVerified?: boolean;
}): HistoricalReviewFrozenPlane {
  return {
    plane: 'report',
    hash: input.reconciliation.reconciliationHash,
    artifactKeys: ['historicalReportCoreReconciliation'],
    replayFidelity: input.reconciliation.coreExact ? 'exact' : 'unverified',
    historicalProvenance: input.reconciliation.coreExact
      ? input.originalPublicationVersionVerified ? 'original-exact' : 'source-reconstructed'
      : 'unavailable',
    sourceReferences: [`Historical report-core reconciliation ${input.reconciliation.reconciliationHash}`],
  };
}
