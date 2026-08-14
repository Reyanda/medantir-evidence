import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HumanVerificationPackage, PipelineState } from '../src/core/types.js';
import { fixtureRequest } from '../src/fixtures.js';

interface RunningServer { port: number; close(): Promise<void> }
interface SemanticManifest {
  manifestHash: string;
  indexHash: string;
  sourceStateHash: string;
  tokenisationManifestHash: string;
  embedding: { embeddingClass: string };
  counts: { units: number; embeddings: number; clusters: number };
  embeddingReuse: { reused: number; generated: number };
}
interface SearchResult {
  indexHash: string;
  searchHash: string;
  results: Array<{
    clusterIds: string[];
    unit: {
      unitId: string;
      unitType: string;
      artifactKey: string;
      artifactHash: string;
      tokenDocumentHash: string;
      tokenIds: string[];
      jsonPointers: string[];
      sourceObjectIds: string[];
      metadata: Record<string, unknown>;
    };
  }>;
}

const headers = (user = 'e2e-owner', project = 'e2e-project', json = false): Record<string, string> => ({
  'x-test-user': user,
  'x-actiora-project': project,
  ...(json ? { 'content-type': 'application/json' } : {}),
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const body = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

async function startStack(runsFile: string, durabilityRoot: string, semanticRoot: string): Promise<RunningServer> {
  const { startEvidenceOsServer } = await import('../src/evidence-os-server.js');
  const { SemanticIndexService } = await import('../src/semantic/service.js');
  const { FileSemanticIndexRepository } = await import('../src/semantic/repository.js');
  const { DeterministicScientificEmbeddingPort } = await import('../src/semantic/embedding.js');
  return startEvidenceOsServer(0, {
    runsFile,
    durabilityRoot,
    semanticIndexService: new SemanticIndexService({
      repository: new FileSemanticIndexRepository({ rootDir: semanticRoot }),
      embeddingPort: new DeterministicScientificEmbeddingPort(),
    }),
    identityProvider: {
      authenticate: async (request) => ({
        sub: String(request.headers['x-test-user'] ?? 'e2e-owner'),
        projectId: String(request.headers['x-actiora-project'] ?? 'e2e-project'),
      }),
    },
  });
}

async function pollForVerification(base: string, runId: string): Promise<PipelineState> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}`, { headers: headers() });
    assert.equal(response.status, 200);
    const state = await body<PipelineState>(response);
    const failed = Object.entries(state.stages).find(([, stage]) => stage.status === 'failed');
    if (failed) assert.fail(`Review failed at ${failed[0]}: ${failed[1].errors.join('; ')}`);
    if (state.stages['human-verify'].status === 'awaiting-human') return state;
    await delay(25);
  }
  throw new Error('Review did not reach independent verification in time.');
}

async function search(base: string, runId: string, request: Record<string, unknown>): Promise<SearchResult> {
  const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-search`, {
    method: 'POST', headers: headers('e2e-owner', 'e2e-project', true), body: JSON.stringify(request),
  });
  assert.equal(response.status, 200);
  return body<SearchResult>(response);
}

