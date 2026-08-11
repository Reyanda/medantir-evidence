import type { PdfTextExtractionPort } from '../core/ports.js';
import type { EvidenceSectionName, FullTextDocument, ParsedDocument, ParsedSection } from '../core/types.js';
import {
  HierarchicalDocumentIntelligenceExtractor,
  type DocumentIntelligenceMetadata,
  type DocumentParseAttempt,
} from './document-intelligence.js';

const SECTION_MARKERS: Array<{ re: RegExp; name: EvidenceSectionName; heading: string }> = [
  { re: /\b(?:background|introduction|rationale)\b/i, name: 'rationale', heading: 'Introduction' },
  { re: /\b(?:objective|objectives|aim|aims|purpose)\b/i, name: 'objectives', heading: 'Objectives' },
  { re: /\b(?:methods?|materials and methods|study design|methodology)\b/i, name: 'methods', heading: 'Methods' },
  { re: /\b(?:results|findings)\b/i, name: 'results', heading: 'Results' },
  { re: /\b(?:discussion|interpretation)\b/i, name: 'discussion', heading: 'Discussion' },
  { re: /\b(?:limitations?)\b/i, name: 'limitations', heading: 'Limitations' },
  { re: /\b(?:conclusions?)\b/i, name: 'discussion', heading: 'Conclusion' },
];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nativeSections(text: string): ParsedSection[] {
  const hits = SECTION_MARKERS
    .map((marker) => ({ ...marker, at: text.search(marker.re) }))
    .filter((marker) => marker.at >= 0)
    .sort((a, b) => a.at - b.at);

  if (hits.length === 0) {
    return [{ name: 'other', heading: 'Full text', pageStart: 1, pageEnd: 1, text: text.slice(0, 12000) }];
  }

  return hits.flatMap((hit, index) => {
    const end = index + 1 < hits.length ? hits[index + 1]!.at : text.length;
    const body = text.slice(hit.at, end).trim();
    return body
      ? [{ name: hit.name, heading: hit.heading, pageStart: 1, pageEnd: 1, text: body.slice(0, 12000) } satisfies ParsedSection]
      : [];
  });
}

function nativeQuality(text: string, sections: ParsedSection[]): { score: number; reasons: string[] } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sectionKinds = new Set(sections.map((section) => section.name));
  const replacementRate = clean.length ? (clean.match(/�/g)?.length ?? 0) / clean.length : 1;
  const lengthScore = clamp(clean.length / 6000);
  const structureScore = clamp(sectionKinds.size / 5);
  const score = clamp(lengthScore * 0.65 + structureScore * 0.35 - clamp(replacementRate * 100) * 0.4);
  const reasons: string[] = [];
  if (clean.length < 800) reasons.push('native full text is very short');
  if (sectionKinds.size < 2) reasons.push('limited native document structure detected');
  if (replacementRate > 0.001) reasons.push('garbled/replacement characters detected');
  return { score, reasons };
}

function chunks(text: string): Array<{ page: number; text: string }> {
  return (text.match(/.{1,2400}/gs) ?? [text]).map((part, index) => ({ page: index + 1, text: part }));
}

export interface FormatAwareDocumentIntelligenceOptions {
  pdfExtractor?: PdfTextExtractionPort;
  acceptThreshold?: number;
}

/**
 * Routes documents by the evidence representation MEDANTIR actually possesses.
 *
 * LiteParse remains the binding first-line parser for PDFs because spatial
 * evidence has to be reconstructed from the visual document. Lawfully retrieved
 * native XML/text is already a structured text representation, so sending its
 * article URL through the PDF parser adds latency without creating page geometry.
 * Native text is therefore quality-gated directly and explicitly marked as
 * non-spatial. Quantitative pooling still fails closed downstream because this
 * route never claims LiteParse/page-coordinate provenance.
 */
export class FormatAwareDocumentIntelligenceExtractor implements PdfTextExtractionPort {
  private readonly pdfExtractor: PdfTextExtractionPort;
  private readonly threshold: number;

  constructor(options: FormatAwareDocumentIntelligenceOptions = {}) {
    this.pdfExtractor = options.pdfExtractor ?? new HierarchicalDocumentIntelligenceExtractor();
    this.threshold = options.acceptThreshold ?? Number(process.env.DOCUMENT_PARSE_MIN_QUALITY ?? 0.55);
  }

  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    const text = document.content?.trim() ?? '';
    const isPdf = document.mimeType.toLowerCase().includes('pdf');
    if (isPdf || !text) return this.pdfExtractor.extract(document);

    const startedAt = new Date().toISOString();
    const sections = nativeSections(text);
    const assessed = nativeQuality(text, sections);
    const completedAt = new Date().toISOString();
    const attempt: DocumentParseAttempt = {
      tier: 'native-structured',
      backend: document.legalAccessRoute,
      accepted: assessed.score >= this.threshold,
      score: assessed.score,
      reasons: assessed.score >= this.threshold ? [] : assessed.reasons,
      startedAt,
      completedAt,
    };

    if (!attempt.accepted) {
      throw new Error(
        `Native document intelligence quality gate failed for ${document.recordId}. `
        + `The supplied ${document.mimeType} representation scored ${assessed.score.toFixed(3)} below ${this.threshold.toFixed(3)}. `
        + 'A higher-fidelity lawful full text is required.',
      );
    }

    const warnings = [
      `Native ${document.mimeType} source accepted directly; PDF/LiteParse spatial parsing was not applicable.`,
      'This representation has section-level rather than page-coordinate provenance; spatial quantitative extraction remains blocked.',
    ];
    const intelligence: DocumentIntelligenceMetadata = {
      hierarchyVersion: '1',
      selectedTier: 'native-structured',
      selectedBackend: document.legalAccessRoute,
      qualityScore: assessed.score,
      threshold: this.threshold,
      downgradeOccurred: false,
      attempts: [attempt],
      textLayer: 'native',
      locatorFidelity: 'section',
      tableCount: 0,
      figureCount: 0,
      warnings,
    };

    return {
      recordId: document.recordId,
      text,
      pages: chunks(text),
      sections,
      extractionMethod: 'native',
      tables: [],
      figures: [],
      documentIntelligence: intelligence,
    } as ParsedDocument;
  }
}
