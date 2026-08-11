import test from 'node:test';
import assert from 'node:assert/strict';
import type { PdfTextExtractionPort } from '../src/core/ports.js';
import type { FullTextDocument, ParsedDocument } from '../src/core/types.js';
import { documentIntelligenceOf } from '../src/document/document-intelligence.js';
import { FormatAwareDocumentIntelligenceExtractor } from '../src/document/format-aware-document-intelligence.js';

const paragraph = 'randomized clinical trial hospitalized adults treatment placebo recovery mortality safety participants allocation follow-up analysis outcomes discussion limitations ';
const nativeText = [
  'Introduction', paragraph.repeat(12),
  'Objectives', paragraph.repeat(7),
  'Methods', paragraph.repeat(12),
  'Results', paragraph.repeat(12),
  'Discussion', paragraph.repeat(10),
  'Limitations', paragraph.repeat(6),
].join('\n');

function source(overrides: Partial<FullTextDocument> = {}): FullTextDocument {
  return {
    recordId: 'pmid:1',
    uri: 'https://europepmc.org/article/PMC/PMC1',
    mimeType: 'text/plain',
    content: nativeText,
    retrievedAt: '2026-08-09T00:00:00.000Z',
    legalAccessRoute: 'Europe PMC open access',
    ...overrides,
  };
}

class CountingPdfExtractor implements PdfTextExtractionPort {
  calls = 0;
  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    this.calls += 1;
    return {
      recordId: document.recordId,
      text: 'pdf parse',
      pages: [{ page: 1, text: 'pdf parse' }],
      sections: [{ name: 'other', heading: 'PDF', pageStart: 1, pageEnd: 1, text: 'pdf parse' }],
      extractionMethod: 'native',
    };
  }
}

test('native lawful full text is quality-gated directly without calling the PDF parser', async () => {
  const pdf = new CountingPdfExtractor();
  const extractor = new FormatAwareDocumentIntelligenceExtractor({ pdfExtractor: pdf, acceptThreshold: 0.5 });
  const parsed = await extractor.extract(source());
  const intelligence = documentIntelligenceOf(parsed);

  assert.equal(pdf.calls, 0);
  assert.equal(parsed.text, nativeText.trim());
  assert.equal(intelligence?.selectedTier, 'native-structured');
  assert.equal(intelligence?.selectedBackend, 'Europe PMC open access');
  assert.equal(intelligence?.downgradeOccurred, false);
  assert.equal(intelligence?.locatorFidelity, 'section');
  assert.equal(intelligence?.attempts.length, 1);
  assert.equal(intelligence?.attempts[0]?.tier, 'native-structured');
  assert.ok(intelligence?.warnings.some((warning) => /spatial quantitative extraction remains blocked/i.test(warning)));
});

test('PDFs still obey the delegated LiteParse-first spatial hierarchy', async () => {
  const pdf = new CountingPdfExtractor();
  const extractor = new FormatAwareDocumentIntelligenceExtractor({ pdfExtractor: pdf, acceptThreshold: 0.5 });
  const pdfSource = source({ mimeType: 'application/pdf' });
  delete pdfSource.content;
  const parsed = await extractor.extract(pdfSource);

  assert.equal(pdf.calls, 1);
  assert.equal(parsed.text, 'pdf parse');
});

test('short or structurally poor native text fails closed instead of being mislabeled as high-quality full text', async () => {
  const pdf = new CountingPdfExtractor();
  const extractor = new FormatAwareDocumentIntelligenceExtractor({ pdfExtractor: pdf, acceptThreshold: 0.7 });

  await assert.rejects(
    () => extractor.extract(source({ content: 'tiny native text' })),
    /Native document intelligence quality gate failed/,
  );
  assert.equal(pdf.calls, 0);
});