test('review-to-semantic-index E2E: execute, verify, persist, retrieve, authorize, restart, and incrementally rebuild', async (t) => {
  delete process.env.REVIEW_LIVE;
  const root = await mkdtemp(join(tmpdir(), 'medantir-semantic-e2e-'));
  const runsFile = join(root, 'control', 'runs.json');
  const durabilityRoot = join(root, 'durability');
  const semanticRoot = join(root, 'semantic');
  let server: RunningServer | undefined;
  t.after(async () => {
    if (server) await server.close().catch(() => undefined);
    delete process.env.REVIEW_LIVE;
    await rm(root, { recursive: true, force: true });
  });

  server = await startStack(runsFile, durabilityRoot, semanticRoot);
  let base = `http://127.0.0.1:${server.port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);

  const capabilitiesResponse = await fetch(`${base}/evidence-os/semantic-capabilities`);
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await body<any>(capabilitiesResponse);
  assert.equal(capabilities.product, 'MEDANTIR Semantic Evidence Index');
  assert.equal(capabilities.version, '0.8.0');
  assert.equal(capabilities.capabilities.hybridRetrieval, true);
  assert.equal(capabilities.capabilities.clustering, true);
  assert.equal(capabilities.capabilities.sourceBoundUnits, true);

  const createResponse = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: headers('e2e-owner', 'e2e-project', true),
    body: JSON.stringify({
      ...fixtureRequest,
      humanVerification: { enabled: true, mode: 'blinded', requireAllItems: true },
    }),
  });
  assert.equal(createResponse.status, 202);
  const accepted = await body<PipelineState>(createResponse);
  assert.equal(accepted.stages['human-verify'].status, 'pending');

  const pending = await pollForVerification(base, accepted.runId);
  assert.equal(pending.artifacts.finalReport, undefined);
  assert.equal((await fetch(`${base}/runs/${pending.runId}/protocol`, { headers: headers() })).status, 200);
  const registrationResponse = await fetch(`${base}/runs/${pending.runId}/registration`, { headers: headers() });
  assert.equal(registrationResponse.status, 200);
  assert.equal((await body<any>(registrationResponse)).ledger.noSecretsPersisted, true);

  const packageResponse = await fetch(`${base}/runs/${pending.runId}/verification`, { headers: headers() });
  assert.equal(packageResponse.status, 200);
  const verification = await body<HumanVerificationPackage>(packageResponse);
  assert.equal(verification.mode, 'blinded');
  assert.ok(verification.items.length > 0);

  const finalResponse = await fetch(`${base}/runs/${pending.runId}/verification`, {
    method: 'POST',
    headers: headers('e2e-owner', 'e2e-project', true),
    body: JSON.stringify({
      packageId: verification.id,
      mode: verification.mode,
      decisions: verification.items.map((item) => ({
        itemId: item.id,
        verdict: 'accept',
        rationale: `Independent E2E check completed for ${item.label}.`,
        reviewerId: 'e2e-independent-reviewer',
      })),
    }),
  });
  assert.equal(finalResponse.status, 200);
  const completed = await body<PipelineState>(finalResponse);
  for (const [name, stage] of Object.entries(completed.stages)) {
    assert.ok(stage.status === 'passed' || stage.status === 'skipped', `${name} ended in ${stage.status}`);
  }
  for (const key of [
    'protocolPackage', 'searchStrategies', 'searchProvenance', 'uniqueRecords', 'deduplicationReport',
    'tiabDecisions', 'parsedDocuments', 'extractedStudies', 'riskOfBias', 'synthesis', 'grade',
    'verificationOutcome', 'finalReport',
  ]) assert.ok(key in completed.artifacts, `Missing completed artifact ${key}`);

  const rebuildResponse = await fetch(`${base}/runs/${completed.runId}/semantic-index/rebuild`, {
    method: 'POST', headers: headers(),
  });
  assert.equal(rebuildResponse.status, 200);
  const initial = await body<SemanticManifest>(rebuildResponse);
  assert.match(initial.indexHash, /^[a-f0-9]{64}$/);
  assert.match(initial.manifestHash, /^[a-f0-9]{64}$/);
  assert.match(initial.tokenisationManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(initial.embedding.embeddingClass, 'deterministic-lexical-dense');
  assert.equal(initial.counts.embeddings, initial.counts.units);
  assert.ok(initial.counts.units > 20);
  assert.ok(initial.counts.clusters > 0);
  assert.deepEqual(initial.embeddingReuse, { reused: 0, generated: initial.counts.units });

  const firstSearch = await search(base, completed.runId, {
    query: 'therapeutic food mortality severe acute malnutrition',
    topK: 10,
    filters: { unitTypes: ['effect-estimate', 'outcome', 'study', 'claim'] },
  });
  assert.equal(firstSearch.indexHash, initial.indexHash);
  assert.match(firstSearch.searchHash, /^[a-f0-9]{64}$/);
  const sourceBound = firstSearch.results.find(({ unit }) =>
    unit.tokenIds.length > 0
    && unit.jsonPointers.length > 0
    && unit.sourceObjectIds.length > 0
    && typeof unit.metadata.studyId === 'string');
  assert.ok(sourceBound, 'Search did not return source-bound study evidence.');
  assert.match(sourceBound.unit.artifactHash, /^[a-f0-9]{64}$/);
  assert.match(sourceBound.unit.tokenDocumentHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(firstSearch).includes('"vector":'), false);

  const unitResponse = await fetch(
    `${base}/runs/${completed.runId}/semantic-units/${encodeURIComponent(sourceBound.unit.unitId)}`,
    { headers: headers() },
  );
  assert.equal(unitResponse.status, 200);
  assert.equal(Object.hasOwn(await body<Record<string, unknown>>(unitResponse), 'vector'), false);

  const clustersResponse = await fetch(`${base}/runs/${completed.runId}/semantic-clusters`, { headers: headers() });
  assert.equal(clustersResponse.status, 200);
  const clusters = await body<any>(clustersResponse);
  assert.equal(clusters.indexHash, initial.indexHash);
  assert.ok(clusters.clusters.length > 0);
  assert.equal(clusters.clusters[0].labelStatus, 'machine-proposed');
  assert.equal(Object.hasOwn(clusters.clusters[0], 'centroid'), false);

  const bundleResponse = await fetch(`${base}/runs/${completed.runId}/reproducibility-bundle`, { headers: headers() });
  assert.equal(bundleResponse.status, 200);
  const bundle = await body<any>(bundleResponse);
  assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.tokenisationManifest.manifestHash, initial.tokenisationManifestHash);
  assert.equal(bundle.semanticIndexManifest.manifestHash, initial.manifestHash);
  assert.ok(bundle.scientificRunManifest);
  assert.ok(bundle.scientificRunSeal);

  assert.equal((await fetch(`${base}/runs/${completed.runId}/semantic-index-manifest`, {
    headers: headers('different-owner', 'e2e-project'),
  })).status, 404);

  await server.close();
  server = undefined;
  server = await startStack(runsFile, durabilityRoot, semanticRoot);
  base = `http://127.0.0.1:${server.port}`;
  const persistedResponse = await fetch(`${base}/runs/${completed.runId}/semantic-index-manifest`, { headers: headers() });
  assert.equal(persistedResponse.status, 200);
  const persisted = await body<SemanticManifest>(persistedResponse);
  assert.equal(persisted.indexHash, initial.indexHash);
  assert.equal(persisted.manifestHash, initial.manifestHash);
  const persistedSearch = await search(base, completed.runId, {
    query: 'therapeutic food mortality severe acute malnutrition',
    topK: 3,
    filters: { unitTypes: ['effect-estimate', 'outcome', 'study', 'claim'] },
  });
  assert.equal(persistedSearch.results[0]?.unit.unitId, firstSearch.results[0]?.unit.unitId);

  await server.close();
  server = undefined;
  const entries = JSON.parse(await readFile(runsFile, 'utf8')) as Array<[
    string,
    { ownerSub: string; projectId: string; state: PipelineState },
  ]>;
  const stored = entries.find(([runId]) => runId === completed.runId);
  assert.ok(stored);
  stored[1].state.artifacts.semanticE2EAmendment = {
    title: 'Long-term post-discharge survival update',
    finding: 'Additional follow-up described mortality after discharge among children recovering from severe acute malnutrition.',
    provenance: { recordId: 'e2e-follow-up', section: 'results', page: 12 },
  };
  stored[1].state.updatedAt = '2026-08-14T18:30:00.000Z';
  await writeFile(runsFile, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });

  server = await startStack(runsFile, durabilityRoot, semanticRoot);
  base = `http://127.0.0.1:${server.port}`;
  const incrementalResponse = await fetch(`${base}/runs/${completed.runId}/semantic-index/rebuild`, {
    method: 'POST', headers: headers(),
  });
  assert.equal(incrementalResponse.status, 200);
  const incremental = await body<SemanticManifest>(incrementalResponse);
  assert.notEqual(incremental.indexHash, initial.indexHash);
  assert.ok(incremental.embeddingReuse.reused > 0);
  assert.ok(incremental.embeddingReuse.generated > 0);
  assert.equal(incremental.embeddingReuse.reused + incremental.embeddingReuse.generated, incremental.counts.units);

  const updated = await search(base, completed.runId, {
    query: 'long-term post-discharge survival update mortality after discharge',
    topK: 5,
    filters: { artifactKeys: ['semanticE2EAmendment'] },
  });
  assert.ok(updated.results.length > 0);
  assert.equal(updated.results[0]!.unit.artifactKey, 'semanticE2EAmendment');
  assert.equal(updated.indexHash, incremental.indexHash);
});