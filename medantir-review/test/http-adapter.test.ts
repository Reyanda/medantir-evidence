import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpEvidenceSourceAdapter } from '../src/adapters/http-evidence-source.js';
import { fixtureRecords } from '../src/fixtures.js';

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

test('executes a search through the HTTP adapter and reconciles records', async (t) => {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query: string };
    assert.ok(payload.query.includes('malnutrition'));
    const body = JSON.stringify({ records: fixtureRecords.slice(0, 2), count: 2 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new HttpEvidenceSourceAdapter({
    database: 'PubMed',
    endpoint: `http://127.0.0.1:${port}/search`,
    mapResponse: (payload) => {
      const value = payload as { records: typeof fixtureRecords; count: number };
      return { records: value.records, resultCount: value.count };
    },
  });
  const result = await adapter.execute({
    database: 'PubMed',
    platform: 'Test API',
    query: 'malnutrition',
    generatedAt: new Date().toISOString(),
  });
  assert.equal(result.records.length, 2);
  assert.equal(result.provenance.resultCount, 2);
});
