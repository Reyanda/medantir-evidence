import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { EvidenceRecord, SearchStrategy } from '../src/core/types.js';
import { createHistoricalReplayCapsule } from '../src/historical/replay-capsule.js';
import {
  captureHistoricalEvidenceSources,
  replayHistoricalEvidenceSources,
} from '../src/historical/replay-runner.js';
import { buildHistoricalReplayCertificate } from '../src/historical/replay-certificate.js';

const strategy = (database: string, generatedAt = '2021-06-02T00:00:00Z'): SearchStrategy => ({
  database,
  platform: database,
  query: `"historical-${database}"`,
  generatedAt,
});

function adapter(database: string, id: string): EvidenceSourceAdapter {
  const record: EvidenceRecord = {
    id,
    title: `Historical ${database} record`,
    abstract: 'Frozen evidence.',
    authors: ['Reviewer A'],
    year: 2021,
    sourceDatabases: [database],
  };
  return {
    database,
    async execute(search) {
      return {
        records: [record],
        provenance: {
          database,
          platform: database,
          executedQuery: search.query,
          executedAt: '2021-06-02T12:00:00Z',
          resultCount: 1,
          exportFormat: 'JSON',
          warnings: [],
        },
      };
    },
  };
}

test('strict capsule capture requires one strategy for every adapter and no orphan strategies', async () => {
  await assert.rejects(
    () => captureHistoricalEvidenceSources([adapter('pubmed', 'p1')], []),
    /requires a search strategy/i,
  );
  await assert.rejects(
    () => captureHistoricalEvidenceSources(
      [adapter('pubmed', 'p1')],
      [strategy('pubmed'), strategy('europepmc')],
    ),
    /strategies without source adapters/i,
  );
});

test('captured source set replays offline with identical source hashes despite new generation timestamps', async () => {
  const strategies = [strategy('pubmed'), strategy('europepmc')];
  const captured = await captureHistoricalEvidenceSources(
    [adapter('pubmed', 'p1'), adapter('europepmc', 'e1')],
    strategies,
  );
  const capsule = createHistoricalReplayCapsule({
    benchmarkId: 'offline-fixture',
    historicalCutoff: '2021-06-02',
    sources: captured.sources,
  });

  const replay = await replayHistoricalEvidenceSources(
    capsule,
    [strategy('pubmed', '2030-01-01T00:00:00Z'), strategy('europepmc', '2030-01-01T00:00:00Z')],
  );
  assert.deepEqual(
    replay.sources.map((source) => source.snapshotHash),
    captured.sources.map((source) => source.snapshotHash),
  );
  assert.deepEqual(replay.records, captured.records);
  const certificate = buildHistoricalReplayCertificate({ capsule, actualSources: replay.sources });
  assert.equal(certificate.exactMachineReplay, true);
});

test('offline replay rejects semantic search drift before returning frozen evidence', async () => {
  const captured = await captureHistoricalEvidenceSources([adapter('pubmed', 'p1')], [strategy('pubmed')]);
  const capsule = createHistoricalReplayCapsule({
    benchmarkId: 'offline-fixture',
    historicalCutoff: '2021-06-02',
    sources: captured.sources,
  });
  await assert.rejects(
    () => replayHistoricalEvidenceSources(capsule, [{ ...strategy('pubmed'), query: '"changed"' }]),
    /search contract drift/i,
  );
});
