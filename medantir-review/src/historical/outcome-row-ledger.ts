import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_OUTCOME_ROW_SCHEMA_VERSION = 'medantir-historical-outcome-row/1' as const;

export type HistoricalOutcomeRowReconstructionStatus =
  | 'published-forest-row'
  | 'primary-source-reconstructed'
  | 'registry-reconstructed'
  | 'secondary-corroboration-only'
  | 'unresolved';

export type HistoricalOutcomeContributionStatus =
  | 'contributing'
  | 'non-contributing'
  | 'unresolved';

export type HistoricalAnalysisPopulation =
  | 'ITT'
  | 'mITT'
  | 'per-protocol'
  | 'as-treated'
  | 'safety-population'
  | 'unspecified';

export interface HistoricalOutcomeRowSourceReceipt {
  sourceType: 'published-forest-plot' | 'primary-report' | 'registry' | 'supplement' | 'secondary-review';
  objectId?: string;
  sha256?: string;
  uri?: string;
  page?: number;
  tableOrFigure?: string;
  rowLabel?: string;
  verbatimEvidence: string;
  sourceDate?: string;
}

interface HistoricalOutcomeRowBase {
  schemaVersion: typeof HISTORICAL_OUTCOME_ROW_SCHEMA_VERSION;
  lineageId: string;
  outcome: string;
  contributionStatus: HistoricalOutcomeContributionStatus;
  reconstructionStatus: HistoricalOutcomeRowReconstructionStatus;
  timeHorizon: string | null;
  analysisPopulation: HistoricalAnalysisPopulation;
  subgroupLabel: string | null;
  source: HistoricalOutcomeRowSourceReceipt;
  notes?: string[];
  rowHash: string;
}

export interface HistoricalBinaryOutcomeRow extends HistoricalOutcomeRowBase {
  dataShape: 'binary-2x2';
  measure: 'RR';
  experimentalEvents: number | null;
  experimentalTotal: number | null;
  controlEvents: number | null;
  controlTotal: number | null;
}

export interface HistoricalContinuousOutcomeRow extends HistoricalOutcomeRowBase {
  dataShape: 'continuous-arm-summary';
  measure: 'MD';
  experimentalMean: number | null;
  experimentalSd: number | null;
  experimentalTotal: number | null;
  controlMean: number | null;
  controlSd: number | null;
  controlTotal: number | null;
}

export type HistoricalOutcomeRow = HistoricalBinaryOutcomeRow | HistoricalContinuousOutcomeRow;
export type HistoricalOutcomeRowInput = Omit<HistoricalBinaryOutcomeRow, 'schemaVersion' | 'rowHash'>
  | Omit<HistoricalContinuousOutcomeRow, 'schemaVersion' | 'rowHash'>;

export interface HistoricalOutcomeRowLedger {
  schemaVersion: 'medantir-historical-outcome-row-ledger/1';
  rows: HistoricalOutcomeRow[];
  ledgerHash: string;
  poolableRows: number;
  unresolvedRows: number;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function rowIdentity(row: HistoricalOutcomeRowInput): unknown {
  return {
    lineageId: clean(row.lineageId),
    outcome: clean(row.outcome).toLowerCase(),
    measure: row.measure,
    timeHorizon: row.timeHorizon ? clean(row.timeHorizon).toLowerCase() : null,
    analysisPopulation: row.analysisPopulation,
    subgroupLabel: row.subgroupLabel ? clean(row.subgroupLabel).toLowerCase() : null,
  };
}

function rowContent(input: HistoricalOutcomeRowInput): unknown {
  return {
    schemaVersion: HISTORICAL_OUTCOME_ROW_SCHEMA_VERSION,
    ...input,
    lineageId: clean(input.lineageId),
    outcome: clean(input.outcome),
    timeHorizon: input.timeHorizon ? clean(input.timeHorizon) : null,
    subgroupLabel: input.subgroupLabel ? clean(input.subgroupLabel) : null,
    source: {
      ...input.source,
      verbatimEvidence: clean(input.source.verbatimEvidence),
      ...(input.source.rowLabel ? { rowLabel: clean(input.source.rowLabel) } : {}),
      ...(input.source.tableOrFigure ? { tableOrFigure: clean(input.source.tableOrFigure) } : {}),
    },
  };
}

function integerOrNull(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer or null.`);
}

function finiteOrNull(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite or null.`);
}

function hasExactSourceBinding(source: HistoricalOutcomeRowSourceReceipt): boolean {
  const normalizedSha = source.sha256?.trim().toLowerCase();
  const objectBound = Boolean(
    source.objectId
    && normalizedSha
    && /^[a-f0-9]{64}$/i.test(normalizedSha)
    && source.objectId === `HOBJ-${normalizedSha}`,
  );
  const sourceLocated = Boolean(source.page !== undefined || source.tableOrFigure || source.rowLabel);
  return objectBound && sourceLocated && clean(source.verbatimEvidence).length > 0;
}

function validateBinary(row: HistoricalOutcomeRowInput & { dataShape: 'binary-2x2' }): void {
  integerOrNull(row.experimentalEvents, `${row.lineageId} experimental events`);
  integerOrNull(row.experimentalTotal, `${row.lineageId} experimental total`);
  integerOrNull(row.controlEvents, `${row.lineageId} control events`);
  integerOrNull(row.controlTotal, `${row.lineageId} control total`);
  if (row.experimentalEvents !== null && row.experimentalTotal !== null && row.experimentalEvents > row.experimentalTotal) {
    throw new Error(`${row.lineageId} experimental events exceed total.`);
  }
  if (row.controlEvents !== null && row.controlTotal !== null && row.controlEvents > row.controlTotal) {
    throw new Error(`${row.lineageId} control events exceed total.`);
  }
}

