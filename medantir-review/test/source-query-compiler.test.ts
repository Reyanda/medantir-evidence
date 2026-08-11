import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOfficialSearchQuery, SourceCompilingAdapter } from '../src/adapters/source-query-compiler.js';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { SearchStrategy } from '../src/core/types.js';

test('generic PRISM Boolean is compiled to PubMed title/abstract syntax', () => {
  const input = '("baricitinib" OR "ruxolitinib") AND ("COVID-19" OR "SARS-CoV-2")';
  assert.equal(
    compileOfficialSearchQuery('PubMed', input),
    '("baricitinib"[Title/Abstract] OR "ruxolitinib"[Title/Abstract]) AND ("COVID-19"[Title/Abstract] OR "SARS-CoV-2"[Title/Abstract])',
  );
});

test('generic PRISM Boolean is compiled to Europe PMC TITLE_ABS syntax', () => {
  const input = '("baricitinib" OR "ruxolitinib") AND "COVID-19"';
  assert.equal(
    compileOfficialSearchQuery('EuropePMC', input),
    '(TITLE_ABS:"baricitinib" OR TITLE_ABS:"ruxolitinib") AND TITLE_ABS:"COVID-19"',
  );
});

test('already fielded source-native queries are not rewritten', () => {
  const pubmed = '"baricitinib"[Title/Abstract] AND COVID-19[MeSH Terms]';
  const epmc = 'TITLE_ABS:"baricitinib" AND TITLE_ABS:"COVID-19"';
  assert.equal(compileOfficialSearchQuery('pubmed', pubmed), pubmed);
  assert.equal(compileOfficialSearchQuery('europepmc', epmc), epmc);
});

test('historical date ranges are compiled in each official source dialect', () => {
  const range = { start: '2019-01-01', end: '2021-06-02' };
  assert.equal(
    compileOfficialSearchQuery('PubMed', '"baricitinib"', range),
    '("baricitinib"[Title/Abstract]) AND 2019/01/01:2021/06/02[dp]',
  );
  assert.equal(
    compileOfficialSearchQuery('EuropePMC', '"baricitinib"', range),
    '(TITLE_ABS:"baricitinib") AND FIRST_PDATE:[2019-01-01 TO 2021-06-02]',
  );
  assert.equal(
    compileOfficialSearchQuery('ClinicalTrials.gov', 'baricitinib AND COVID-19', range),
    '(baricitinib AND COVID-19) AND AREA[StudyFirstPostDate]RANGE[01/01/2019, 06/02/2021]',
  );
});

test('source-compiling wrapper passes and records the compiled execution query', async () => {
  const seen: SearchStrategy[] = [];
  const inner: EvidenceSourceAdapter = {
    database: 'pubmed',
    async execute(strategy) {
      seen.push(strategy);
      return {
        records: [{ id: 'pmid:1', title: 'Example', abstract: '', authors: [], year: 2021, pmid: '1', sourceDatabases: ['pubmed'] }],
        provenance: {
          database: 'pubmed',
          platform: 'test',
          executedQuery: strategy.query,
          executedAt: new Date().toISOString(),
          resultCount: 1,
          exportFormat: 'JSON',
          warnings: [],
        },
      };
    },
  };
  const adapter = new SourceCompilingAdapter(inner);
  const result = await adapter.execute({ database: 'PubMed', platform: 'semantic', query: '"baricitinib" AND "COVID-19"', generatedAt: new Date().toISOString() });
  const observed = seen[0];
  assert.ok(observed);
  assert.equal(observed.query, '"baricitinib"[Title/Abstract] AND "COVID-19"[Title/Abstract]');
  assert.equal(result.provenance.executedQuery, observed.query);
});

test('source-compiling wrapper honors an attached historical date range', async () => {
  const seen: SearchStrategy[] = [];
  const inner: EvidenceSourceAdapter = {
    database: 'europepmc',
    async execute(strategy) {
      seen.push(strategy);
      return {
        records: [],
        provenance: {
          database: 'europepmc', platform: 'test', executedQuery: strategy.query,
          executedAt: new Date().toISOString(), resultCount: 0, exportFormat: 'JSON', warnings: [],
        },
      };
    },
  };
  const adapter = new SourceCompilingAdapter(inner);
  await adapter.execute({
    database: 'EuropePMC', platform: 'semantic', query: '"ruxolitinib" AND "COVID-19"', generatedAt: new Date().toISOString(),
    dateRange: { start: '2019-01-01', end: '2021-06-02' },
  } as SearchStrategy & { dateRange: { start: string; end: string } });
  assert.match(seen[0]?.query ?? '', /FIRST_PDATE:\[2019-01-01 TO 2021-06-02\]/);
});
