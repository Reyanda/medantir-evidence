import { scientificContentHash } from '../core/canonical-hash.js';
import {
  isHistoricalOutcomeRowPoolable,
  type HistoricalOutcomeRow,
} from './outcome-row-ledger.js';

export const HISTORICAL_FOREST_CANDIDATE_SCHEMA_VERSION = 'medantir-historical-forest-candidate/1' as const;

export interface HistoricalForestCandidateSource {
  objectId: string;
  sha256: string;
  publicationId: string;
  figure: string;
  panel?: string;
  rowLabel: string;
  verbatimEvidence: string;
  extractionMethod: 'manual-transcription' | 'vision-assisted-transcription' | 'structured-export';
}

export interface HistoricalForestRowCandidateInput {
  lineageId: string;
  outcome: string;
  measure: 'RR' | 'MD';
  estimate: number;
  ciLower: number;
  ciUpper: number;
  timeHorizon?: string;
  source: HistoricalForestCandidateSource;
}

export interface HistoricalForestRowCandidate extends HistoricalForestRowCandidateInput {
  candidateId: string;
  candidateHash: string;
  authoritativeForSynthesis: false;
}

export interface HistoricalForestCandidateLedger {
  schemaVersion: typeof HISTORICAL_FOREST_CANDIDATE_SCHEMA_VERSION;
  candidates: HistoricalForestRowCandidate[];
  candidateCount: number;
  ledgerHash: string;
  authoritativeRows: 0;
}

export interface HistoricalForestPrimaryReconciliation {
  schemaVersion: 'medantir-historical-forest-primary-reconciliation/1';
  candidateId: string;
  candidateHash: string;
  primaryRowHash: string;
  lineageId: string;
  outcome: string;
  measure: 'RR' | 'MD';
  candidateEstimate: number;
  primaryEstimate: number;
  absoluteDifference: number;
  tolerance: number;
  estimateMatches: boolean;
  primarySourceAuthoritative: boolean;
  reconciled: boolean;
  receiptHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function exactObject(source: HistoricalForestCandidateSource): boolean {
  const sha = source.sha256.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(sha) && source.objectId === `HOBJ-${sha}`;
}

function validateCandidate(input: HistoricalForestRowCandidateInput): void {
  if (!clean(input.lineageId) || !clean(input.outcome)) throw new Error('Historical forest candidate requires lineageId and outcome.');
  if (![input.estimate, input.ciLower, input.ciUpper].every(Number.isFinite)) throw new Error(`Historical forest candidate '${input.lineageId}:${input.outcome}' requires finite estimate/CI values.`);
  if (input.ciLower > input.ciUpper || input.estimate < input.ciLower || input.estimate > input.ciUpper) {
    throw new Error(`Historical forest candidate '${input.lineageId}:${input.outcome}' has an incoherent estimate/CI.`);
  }
  if (input.measure === 'RR' && (input.estimate <= 0 || input.ciLower <= 0 || input.ciUpper <= 0)) {
    throw new Error(`Historical RR forest candidate '${input.lineageId}:${input.outcome}' must be positive.`);
  }
  if (!exactObject(input.source)) throw new Error(`Historical forest candidate '${input.lineageId}:${input.outcome}' requires an immutable figure-object receipt.`);
  if (!clean(input.source.publicationId) || !clean(input.source.figure) || !clean(input.source.rowLabel) || !clean(input.source.verbatimEvidence)) {
    throw new Error(`Historical forest candidate '${input.lineageId}:${input.outcome}' requires publication, figure, row label and verbatim evidence.`);
  }
}

export function createHistoricalForestCandidate(
  input: HistoricalForestRowCandidateInput,
  allowedLineageIds: ReadonlySet<string>,
): HistoricalForestRowCandidate {
  validateCandidate(input);
  const lineageId = clean(input.lineageId);
  if (!allowedLineageIds.has(lineageId)) throw new Error(`Historical forest candidate references unknown lineage '${lineageId}'.`);
  const normalized = {
    ...input,
    lineageId,
    outcome: clean(input.outcome),
    ...(input.timeHorizon?.trim() ? { timeHorizon: clean(input.timeHorizon) } : {}),
    source: {
      ...input.source,
      sha256: input.source.sha256.toLowerCase(),
      publicationId: clean(input.source.publicationId),
      figure: clean(input.source.figure),
      ...(input.source.panel?.trim() ? { panel: clean(input.source.panel) } : {}),
      rowLabel: clean(input.source.rowLabel),
      verbatimEvidence: clean(input.source.verbatimEvidence),
    },
  };
  const candidateHash = scientificContentHash(normalized);
  return {
    ...normalized,
    candidateId: `HFC-${candidateHash.slice(0, 24)}`,
    candidateHash,
    authoritativeForSynthesis: false,
  };
}

export function createHistoricalForestCandidateLedger(input: {
  candidates: HistoricalForestRowCandidateInput[];
  allowedLineageIds: ReadonlySet<string>;
}): HistoricalForestCandidateLedger {
  const candidates = input.candidates.map((candidate) => createHistoricalForestCandidate(candidate, input.allowedLineageIds));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const identity = scientificContentHash({
      lineageId: candidate.lineageId,
      outcome: candidate.outcome.toLowerCase(),
      measure: candidate.measure,
      timeHorizon: candidate.timeHorizon?.toLowerCase() ?? null,
      figure: candidate.source.figure,
      panel: candidate.source.panel ?? null,
    });
    if (seen.has(identity)) throw new Error(`Duplicate historical forest candidate for ${candidate.lineageId}:${candidate.outcome}.`);
    seen.add(identity);
  }
  const sorted = [...candidates].sort((a, b) => `${a.outcome}:${a.lineageId}`.localeCompare(`${b.outcome}:${b.lineageId}`));
  return {
    schemaVersion: HISTORICAL_FOREST_CANDIDATE_SCHEMA_VERSION,
    candidates: sorted,
    candidateCount: sorted.length,
    ledgerHash: scientificContentHash(sorted.map((candidate) => candidate.candidateHash)),
    authoritativeRows: 0,
  };
}

