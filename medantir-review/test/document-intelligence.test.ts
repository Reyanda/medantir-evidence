import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HierarchicalDocumentIntelligenceExtractor,
  documentIntelligenceOf,
  type DocumentSpatialPage,
} from '../src/document/document-intelligence.js';
import type { FullTextDocument } from '../src/core/types.js';

function document(content = 'Native fallback content'): FullTextDocument {
  return {
    recordId: 'pmid:1',
    uri: 'https://example.org/paper',
    mimeType: 'text/plain',
    content,
    retrievedAt: new Date().toISOString(),
    legalAccessRoute: 'Europe PMC open access',
  };
}

const richParagraph = 'randomized clinical trial hospitalized adults treatment placebo recovery mortality safety participants allocation follow-up analysis outcomes discussion limitations ';
const tableMarkdown = [
  '| Group | N | Outcome |',
  '| --- | --- | --- |',
  '| Baricitinib | 100 | Recovery |',
  '| Control | 100 | Recovery |',
].join('\n');
const richMarkdown = [
  '# Introduction', richParagraph.repeat(12),
  '# Objectives', richParagraph.repeat(8),
  '# Methods', richParagraph.repeat(12),
  tableMarkdown,
  '# Results', richParagraph.repeat(12),
  '![Kaplan-Meier curve](https://example.org/figure1.png)',
  '# Discussion', richParagraph.repeat(10),
  '# Limitations', richParagraph.repeat(6),
].join('\n\n');

test('LiteParse is attempted first and accepted structured output wins over native text', async () => {
  let calls = 0;
  const extractor = new HierarchicalDocumentIntelligenceExtractor({
    acceptThreshold: 0.5,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ markdown: richMarkdown }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const parsed = await extractor.extract(document('This native text must not win while LiteParse passes. '.repeat(200)));
  const intelligence = documentIntelligenceOf(parsed);

  assert.equal(calls, 1);
  assert.equal(intelligence?.selectedTier, 'liteparse-structured');
  assert.equal(intelligence?.downgradeOccurred, false);
  assert.ok((intelligence?.qualityScore ?? 0) >= 0.5);
  assert.match(parsed.text, /randomized clinical trial/);
  const enriched = parsed as typeof parsed & { tables?: unknown[]; figures?: unknown[] };
  assert.ok((enriched.tables?.length ?? 0) >= 1);
  assert.ok((enriched.figures?.length ?? 0) >= 1);
});

test('LiteParse textItems survive as top-left 72-DPI page-coordinate provenance', async () => {
  const extractor = new HierarchicalDocumentIntelligenceExtractor({
    acceptThreshold: 0.5,
    fetchImpl: async () => new Response(JSON.stringify({
      markdown: richMarkdown,
      pages: [{
        page: 4,
        width: 612,
        height: 792,
        text: 'Mortality 1.20 0.90 1.60',
        textItems: [
          { text: 'Mortality', x: 72, y: 220, width: 55, height: 11 },
          { text: '1.20', x: 330, y: 220, width: 24, height: 11 },
          { text: '0.90', x: 365, y: 220, width: 24, height: 11 },
          { text: '1.60', x: 400, y: 220, width: 24, height: 11 },
        ],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  const parsed = await extractor.extract(document('native fallback '.repeat(1000)));
  const intelligence = documentIntelligenceOf(parsed);
  const spatial = (parsed as typeof parsed & { spatialPages?: DocumentSpatialPage[] }).spatialPages;

  assert.equal(intelligence?.locatorFidelity, 'page-coordinate');
  assert.equal(intelligence?.coordinateSystem, 'top-left-72dpi');
  assert.equal(intelligence?.spatialPageCount, 1);
  assert.equal(intelligence?.spatialTextItemCount, 4);
  assert.equal(spatial?.[0]?.page, 4);
  assert.equal(spatial?.[0]?.width, 612);
  assert.equal(spatial?.[0]?.height, 792);
  assert.deepEqual(spatial?.[0]?.textItems[0], {
    text: 'Mortality',
    page: 4,
    x: 72,
    y: 220,
    width: 55,
    height: 11,
    coordinateSystem: 'top-left-72dpi',
  });
});

test('page text without valid coordinate boxes remains page-level rather than claiming spatial fidelity', async () => {
  const extractor = new HierarchicalDocumentIntelligenceExtractor({
    acceptThreshold: 0.5,
    fetchImpl: async () => new Response(JSON.stringify({
      markdown: richMarkdown,
      pages: [{ page: 2, text: 'Results', textItems: [{ text: 'Results', x: -1, y: 30, width: 40, height: 10 }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  const parsed = await extractor.extract(document('native fallback '.repeat(1000)));
  const intelligence = documentIntelligenceOf(parsed);

  assert.equal(intelligence?.locatorFidelity, 'page');
  assert.equal(intelligence?.spatialTextItemCount, undefined);
  assert.ok(intelligence?.warnings.some((warning) => /without usable text-item coordinates/i.test(warning)));
});

test('native structured text is a recorded downgrade only after LiteParse quality failure', async () => {
  const native = [
    'Introduction', richParagraph.repeat(10),
    'Objectives', richParagraph.repeat(6),
    'Methods', richParagraph.repeat(10),
    'Results', richParagraph.repeat(10),
    'Discussion', richParagraph.repeat(8),
    'Limitations', richParagraph.repeat(5),
  ].join('\n');
  const extractor = new HierarchicalDocumentIntelligenceExtractor({
    acceptThreshold: 0.5,
    fetchImpl: async () => new Response(JSON.stringify({ markdown: 'broken' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  const parsed = await extractor.extract(document(native));
  const intelligence = documentIntelligenceOf(parsed);

  assert.equal(intelligence?.selectedTier, 'native-structured');
  assert.equal(intelligence?.downgradeOccurred, true);
  assert.equal(intelligence?.attempts[0]?.tier, 'liteparse-structured');
  assert.equal(intelligence?.attempts[0]?.accepted, false);
  assert.equal(intelligence?.attempts[1]?.tier, 'native-structured');
  assert.equal(intelligence?.attempts[1]?.accepted, true);
  assert.ok(intelligence?.warnings.some((warning) => warning.includes('downgraded')));
});

test('document parsing fails closed when neither LiteParse nor lower tier meets quality', async () => {
  const extractor = new HierarchicalDocumentIntelligenceExtractor({
    acceptThreshold: 0.8,
    fetchImpl: async () => new Response(JSON.stringify({ markdown: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    () => extractor.extract(document('tiny')),
    /Document intelligence quality gate failed/,
  );
});
