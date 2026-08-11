import type { HistoricalArchiveObjectReceipt } from './object-archive.js';
import type { HistoricalAppraisalRowInput } from './appraisal-ledger.js';
import type { HistoricalJatsTable, HistoricalJatsTableRow } from './jats-table-extractor.js';
import { requireHistoricalJatsTable } from './jats-table-extractor.js';

function normalizeStudyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/et\s+al\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    // Citation xrefs can appear as [25] in JATS study cells. Ignore standalone
    // reference-number tokens while preserving the 4-digit publication year.
    .filter((token) => token && !/^\d{1,3}$/.test(token))
    .join(' ')
    .trim();
}

function tableRow(table: HistoricalJatsTable, rowLabel: string): HistoricalJatsTableRow {
  const expected = normalizeStudyKey(rowLabel);
  const matches = table.rows.filter((row) => normalizeStudyKey(row.cells[0] ?? '') === expected);
  if (matches.length !== 1) {
    throw new Error(`Historical appraisal row '${rowLabel}' did not resolve uniquely in ${table.label}; found ${matches.length}.`);
  }
  return matches[0]!;
}

function integerCell(value: string, label: string): number {
  const match = value.match(/-?\d+/);
  if (!match) throw new Error(`Historical appraisal ${label} cell '${value}' has no integer.`);
  return Number.parseInt(match[0], 10);
}

function stars(value: string, label: string): number {
  const count = (value.match(/[\*★]/g) ?? []).length;
  if (count === 0 && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  if (count === 0) throw new Error(`Historical appraisal ${label} cell '${value}' has no NOS stars.`);
  return count;
}

function normalizedInterpretation(value: string): string {
  return value.toLowerCase().replace(/\s+quality\b/g, '').trim();
}

function reconcileJadad(input: Extract<HistoricalAppraisalRowInput, { tool: 'modified-jadad-7' }>, row: HistoricalJatsTableRow): void {
  if (row.cells.length < 7) throw new Error(`Historical Jadad row '${input.source.rowLabel}' has ${row.cells.length} cells; expected at least 7.`);
  const actual = {
    randomAllocation: integerCell(row.cells[1]!, 'random allocation'),
    concealment: integerCell(row.cells[2]!, 'concealment'),
    blinding: integerCell(row.cells[3]!, 'blinding'),
    withdrawalsDropouts: integerCell(row.cells[4]!, 'withdrawals/dropouts'),
    totalScore: integerCell(row.cells[5]!, 'total score'),
    interpretation: normalizedInterpretation(row.cells[6]!),
  };
  for (const key of ['randomAllocation', 'concealment', 'blinding', 'withdrawalsDropouts', 'totalScore'] as const) {
    if (actual[key] !== input[key]) throw new Error(`Historical Jadad row '${input.lineageId}' ${key} mismatch: expected ${input[key]}, JATS ${actual[key]}.`);
  }
  if (actual.interpretation !== input.interpretation) {
    throw new Error(`Historical Jadad row '${input.lineageId}' interpretation mismatch: expected ${input.interpretation}, JATS ${actual.interpretation}.`);
  }
}

function reconcileNos(input: Extract<HistoricalAppraisalRowInput, { tool: 'newcastle-ottawa-cohort-9' }>, row: HistoricalJatsTableRow): void {
  if (row.cells.length < 7) throw new Error(`Historical NOS row '${input.source.rowLabel}' has ${row.cells.length} cells; expected at least 7.`);
  const actual = {
    selection: stars(row.cells[2]!, 'selection'),
    comparability: stars(row.cells[3]!, 'comparability'),
    outcome: stars(row.cells[4]!, 'outcome'),
    totalScore: integerCell(row.cells[5]!, 'total score'),
    interpretation: normalizedInterpretation(row.cells[6]!),
  };
  for (const key of ['selection', 'comparability', 'outcome', 'totalScore'] as const) {
    if (actual[key] !== input[key]) throw new Error(`Historical NOS row '${input.lineageId}' ${key} mismatch: expected ${input[key]}, JATS ${actual[key]}.`);
  }
  if (actual.interpretation !== input.interpretation) {
    throw new Error(`Historical NOS row '${input.lineageId}' interpretation mismatch: expected ${input.interpretation}, JATS ${actual.interpretation}.`);
  }
}

/**
 * Upgrade publication-transcribed appraisal rows only after cell-by-cell
 * reconciliation against the exact archived JATS row. The resulting source
 * binding carries both publication-object and raw-row hashes.
 */
export function bindHistoricalAppraisalToJats(input: {
  rows: HistoricalAppraisalRowInput[];
  tables: HistoricalJatsTable[];
  publicationObject: HistoricalArchiveObjectReceipt;
}): HistoricalAppraisalRowInput[] {
  const jadad = requireHistoricalJatsTable(input.tables, 'Table 3');
  const nos = requireHistoricalJatsTable(input.tables, 'Table 4');
  return input.rows.map((appraisal) => {
    const table = appraisal.tool === 'modified-jadad-7' ? jadad : nos;
    const row = tableRow(table, appraisal.source.rowLabel);
    if (appraisal.tool === 'modified-jadad-7') reconcileJadad(appraisal, row);
    else reconcileNos(appraisal, row);
    return {
      ...appraisal,
      source: {
        ...appraisal.source,
        objectId: input.publicationObject.objectId,
        sha256: input.publicationObject.sha256,
        bindingFidelity: 'structured-row',
        rowFragmentSha256: row.sourceFragmentSha256,
        verbatimEvidence: row.rowText,
      },
    };
  });
}