function primaryEstimate(row: HistoricalOutcomeRow): number {
  if (row.dataShape === 'binary-2x2') {
    if ([row.experimentalEvents, row.experimentalTotal, row.controlEvents, row.controlTotal].some((value) => value === null)) {
      throw new Error(`Primary row '${row.lineageId}:${row.outcome}' is missing binary arm data.`);
    }
    const expRisk = row.experimentalEvents! / row.experimentalTotal!;
    const controlRisk = row.controlEvents! / row.controlTotal!;
    if (controlRisk === 0) throw new Error(`Primary row '${row.lineageId}:${row.outcome}' has zero control risk; direct RR reconciliation is undefined.`);
    return expRisk / controlRisk;
  }
  if (row.experimentalMean === null || row.controlMean === null) throw new Error(`Primary row '${row.lineageId}:${row.outcome}' is missing continuous means.`);
  return row.experimentalMean - row.controlMean;
}

export function reconcileHistoricalForestCandidate(input: {
  candidate: HistoricalForestRowCandidate;
  primaryRow: HistoricalOutcomeRow;
  absoluteTolerance?: number;
}): HistoricalForestPrimaryReconciliation {
  const tolerance = input.absoluteTolerance ?? 0.02;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Historical forest reconciliation tolerance must be non-negative.');
  if (input.candidate.lineageId !== input.primaryRow.lineageId) throw new Error('Historical forest candidate and primary row lineage IDs differ.');
  if (input.candidate.outcome.trim().toLowerCase() !== input.primaryRow.outcome.trim().toLowerCase()) throw new Error('Historical forest candidate and primary row outcomes differ.');
  if (input.candidate.measure !== input.primaryRow.measure) throw new Error('Historical forest candidate and primary row effect measures differ.');
  if (input.candidate.timeHorizon && input.primaryRow.timeHorizon
    && input.candidate.timeHorizon.trim().toLowerCase() !== input.primaryRow.timeHorizon.trim().toLowerCase()) {
    throw new Error('Historical forest candidate and primary row time horizons differ.');
  }
  const primarySourceAuthoritative = isHistoricalOutcomeRowPoolable(input.primaryRow);
  const observed = primaryEstimate(input.primaryRow);
  const absoluteDifference = Math.abs(observed - input.candidate.estimate);
  const estimateMatches = absoluteDifference <= tolerance;
  const base: Omit<HistoricalForestPrimaryReconciliation, 'receiptHash'> = {
    schemaVersion: 'medantir-historical-forest-primary-reconciliation/1',
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    primaryRowHash: input.primaryRow.rowHash,
    lineageId: input.primaryRow.lineageId,
    outcome: input.primaryRow.outcome,
    measure: input.primaryRow.measure,
    candidateEstimate: input.candidate.estimate,
    primaryEstimate: observed,
    absoluteDifference,
    tolerance,
    estimateMatches,
    primarySourceAuthoritative,
    reconciled: estimateMatches && primarySourceAuthoritative,
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}