function validateContinuous(row: HistoricalOutcomeRowInput & { dataShape: 'continuous-arm-summary' }): void {
  finiteOrNull(row.experimentalMean, `${row.lineageId} experimental mean`);
  finiteOrNull(row.experimentalSd, `${row.lineageId} experimental SD`);
  integerOrNull(row.experimentalTotal, `${row.lineageId} experimental total`);
  finiteOrNull(row.controlMean, `${row.lineageId} control mean`);
  finiteOrNull(row.controlSd, `${row.lineageId} control SD`);
  integerOrNull(row.controlTotal, `${row.lineageId} control total`);
  if (row.experimentalSd !== null && row.experimentalSd < 0) throw new Error(`${row.lineageId} experimental SD cannot be negative.`);
  if (row.controlSd !== null && row.controlSd < 0) throw new Error(`${row.lineageId} control SD cannot be negative.`);
}

function hasCompleteNumericData(row: HistoricalOutcomeRowInput): boolean {
  if (row.dataShape === 'binary-2x2') {
    return [row.experimentalEvents, row.experimentalTotal, row.controlEvents, row.controlTotal].every((value) => value !== null);
  }
  return [
    row.experimentalMean,
    row.experimentalSd,
    row.experimentalTotal,
    row.controlMean,
    row.controlSd,
    row.controlTotal,
  ].every((value) => value !== null);
}

export function isHistoricalOutcomeRowPoolable(row: HistoricalOutcomeRowInput | HistoricalOutcomeRow): boolean {
  return row.contributionStatus === 'contributing'
    && row.reconstructionStatus !== 'unresolved'
    && row.reconstructionStatus !== 'secondary-corroboration-only'
    && row.reconstructionStatus !== 'published-forest-row'
    && row.source.sourceType !== 'published-forest-plot'
    && Boolean(row.timeHorizon)
    && row.analysisPopulation !== 'unspecified'
    && hasExactSourceBinding(row.source)
    && hasCompleteNumericData(row as HistoricalOutcomeRowInput);
}

export function createHistoricalOutcomeRow(
  input: HistoricalOutcomeRowInput,
  allowedLineageIds: ReadonlySet<string>,
): HistoricalOutcomeRow {
  const lineageId = clean(input.lineageId);
  if (!allowedLineageIds.has(lineageId)) throw new Error(`Historical outcome row references unknown canonical lineage '${lineageId}'.`);
  if (!clean(input.outcome)) throw new Error(`Historical outcome row '${lineageId}' requires an outcome.`);
  if (!clean(input.source.verbatimEvidence)) throw new Error(`Historical outcome row '${lineageId}' requires verbatim source evidence.`);
  if (input.dataShape === 'binary-2x2') validateBinary(input);
  else validateContinuous(input);

  if (input.contributionStatus === 'contributing' && !hasCompleteNumericData(input)) {
    throw new Error(`Historical contributing row '${lineageId}:${input.outcome}' is missing numeric arm data.`);
  }
  if (input.contributionStatus === 'contributing' && input.reconstructionStatus === 'unresolved') {
    throw new Error(`Historical contributing row '${lineageId}:${input.outcome}' cannot have unresolved reconstruction status.`);
  }
  if (input.contributionStatus === 'contributing' && input.reconstructionStatus === 'secondary-corroboration-only') {
    throw new Error(`Historical contributing row '${lineageId}:${input.outcome}' cannot be authorized by secondary corroboration alone.`);
  }
  if (input.contributionStatus === 'contributing' && (
    input.reconstructionStatus === 'published-forest-row'
    || input.source.sourceType === 'published-forest-plot'
  )) {
    throw new Error(`Historical contributing row '${lineageId}:${input.outcome}' cannot be authorized by the published meta-analysis forest plot; reconcile it to a primary report, registry result or supplement first.`);
  }

  const content = rowContent(input) as Omit<HistoricalOutcomeRow, 'rowHash'>;
  return {
    ...content,
    rowHash: scientificContentHash(content),
  } as HistoricalOutcomeRow;
}

export function createHistoricalOutcomeRowLedger(
  inputs: HistoricalOutcomeRowInput[],
  allowedLineageIds: ReadonlySet<string>,
): HistoricalOutcomeRowLedger {
  const rows = inputs.map((input) => createHistoricalOutcomeRow(input, allowedLineageIds));
  const identities = new Map<string, HistoricalOutcomeRow>();
  for (const row of rows) {
    const identity = scientificContentHash(rowIdentity(row));
    const previous = identities.get(identity);
    if (previous) {
      throw new Error(`Duplicate historical estimand row for ${row.lineageId}:${row.outcome}; distinguish time horizon, analysis population or subgroup explicitly.`);
    }
    identities.set(identity, row);
  }
  const sorted = [...rows].sort((a, b) => {
    const left = `${a.outcome}\u0000${a.lineageId}\u0000${a.timeHorizon ?? ''}\u0000${a.analysisPopulation}\u0000${a.subgroupLabel ?? ''}`;
    const right = `${b.outcome}\u0000${b.lineageId}\u0000${b.timeHorizon ?? ''}\u0000${b.analysisPopulation}\u0000${b.subgroupLabel ?? ''}`;
    return left.localeCompare(right);
  });
  return {
    schemaVersion: 'medantir-historical-outcome-row-ledger/1',
    rows: sorted,
    ledgerHash: scientificContentHash(sorted.map((row) => row.rowHash)),
    poolableRows: sorted.filter(isHistoricalOutcomeRowPoolable).length,
    unresolvedRows: sorted.filter((row) => row.contributionStatus === 'unresolved'
      || (row.contributionStatus === 'contributing' && !isHistoricalOutcomeRowPoolable(row))).length,
  };
}
