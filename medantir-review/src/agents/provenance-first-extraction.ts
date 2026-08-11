import type { Agent, AgentContext, AgentResult, ExtractedStudy, ParsedDocument } from '../core/types.js';
import { normaliseText } from '../core/utils.js';
import type { DocumentCoordinateSystem, DocumentSpatialPage, DocumentSpatialTextItem } from '../document/document-intelligence.js';

export type QuantitativeEffectMeasure = 'RR' | 'OR' | 'HR' | 'MD' | 'SMD' | 'RD';
export type QuantitativeAnalysisScale = 'identity' | 'log';

type TableEvidence = {
  id: string;
  heading?: string;
  page?: number;
  rows: string[][];
  source?: string;
};

type EvidenceDocument = ParsedDocument & {
  tables?: TableEvidence[];
  spatialPages?: DocumentSpatialPage[];
  documentIntelligence?: {
    selectedTier?: string;
    locatorFidelity?: string;
  };
};

export interface QuantitativeEvidenceBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  coordinateSystem: DocumentCoordinateSystem;
}

export interface QuantitativeSpatialLocator {
  page: number;
  coordinateSystem: DocumentCoordinateSystem;
  rowLabelBox: QuantitativeEvidenceBox;
  columnHeaderBox: QuantitativeEvidenceBox;
  effectCellBox: QuantitativeEvidenceBox;
  confidenceIntervalCellBox?: QuantitativeEvidenceBox;
}

export interface QuantitativeExtractionLedgerRow {
  studyId: string;
  recordId: string;
  outcome: string;
  status: 'extracted' | 'blocked';
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
  effect?: number;
  analysisEffect?: number;
  standardError?: number;
  confidenceInterval?: [number, number];
  tableId?: string;
  tableHeading?: string;
  rowLabel?: string;
  columnHeader?: string;
  page?: number;
  spatialLocator?: QuantitativeSpatialLocator;
  verbatim?: string;
  extractionTool: 'liteparse' | 'blocked-needs-manual';
  reason?: string;
}

type Candidate = {
  effectMeasure: QuantitativeEffectMeasure;
  effect: number;
  standardError: number;
  confidenceInterval: [number, number];
  tableId: string;
  tableHeading?: string;
  rowLabel: string;
  columnHeader: string;
  page: number;
  spatialLocator?: QuantitativeSpatialLocator;
  verbatim: string;
};

const GENERIC_OUTCOME_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'from', 'outcome', 'outcomes', 'primary', 'secondary',
]);

function meaningfulTokens(value: string): string[] {
  return normaliseText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !GENERIC_OUTCOME_TOKENS.has(token));
}

function outcomeMatch(outcome: string, rowText: string): boolean {
  const wanted = normaliseText(outcome);
  const observed = normaliseText(rowText);
  if (!wanted || !observed) return false;
  if (observed.includes(wanted)) return true;

  const tokens = meaningfulTokens(outcome);
  if (tokens.length === 0) return false;
  const observedTokens = new Set(meaningfulTokens(rowText));
  const matched = tokens.filter((token) => observedTokens.has(token)).length;
  if (tokens.length === 1) return matched === 1;
  return matched / tokens.length >= 0.75;
}

