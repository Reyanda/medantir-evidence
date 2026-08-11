import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_MANUAL_SEARCH_LEDGER_SCHEMA_VERSION = 'medantir-historical-manual-search-ledger/1' as const;

export type HistoricalManualSearchMethod =
  | 'backward-citation'
  | 'forward-citation'
  | 'journal-hand-search'
  | 'conference-search'
  | 'expert-contact'
  | 'author-contact'
  | 'other';

export type HistoricalManualSearchProvenanceClass =
  | 'original-ledger'
  | 'reconstructed-from-source'
  | 'publication-aggregate-only';

export interface HistoricalManualSearchCandidate {
  candidateId: string;
  title?: string;
  doi?: string;
  pmid?: string;
  registryId?: string;
  decision: 'included' | 'excluded' | 'duplicate' | 'unresolved';
  reason?: string;
}

export interface HistoricalManualSearchActionInput {
  method: HistoricalManualSearchMethod;
  seedId: string;
  seedType: 'included-report' | 'review' | 'journal' | 'conference' | 'expert' | 'other';
  platform?: string;
  executedDate?: string;
  provenanceClass: HistoricalManualSearchProvenanceClass;
  sourceReference: string;
  sourceObjectId?: string;
  sourceSha256?: string;
  candidates: HistoricalManualSearchCandidate[];
  notes?: string[];
}

export interface HistoricalManualSearchAction extends HistoricalManualSearchActionInput {
  actionId: string;
  exactSourceBound: boolean;
}

export interface HistoricalManualSearchLedger {
  schemaVersion: typeof HISTORICAL_MANUAL_SEARCH_LEDGER_SCHEMA_VERSION;
  reviewId: string;
  reportedAsPerformed: boolean;
  actions: HistoricalManualSearchAction[];
  status: 'original-ledger-exact' | 'reconstructed' | 'aggregate-only' | 'unavailable';
  missingReason?: string;
  ledgerHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function exactBound(action: HistoricalManualSearchActionInput): boolean {
  return action.provenanceClass === 'original-ledger'
    && Boolean(action.sourceObjectId)
    && Boolean(action.sourceSha256 && /^[a-f0-9]{64}$/i.test(action.sourceSha256))
    && Boolean(action.executedDate)
    && Boolean(action.platform);
}

function actionIdentity(action: HistoricalManualSearchActionInput): unknown {
  return {
    method: action.method,
    seedId: clean(action.seedId),
    seedType: action.seedType,
    platform: action.platform ? clean(action.platform) : null,
    executedDate: action.executedDate ?? null,
    provenanceClass: action.provenanceClass,
    sourceObjectId: action.sourceObjectId ?? null,
    sourceSha256: action.sourceSha256 ?? null,
    candidates: action.candidates.map((candidate) => ({
      candidateId: clean(candidate.candidateId),
      decision: candidate.decision,
      reason: candidate.reason ? clean(candidate.reason) : null,
      doi: candidate.doi?.trim().toLowerCase() ?? null,
      pmid: candidate.pmid?.trim() ?? null,
      registryId: candidate.registryId?.trim().toUpperCase() ?? null,
    })).sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
  };
}

export function createHistoricalManualSearchLedger(input: {
  reviewId: string;
  reportedAsPerformed: boolean;
  actions?: HistoricalManualSearchActionInput[];
  missingReason?: string;
}): HistoricalManualSearchLedger {
  if (!clean(input.reviewId)) throw new Error('Historical manual-search ledger requires a review ID.');
  const seenActionIds = new Set<string>();
  const actions = (input.actions ?? []).map((action) => {
    if (!clean(action.seedId)) throw new Error('Historical manual-search action requires a seed ID.');
    if (!clean(action.sourceReference)) throw new Error(`Historical manual-search action '${action.seedId}' requires a source reference.`);
    const candidateIds = new Set<string>();
    for (const candidate of action.candidates) {
      const id = clean(candidate.candidateId);
      if (!id) throw new Error(`Historical manual-search action '${action.seedId}' contains a candidate without an ID.`);
      if (candidateIds.has(id)) throw new Error(`Historical manual-search action '${action.seedId}' duplicates candidate '${id}'.`);
      candidateIds.add(id);
    }
    const actionId = `HMS-${scientificContentHash(actionIdentity(action)).slice(0, 24)}`;
    if (seenActionIds.has(actionId)) throw new Error(`Duplicate historical manual-search action '${actionId}'.`);
    seenActionIds.add(actionId);
    return {
      ...action,
      seedId: clean(action.seedId),
      sourceReference: clean(action.sourceReference),
      actionId,
      exactSourceBound: exactBound(action),
    };
  }).sort((a, b) => a.actionId.localeCompare(b.actionId));

  let status: HistoricalManualSearchLedger['status'];
  if (!input.reportedAsPerformed) {
    status = actions.length === 0 ? 'unavailable' : 'reconstructed';
  } else if (actions.length === 0) {
    status = 'unavailable';
  } else if (actions.every((action) => action.exactSourceBound)) {
    status = 'original-ledger-exact';
  } else if (actions.every((action) => action.provenanceClass === 'publication-aggregate-only')) {
    status = 'aggregate-only';
  } else {
    status = 'reconstructed';
  }
  if (input.reportedAsPerformed && actions.length === 0 && !input.missingReason?.trim()) {
    throw new Error('A reported historical manual search with no itemized actions requires an explicit missing reason.');
  }
  const base = {
    schemaVersion: HISTORICAL_MANUAL_SEARCH_LEDGER_SCHEMA_VERSION,
    reviewId: clean(input.reviewId),
    reportedAsPerformed: input.reportedAsPerformed,
    actions,
    status,
    ...(input.missingReason?.trim() ? { missingReason: clean(input.missingReason) } : {}),
  };
  return { ...base, ledgerHash: scientificContentHash(base) };
}
