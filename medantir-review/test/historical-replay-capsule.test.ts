import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../src/core/types.js';
import {
  captureHistoricalSourceSnapshot,
  createHistoricalReplayCapsule,
  FrozenHistoricalEvidenceSourceAdapter,
  historicalProvenanceContractHash,
  historicalStrategyContractHash,
  verifyHistoricalReplayCapsule,
  type HistoricalPublicationSearchClaim,
} from '../src/historical/replay-capsule.js';
import {
  buildHistoricalReplayCertificate,
  historicalCheckpoint,
} from '../src/historical/replay-certificate.js';

const record: EvidenceRecord = {
  id: 'pmid:123',
  title: 'Historical randomized trial',
  abstract: 'Adults were randomized to treatment or control.',
  authors: ['Example A'],
  year: 2021,
  journal: 'Historical Medicine',
  pmid: '123',
  doi: '10.1000/historical.123',
  sourceDatabases: ['pubmed'],
};

const datedStrategy = (generatedAt = '2026-08-10T10:00:00.000Z'): SearchStrategy & { dateRange: { start: string; end: string } } => ({
  database: 'pubmed',
  platform: 'PubMed',
  purpose: 'primary-studies',
  query: '("JAK inhibitor"[Title/Abstract]) AND ("COVID-19"[Title/Abstract])',
  generatedAt,
  dateRange: { start: '2019-01-01', end: '2021-06-02' },
});

const provenance = (executedAt = '2026-08-10T10:01:00.000Z'): SearchProvenance => ({
  database: 'pubmed',
  platform: 'PubMed E-utilities',
  executedQuery: '(("JAK inhibitor"[Title/Abstract]) AND ("COVID-19"[Title/Abstract])) AND 2019/01/01:2021/06/02[dp]',
  executedAt,
  resultCount: 1,
  exportFormat: 'JSON',
  warnings: [],
});

const publicationClaim = (overrides: Partial<HistoricalPublicationSearchClaim> = {}): HistoricalPublicationSearchClaim => ({
  database: 'pubmed',
  platform: 'PubMed',
  reportedResultCount: 1,
  queryAvailable: true,
  dateRestrictionAvailable: true,
  languageRestrictionAvailable: true,
  manualSearchesDisclosed: true,
  sourceReference: 'published-table-1',
  ...overrides,
});

test('historical search identity ignores wall-clock generation/execution timestamps', () => {
  assert.equal(historicalStrategyContractHash(datedStrategy('2021-06-02T12:00:00Z')), historicalStrategyContractHash(datedStrategy('2026-08-10T12:00:00Z')));
  assert.equal(historicalProvenanceContractHash(provenance('2021-06-02T12:01:00Z')), historicalProvenanceContractHash(provenance('2026-08-10T12:01:00Z')));
});

test('capsule is content-addressed, verifies, and can make an honest publication-exact claim only with complete claims and checkpoints', () => {
  const source = captureHistoricalSourceSnapshot(datedStrategy(), { records: [record], provenance: provenance() });
  const checkpoint = historicalCheckpoint('deduplicate', 'uniqueRecords', [record]);
  const capsule = createHistoricalReplayCapsule({
    benchmarkId: 'historical-fixture',
    historicalCutoff: '2021-06-02',
    searchStart: '2019-01-01',
    publicationClaims: [publicationClaim()],
    sources: [source],
    checkpoints: [checkpoint],
  });

  assert.match(capsule.capsuleId, /^HRC-[a-f0-9]{24}$/);
  assert.equal(capsule.reproductionClaim, 'publication-exact');
  assert.equal(verifyHistoricalReplayCapsule(capsule).valid, true);

  const incomplete = createHistoricalReplayCapsule({
    benchmarkId: 'historical-fixture',
    historicalCutoff: '2021-06-02',
    publicationClaims: [publicationClaim({ manualSearchesDisclosed: false })],
    sources: [source],
    checkpoints: [checkpoint],
  });
  assert.equal(incomplete.reproductionClaim, 'machine-exact-publication-incomplete');
  assert.ok(incomplete.reproductionReasons.some((reason) => /manual-search/i.test(reason)));
});

test('frozen source adapter replays exact normalized evidence but rejects query/date contract drift', async () => {
  const source = captureHistoricalSourceSnapshot(datedStrategy(), { records: [record], provenance: provenance() });
  const adapter = new FrozenHistoricalEvidenceSourceAdapter(source);

  const replay = await adapter.execute(datedStrategy('2030-01-01T00:00:00Z'));
  assert.deepEqual(replay.records, [record]);
  assert.deepEqual(replay.provenance, provenance());

  await assert.rejects(
    () => adapter.execute({ ...datedStrategy(), query: '"different query"' }),
    /search contract drift/i,
  );
  await assert.rejects(
    () => adapter.execute({ ...datedStrategy(), dateRange: { start: '2019-01-01', end: '2021-06-03' } } as SearchStrategy),
    /search contract drift/i,
  );
});

test('capsule tampering is detected at source and corpus level', () => {
  const source = captureHistoricalSourceSnapshot(datedStrategy(), { records: [record], provenance: provenance() });
  const capsule = createHistoricalReplayCapsule({
    benchmarkId: 'historical-fixture',
    historicalCutoff: '2021-06-02',
    sources: [source],
  });
  const tampered = structuredClone(capsule);
  tampered.sources[0]!.records[0]!.title = 'Post-capture mutation';

  const verification = verifyHistoricalReplayCapsule(tampered);
  assert.equal(verification.valid, false);
  assert.ok(verification.sourceErrors.some((error) => /records hash mismatch/i.test(error.error)));
  assert.ok(verification.sourceErrors.some((error) => /imported corpus hash mismatch/i.test(error.error)));
});

test('replay certificate identifies first semantic divergence instead of returning a generic failure', () => {
  const expectedSource = captureHistoricalSourceSnapshot(datedStrategy(), { records: [record], provenance: provenance() });
  const expectedCheckpoint = historicalCheckpoint('deduplicate', 'uniqueRecords', [record]);
  const capsule = createHistoricalReplayCapsule({
    benchmarkId: 'historical-fixture',
    historicalCutoff: '2021-06-02',
    publicationClaims: [publicationClaim()],
    sources: [expectedSource],
    checkpoints: [expectedCheckpoint],
  });

  const exact = buildHistoricalReplayCertificate({
    capsule,
    actualSources: [expectedSource],
    actualCheckpoints: [expectedCheckpoint],
  });
  assert.equal(exact.exactMachineReplay, true);
  assert.equal(exact.publicationExact, true);
  assert.equal(exact.divergences.length, 0);

  const changedRecord = { ...record, abstract: 'Metadata was corrected later.' };
  const changedSource = captureHistoricalSourceSnapshot(datedStrategy(), { records: [changedRecord], provenance: provenance() });
  const changedCheckpoint = historicalCheckpoint('deduplicate', 'uniqueRecords', [changedRecord]);
  const divergent = buildHistoricalReplayCertificate({
    capsule,
    actualSources: [changedSource],
    actualCheckpoints: [changedCheckpoint],
  });

  assert.equal(divergent.exactMachineReplay, false);
  assert.equal(divergent.firstDivergence?.scope, 'source-corpus');
  assert.equal(divergent.firstDivergence?.database, 'pubmed');
  assert.ok(divergent.divergences.some((entry) => entry.scope === 'pipeline-checkpoint' && entry.artifactKey === 'uniqueRecords'));
});
