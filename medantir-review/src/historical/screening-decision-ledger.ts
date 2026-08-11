import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_SCREENING_LEDGER_SCHEMA_VERSION = 'medantir-historical-screening-ledger/1' as const;

export type HistoricalScreeningStage = 'title-abstract' | 'full-text';
export type HistoricalScreeningDecision = 'include' | 'exclude' | 'uncertain';
export type HistoricalScreeningProvenanceClass =
  | 'original-reviewer-ledger'
  | 'reconstructed-from-publication'
  | 'reconstructed-from-source'
  | 'aggregate-flow-only';

export interface HistoricalScreeningDecisionInput {
  stage: HistoricalScreeningStage;
  recordId: string;
  lineageId?: string;
  decision: HistoricalScreeningDecision;
  reason?: string;
  reviewerIds?: string[];
  conflictResolvedBy?: string;
  decidedAt?: string;
  provenanceClass: HistoricalScreeningProvenanceClass;
  sourceReference: string;
  sourceObjectId?: string;
  sourceSha256?: string;
  verbatimEvidence?: string;
}

export interface HistoricalScreeningDecisionRow extends HistoricalScreeningDecisionInput {
  decisionId: string;
  exactOriginalDecision: boolean;
}

export interface HistoricalScreeningAggregate {
  stage: HistoricalScreeningStage;
  included?: number;
  excluded?: number;
  uncertain?: number;
  sourceReference: string;
}

export interface HistoricalScreeningDecisionLedger {
  schemaVersion: typeof HISTORICAL_SCREENING_LEDGER_SCHEMA_VERSION;
  reviewId: string;
  decisions: HistoricalScreeningDecisionRow[];
  aggregates: HistoricalScreeningAggregate[];
  status: 'row-exact' | 'row-reconstructed' | 'aggregate-only' | 'unavailable';
  ledgerHash: string;
}

export interface HistoricalScreeningReplayDifference {
  stage: HistoricalScreeningStage;
  recordId: string;
  expected?: HistoricalScreeningDecision;
  actual?: HistoricalScreeningDecision;
  kind: 'decision-mismatch' | 'missing-replay-decision' | 'unexpected-replay-decision';
}

