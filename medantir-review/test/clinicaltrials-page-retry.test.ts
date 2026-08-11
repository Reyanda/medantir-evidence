import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ClinicalTrialsGovAdapter } from '../src/adapters/official-search.js';

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

const strategy = {
  database: 'clinicaltrials.gov',
  platform: 'official-test',
  query: 'baricitinib AND COVID-19',
  generatedAt: '2026-08-10T00:00:00.000Z',
};

function study(id: string, title: string) {
  return {
    protocolSection: {
      identificationModule: { nctId: id, briefTitle: title },
      descriptionModule: { briefSummary: `${title} summary` },
      statusModule: { studyFirstPostDateStruct: { date: '2021-06-02' } },
      sponsorCollaboratorsModule: { leadSponsor: { name: 'Example Sponsor' } },
      contactsLocationsModule: { overallOfficials: [{ name: 'Investigator One' }] },
      conditionsModule: { conditions: ['COVID-19'] },
      armsInterventionsModule: { interventions: [{ name: 'Baricitinib' }] },
    },
  };
}

test('ClinicalTrials retries a failed page token without replaying successful earlier pages', async (t) => {
  const tokens: Array<string | null> = [];
  let page2Attempts = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('pageToken');
    tokens.push(token);
    if (!token) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        totalCount: 2,
        studies: [study('NCT00000001', 'Trial one')],
        nextPageToken: 'PAGE2',
      }));
      return;
    }
    page2Attempts += 1;
    if (page2Attempts === 1) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'temporary failure' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      totalCount: 2,
      studies: [study('NCT00000002', 'Trial two')],
    }));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new ClinicalTrialsGovAdapter({
    baseUrl: `http://127.0.0.1:${port}`,
    maxRecords: 10,
    pageSize: 1,
    maxPageAttempts: 3,
    baseRetryDelayMs: 0,
    maxRetryDelayMs: 0,
    sleep: async () => {},
  });

  const result = await adapter.execute(strategy);

  assert.deepEqual(tokens, [null, 'PAGE2', 'PAGE2']);
  assert.equal(result.records.length, 2);
  assert.ok(result.provenance.warnings.some((warning) => /page token PAGE2 failure recovered after 2 attempt/i.test(warning)));
});

test('ClinicalTrials does not retry non-transient 4xx query failures', async (t) => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid query' }));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new ClinicalTrialsGovAdapter({
    baseUrl: `http://127.0.0.1:${port}`,
    maxPageAttempts: 5,
    baseRetryDelayMs: 0,
    maxRetryDelayMs: 0,
    sleep: async () => {},
  });

  await assert.rejects(() => adapter.execute(strategy), /HTTP 400/);
  assert.equal(calls, 1);
});

test('ClinicalTrials honors Retry-After for retryable responses within the configured delay ceiling', async (t) => {
  let calls = 0;
  const delays: number[] = [];
  const server = createServer((_req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: 'rate limited' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ totalCount: 1, studies: [study('NCT00000003', 'Trial three')] }));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listen(server);
  const adapter = new ClinicalTrialsGovAdapter({
    baseUrl: `http://127.0.0.1:${port}`,
    maxRecords: 10,
    maxPageAttempts: 3,
    baseRetryDelayMs: 10,
    maxRetryDelayMs: 1500,
    sleep: async (ms) => { delays.push(ms); },
  });

  const result = await adapter.execute(strategy);

  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
  assert.equal(result.records.length, 1);
  assert.ok(result.provenance.warnings.some((warning) => /HTTP 429/i.test(warning)));
});
