import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryHistoricalObjectStore } from '../src/historical/object-archive.js';
import { captureHistoricalHttpObject } from '../src/historical/http-object-capture.js';
import {
  extractHistoricalJatsTables,
  findHistoricalJatsRow,
  requireHistoricalJatsTable,
} from '../src/historical/jats-table-extractor.js';

const xml = `<?xml version="1.0"?>
<article>
  <body>
    <table-wrap id="T3">
      <label>Table 3</label>
      <caption><title>Quality &amp; appraisal</title></caption>
      <table>
        <thead><tr><th>Study</th><th>Total score</th><th>Interpretation</th></tr></thead>
        <tbody>
          <tr><td>Cantini F et al. 2020 (a)</td><td><bold>1</bold></td><td>Low quality</td></tr>
          <tr><td>Cao Y et al. 2020</td><td>7</td><td>High quality</td></tr>
        </tbody>
      </table>
    </table-wrap>
  </body>
</article>`;

test('raw historical HTTP capture archives exact response bytes and records a semantic response receipt', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const captured = await captureHistoricalHttpObject({
    store,
    url: 'https://example.org/fullTextXML',
    capturedAt: '2026-08-10T12:00:00Z',
    metadata: { role: 'fulltext-source', mediaType: 'application/xml', recordId: 'PMC1', accessClass: 'public' },
    fetchImpl: async () => new Response(xml, {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', etag: '"abc"', 'last-modified': 'Mon, 01 Jun 2021 00:00:00 GMT' },
    }),
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.object.byteLength, new TextEncoder().encode(xml).byteLength);
  assert.match(captured.object.sha256, /^[a-f0-9]{64}$/);
  assert.match(captured.responseContractHash, /^[a-f0-9]{64}$/);
  assert.equal(new TextDecoder().decode(await store.get(captured.object)), xml);
});

test('historical HTTP capture rejects non-HTTPS, errors and empty source bodies', async () => {
  const store = new InMemoryHistoricalObjectStore();
  await assert.rejects(() => captureHistoricalHttpObject({
    store, url: 'http://example.org', metadata: { role: 'fulltext-source', mediaType: 'text/plain', accessClass: 'public' },
  }), /requires an HTTPS URL/i);
  await assert.rejects(() => captureHistoricalHttpObject({
    store, url: 'https://example.org/error', metadata: { role: 'fulltext-source', mediaType: 'text/plain', accessClass: 'public' },
    fetchImpl: async () => new Response('no', { status: 503 }),
  }), /HTTP 503/i);
  await assert.rejects(() => captureHistoricalHttpObject({
    store, url: 'https://example.org/empty', metadata: { role: 'fulltext-source', mediaType: 'text/plain', accessClass: 'public' },
    fetchImpl: async () => new Response('', { status: 200 }),
  }), /empty body/i);
});

test('JATS table extractor preserves deterministic cell sequence plus raw table/row hashes', () => {
  const tables = extractHistoricalJatsTables(xml);
  assert.equal(tables.length, 1);
  const table = requireHistoricalJatsTable(tables, 'Table 3');
  assert.equal(table.caption, 'Quality & appraisal');
  assert.deepEqual(table.rows[0]?.cells, ['Study', 'Total score', 'Interpretation']);
  assert.deepEqual(table.rows[1]?.cells, ['Cantini F et al. 2020 (a)', '1', 'Low quality']);
  assert.match(table.tableFragmentSha256, /^[a-f0-9]{64}$/);
  assert.match(table.structureHash, /^[a-f0-9]{64}$/);
  assert.match(table.rows[1]!.sourceFragmentSha256, /^[a-f0-9]{64}$/);
  assert.equal(findHistoricalJatsRow(table, 'Cantini F').rowIndex, 1);
});

test('JATS table identity tolerates terminal label punctuation only', () => {
  const punctuated = xml.replace('<label>Table 3</label>', '<label>Table 3.</label>');
  const table = requireHistoricalJatsTable(extractHistoricalJatsTables(punctuated), 'Table 3');
  assert.equal(table.label, 'Table 3.');
  assert.throws(() => requireHistoricalJatsTable(extractHistoricalJatsTables(punctuated), 'Table 4'), /found 0/i);
});

test('JATS exact row lookup fails closed on absent or ambiguous labels', () => {
  const table = requireHistoricalJatsTable(extractHistoricalJatsTables(xml), 'Table 3');
  assert.throws(() => findHistoricalJatsRow(table, 'missing'), /found 0/i);
  assert.throws(() => findHistoricalJatsRow(table, '2020'), /found 2/i);
});
