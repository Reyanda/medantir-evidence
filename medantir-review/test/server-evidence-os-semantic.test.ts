import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtractedStudy, PipelineState, StageName } from '../src/core/types.js';

const stageNames = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve',
  'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
] as StageName[];

function extractedStudy(): ExtractedStudy {
  return {
    studyId: 'study-semantic',
    reportIds: ['report-semantic'],
    design: 'randomised controlled trial',
    population: 'Children with severe acute malnutrition',
    interventionOrExposure: 'Reduced-dose RUTF',
    comparator: 'Standard-dose RUTF',
    outcomes: [{ name: 'Post-discharge mortality', effect: Math.log(0.8), standardError: 0.1 }],
    mechanisms: ['Persistent immune dysfunction'],
    funding: 'Public grant',
    rationale: 'Simplified protocols may reduce treatment burden.',
    objectives: ['Estimate mortality effects.'],
    resultsSummary: 'Post-discharge mortality was measured.',
    discussionSummary: 'Follow-up context may modify the effect.',
    limitations: ['Loss to follow-up occurred.'],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {},
    sourceQuotes: [],
  };
}

function run(): PipelineState {
  return {
    runId: 'semantic-api-run',
    request: { reviewType: 'systematic', databases: ['PubMed'], question: { title: 'RUTF and mortality', objective: 'Estimate mortality effects.' } },
    stages: Object.fromEntries(stageNames.map((name) => [name, { name, status: 'pending', attempts: 0, errors: [] }])) as unknown as PipelineState['stages'],
    artifacts: { extractedStudies: [extractedStudy()] },
    audit: [],
    createdAt: '2026-08-14T12:00:00Z',
    updatedAt: '2026-08-14T12:00:00Z',
  };
}

test('semantic Evidence OS routes are public only for capability discovery and owner-scoped for index and search', async (t) => {
  process.env.REVIEW_LIVE = '1';
  process.env.SEMANTIC_EMBEDDING_MODE = 'local';
  process.env.SEMANTIC_EMBEDDING_DIMENSIONS = '64';
  const { startEvidenceOsServer } = await import('../src/evidence-os-server.js');
  const root = await mkdtemp(join(tmpdir(), 'semantic-api-'));
  const runsFile = join(root, 'runs.json');
  await writeFile(runsFile, JSON.stringify([['semantic-api-run', { ownerSub: 'owner', projectId: 'project', state: run() }]]), { mode: 0o600 });
  const server = await startEvidenceOsServer(0, {
    runsFile,
    durabilityRoot: join(root, 'durability'),
    identityProvider: {
      authenticate: async (req) => ({
        sub: String(req.headers['x-test-user'] ?? 'owner'),
        projectId: String(req.headers['x-actiora-project'] ?? 'project'),
      }),
    },
  });
  t.after(async () => {
    delete process.env.REVIEW_LIVE;
    delete process.env.SEMANTIC_EMBEDDING_MODE;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;

  const capabilities = await fetch(`${base}/evidence-os/semantic-capabilities`);
  assert.equal(capabilities.status, 200);
  const capabilityBody = await capabilities.json() as { retrieval: string[]; capabilityHash: string };
  assert.ok(capabilityBody.retrieval.includes('BM25'));
  assert.match(capabilityBody.capabilityHash, /^[a-f0-9]{64}$/);

  const contracts = await fetch(`${base}/evidence-os/extraction-field-contracts`);
  assert.equal(contracts.status, 200);

  const manifestResponse = await fetch(`${base}/runs/semantic-api-run/semantic-index-manifest`, {
    headers: { 'x-actiora-project': 'project' },
  });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json() as { indexHash: string; counts: { units: number }; embedding: { embeddingClass: string } };
  assert.match(manifest.indexHash, /^[a-f0-9]{64}$/);
  assert.ok(manifest.counts.units > 0);
  assert.equal(manifest.embedding.embeddingClass, 'deterministic-lexical-dense');

  const searchResponse = await fetch(`${base}/runs/semantic-api-run/semantic-search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actiora-project': 'project' },
    body: JSON.stringify({ query: 'post-discharge mortality in malnourished children', topK: 5 }),
  });
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json() as { results: Array<{ unit: { unitId: string; text: string; tokenIds: string[] } }> };
  assert.ok(search.results.length > 0);
  assert.match(search.results[0]!.unit.unitId, /^semu-/);
  assert.ok(Array.isArray(search.results[0]!.unit.tokenIds));
  assert.doesNotMatch(JSON.stringify(search), /"vector"/);

  const clustersResponse = await fetch(`${base}/runs/semantic-api-run/semantic-clusters`, {
    headers: { 'x-actiora-project': 'project' },
  });
  assert.equal(clustersResponse.status, 200);
  const clusters = await clustersResponse.json() as { clusters: unknown[] };
  assert.doesNotMatch(JSON.stringify(clusters), /"centroid"/);
  assert.doesNotMatch(JSON.stringify(clusters), /"vector"/);

  const units = await fetch(`${base}/runs/semantic-api-run/semantic-units?limit=2`, {
    headers: { 'x-actiora-project': 'project' },
  });
  assert.equal(units.status, 200);
  const unitPage = await units.json() as { limit: number; units: unknown[] };
  assert.equal(unitPage.limit, 2);
  assert.ok(unitPage.units.length <= 2);

  const otherOwner = await fetch(`${base}/runs/semantic-api-run/semantic-index-manifest`, {
    headers: { 'x-test-user': 'other', 'x-actiora-project': 'project' },
  });
  assert.equal(otherOwner.status, 404);
});
