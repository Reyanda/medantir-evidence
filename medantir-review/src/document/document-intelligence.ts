import type { PdfTextExtractionPort } from '../core/ports.js';
import type { EvidenceSectionName, FullTextDocument, ParsedDocument, ParsedSection } from '../core/types.js';

export type DocumentParseTier =
  | 'liteparse-structured'
  | 'native-structured'
  | 'coordinate-pdf'
  | 'ocr'
  | 'minimal-text';

export type DocumentCoordinateSystem = 'top-left-72dpi';

export interface DocumentParseAttempt {
  tier: DocumentParseTier;
  backend: string;
  accepted: boolean;
  score: number;
  reasons: string[];
  startedAt: string;
  completedAt: string;
}

export interface DocumentTableEvidence {
  id: string;
  heading?: string;
  rows: string[][];
  source: 'liteparse-markdown' | 'native';
}

export interface DocumentFigureEvidence {
  id: string;
  alt: string;
  uri?: string | undefined;
  source: 'liteparse-markdown' | 'native';
}

export interface DocumentSpatialTextItem {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: DocumentCoordinateSystem;
}

export interface DocumentSpatialPage {
  page: number;
  width?: number;
  height?: number;
  coordinateSystem: DocumentCoordinateSystem;
  textItems: DocumentSpatialTextItem[];
}

export interface DocumentIntelligenceMetadata {
  hierarchyVersion: '1';
  selectedTier: DocumentParseTier;
  selectedBackend: string;
  qualityScore: number;
  threshold: number;
  downgradeOccurred: boolean;
  attempts: DocumentParseAttempt[];
  textLayer: 'structured' | 'native' | 'ocr' | 'minimal';
  locatorFidelity: 'page-coordinate' | 'page' | 'section' | 'synthetic-chunk';
  tableCount: number;
  figureCount: number;
  spatialPageCount?: number;
  spatialTextItemCount?: number;
  coordinateSystem?: DocumentCoordinateSystem;
  warnings: string[];
}

export type IntelligentParsedDocument = ParsedDocument & {
  documentIntelligence: DocumentIntelligenceMetadata;
  tables: DocumentTableEvidence[];
  figures: DocumentFigureEvidence[];
  spatialPages?: DocumentSpatialPage[];
};

interface LiteParseTextItem {
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface LiteParsePage {
  page?: number;
  text?: string;
  markdown?: string;
  width?: number;
  height?: number;
  textItems?: LiteParseTextItem[];
}

interface LiteParseResponse {
  markdown?: string;
  text?: string;
  pages?: LiteParsePage[];
  tables?: Array<{ title?: string; rows?: unknown[][] }>;
  images?: Array<{ alt?: string; url?: string; uri?: string }>;
}

const SECTION_NAMES: Array<{ pattern: RegExp; name: EvidenceSectionName; heading: string }> = [
  { pattern: /^(?:background|introduction|rationale)$/i, name: 'rationale', heading: 'Introduction' },
  { pattern: /^(?:objective|objectives|aim|aims|purpose)$/i, name: 'objectives', heading: 'Objectives' },
  { pattern: /^(?:methods?|materials and methods|study design|methodology)$/i, name: 'methods', heading: 'Methods' },
  { pattern: /^(?:results|findings)$/i, name: 'results', heading: 'Results' },
  { pattern: /^(?:discussion|interpretation|conclusions?)$/i, name: 'discussion', heading: 'Discussion' },
  { pattern: /^(?:limitations?)$/i, name: 'limitations', heading: 'Limitations' },
];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sectionName(heading: string): { name: EvidenceSectionName; heading: string } {
  const normalized = heading.replace(/^#+\s*/, '').trim();
  return SECTION_NAMES.find((entry) => entry.pattern.test(normalized)) ?? { name: 'other', heading: normalized || 'Full text' };
}

function markdownSections(markdown: string): ParsedSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Array<{ line: number; level: number; text: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ line: i, level: match[1]!.length, text: match[2]!.trim() });
  }
  if (headings.length === 0) return deriveSections(markdown);

  const sections: ParsedSection[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i]!;
    const next = headings[i + 1];
    const body = lines.slice(current.line + 1, next?.line ?? lines.length).join('\n').trim();
    if (!body) continue;
    const mapped = sectionName(current.text);
    sections.push({
      name: mapped.name,
      heading: mapped.heading,
      pageStart: 1,
      pageEnd: 1,
      text: body.slice(0, 12000),
    });
  }
  return sections.length > 0 ? sections : deriveSections(markdown);
}