function abbreviationHeader(value: string, abbreviation: string): boolean {
  const stripped = value
    .replace(/\b(?:adjusted|unadjusted|crude|pooled|effect|estimate|ratio|difference|standardised|standardized|mean|risk|hazard|odds|rate)\b/g, ' ')
    .replace(/\b(?:95|ci|confidence|interval)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped === abbreviation.toLowerCase();
}

function effectMeasure(header: string): QuantitativeEffectMeasure | null {
  const value = normaliseText(header);
  if (/\bstandardised mean difference\b|\bstandardized mean difference\b/.test(value) || abbreviationHeader(value, 'smd')) return 'SMD';
  if (/\brisk difference\b/.test(value) || abbreviationHeader(value, 'rd')) return 'RD';
  if (/\bmean difference\b/.test(value) || abbreviationHeader(value, 'md')) return 'MD';
  if (/\bhazard ratio\b/.test(value) || abbreviationHeader(value, 'hr')) return 'HR';
  if (/\bodds ratio\b/.test(value) || abbreviationHeader(value, 'or')) return 'OR';
  if (/\brisk ratio\b|\brelative risk\b|\brate ratio\b/.test(value) || abbreviationHeader(value, 'rr')) return 'RR';
  return null;
}

function analysisScale(measure: QuantitativeEffectMeasure): QuantitativeAnalysisScale {
  return measure === 'RR' || measure === 'OR' || measure === 'HR' ? 'log' : 'identity';
}

function analysisEffect(measure: QuantitativeEffectMeasure, effect: number): number | null {
  if (analysisScale(measure) === 'identity') return effect;
  if (!(effect > 0)) return null;
  return Math.log(effect);
}

function isConfidenceIntervalHeader(header: string): boolean {
  const value = normaliseText(header);
  return /\b95\b.*\bci\b|\bconfidence interval\b|\bci\b/.test(value);
}

function parseNumbers(value: string): number[] {
  const normalized = value
    .replace(/[−–—]/g, '-')
    .replace(/95\s*%?\s*(?:ci|confidence\s+interval)/gi, ' ');
  const matches = normalized.match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? [];
  return matches.map(Number).filter(Number.isFinite);
}

function deriveStandardError(measure: QuantitativeEffectMeasure, lower: number, upper: number): number | null {
  if (!(upper > lower)) return null;
  if (analysisScale(measure) === 'log') {
    if (!(lower > 0 && upper > 0)) return null;
    return (Math.log(upper) - Math.log(lower)) / (2 * 1.96);
  }
  return (upper - lower) / (2 * 1.96);
}

function validInterval(measure: QuantitativeEffectMeasure, effect: number, lower: number, upper: number): boolean {
  if (![effect, lower, upper].every(Number.isFinite)) return false;
  if (!(lower <= effect && effect <= upper && upper > lower)) return false;
  if (analysisScale(measure) === 'log' && !(lower > 0 && effect > 0)) return false;
  return true;
}

function rowLabelColumn(headers: string[]): number {
  const preferred = headers.findIndex((header) => /^(study|outcome|endpoint|variable|measure|characteristic|comparison)$/i.test(header.trim()));
  return preferred >= 0 ? preferred : 0;
}

function pageForRow(document: EvidenceDocument, table: TableEvidence, row: string[]): number | null {
  if (Number.isInteger(table.page) && (table.page ?? 0) > 0) return table.page ?? null;

  const cells = row
    .map((cell) => normaliseText(cell))
    .filter((cell) => cell.length >= 2);
  if (cells.length === 0) return null;

  const hits = document.pages.filter((page) => {
    const pageText = normaliseText(page.text);
    const required = Math.min(2, cells.length);
    return cells.filter((cell) => pageText.includes(cell)).length >= required;
  });
  return hits.length === 1 ? hits[0]!.page : null;
}

function spatialText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/95\s*%?\s*(?:ci|confidence\s+interval)/gi, ' ')
    .replace(/[^a-z0-9.+%-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unionBox(items: DocumentSpatialTextItem[], text: string): QuantitativeEvidenceBox | null {
  if (items.length === 0) return null;
  const page = items[0]!.page;
  if (items.some((item) => item.page !== page)) return null;
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return {
    page,
    x,
    y,
    width: right - x,
    height: bottom - y,
    text,
    coordinateSystem: items[0]!.coordinateSystem,
  };
}

function uniqueSpatialBox(page: DocumentSpatialPage, target: string): QuantitativeEvidenceBox | null {
  const wanted = spatialText(target);
  if (!wanted) return null;
  const items = page.textItems.filter((item) => spatialText(item.text));
  const matches: QuantitativeEvidenceBox[] = [];
  const maxWindow = Math.min(12, items.length);
  for (let start = 0; start < items.length; start += 1) {
    for (let size = 1; size <= maxWindow && start + size <= items.length; size += 1) {
      const span = items.slice(start, start + size);
      const combined = spatialText(span.map((item) => item.text).join(' '));
      if (combined !== wanted) continue;
      const box = unionBox(span, target);
      if (box) matches.push(box);
    }
  }
  const unique = matches.filter((match, index) => matches.findIndex((other) => (
    other.x === match.x && other.y === match.y && other.width === match.width && other.height === match.height
  )) === index);
  return unique.length === 1 ? unique[0]! : null;
}

function spatialLocatorFor(
  document: EvidenceDocument,
  pageNumber: number,
  rowLabel: string,
  columnHeader: string,
  effectCell: string,
  confidenceIntervalCell?: string,
): QuantitativeSpatialLocator | null {
  if (document.documentIntelligence?.locatorFidelity !== 'page-coordinate') return null;
  const page = document.spatialPages?.find((candidate) => candidate.page === pageNumber);
  if (!page) return null;
  const rowLabelBox = uniqueSpatialBox(page, rowLabel);
  const columnHeaderBox = uniqueSpatialBox(page, columnHeader);
  const effectCellBox = uniqueSpatialBox(page, effectCell);
  if (!rowLabelBox || !columnHeaderBox || !effectCellBox) return null;
  const confidenceIntervalCellBox = confidenceIntervalCell && confidenceIntervalCell !== effectCell
    ? uniqueSpatialBox(page, confidenceIntervalCell)
    : undefined;
  if (confidenceIntervalCell && confidenceIntervalCell !== effectCell && !confidenceIntervalCellBox) return null;
  return {
    page: pageNumber,
    coordinateSystem: page.coordinateSystem,
    rowLabelBox,
    columnHeaderBox,
    effectCellBox,
    ...(confidenceIntervalCellBox ? { confidenceIntervalCellBox } : {}),
  };
}

function parseCandidate(
  document: EvidenceDocument,
  table: TableEvidence,
  headers: string[],
  row: string[],
  rowIndex: number,
  columnIndex: number,
  measure: QuantitativeEffectMeasure,
): Candidate | null {
  const value = row[columnIndex]?.trim() ?? '';
  if (!value) return null;

  const pointNumbers = parseNumbers(value);
  if (pointNumbers.length === 0) return null;
  const point = pointNumbers[0]!;

  let lower: number | undefined;
  let upper: number | undefined;
  let confidenceIntervalCell: string | undefined;
  if (pointNumbers.length >= 3) {
    lower = pointNumbers[1];
    upper = pointNumbers[2];
    confidenceIntervalCell = value;
  } else {
    const ciIndex = headers.findIndex((header, index) => index !== columnIndex && isConfidenceIntervalHeader(header));
    if (ciIndex >= 0) {
      const rawCi = row[ciIndex]?.trim() ?? '';
      const ciNumbers = parseNumbers(rawCi);
      if (ciNumbers.length >= 2) {
        lower = ciNumbers[0];
        upper = ciNumbers[1];
        confidenceIntervalCell = rawCi;
      }
    }
  }

  if (lower === undefined || upper === undefined || !validInterval(measure, point, lower, upper)) return null;
  const se = deriveStandardError(measure, lower, upper);
  if (se === null || !Number.isFinite(se) || se <= 0) return null;

  const labelIndex = rowLabelColumn(headers);
  const rowLabel = row[labelIndex]?.trim() ?? '';
  const columnHeader = headers[columnIndex]?.trim() ?? '';
  if (!rowLabel || !columnHeader) return null;

  const page = pageForRow(document, table, row);
  if (page === null) return null;
  const spatialLocator = spatialLocatorFor(document, page, rowLabel, columnHeader, value, confidenceIntervalCell);
  if (document.documentIntelligence?.locatorFidelity === 'page-coordinate' && !spatialLocator) return null;

  const verbatim = row.map((cell) => cell.trim()).join(' | ');
  return {
    effectMeasure: measure,
    effect: point,
    standardError: se,
    confidenceInterval: [lower, upper],
    tableId: table.id || `table-${rowIndex + 1}`,
    ...(table.heading ? { tableHeading: table.heading } : {}),
    rowLabel,
    columnHeader,
    page,
    ...(spatialLocator ? { spatialLocator } : {}),
    verbatim,
  };
}

function candidatesForOutcome(document: EvidenceDocument, outcome: string): Candidate[] {
  if (document.documentIntelligence?.selectedTier !== 'liteparse-structured') return [];
  if (!['page', 'page-coordinate'].includes(document.documentIntelligence?.locatorFidelity ?? '')) return [];

  const candidates: Candidate[] = [];
  for (const table of document.tables ?? []) {
    if (table.rows.length < 2) continue;
    const headers = table.rows[0]?.map((cell) => cell.trim()) ?? [];
    if (headers.length < 2) continue;
    const labelIndex = rowLabelColumn(headers);

    for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex += 1) {
      const row = table.rows[rowIndex] ?? [];
      const rowLabel = row[labelIndex]?.trim() ?? '';
      if (!rowLabel || !outcomeMatch(outcome, row.join(' '))) continue;

      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        if (columnIndex === labelIndex) continue;
        const measure = effectMeasure(headers[columnIndex] ?? '');
        if (!measure) continue;
        const candidate = parseCandidate(document, table, headers, row, rowIndex, columnIndex, measure);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function blockedReason(document: EvidenceDocument, candidateCount: number): string {
  if (document.documentIntelligence?.selectedTier !== 'liteparse-structured') {
    return 'Quantitative extraction requires LiteParse structured evidence; lower-tier text is not accepted for pooling.';
  }
  if (!['page', 'page-coordinate'].includes(document.documentIntelligence?.locatorFidelity ?? '')) {
    return 'Page-resolved provenance is unavailable; quantitative extraction is blocked.';
  }
  if (candidateCount > 1) {
    return `Ambiguous quantitative evidence: ${candidateCount} labelled estimates match this outcome; subgroup/row adjudication is required.`;
  }
  if (document.documentIntelligence?.locatorFidelity === 'page-coordinate') {
    return 'No uniquely labelled effect estimate could be bound simultaneously to its row label, effect-measure header, numeric cell and spatial page coordinates.';
  }
  return 'No uniquely labelled effect estimate with a valid confidence interval was found in LiteParse table evidence.';
}

/**
 * Replaces machine-carried numeric outcomes with values that can be reconstructed
 * from the included full text. Every accepted value must have an explicit row
 * label, column header, page, verbatim table row and LiteParse provenance.
 * Where LiteParse exposes page-coordinate text items, the row label, measure
 * header and numeric cell must also resolve uniquely to top-left 72-DPI boxes;
 * spatial ambiguity fails closed instead of being silently downgraded to a page.
 *
 * Ratio measures are stored on their logarithmic analysis scale while the
 * ledger preserves the reported ratio and confidence interval. Difference
 * measures stay on the identity scale. This prevents effect/SE scale mixing in
 * inverse-variance synthesis and lets the forest renderer back-transform safely.
 *
 * This deliberately fails closed: lower-tier text, missing page provenance,
 * invalid intervals and multiple matching rows remain non-numeric so downstream
 * meta-analysis cannot pool them accidentally.
 */
export class ProvenanceFirstExtractionAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = result.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    if (!studies) throw new Error('Provenance-first extraction requires the base extraction artifact.');

    const documents = context.state.artifacts.includedDocuments as EvidenceDocument[] | undefined;
    if (!documents) throw new Error('Provenance-first extraction requires included full-text documents.');
    const byRecordId = new Map(documents.map((document) => [document.recordId, document]));

    const ledger: QuantitativeExtractionLedgerRow[] = [];
    const warnings = [...(result.warnings ?? [])];

    const enriched = studies.map((study) => {
      const recordId = study.reportIds[0];
      const document = recordId ? byRecordId.get(recordId) : undefined;
      if (!document) {
        const outcomes = study.outcomes.map((outcome) => ({ name: outcome.name }));
        for (const outcome of outcomes) {
          ledger.push({
            studyId: study.studyId,
            recordId: recordId ?? 'unknown',
            outcome: outcome.name,
            status: 'blocked',
            extractionTool: 'blocked-needs-manual',
            reason: 'Included full-text document is unavailable for quantitative provenance reconstruction.',
          });
        }
        warnings.push(`${study.studyId}: quantitative values blocked because the included full text could not be resolved.`);
        return { ...study, outcomes };
      }

      const outcomes = study.outcomes.map((outcome) => {
        const candidates = candidatesForOutcome(document, outcome.name);
        if (candidates.length !== 1) {
          const reason = blockedReason(document, candidates.length);
          ledger.push({
            studyId: study.studyId,
            recordId: document.recordId,
            outcome: outcome.name,
            status: 'blocked',
            extractionTool: 'blocked-needs-manual',
            reason,
          });
          warnings.push(`${study.studyId} / ${outcome.name}: ${reason}`);
          return { name: outcome.name };
        }

        const candidate = candidates[0]!;
        const scale = analysisScale(candidate.effectMeasure);
        const analysed = analysisEffect(candidate.effectMeasure, candidate.effect);
        if (analysed === null || !Number.isFinite(analysed)) {
          const reason = `Reported ${candidate.effectMeasure} could not be represented on its ${scale} analysis scale.`;
          ledger.push({
            studyId: study.studyId,
            recordId: document.recordId,
            outcome: outcome.name,
            status: 'blocked',
            extractionTool: 'blocked-needs-manual',
            reason,
          });
          warnings.push(`${study.studyId} / ${outcome.name}: ${reason}`);
          return { name: outcome.name };
        }

        ledger.push({
          studyId: study.studyId,
          recordId: document.recordId,
          outcome: outcome.name,
          status: 'extracted',
          effectMeasure: candidate.effectMeasure,
          analysisScale: scale,
          effect: candidate.effect,
          analysisEffect: analysed,
          standardError: candidate.standardError,
          confidenceInterval: candidate.confidenceInterval,
          tableId: candidate.tableId,
          ...(candidate.tableHeading ? { tableHeading: candidate.tableHeading } : {}),
          rowLabel: candidate.rowLabel,
          columnHeader: candidate.columnHeader,
          page: candidate.page,
          ...(candidate.spatialLocator ? { spatialLocator: candidate.spatialLocator } : {}),
          verbatim: candidate.verbatim,
          extractionTool: 'liteparse',
        });
        return {
          name: outcome.name,
          effect: analysed,
          standardError: candidate.standardError,
          effectMeasure: candidate.effectMeasure,
          analysisScale: scale,
          reportedEffect: candidate.effect,
          reportedConfidenceInterval: candidate.confidenceInterval,
        };
      });

      return { ...study, outcomes };
    });

    const extractedCount = ledger.filter((entry) => entry.status === 'extracted').length;
    const coordinateBoundCount = ledger.filter((entry) => entry.status === 'extracted' && entry.spatialLocator).length;
    const blockedCount = ledger.length - extractedCount;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        extractedStudies: enriched,
        quantitativeExtractionLedger: ledger,
        quantitativeExtractionQuality: {
          totalOutcomes: ledger.length,
          provenanceBound: extractedCount,
          coordinateBound: coordinateBoundCount,
          blockedNeedsManual: blockedCount,
          poolingRequiresProvenance: true,
          acceptedExtractionTool: 'liteparse',
          requiredFields: ['rowLabel', 'columnHeader', 'page', 'verbatim', 'extractionTool', 'analysisScale'],
          coordinateRequiredWhenAvailable: true,
        },
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