export interface HistoricalScreeningReplayComparison {
  exact: boolean;
  comparableRows: number;
  differences: HistoricalScreeningReplayDifference[];
  firstDifference?: HistoricalScreeningReplayDifference;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function decisionIdentity(input: HistoricalScreeningDecisionInput): unknown {
  return {
    stage: input.stage,
    recordId: clean(input.recordId),
    lineageId: input.lineageId ? clean(input.lineageId) : null,
    decision: input.decision,
    reason: input.reason ? clean(input.reason) : null,
    reviewerIds: [...(input.reviewerIds ?? [])].map(clean).sort(),
    conflictResolvedBy: input.conflictResolvedBy ? clean(input.conflictResolvedBy) : null,
    decidedAt: input.decidedAt ?? null,
    provenanceClass: input.provenanceClass,
    sourceObjectId: input.sourceObjectId ?? null,
    sourceSha256: input.sourceSha256 ?? null,
  };
}

function exactOriginal(input: HistoricalScreeningDecisionInput): boolean {
  return input.provenanceClass === 'original-reviewer-ledger'
    && Boolean(input.sourceObjectId)
    && Boolean(input.sourceSha256 && /^[a-f0-9]{64}$/i.test(input.sourceSha256))
    && Boolean(input.reviewerIds?.length)
    && Boolean(input.decidedAt);
}

export function createHistoricalScreeningDecisionLedger(input: {
  reviewId: string;
  decisions?: HistoricalScreeningDecisionInput[];
  aggregates?: HistoricalScreeningAggregate[];
}): HistoricalScreeningDecisionLedger {
  const reviewId = clean(input.reviewId);
  if (!reviewId) throw new Error('Historical screening ledger requires a review ID.');
  const seen = new Set<string>();
  const decisions = (input.decisions ?? []).map((decision) => {
    const recordId = clean(decision.recordId);
    if (!recordId) throw new Error('Historical screening decision requires a record ID.');
    if (!clean(decision.sourceReference)) throw new Error(`Historical screening decision '${recordId}' requires a source reference.`);
    const key = `${decision.stage}:${recordId}`;
    if (seen.has(key)) throw new Error(`Duplicate historical screening decision '${key}'.`);
    seen.add(key);
    const normalized: HistoricalScreeningDecisionInput = {
      ...decision,
      recordId,
      ...(decision.lineageId ? { lineageId: clean(decision.lineageId) } : {}),
      ...(decision.reason ? { reason: clean(decision.reason) } : {}),
      ...(decision.reviewerIds ? { reviewerIds: decision.reviewerIds.map(clean).sort() } : {}),
      sourceReference: clean(decision.sourceReference),
      ...(decision.verbatimEvidence ? { verbatimEvidence: clean(decision.verbatimEvidence) } : {}),
    };
    return {
      ...normalized,
      decisionId: `HSD-${scientificContentHash(decisionIdentity(normalized)).slice(0, 24)}`,
      exactOriginalDecision: exactOriginal(normalized),
    };
  }).sort((a, b) => `${a.stage}:${a.recordId}`.localeCompare(`${b.stage}:${b.recordId}`));

  const aggregates = [...(input.aggregates ?? [])].map((aggregate) => {
    for (const [label, value] of Object.entries({ included: aggregate.included, excluded: aggregate.excluded, uncertain: aggregate.uncertain })) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`Historical screening aggregate ${aggregate.stage}.${label} must be a non-negative integer.`);
    }
    return { ...aggregate, sourceReference: clean(aggregate.sourceReference) };
  }).sort((a, b) => a.stage.localeCompare(b.stage));

  let status: HistoricalScreeningDecisionLedger['status'];
  if (decisions.length > 0 && decisions.every((decision) => decision.exactOriginalDecision)) status = 'row-exact';
  else if (decisions.length > 0) status = 'row-reconstructed';
  else if (aggregates.length > 0) status = 'aggregate-only';
  else status = 'unavailable';

  const base = { schemaVersion: HISTORICAL_SCREENING_LEDGER_SCHEMA_VERSION, reviewId, decisions, aggregates, status };
  return { ...base, ledgerHash: scientificContentHash(base) };
}

export function compareHistoricalScreeningReplay(
  historical: HistoricalScreeningDecisionLedger,
  replay: Array<{ stage: HistoricalScreeningStage; recordId: string; decision: HistoricalScreeningDecision }>,
): HistoricalScreeningReplayComparison {
  if (historical.status === 'aggregate-only' || historical.status === 'unavailable') {
    return { exact: false, comparableRows: 0, differences: [] };
  }
  const expected = new Map(historical.decisions.map((decision) => [`${decision.stage}:${decision.recordId}`, decision]));
  const actual = new Map(replay.map((decision) => [`${decision.stage}:${clean(decision.recordId)}`, decision]));
  const differences: HistoricalScreeningReplayDifference[] = [];
  for (const [key, decision] of expected) {
    const observed = actual.get(key);
    if (!observed) {
      differences.push({ stage: decision.stage, recordId: decision.recordId, expected: decision.decision, kind: 'missing-replay-decision' });
    } else if (observed.decision !== decision.decision) {
      differences.push({ stage: decision.stage, recordId: decision.recordId, expected: decision.decision, actual: observed.decision, kind: 'decision-mismatch' });
    }
  }
  for (const [key, decision] of actual) {
    if (expected.has(key)) continue;
    differences.push({ stage: decision.stage, recordId: clean(decision.recordId), actual: decision.decision, kind: 'unexpected-replay-decision' });
  }
  return {
    exact: differences.length === 0 && expected.size === actual.size,
    comparableRows: expected.size,
    differences,
    ...(differences[0] ? { firstDifference: differences[0] } : {}),
  };
}
