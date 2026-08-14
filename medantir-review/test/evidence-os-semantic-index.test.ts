import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtractedStudy, PipelineState, StageName } from '../src/core/types.js';
import { DeterministicScientificEmbeddingPort, OpenAiCompatibleEmbeddingPort } from '../src/semantic/embedding.js';
import { buildSemanticIndex, verifySemanticIndexSnapshot } from '../src/semantic/index-builder.js';
import { FileSemanticIndexRepository } from '../src/semantic/repository.js';
import { searchSemanticIndex } from '../src/semantic/search.js';
import { projectSemanticUnits } from '../src/semantic/unit-projector.js';
import { SemanticIndexService } from '../src/semantic/service.js';
import type { SemanticEmbeddingPort } from '../src/semantic/types.js';

const stageNames = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve',
  'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
] as StageName[];

function study(id: string, population: string, outcome: string, effect: number, mechanism: string): ExtractedStudy {
  return {
    studyId: id,
    reportIds: [`report-${id}`],
    design: 'randomised controlled trial',
    population,
    interventionOrExposure: 'Reduced-dose ready-to-use therapeutic food',
    comparator: 'Standard-dose ready-to-use therapeutic food',
    outcomes: [{ name: outcome, effect, standardError: 0.12 }],
    mechanisms: [mechanism],
    funding: 'Public research grant',
    rationale: 'Treatment burden may be reduced without compromising recovery.',
    objectives: ['Estimate treatment effects on recovery and mortality.'],
    resultsSummary: `${outcome} was measured after treatment.`,
    discussionSummary: 'The findings may inform simplified nutrition protocols.',
    limitations: ['Follow-up was incomplete for some children.'],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {},
    sourceQuotes: [],
  };
}

function state(): PipelineState {
  return {
    runId: 'semantic-run',
    request: {
      reviewType: 'systematic',
      databases: ['PubMed'],
      question: {
        title: 'Reduced-dose therapeutic food for children with severe acute malnutrition',
        objective: 'Estimate recovery and mortality effects.',
        population: 'Children aged 6 to 59 months with severe acute malnutrition',
        interventionOrExposure: 'Reduced-dose RUTF',
        comparator: 'Standard-dose RUTF',
        outcomes: ['Recovery', 'Mortality'],
      },
    },
    stages: Object.fromEntries(stageNames.map((name) => [name, { name, status: 'passed', attempts: 1, errors: [] }])) as unknown as PipelineState['stages'],
    artifacts: {
      extractedStudies: [
        study('s1', 'Children aged 6 to 59 months with severe acute malnutrition', 'Mortality', Math.log(0.9), 'Inflammation and infection may alter nutritional recovery.'),
        study('s2', 'Hospitalised children recovering from severe acute malnutrition', 'Post-discharge mortality', Math.log(0.8), 'Persistent immune dysfunction may increase post-discharge mortality.'),
        study('s3', 'Community-treated children with uncomplicated severe acute malnutrition', 'Nutritional recovery', Math.log(1.05), 'Gut microbiome maturation may support recovery.'),
      ],
      finalReport: {
        title: 'Reduced-dose RUTF review',
        sections: {
          methods: 'Randomised trials were synthesised using a random-effects model.',
          results: 'Mortality and nutritional recovery were evaluated.',
          discussion: 'Context and follow-up may explain heterogeneity.',
        },
      },
      credentialExample: { apiKey: 'must-never-enter-index' },
    },
    audit: [],
    createdAt: '2026-08-14T12:00:00Z',
    updatedAt: '2026-08-14T12:00:00Z',
  };
}

test('builds deterministic token-bound semantic units, embeddings, clusters, and hybrid retrieval', async () => {
  const port = new DeterministicScientificEmbeddingPort({ dimensions: 128 });
  const first = await buildSemanticIndex(state(), port, '2026-08-14T12:00:00Z');
  const second = await buildSemanticIndex(state(), port, '2026-08-15T12:00:00Z');

  verifySemanticIndexSnapshot(first);
  assert.equal(first.indexHash, second.indexHash);
  assert.equal(first.manifest.manifestHash, second.manifest.manifestHash);
  assert.equal(first.embeddings.length, first.units.length);
  assert.ok(first.units.some((unit) => unit.unitType === 'study'));
  assert.ok(first.units.some((unit) => unit.unitType === 'outcome'));
  assert.ok(first.units.some((unit) => unit.unitType === 'effect-estimate' && unit.imradRole === 'results'));
  assert.ok(first.units.some((unit) => unit.unitType === 'mechanism'));
  assert.ok(first.clusters.length > 0);
  assert.equal(first.manifest.embedding.embeddingClass, 'deterministic-lexical-dense');
  assert.match(JSON.stringify(first), /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(first), /must-never-enter-index/);

  const response = await searchSemanticIndex(first, port, {
    query: 'post-discharge mortality in children after severe acute malnutrition',
    topK: 10,
    filters: { unitTypes: ['study', 'outcome', 'effect-estimate', 'mechanism', 'claim'] },
  });
  assert.equal(response.results.length > 0, true);
  assert.ok(response.results.some((result) => result.unit.metadata.studyId === 's2'));
  assert.match(response.searchHash, /^[a-f0-9]{64}$/);

  const resultsOnly = await searchSemanticIndex(first, port, {
    query: 'mortality effect',
    filters: { imradRoles: ['results'] },
  });
  assert.ok(resultsOnly.results.every((result) => result.unit.imradRole === 'results'));
});

