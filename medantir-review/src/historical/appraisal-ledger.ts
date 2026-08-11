import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_APPRAISAL_LEDGER_SCHEMA_VERSION = 'medantir-historical-appraisal-ledger/1' as const;

export interface HistoricalAppraisalSourceReceipt {
  sourceType: 'published-table' | 'primary-report' | 'supplement';
  sourceReference: string;
  tableOrFigure?: string;
  rowLabel: string;
  verbatimEvidence: string;
  objectId?: string;
  sha256?: string;
  bindingFidelity?: 'citation-only' | 'verbatim-exact' | 'structured-row';
  rowFragmentSha256?: string;
}

export interface HistoricalModifiedJadadRow {
  lineageId: string;
  tool: 'modified-jadad-7';
  randomAllocation: number;
  concealment: number;
  blinding: number;
  withdrawalsDropouts: number;
  totalScore: number;
  interpretation: 'low' | 'moderate' | 'high';
  source: HistoricalAppraisalSourceReceipt;
}

export interface HistoricalNewcastleOttawaRow {
  lineageId: string;
  tool: 'newcastle-ottawa-cohort-9';
  selection: number;
  comparability: number;
  outcome: number;
  totalScore: number;
  interpretation: 'good' | 'fair' | 'poor';
  source: HistoricalAppraisalSourceReceipt;
}

export type HistoricalAppraisalRowInput = HistoricalModifiedJadadRow | HistoricalNewcastleOttawaRow;
export type HistoricalAppraisalRow = HistoricalAppraisalRowInput & {
  rowHash: string;
  exactSourceBound: boolean;
};

export interface HistoricalAppraisalLedger {
  schemaVersion: typeof HISTORICAL_APPRAISAL_LEDGER_SCHEMA_VERSION;
  rows: HistoricalAppraisalRow[];
  ledgerHash: string;
  exactSourceBoundRows: number;
  reconstructionOnlyRows: number;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function validObjectBinding(source: HistoricalAppraisalSourceReceipt): boolean {
  return Boolean(
    source.objectId
    && source.sha256
    && /^[a-f0-9]{64}$/i.test(source.sha256)
    && source.objectId === `HOBJ-${source.sha256.toLowerCase()}`,
  );
}

function exactSourceBound(source: HistoricalAppraisalSourceReceipt): boolean {
  if (!validObjectBinding(source) || !clean(source.verbatimEvidence)) return false;
  if (source.bindingFidelity === 'verbatim-exact') return true;
  return source.bindingFidelity === 'structured-row'
    && Boolean(source.rowFragmentSha256 && /^[a-f0-9]{64}$/i.test(source.rowFragmentSha256));
}

function validateIntegerRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}].`);
  }
}

function validateJadad(row: HistoricalModifiedJadadRow): void {
  validateIntegerRange(row.randomAllocation, 0, 2, `${row.lineageId} Jadad random allocation`);
  validateIntegerRange(row.concealment, 0, 2, `${row.lineageId} Jadad concealment`);
  validateIntegerRange(row.blinding, 0, 2, `${row.lineageId} Jadad blinding`);
  validateIntegerRange(row.withdrawalsDropouts, 0, 1, `${row.lineageId} Jadad withdrawals/dropouts`);
  const total = row.randomAllocation + row.concealment + row.blinding + row.withdrawalsDropouts;
  if (total !== row.totalScore) throw new Error(`${row.lineageId} modified Jadad component sum ${total} does not equal reported total ${row.totalScore}.`);
  const expected = row.totalScore > 4 ? 'high' : row.totalScore >= 3 ? 'moderate' : 'low';
  if (row.interpretation !== expected) throw new Error(`${row.lineageId} modified Jadad interpretation '${row.interpretation}' conflicts with score ${row.totalScore}.`);
}

function validateNos(row: HistoricalNewcastleOttawaRow): void {
  validateIntegerRange(row.selection, 0, 4, `${row.lineageId} NOS selection`);
  validateIntegerRange(row.comparability, 0, 2, `${row.lineageId} NOS comparability`);
  validateIntegerRange(row.outcome, 0, 3, `${row.lineageId} NOS outcome`);
  const total = row.selection + row.comparability + row.outcome;
  if (total !== row.totalScore) throw new Error(`${row.lineageId} NOS component sum ${total} does not equal reported total ${row.totalScore}.`);
  if (row.totalScore > 9) throw new Error(`${row.lineageId} NOS total cannot exceed 9.`);
  if (row.totalScore >= 7 && row.interpretation !== 'good') {
    throw new Error(`${row.lineageId} NOS score ${row.totalScore} must be interpreted as good under the bound historical contract.`);
  }
}

export function createHistoricalAppraisalLedger(
  inputs: HistoricalAppraisalRowInput[],
  allowedLineageIds: ReadonlySet<string>,
): HistoricalAppraisalLedger {
  const seen = new Set<string>();
  const rows: HistoricalAppraisalRow[] = inputs.map((input) => {
    const lineageId = clean(input.lineageId);
    if (!allowedLineageIds.has(lineageId)) throw new Error(`Historical appraisal references unknown canonical lineage '${lineageId}'.`);
    const identity = `${lineageId}:${input.tool}`;
    if (seen.has(identity)) throw new Error(`Duplicate historical appraisal row '${identity}'.`);
    seen.add(identity);
    if (!clean(input.source.rowLabel) || !clean(input.source.verbatimEvidence)) {
      throw new Error(`Historical appraisal '${identity}' requires a source row label and verbatim evidence.`);
    }
    if ((input.source.objectId || input.source.sha256) && !validObjectBinding(input.source)) {
      throw new Error(`Historical appraisal '${identity}' has an invalid content-addressed object binding; objectId must equal HOBJ-<sha256>.`);
    }
    if (input.source.bindingFidelity === 'structured-row'
      && (!input.source.rowFragmentSha256 || !/^[a-f0-9]{64}$/i.test(input.source.rowFragmentSha256))) {
      throw new Error(`Historical appraisal '${identity}' structured-row binding requires a raw row-fragment SHA-256.`);
    }
    if (input.tool === 'modified-jadad-7') validateJadad(input);
    else validateNos(input);
    const normalized = {
      ...input,
      lineageId,
      source: {
        ...input.source,
        sourceReference: clean(input.source.sourceReference),
        rowLabel: clean(input.source.rowLabel),
        verbatimEvidence: clean(input.source.verbatimEvidence),
        ...(input.source.tableOrFigure ? { tableOrFigure: clean(input.source.tableOrFigure) } : {}),
        ...(input.source.sha256 ? { sha256: input.source.sha256.toLowerCase() } : {}),
      },
    };
    return {
      ...normalized,
      rowHash: scientificContentHash(normalized),
      exactSourceBound: exactSourceBound(normalized.source),
    } as HistoricalAppraisalRow;
  }).sort((a, b) => a.lineageId.localeCompare(b.lineageId));
  return {
    schemaVersion: HISTORICAL_APPRAISAL_LEDGER_SCHEMA_VERSION,
    rows,
    ledgerHash: scientificContentHash(rows.map((row) => row.rowHash)),
    exactSourceBoundRows: rows.filter((row) => row.exactSourceBound).length,
    reconstructionOnlyRows: rows.filter((row) => !row.exactSourceBound).length,
  };
}
