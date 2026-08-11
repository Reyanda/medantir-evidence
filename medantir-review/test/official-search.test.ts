import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  PubMedAdapter,
  EuropePmcOfficialAdapter,
  ClinicalTrialsGovAdapter,
  parseMedline,
} from '../src/adapters/official-search.js';

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

const strategy = (database: string, query = 'baricitinib AND COVID-19') => ({
  database,
  platform: 'official-test',
  query,
  generatedAt: new Date().toISOString(),
});

test('parseMedline preserves PMID, title, abstract, DOI and authors', () => {
  const parsed = parseMedline(`PMID- 111\nTI  - First title\nAB  - First abstract line\n      continued abstract\nFAU - Smith, Jane\nDP  - 2021 Jan\nJT  - Journal One\nAID - 10.1000/ABC [doi]\n\nPMID- 222\nTI  - Second title\nAB  - Second abstract\nAU  - Doe J\nDP  - 2020\nJT  - Journal Two\n`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.pmid, '111');
  assert.equal(parsed[0]?.doi, '10.1000/abc');
  assert.equal(parsed[0]?.abstract, 'First abstract line continued abstract');
  assert.deepEqual(parsed[0]?.authors, ['Smith, Jane']);
});

test('parseMedline retains a PMID even when the source record has no title', () => {
  const parsed = parseMedline('PMID- 333\nDP  - 2021\nSTAT- PubMed-not-MEDLINE\n');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.pmid, '333');
  assert.match(parsed[0]?.title ?? '', /title unavailable/);
  assert.ok(parsed[0]?.keywords?.includes('source-record-warning:title-unavailable'));
});

test('PubMed adapter really performs ESearch then EFetch and reconciles all hits', async (t) => {
  let searchCalls = 0;
  let fetchCalls = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    if (req.url === '/esearch.fcgi') {
      searchCalls += 1;
      assert.equal(body.get('db'), 'pubmed');
      assert.equal(body.get('term'), 'baricitinib AND COVID-19');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ esearchresult: { count: '2', idlist: ['111', '222'] } }));
      return;
    }
    if (req.url === '/efetch.fcgi') {
      fetchCalls += 1;
      assert.equal(body.get('rettype'), 'medline');
      assert.equal(body.get('id'), '111,222');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('PMID- 111\nTI  - Trial one\nAB  - Abstract one\nFAU - Smith, Jane\nDP  - 2021\nJT  - Journal\nAID - 10.1000/one [doi]\n\nPMID- 222\nTI  - Trial two\nAB  - Abstract two\nFAU - Doe, John\nDP  - 2021\nJT  - Journal\nAID - 10.1000/two [doi]\n');
      return;
    }
    res.writeHead(404).end();
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new PubMedAdapter({ baseUrl: `http://127.0.0.1:${port}`, maxRecords: 10, fetchChunkSize: 200, email: 'test@example.org' });
  const result = await adapter.execute(strategy('pubmed'));
  assert.equal(searchCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.provenance.resultCount, 2);
  assert.equal(result.provenance.platform, 'NCBI E-utilities');
});

test('PubMed keeps a requested PMID if EFetch omits its metadata', async (t) => {
  const server = createServer(async (req, res) => {
    if (req.url === '/esearch.fcgi') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ esearchresult: { count: '2', idlist: ['111', '999'] } }));
      return;
    }
    if (req.url === '/efetch.fcgi') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('PMID- 111\nTI  - Trial one\nDP  - 2021\n');
      return;
    }
    res.writeHead(404).end();
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new PubMedAdapter({ baseUrl: `http://127.0.0.1:${port}`, maxRecords: 10, email: 'test@example.org' });
  const result = await adapter.execute(strategy('pubmed'));
  assert.equal(result.records.length, 2);
  const retained = result.records.find((record) => record.pmid === '999');
  assert.ok(retained);
  assert.match(retained.title, /metadata unavailable/);
  assert.ok(result.provenance.warnings.some((warning) => /incomplete EFetch metadata/i.test(warning)));
});

test('PubMed fails closed rather than silently truncating an oversized search', async (t) => {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ esearchresult: { count: '2', idlist: ['111'] } }));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new PubMedAdapter({ baseUrl: `http://127.0.0.1:${port}`, maxRecords: 1, email: 'test@example.org' });
  await assert.rejects(() => adapter.execute(strategy('pubmed')), /exceeding configured complete-export limit/);
});

test('Europe PMC adapter follows cursorMark until hitCount is completely exported', async (t) => {
  const cursors: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cursor = url.searchParams.get('cursorMark') ?? '*';
    cursors.push(cursor);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (cursor === '*') {
      res.end(JSON.stringify({
        hitCount: 2,
        nextCursorMark: 'NEXT',
        resultList: { result: [{ id: '1', source: 'MED', pmid: '111', title: 'EPMC one', abstractText: 'A', authorString: 'A One', pubYear: '2021' }] },
      }));
    } else {
      res.end(JSON.stringify({
        hitCount: 2,
        resultList: { result: [{ id: '2', source: 'MED', pmid: '222', title: 'EPMC two', abstractText: 'B', authorString: 'B Two', pubYear: '2021' }] },
      }));
    }
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new EuropePmcOfficialAdapter({ baseUrl: `http://127.0.0.1:${port}`, maxRecords: 10, pageSize: 1 });
  const result = await adapter.execute(strategy('europepmc'));
  assert.deepEqual(cursors, ['*', 'NEXT']);
  assert.equal(result.records.length, 2);
  assert.equal(result.provenance.resultCount, 2);
});

test('ClinicalTrials.gov adapter follows pageToken and maps NCT records', async (t) => {
  const tokens: Array<string | null> = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('pageToken');
    tokens.push(token);
    assert.equal(url.searchParams.get('countTotal'), 'true');
    res.writeHead(200, { 'content-type': 'application/json' });
    const study = (id: string, title: string) => ({
      protocolSection: {
        identificationModule: { nctId: id, briefTitle: title },
        descriptionModule: { briefSummary: `${title} summary` },
        statusModule: { studyFirstPostDateStruct: { date: '2021-06-02' } },
        sponsorCollaboratorsModule: { leadSponsor: { name: 'Example Sponsor' } },
        contactsLocationsModule: { overallOfficials: [{ name: 'Investigator One' }] },
        conditionsModule: { conditions: ['COVID-19'] },
        armsInterventionsModule: { interventions: [{ name: 'Baricitinib' }] },
      },
    });
    if (!token) {
      res.end(JSON.stringify({ totalCount: 2, studies: [study('NCT00000001', 'Trial one')], nextPageToken: 'PAGE2' }));
    } else {
      res.end(JSON.stringify({ totalCount: 2, studies: [study('NCT00000002', 'Trial two')] }));
    }
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new ClinicalTrialsGovAdapter({ baseUrl: `http://127.0.0.1:${port}`, maxRecords: 10, pageSize: 1 });
  const result = await adapter.execute(strategy('clinicaltrials.gov'));
  assert.deepEqual(tokens, [null, 'PAGE2']);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0]?.id, 'nct:nct00000001');
  assert.equal(result.provenance.platform, 'ClinicalTrials.gov API v2');
});