function deriveSections(text: string): ParsedSection[] {
  const hits = SECTION_NAMES
    .map((entry) => ({ ...entry, at: text.search(new RegExp(`\\b${entry.pattern.source.replace(/^\^|\$$/g, '')}\\b`, 'i')) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (hits.length === 0) {
    return [{ name: 'other', heading: 'Full text', pageStart: 1, pageEnd: 1, text: text.slice(0, 12000) }];
  }
  const sections: ParsedSection[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i]!.at;
    const end = i + 1 < hits.length ? hits[i + 1]!.at : text.length;
    const body = text.slice(start, end).trim();
    if (body) sections.push({ name: hits[i]!.name, heading: hits[i]!.heading, pageStart: 1, pageEnd: 1, text: body.slice(0, 12000) });
  }
  return sections;
}

function parseMarkdownRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = parseMarkdownRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTables(markdown: string): DocumentTableEvidence[] {
  const lines = markdown.split(/\r?\n/);
  const tables: DocumentTableEvidence[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i] ?? '';
    const separator = lines[i + 1] ?? '';
    if (!header.includes('|') || !isMarkdownTableSeparator(separator)) continue;
    const rows: string[][] = [parseMarkdownRow(header)];
    let cursor = i + 2;
    while (cursor < lines.length && (lines[cursor] ?? '').includes('|') && (lines[cursor] ?? '').trim()) {
      rows.push(parseMarkdownRow(lines[cursor]!));
      cursor += 1;
    }
    tables.push({ id: `table-${tables.length + 1}`, rows, source: 'liteparse-markdown' });
    i = cursor - 1;
  }
  return tables;
}

function markdownFigures(markdown: string): DocumentFigureEvidence[] {
  const figures: DocumentFigureEvidence[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(re)) {
    figures.push({ id: `figure-${figures.length + 1}`, alt: match[1] ?? '', uri: match[2], source: 'liteparse-markdown' });
  }
  return figures;
}

function quality(text: string, sections: ParsedSection[], tables: number, figures: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  const lengthScore = clamp(clean.length / 6000);
  const sectionKinds = new Set(sections.map((section) => section.name));
  const structureScore = clamp(sectionKinds.size / 5);
  const replacementRate = clean.length ? (clean.match(/�/g)?.length ?? 0) / clean.length : 1;
  const garblePenalty = clamp(replacementRate * 100);
  const words = clean.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const diversity = words.length ? new Set(words).size / words.length : 0;
  const diversityScore = clamp(diversity / 0.35);
  const modalityBonus = clamp((tables > 0 ? 0.5 : 0) + (figures > 0 ? 0.5 : 0));
  const score = clamp(lengthScore * 0.45 + structureScore * 0.3 + diversityScore * 0.2 + modalityBonus * 0.05 - garblePenalty * 0.4);
  if (clean.length < 800) reasons.push('extracted text is very short');
  if (sectionKinds.size < 2) reasons.push('limited document structure detected');
  if (replacementRate > 0.001) reasons.push('garbled/replacement characters detected');
  if (diversity < 0.08) reasons.push('low lexical diversity suggests extraction damage');
  return { score, reasons };
}

function chunks(text: string, sourcePages?: LiteParsePage[]): Array<{ page: number; text: string }> {
  if (sourcePages?.length) {
    return sourcePages.map((page, index) => ({ page: page.page ?? index + 1, text: page.markdown ?? page.text ?? '' })).filter((page) => page.text.trim());
  }
  return (text.match(/.{1,2400}/gs) ?? [text]).map((part, index) => ({ page: index + 1, text: part }));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function spatialPages(sourcePages?: LiteParsePage[]): DocumentSpatialPage[] {
  if (!sourcePages?.length) return [];
  const coordinateSystem: DocumentCoordinateSystem = 'top-left-72dpi';
  return sourcePages.flatMap((page, index) => {
    const pageNumber = page.page ?? index + 1;
    const textItems = (page.textItems ?? []).flatMap((item) => {
      const text = item.text?.trim() ?? '';
      if (!text
        || !finiteNonNegative(item.x)
        || !finiteNonNegative(item.y)
        || !finiteNonNegative(item.width)
        || !finiteNonNegative(item.height)) return [];
      return [{
        text,
        page: pageNumber,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        coordinateSystem,
      } satisfies DocumentSpatialTextItem];
    });
    if (textItems.length === 0) return [];
    return [{
      page: pageNumber,
      ...(finiteNonNegative(page.width) ? { width: page.width } : {}),
      ...(finiteNonNegative(page.height) ? { height: page.height } : {}),
      coordinateSystem,
      textItems,
    } satisfies DocumentSpatialPage];
  });
}

export interface HierarchicalDocumentIntelligenceOptions {
  liteParseEndpoint?: string;
  acceptThreshold?: number;
  fetchImpl?: typeof fetch;
  liteParseTimeoutMs?: number;
}

/**
 * MEDANTIR document hierarchy.
 *
 * 1. LiteParse structured parse gets first right of refusal.
 * 2. Native structured/text source may be accepted only when LiteParse fails or
 *    its measured quality is below threshold.
 * 3. Coordinate-aware PDF and OCR are declared downstream tiers. They are not
 *    silently emulated by plain text; if no configured backend can satisfy the
 *    quality boundary the document fails closed.
 *
 * Tables and figures discovered in LiteParse markdown are preserved as separate
 * evidence objects rather than flattened into narrative text. When LiteParse
 * exposes per-page textItems, their top-left 72-DPI geometry is retained as a
 * first-class evidence layer so later extraction can bind values to exact boxes.
 */
export class HierarchicalDocumentIntelligenceExtractor implements PdfTextExtractionPort {
  private readonly endpoint: string;
  private readonly threshold: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HierarchicalDocumentIntelligenceOptions = {}) {
    this.endpoint = options.liteParseEndpoint ?? process.env.PARSE_URL ?? 'https://api.actiora.com/parse';
    this.threshold = options.acceptThreshold ?? Number(process.env.DOCUMENT_PARSE_MIN_QUALITY ?? 0.55);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.liteParseTimeoutMs ?? Number(process.env.LITEPARSE_TIMEOUT_MS ?? 45000);
  }

  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    const attempts: DocumentParseAttempt[] = [];
    const warnings: string[] = [];

    const liteStarted = new Date().toISOString();
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: document.uri }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`LiteParse HTTP ${response.status}`);
      const payload = await response.json() as LiteParseResponse;
      const text = (payload.markdown ?? payload.text ?? '').trim();
      if (!text) throw new Error('LiteParse returned no document text');
      const sections = markdownSections(text);
      const tables = payload.tables?.length
        ? payload.tables.map((table, index) => ({
            id: `table-${index + 1}`,
            ...(table.title ? { heading: table.title } : {}),
            rows: (table.rows ?? []).map((row) => row.map((cell) => String(cell ?? ''))),
            source: 'liteparse-markdown' as const,
          }))
        : markdownTables(text);
      const figures = payload.images?.length
        ? payload.images.map((image, index) => ({
            id: `figure-${index + 1}`,
            alt: image.alt ?? '',
            ...((image.url ?? image.uri) ? { uri: image.url ?? image.uri } : {}),
            source: 'liteparse-markdown' as const,
          }))
        : markdownFigures(text);
      const spatial = spatialPages(payload.pages);
      const spatialTextItemCount = spatial.reduce((sum, page) => sum + page.textItems.length, 0);
      const assessed = quality(text, sections, tables.length, figures.length);
      const accepted = assessed.score >= this.threshold;
      attempts.push({
        tier: 'liteparse-structured', backend: this.endpoint, accepted, score: assessed.score,
        reasons: accepted ? [] : assessed.reasons, startedAt: liteStarted, completedAt: new Date().toISOString(),
      });
      if (accepted) {
        if (payload.pages?.length && spatial.length === 0) {
          warnings.push('LiteParse returned page text without usable text-item coordinates; locator fidelity remains page-level.');
        }
        const result: IntelligentParsedDocument = {
          recordId: document.recordId,
          text,
          pages: chunks(text, payload.pages),
          sections,
          extractionMethod: 'native',
          tables,
          figures,
          ...(spatial.length > 0 ? { spatialPages: spatial } : {}),
          documentIntelligence: {
            hierarchyVersion: '1', selectedTier: 'liteparse-structured', selectedBackend: this.endpoint,
            qualityScore: assessed.score, threshold: this.threshold, downgradeOccurred: false, attempts,
            textLayer: 'structured', locatorFidelity: spatial.length > 0 ? 'page-coordinate' : payload.pages?.length ? 'page' : 'section',
            tableCount: tables.length, figureCount: figures.length,
            ...(spatial.length > 0 ? {
              spatialPageCount: spatial.length,
              spatialTextItemCount,
              coordinateSystem: 'top-left-72dpi' as const,
            } : {}),
            warnings,
          },
        };
        return result as ParsedDocument;
      }
      warnings.push(`LiteParse quality ${assessed.score.toFixed(3)} below threshold ${this.threshold.toFixed(3)}; evaluating lower tier.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({
        tier: 'liteparse-structured', backend: this.endpoint, accepted: false, score: 0,
        reasons: [reason], startedAt: liteStarted, completedAt: new Date().toISOString(),
      });
      warnings.push(`LiteParse unavailable/failed: ${reason}`);
    }

    if (document.content?.trim()) {
      const nativeStarted = new Date().toISOString();
      const text = document.content.trim();
      const sections = deriveSections(text);
      const assessed = quality(text, sections, 0, 0);
      const accepted = assessed.score >= this.threshold;
      attempts.push({
        tier: 'native-structured', backend: document.legalAccessRoute, accepted, score: assessed.score,
        reasons: accepted ? [] : assessed.reasons, startedAt: nativeStarted, completedAt: new Date().toISOString(),
      });
      if (accepted) {
        warnings.push('Document parse downgraded from LiteParse to native source text.');
        const result: IntelligentParsedDocument = {
          recordId: document.recordId,
          text,
          pages: chunks(text),
          sections,
          extractionMethod: 'native',
          tables: [],
          figures: [],
          documentIntelligence: {
            hierarchyVersion: '1', selectedTier: 'native-structured', selectedBackend: document.legalAccessRoute,
            qualityScore: assessed.score, threshold: this.threshold, downgradeOccurred: true, attempts,
            textLayer: 'native', locatorFidelity: 'synthetic-chunk',
            tableCount: 0, figureCount: 0, warnings,
          },
        };
        return result as ParsedDocument;
      }
    }

    throw new Error(
      `Document intelligence quality gate failed for ${document.recordId}. `
      + `LiteParse has precedence; configured lower tiers could not produce an acceptable parse. `
      + `Coordinate-aware PDF/OCR backend required. Attempts: ${attempts.map((attempt) => `${attempt.tier}:${attempt.score.toFixed(3)}`).join(', ')}`,
    );
  }
}

export function documentIntelligenceOf(document: ParsedDocument): DocumentIntelligenceMetadata | null {
  return (document as ParsedDocument & { documentIntelligence?: DocumentIntelligenceMetadata }).documentIntelligence ?? null;
}
