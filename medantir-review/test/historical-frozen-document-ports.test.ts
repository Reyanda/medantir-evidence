import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceRecord, FullTextDocument, ParsedDocument } from '../src/core/types.js';
import type { PdfTextExtractionPort } from '../src/core/ports.js';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { InMemoryHistoricalObjectStore } from '../src/historical/object-archive.js';
import {
  archiveHistoricalFullTexts,
  archiveHistoricalParsedDocuments,
} from '../src/historical/evidence-plane-archive.js';
import {
  FrozenHistoricalFullTextRetrievalPort,
  FrozenHistoricalParsedDocumentPort,
  historicalParserCheckpoint,
  verifyHistoricalParserReplay,
} from '../src/historical/frozen-document-ports.js';

const record: EvidenceRecord = {
  id: 'r1', title: 'Historical trial', abstract: 'Trial.', authors: [], year: 2021, sourceDatabases: ['pubmed'],
};
const fullText: FullTextDocument = {
  recordId: 'r1',
  uri: 'https://example.org/r1.pdf',
  mimeType: 'application/pdf',
  content: 'historical full text',
  retrievedAt: '2021-06-01T00:00:00Z',
  legalAccessRoute: 'open-access',
};
const parsed: ParsedDocument = {
  recordId: 'r1',
  text: 'historical full text',
  pages: [{ page: 1, text: 'historical full text' }],
  sections: [{ name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: 'historical full text' }],
  extractionMethod: 'native',
};

test('standard MEDANTIR retrieval/parser ports can replay frozen document bodies with zero network dependency', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [fullReceipt] = await archiveHistoricalFullTexts(store, [fullText]);
  const [parsedReceipt] = await archiveHistoricalParsedDocuments(store, [parsed]);
  assert.ok(fullReceipt && parsedReceipt);

  const retrieval = new FrozenHistoricalFullTextRetrievalPort(store, [fullReceipt]);
  const parsing = new FrozenHistoricalParsedDocumentPort(store, [parsedReceipt]);
  const restoredFullText = await retrieval.retrieve(record);
  assert.deepEqual(restoredFullText, fullText);
  assert.deepEqual(await parsing.extract(restoredFullText!), parsed);
});

test('exact historical retrieval fails when pipeline asks for a record absent from the archive', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const retrieval = new FrozenHistoricalFullTextRetrievalPort(store, []);
  await assert.rejects(() => retrieval.retrieve(record), /no frozen full-text object/i);
});

test('parser verification re-runs from exact source bytes and certifies matching parser contract/output', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [fullReceipt] = await archiveHistoricalFullTexts(store, [fullText]);
  const [parsedReceipt] = await archiveHistoricalParsedDocuments(store, [parsed]);
  assert.ok(fullReceipt && parsedReceipt);
  const checkpoint = historicalParserCheckpoint({ fullText: fullReceipt, parsed: parsedReceipt, parserContractHash: 'parser-v1' });
  const parser: PdfTextExtractionPort = { async extract(document) { return { ...parsed, text: document.content ?? '' }; } };
  const certificate = await verifyHistoricalParserReplay({
    store, fullTextReceipt: fullReceipt, parsedReceipt, checkpoint, parser, parserContractHash: 'parser-v1',
  });
  assert.equal(certificate.exact, true);
  assert.equal(certificate.actualParsedHash, scientificContentHash(parsed));
});

test('parser contract drift is localized before parser execution', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [fullReceipt] = await archiveHistoricalFullTexts(store, [fullText]);
  const [parsedReceipt] = await archiveHistoricalParsedDocuments(store, [parsed]);
  assert.ok(fullReceipt && parsedReceipt);
  const checkpoint = historicalParserCheckpoint({ fullText: fullReceipt, parsed: parsedReceipt, parserContractHash: 'parser-v1' });
  let called = false;
  const parser: PdfTextExtractionPort = { async extract() { called = true; return parsed; } };
  const certificate = await verifyHistoricalParserReplay({
    store, fullTextReceipt: fullReceipt, parsedReceipt, checkpoint, parser, parserContractHash: 'parser-v2',
  });
  assert.equal(certificate.exact, false);
  assert.equal(certificate.parserContractMatches, false);
  assert.equal(called, false);
});

test('same parser contract with changed parse output is a parser-output divergence', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [fullReceipt] = await archiveHistoricalFullTexts(store, [fullText]);
  const [parsedReceipt] = await archiveHistoricalParsedDocuments(store, [parsed]);
  assert.ok(fullReceipt && parsedReceipt);
  const checkpoint = historicalParserCheckpoint({ fullText: fullReceipt, parsed: parsedReceipt, parserContractHash: 'parser-v1' });
  const parser: PdfTextExtractionPort = { async extract() { return { ...parsed, text: 'changed parser output' }; } };
  const certificate = await verifyHistoricalParserReplay({
    store, fullTextReceipt: fullReceipt, parsedReceipt, checkpoint, parser, parserContractHash: 'parser-v1',
  });
  assert.equal(certificate.sourceObjectMatches, true);
  assert.equal(certificate.parserContractMatches, true);
  assert.equal(certificate.parsedDocumentMatches, false);
  assert.equal(certificate.exact, false);
});
