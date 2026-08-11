import test from 'node:test';
import assert from 'node:assert/strict';
import type { FullTextDocument, ParsedDocument } from '../src/core/types.js';
import { InMemoryHistoricalObjectStore } from '../src/historical/object-archive.js';
import {
  archiveHistoricalFullTexts,
  archiveHistoricalParsedDocuments,
  restoreHistoricalFullTexts,
  restoreHistoricalParsedDocuments,
  verifierHistoricalObjectReceipt,
} from '../src/historical/evidence-plane-archive.js';

const fullText: FullTextDocument = {
  recordId: 'r1',
  uri: 'https://example.org/article.pdf',
  mimeType: 'application/pdf',
  content: '%PDF-1.7\nfixture historical bytes\n%%EOF',
  retrievedAt: '2021-06-02T10:00:00Z',
  legalAccessRoute: 'open-access',
};

const parsed: ParsedDocument = {
  recordId: 'r1',
  text: 'Methods\nHistorical trial.\nResults\nRR 0.5.',
  pages: [
    { page: 1, text: 'Methods\nHistorical trial.' },
    { page: 2, text: 'Results\nRR 0.5.' },
  ],
  sections: [
    { name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: 'Historical trial.' },
    { name: 'results', heading: 'Results', pageStart: 2, pageEnd: 2, text: 'RR 0.5.' },
  ],
  extractionMethod: 'native',
};

test('historical full-text archive restores byte-identical source and verifier projection omits body/storage locator', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [receipt] = await archiveHistoricalFullTexts(store, [fullText]);
  assert.ok(receipt);
  const restored = await restoreHistoricalFullTexts(store, [receipt!]);
  assert.deepEqual(restored, [fullText]);

  const verifier = verifierHistoricalObjectReceipt(receipt!.object);
  assert.equal('storageReference' in verifier, false);
  assert.equal('sourceUri' in verifier, false);
  assert.equal('content' in verifier, false);
  assert.equal(verifier.sha256.length, 64);
  assert.equal(verifier.accessClass, 'restricted-source');
});

test('historical object archive fails closed when one stored byte changes', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [receipt] = await archiveHistoricalFullTexts(store, [fullText]);
  assert.ok(receipt);
  store.corruptForTest(receipt!.object.objectId, new TextEncoder().encode('corrupted'));
  await assert.rejects(
    () => restoreHistoricalFullTexts(store, [receipt!]),
    /integrity verification/i,
  );
});

test('parser outputs can be archived and independently hash-verified before reuse', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const [receipt] = await archiveHistoricalParsedDocuments(store, [parsed]);
  assert.ok(receipt);
  const restored = await restoreHistoricalParsedDocuments(store, [receipt!]);
  assert.deepEqual(restored, [parsed]);
});

test('missing full-text body cannot be promoted to an exact historical archive receipt', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const withoutBody: FullTextDocument = { ...fullText };
  delete withoutBody.content;
  await assert.rejects(
    () => archiveHistoricalFullTexts(store, [withoutBody]),
    /no captured body/i,
  );
});
