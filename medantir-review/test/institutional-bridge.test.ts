import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BridgeBrowserAutomationPort,
  DATABASE_RECIPES,
  institutionalAdapterFor,
  parseRis,
} from '../src/adapters/institutional.js';

const AUTH = { token: 'verified-token', projectId: 'proj-7' };

// The factory falls back to this env var; ensure the "unconfigured" branch is testable.
delete process.env.REVIEW_BRIDGE_URL;

/** Replace globalThis.fetch with a stub for the duration of fn. */
async function withFetch(
  stub: (input: any, init: any) => Promise<Response>,
  fn: (calls: Array<{ input: any; init: any }>) => Promise<void> | void,
) {
  const original = globalThis.fetch;
  const calls: Array<{ input: any; init: any }> = [];
  (globalThis as any).fetch = async (input: any, init: any) => {
    calls.push({ input, init });
    return stub(input, init);
  };
  try {
    await fn(calls);
  } finally {
    (globalThis as any).fetch = original;
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const INPUT = { database: 'scopus', platform: 'Scopus', query: 'stroke rehabilitation', allowedExportFormats: ['RIS'] };

test('forwards the verified bearer token and project header to the bridge', async () => {
  const port = new BridgeBrowserAutomationPort('http://bridge:10086/', DATABASE_RECIPES, AUTH);
  await withFetch(
    async () => jsonResponse({ records: [], resultCount: 0, warnings: [] }),
    async (calls) => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.equal(calls.length, 1);
      const { input, init } = calls[0]!;
      assert.equal(input, 'http://bridge:10086/command');
      assert.equal(init.headers.authorization, 'Bearer verified-token');
      assert.equal(init.headers['x-actiora-project'], 'proj-7');
      assert.equal(init.headers['x-medantir-sudo'], undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.action, 'db_search');
      assert.equal(body.session, 'db/scopus/qmul');
      assert.equal(result.warnings.length, 0);
    },
  );
});

test('returns AUTH REQUIRED without a network call when no identity was forwarded', async () => {
  const port = new BridgeBrowserAutomationPort('http://bridge:10086', DATABASE_RECIPES);
  await withFetch(
    async () => { throw new Error('must not be called'); },
    async (calls) => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.equal(calls.length, 0);
      assert.equal(result.records.length, 0);
      assert.ok(result.warnings[0]!.includes('AUTH REQUIRED'));
    },
  );
});

test('maps the structured needsAuth signal to an actionable warning', async () => {
  const port = new BridgeBrowserAutomationPort('http://bridge:10086', DATABASE_RECIPES, AUTH);
  await withFetch(
    async () => jsonResponse({
      records: [], resultCount: 0, executedQuery: INPUT.query, needsAuth: true,
      warnings: ["AUTH REQUIRED: Scopus session 'db/scopus/qmul' missing or expired"],
    }),
    async () => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.equal(result.records.length, 0);
      assert.ok(result.warnings[0]!.includes('AUTH REQUIRED'));
      assert.ok(result.warnings[0]!.includes('db/scopus/qmul'));
    },
  );
});

test('maps bridge 401/403 to a token-expired warning', async () => {
  const port = new BridgeBrowserAutomationPort('http://bridge:10086', DATABASE_RECIPES, AUTH);
  await withFetch(
    async () => new Response('{"error":"Invalid or expired access token"}', { status: 401 }),
    async () => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.ok(result.warnings[0]!.includes('sign-in expired'));
    },
  );
});

test('prefers native RIS export over scraped records', async () => {
  const ris = [
    'TY  - JOUR', 'TI  - RIS imported title', 'AU  - Smith, Jane', 'PY  - 2024',
    'JO  - Lancet', 'DO  - 10.1000/xyz', 'AB  - Full abstract text', 'ER  - ',
  ].join('\n');
  const port = new BridgeBrowserAutomationPort('http://bridge:10086', DATABASE_RECIPES, AUTH);
  await withFetch(
    async () => jsonResponse({
      ris, exportUsed: true, executedQuery: INPUT.query, resultCount: 1,
      records: [{ id: 'scraped', title: 'Scraped title', abstract: '', authors: [], year: 0, sourceDatabases: ['scopus'] }],
      warnings: [],
    }),
    async () => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0]!.title, 'RIS imported title');
      assert.equal(result.records[0]!.doi, '10.1000/xyz');
      assert.equal(result.records[0]!.year, 2024);
      assert.deepEqual(result.records[0]!.authors, ['Smith, Jane']);
    },
  );
});

test('falls back to scraped records when no RIS is present', async () => {
  const port = new BridgeBrowserAutomationPort('http://bridge:10086', DATABASE_RECIPES, AUTH);
  await withFetch(
    async () => jsonResponse({
      records: [{ id: 'scraped', title: 'Scraped title', abstract: '', authors: [], year: 0, sourceDatabases: ['scopus'] }],
      resultCount: 1, warnings: [],
    }),
    async () => {
      const result = await port.runDatabaseSearch(INPUT);
      assert.equal(result.records[0]!.title, 'Scraped title');
    },
  );
});

test('parseRis maps common tags and drops titleless entries', () => {
  const ris = [
    'TY  - JOUR', 'TI  - First study', 'A1  - Doe, J', 'Y1  - 2023', 'AN  - 38001234', 'ER  - ',
    'TY  - JOUR', 'AB  - No title here', 'ER  - ',
    'TY  - JOUR', 'T1  - Second study', 'DO  - https://doi.org/10.1/ABC', 'ER  - ',
  ].join('\n');
  const records = parseRis(ris, 'cinahl');
  assert.equal(records.length, 2);
  assert.equal(records[0]!.pmid, '38001234');
  assert.equal(records[1]!.title, 'Second study');
  assert.equal(records[1]!.doi, '10.1/abc');
  assert.equal(records[1]!.id, '10.1/abc');
});

test('factory wires auth through, or reports an explicit gap without a bridge URL', async () => {
  assert.equal(institutionalAdapterFor('pubmed', { bridgeUrl: 'http://x' }), null);
  const unconfigured = institutionalAdapterFor('wos', { bridgeUrl: undefined });
  assert.ok(unconfigured);
  const outcome = await unconfigured!.execute({ query: 'q' } as any);
  assert.ok(outcome.provenance.warnings[0]!.includes('AUTH REQUIRED'));
  const wired = institutionalAdapterFor('wos', { bridgeUrl: 'http://bridge:10086', auth: AUTH });
  assert.ok(wired);
});