test('bounds every semantic projection, including a single oversized lexical token', () => {
  const oversized = structuredClone(state());
  oversized.artifacts.longUnbrokenResult = { resultsSummary: 'x'.repeat(25_500) };
  const units = projectSemanticUnits(oversized, '2026-08-14T12:00:00Z');
  const longUnits = units.filter((unit) => unit.artifactKey === 'longUnbrokenResult');
  assert.ok(longUnits.length >= 3);
  assert.ok(longUnits.every((unit) => unit.text.length <= 12_000));
  assert.ok(longUnits.some((unit) => unit.metadata.projectionStartOffset === 12_000));
});

test('persists immutable semantic snapshots and automatically rebuilds when scientific state changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'semantic-index-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new FileSemanticIndexRepository({ rootDir: root });
  const service = new SemanticIndexService({
    repository,
    embeddingPort: new DeterministicScientificEmbeddingPort({ dimensions: 96 }),
    now: () => '2026-08-14T12:00:00Z',
  });
  const initialState = state();
  const initial = await service.getOrBuild(initialState.runId, initialState);
  const loaded = await repository.getLatest(initialState.runId);
  assert.equal(loaded?.indexHash, initial.indexHash);

  const updated = structuredClone(initialState);
  const studies = updated.artifacts.extractedStudies as ExtractedStudy[];
  studies[0]!.resultsSummary = 'Mortality was lower in the reduced-dose group.';
  updated.updatedAt = '2026-08-14T13:00:00Z';
  const rebuilt = await service.getOrBuild(updated.runId, updated);
  assert.notEqual(rebuilt.indexHash, initial.indexHash);
});

test('reuses unchanged semantic vectors when only part of the scientific state changes', async () => {
  const inner = new DeterministicScientificEmbeddingPort({ dimensions: 64 });
  const calls: number[] = [];
  const port: SemanticEmbeddingPort = {
    profile: inner.profile,
    async embed(texts) {
      calls.push(texts.length);
      return inner.embed(texts);
    },
  };
  const repository = new (await import('../src/semantic/repository.js')).MemorySemanticIndexRepository();
  const service = new SemanticIndexService({ repository, embeddingPort: port, now: () => '2026-08-14T12:00:00Z' });
  const initialState = state();
  const initial = await service.getOrBuild(initialState.runId, initialState);
  assert.equal(calls[0], initial.units.length);

  const updated = structuredClone(initialState);
  const studies = updated.artifacts.extractedStudies as ExtractedStudy[];
  studies[1]!.discussionSummary = 'Persistent immune dysfunction may explain excess post-discharge mortality.';
  updated.updatedAt = '2026-08-14T13:00:00Z';
  const next = await service.getOrBuild(updated.runId, updated);
  assert.ok(next.manifest.embeddingReuse.reused > 0);
  assert.ok(next.manifest.embeddingReuse.generated > 0);
  assert.ok(next.manifest.embeddingReuse.generated < next.units.length);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], next.manifest.embeddingReuse.generated);
});

test('supports a versioned OpenAI-compatible provider embedding port without leaking credentials', async () => {
  const requests: Array<{ url: string; authorization: string; body: unknown }> = [];
  const port = new OpenAiCompatibleEmbeddingPort({
    baseUrl: 'https://embedding.example.test',
    apiKey: 'private-key',
    model: 'semantic-model',
    dimensions: 32,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: String((init?.headers as Record<string, string>).authorization),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        model: 'semantic-model-v2',
        data: [
          { index: 0, embedding: Array.from({ length: 32 }, (_, index) => index === 0 ? 1 : 0) },
          { index: 1, embedding: Array.from({ length: 32 }, (_, index) => index === 1 ? 1 : 0) },
        ],
        usage: { total_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'request-1', 'x-embedding-cost-usd': '0.002' } });
    },
  });
  const batch = await port.embed(['mortality', 'recovery']);
  assert.equal(batch.profile.model, 'semantic-model');
  assert.equal(batch.profile.modelVersion, 'semantic-model-v2');
  assert.equal(batch.profile.dimensions, 32);
  assert.equal(batch.vectors.length, 2);
  assert.equal(batch.receipts[0]?.inputTokens, 7);
  assert.equal(batch.receipts[0]?.costUsd, 0.002);
  assert.equal(requests[0]?.url, 'https://embedding.example.test/v1/embeddings');
  assert.equal(requests[0]?.authorization, 'Bearer private-key');
  assert.doesNotMatch(JSON.stringify(batch), /private-key/);
});

test('rejects semantic-vector tampering', async () => {
  const snapshot = await buildSemanticIndex(state(), new DeterministicScientificEmbeddingPort({ dimensions: 64 }), '2026-08-14T12:00:00Z');
  const tampered = structuredClone(snapshot);
  tampered.embeddings[0]!.vector[0] = (tampered.embeddings[0]!.vector[0] ?? 0) + 0.5;
  assert.throws(() => verifySemanticIndexSnapshot(tampered), /vector hash mismatch/);
});
