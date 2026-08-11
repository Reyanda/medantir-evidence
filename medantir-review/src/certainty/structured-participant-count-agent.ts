import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { QuantitativeExtractionLedgerRow } from '../agents/provenance-first-extraction.js';
import type { OutcomeParticipantCountReceipt } from './automatic-grade-evidence-agent.js';

type TableEvidence = {
  id: string;
  heading?: string;
  page?: number;
  rows: string[][];
};

type EvidenceDocument = {
  recordId: string;
  tables?: TableEvidence[];
};

const TOTAL_HEADERS = new Set([
  'n',
  'total n',
  'participants',
  'number of participants',
  'sample size',
  'total participants',
  'analysed participants',
  'analyzed participants',
]);

const INTERVENTION_WORDS = ['intervention', 'treatment', 'experimental', 'active'];
const COMPARATOR_WORDS = ['control', 'comparator', 'placebo', 'usual care', 'standard care'];

function integerCell(value: string): number | null {
  const cleaned = value.trim().replaceAll(',', '');
  if (!/^\d+$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nLikeHeader(value: string): boolean {
  const normalized = normaliseText(value);
  return /(^|\s)n($|\s)|participants?|sample size|number analysed|number analyzed/.test(normalized);
}

function armHeader(value: string, words: string[]): boolean {
  const normalized = normaliseText(value);
  return nLikeHeader(normalized) && words.some((word) => normalized.includes(word));
}

function exactRow(table: TableEvidence, ledger: QuantitativeExtractionLedgerRow): { headers: string[]; row: string[]; rowIndex: number } | null {
  if (table.rows.length < 2) return null;
  const headers = table.rows[0]?.map((cell) => cell.trim()) ?? [];
  const candidates: Array<{ row: string[]; rowIndex: number }> = [];
  for (let index = 1; index < table.rows.length; index += 1) {
    const row = table.rows[index] ?? [];
    const verbatim = row.map((cell) => cell.trim()).join(' | ');
    if (ledger.verbatim && verbatim === ledger.verbatim) candidates.push({ row, rowIndex: index });
  }
  if (candidates.length === 0 && ledger.rowLabel) {
    const wanted = normaliseText(ledger.rowLabel);
    for (let index = 1; index < table.rows.length; index += 1) {
      const row = table.rows[index] ?? [];
      if (row.some((cell) => normaliseText(cell) === wanted)) candidates.push({ row, rowIndex: index });
    }
  }
  return candidates.length === 1 ? { headers, ...candidates[0]! } : null;
}

function deriveCount(headers: string[], row: string[]): {
  totalParticipants: number;
  method: 'single-total-column' | 'arm-specific-sum';
  sourceCells: Array<{ header: string; value: string; columnIndex: number }>;
} | null {
  const totalColumns = headers.flatMap((header, index) => TOTAL_HEADERS.has(normaliseText(header)) ? [index] : []);
  const validTotals = totalColumns.flatMap((index) => {
    const value = row[index] ?? '';
    const n = integerCell(value);
    return n === null ? [] : [{ header: headers[index] ?? '', value, columnIndex: index, n }];
  });
  if (validTotals.length === 1) {
    return {
      totalParticipants: validTotals[0]!.n,
      method: 'single-total-column',
      sourceCells: [{ header: validTotals[0]!.header, value: validTotals[0]!.value, columnIndex: validTotals[0]!.columnIndex }],
    };
  }
  if (validTotals.length > 1) return null;

  const interventionColumns = headers.flatMap((header, index) => armHeader(header, INTERVENTION_WORDS) ? [index] : []);
  const comparatorColumns = headers.flatMap((header, index) => armHeader(header, COMPARATOR_WORDS) ? [index] : []);
  if (interventionColumns.length !== 1 || comparatorColumns.length !== 1 || interventionColumns[0] === comparatorColumns[0]) return null;
  const interventionValue = row[interventionColumns[0]!] ?? '';
  const comparatorValue = row[comparatorColumns[0]!] ?? '';
  const interventionN = integerCell(interventionValue);
  const comparatorN = integerCell(comparatorValue);
  if (interventionN === null || comparatorN === null) return null;
  return {
    totalParticipants: interventionN + comparatorN,
    method: 'arm-specific-sum',
    sourceCells: [
      { header: headers[interventionColumns[0]!] ?? '', value: interventionValue, columnIndex: interventionColumns[0]! },
      { header: headers[comparatorColumns[0]!] ?? '', value: comparatorValue, columnIndex: comparatorColumns[0]! },
    ],
  };
}

function unresolved(ledger: QuantitativeExtractionLedgerRow, reason: string): OutcomeParticipantCountReceipt {
  return {
    version: 1,
    studyId: ledger.studyId,
    outcome: ledger.outcome,
    status: 'unresolved',
    evidenceIds: [],
    source: 'unresolved',
    sourceHash: stableHash({ studyId: ledger.studyId, outcome: ledger.outcome, recordId: ledger.recordId, tableId: ledger.tableId ?? null, reason }),
  };
}

/**
 * Source-bound participant-count extraction for GRADE information-size evidence.
 *
 * Counts are accepted only from the same structured table row already approved
 * for quantitative effect extraction. No prose regex, abstract N, or nearby table
 * count is allowed to enter OIS automatically.
 */
export class StructuredParticipantCountAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    const ledger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[] | undefined;
    if (!ledger) return result;
    const documents = context.state.artifacts.includedDocuments as EvidenceDocument[] | undefined;
    const byRecord = new Map((documents ?? []).map((document) => [document.recordId, document]));
    const receipts: OutcomeParticipantCountReceipt[] = [];

    for (const quantitative of ledger) {
      if (quantitative.status !== 'extracted' || !quantitative.tableId) {
        receipts.push(unresolved(quantitative, 'Quantitative estimate is not an extracted table-bound row.'));
        continue;
      }
      const document = byRecord.get(quantitative.recordId);
      if (!document) {
        receipts.push(unresolved(quantitative, 'Included source document is unavailable.'));
        continue;
      }
      const tables = (document.tables ?? []).filter((table) => table.id === quantitative.tableId);
      if (tables.length !== 1) {
        receipts.push(unresolved(quantitative, 'The quantitative table identity is missing or ambiguous.'));
        continue;
      }
      const matched = exactRow(tables[0]!, quantitative);
      if (!matched) {
        receipts.push(unresolved(quantitative, 'The exact quantitative source row could not be uniquely reconstructed.'));
        continue;
      }
      const count = deriveCount(matched.headers, matched.row);
      if (!count) {
        receipts.push(unresolved(quantitative, 'No single unambiguous total-N column or intervention/comparator N pair exists on the quantitative source row.'));
        continue;
      }
      const sourceIdentity = {
        recordId: quantitative.recordId,
        tableId: quantitative.tableId,
        rowIndex: matched.rowIndex,
        rowLabel: quantitative.rowLabel ?? null,
        outcome: quantitative.outcome,
        method: count.method,
        sourceCells: count.sourceCells,
      };
      const sourceHash = stableHash(sourceIdentity);
      receipts.push({
        version: 1,
        studyId: quantitative.studyId,
        outcome: quantitative.outcome,
        status: 'exact',
        totalParticipants: count.totalParticipants,
        evidenceIds: count.sourceCells.map((cell) => `participant-cell:${stableHash({ sourceHash, cell }).slice(0, 24)}`),
        source: 'structured-arm-counts',
        sourceHash,
      });
    }

    const exact = receipts.filter((item) => item.status === 'exact').length;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        outcomeParticipantCountLedger: receipts,
        participantCountExtractionQuality: {
          totalQuantitativeRows: receipts.length,
          exactCounts: exact,
          unresolvedCounts: receipts.length - exact,
          acceptedSource: 'same-structured-row-as-quantitative-effect',
          proseCountsAccepted: false,
        },
      },
      ...(exact < receipts.length
        ? { warnings: [...(result.warnings ?? []), `${receipts.length - exact} quantitative outcome row(s) lack an exact source-bound participant count; GRADE information size remains unresolved for those rows.`] }
        : {}),
    };
  }
}
