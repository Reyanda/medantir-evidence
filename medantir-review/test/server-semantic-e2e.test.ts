import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HumanVerificationPackage, PipelineState } from '../src/core/types.js';
import { fixtureRequest } from '../src/fixtures.js';

interface RunningServer {
  port: number;
  close(): Promise<void>;
}

interface SemanticManifest {
  manifestHash: string;
  indexHash: string;
  sourceStateHash: string;
  tokenisationManifestHash: string;
  embedding: {
    provider: string;
    model: string;
    modelVersion: string;
    dimensions: number;
    embeddingClass: string;
  };
  counts: {
    units: number;
    embeddings: number;
    clusters: number;
  };
  embeddingReuse: {
    reused: number;
    generated: number;
  };
  warnings: string[];
}

interface SemanticSearchBody {
  indexHash: string;
  searchHash: string;
  results: Array<{
    rank: number;
    score: number;
    clusterIds: string[];
    unit: {
      unitId: string;
      unitType: string;
      artifactKey: string;
      artifactHash: string;
      tokenDocumentHash: string;
      tokenIds: string[];
      jsonPointers: string[];
      imradRole: string;
      sourceObjectIds: string[];
      metadata: Record<string, unknown>;
      text: string;
    };
  }>;
}

const ownerHeaders = (
  user = 'e2e-owner',
  project = 'e2e-project',
  json = false,
): Record<string, string> => ({
  'x-test-user': user,
  'x-actiora-project': project,
  ...(json ? { 'content-type': 'application/json' } : {}),
});

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T;
  return payload;
}

async function pollUntilVerificationGate(base: string, runId: string): Promise<PipelineState> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}`, {
      headers: ownerHeaders(),
    });
    assert.equal(response.status, 200);
    const state = await jsonResponse<PipelineState>(response);
    const failed = Object.entries(state.stages).find(([, stage]) => stage.status === 'failed');
    if (failed) {
      assert.fail(`Review pipeline failed at ${failed[0]}: ${failed[1].errors.join('; ')}`);
    }
    const verificationStatus = state.stages['human-verify'].status;
    if (verificationStatus === 'awaiting-human' || verificationStatus === 'passed') return state;
    await pause(25);
  }
  throw new Error('Review pipeline did not reach the independent-verification gate in time.');
}

async function startStack(input: {
  runsFile: string;
  durabilityRoot: string;
  semanticRoot: string;
}): Promise<RunningServer> {
  const { startEvidenceOsServer } = await import('../src/evidence-os-server.js');
  const { SemanticIndexService } = await import('../src/semantic/service.js');
  const { FileSemanticIndexRepository } = await import('../src/semantic/repository.js');
  const semanticIndexService = new SemanticIndexService({
    repository: new FileSemanticIndexRepository({ rootDir: input.semanticRoot }),
  });
  return startEvidenceOsServer(0, {
    runsFile: input.runsFile,
    durabilityRoot: input.durabilityRoot,
    semanticIndexService,
    identityProvider: {
      authenticate: async (request) => ({
        sub: String(request.headers['x-test-user'] ?? 'e2e-owner'),
        projectId: String(request.headers['x-actiora-project'] ?? 'e2e-project'),
      }),
    },
  });
}

async function semanticManifest(base: string, runId: string): Promise<SemanticManifest> {
  const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-index-manifest`, {
    headers: ownerHeaders(),
  });
  assert.equal(response.status, 200);
  return jsonResponse<SemanticManifest>(response);
}

async function semanticSearch(
  base: string,
  runId: string,
  body: Record<string, unknown>,
): Promise<SemanticSearchBody> {
  const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-search`, {
    method: 'POST',
    headers: ownerHeaders('e2e-owner', 'e2e-project', true),
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return jsonResponse<SemanticSearchBody>(response);
}

test('completes a review, verifies it, persists a semantic index, retrieves source-bound evidence, and incrementally rebuilds after restart', async (t) => {
  delete process.env.REVIEW_LIVE;
  const root = await mkdtemp(join(tmpdir(), 'medantir-semantic-e2e-'));
  const runsFile = join(root, 'control', 'runs.json');
  const durabilityRoot = join(root, 'durability');
  const semanticRoot = join(root, 'semantic-persistence');
  let activeServer: RunningServer | undefined;

  t.after(async () => {
    if (activeServer) await activeServer.close().catch(() => undefined);
    delete process.env.REVIEW_LIVE;
    await rm(root, { recursive: true, force: true });
  });

  activeServer = await startStack({ runsFile, durabilityRoot, semanticRoot });
  let base = `http://127.0.0.1:${activeServer.port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);

  const capabilities = await fetch(`${base}/evidence-os/semantic-capabilities`);
  assert.equal(capabilities.status, 200);
  const capabilityBody = await jsonResponse<{
    product: string;
    version: string;
    capabilities: { hybridRetrieval: boolean; clustering: boolean; sourceBoundUnits: boolean };
  }>(capabilities);
  assert.equal(capabilityBody.product, 'MEDANTIR Semantic Evidence Index');
  assert.equal(capabilityBody.version, '0.8.0');
  assert.equal(capabilityBody.capabilities.hybridRetrieval, true);
  assert.equal(capabilityBody.capabilities.clustering, true);
  assert.equal(capabilityBody.capabilities.sourceBoundUnits, true);

  const create = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: ownerHeaders('e2e-owner', 'e2e-project', true),
    body: JSON.stringify({
      ...fixtureRequest,
      humanVerification: {
        enabled: true,
        mode: 'blinded',
        requireAllItems: true,
      },
    }),
  });
  assert.equal(create.status, 202);
  const accepted = await jsonResponse<PipelineState>(create);
  assert.equal(accepted.stages['human-verify'].status, 'pending');

  const pending = await pollUntilVerificationGate(base, accepted.runId);
  assert.equal(pending.stages['human-verify'].status, 'awaiting-human');
  assert.equal(pending.artifacts.finalReport, undefined);

  const protocolResponse = await fetch(`${base}/runs/${pending.runId}/protocol`, {
    headers: ownerHeaders(),
  });
  assert.equal(protocolResponse.status, 200);
  const protocol = await jsonResponse<{ checksum: string; files: Array<{ path: string }> }>(protocolResponse);
  assert.match(protocol.checksum, /^[a-f0-9]{32,}$/);
  assert.ok(protocol.files.some((file) => file.path === 'protocol/PROTOCOL.md'));

  const registrationResponse = await fetch(`${base}/runs/${pending.runId}/registration`, {
    headers: ownerHeaders(),
  });
  assert.equal(registrationResponse.status, 200);
  const registration = await jsonResponse<{ ledger: { noSecretsPersisted: boolean } }>(registrationResponse);
  assert.equal(registration.ledger.noSecretsPersisted, true);

  const packageResponse = await fetch(`${base}/runs/${pending.runId}/verification`, {
    headers: ownerHeaders(),
  });
  assert.equal(packageResponse.status, 200);
  const verificationPackage = await jsonResponse<HumanVerificationPackage>(packageResponse);
  assert.equal(verificationPackage.mode, 'blinded');
  assert.ok(verificationPackage.items.length > 0);

  const finalise = await fetch(`${base}/runs/${pending.runId}/verification`, {
    method: 'POST',
    headers: ownerHeaders('e2e-owner', 'e2e-project', true),
    body: JSON.stringify({
      packageId: verificationPackage.id,
      mode: verificationPackage.mode,
      decisions: verificationPackage.items.map((item) => ({
        itemId: item.id,
        verdict: 'accept',
        rationale: `Independent E2E evidence check completed for ${item.label}.`,
        reviewerId: 'e2e-independent-reviewer',
      })),
    }),
  });
  assert.equal(finalise.status, 200);
  const completed = await jsonResponse<PipelineState>(finalise);
  assert.equal(completed.stages['human-verify'].status, 'passed');
  for (const [stageName, stage] of Object.entries(completed.stages)) {
    assert.ok(
      stage.status === 'passed' || stage.status === 'skipped',
      `${stageName} ended in ${stage.status}`,
    );
  }
  for (const artifact of [
    'protocolPackage',
    'searchStrategies',
    'searchProvenance',
    'uniqueRecords',
    'deduplicationReport',
    'tiabDecisions',
    'parsedDocuments',
    'extractedStudies',
    'riskOfBias',
    'synthesis',
    'grade',
    'verificationOutcome',
    'finalReport',
  ]) {
    assert.ok(artifact in completed.artifacts, `completed review is missing ${artifact}`);
  }

  const rebuildResponse = await fetch(`${base}/runs/${completed.runId}/semantic-index/rebuild`, {
    method: 'POST',
    headers: ownerHeaders(),
  });
  assert.equal(rebuildResponse.status, 200);
  const firstManifest = await jsonResponse<SemanticManifest>(rebuildResponse);
  assert.match(firstManifest.indexHash, /^[a-f0-9]{64}$/);
  assert.match(firstManifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.match(firstManifest.sourceStateHash, /^[a-f0-9]{64}$/);
  assert.match(firstManifest.tokenisationManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(firstManifest.embedding.embeddingClass, 'deterministic-lexical-dense');
  assert.equal(firstManifest.counts.embeddings, firstManifest.counts.units);
  assert.ok(firstManifest.counts.units > 20);
  assert.ok(firstManifest.counts.clusters > 0);
  assert.equal(firstManifest.embeddingReuse.reused, 0);
  assert.equal(firstManifest.embeddingReuse.generated, firstManifest.counts.units);

  const search = await semanticSearch(base, completed.runId, {
    query: 'therapeutic food mortality severe acute malnutrition',
    topK: 10,
    filters: {
      unitTypes: ['effect-estimate', 'outcome', 'study', 'claim'],
    },
  });
  assert.equal(search.indexHash, firstManifest.indexHash);
  assert.match(search.searchHash, /^[a-f0-9]{64}$/);
  assert.ok(search.results.length > 0);
  const sourceBound = search.results.find((result) =>
    result.unit.tokenIds.length > 0
    && result.unit.jsonPointers.length > 0
    && result.unit.sourceObjectIds.length > 0
    && typeof result.unit.metadata.studyId === 'string',
  );
  assert.ok(sourceBound, 'semantic search did not return source-bound study evidence');
  assert.match(sourceBound.unit.artifactHash, /^[a-f0-9]{64}$/);
  assert.match(sourceBound.unit.tokenDocumentHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(search).includes('"vector":'), false);

  const unitResponse = await fetch(`${base}/runs/${completed.runId}/semantic-units/${encodeURIComponent(sourceBound.unit.unitId)}`, {
    headers: ownerHeaders(),
  });
  assert.equal(unitResponse.status, 200);
  const fetchedUnit = await jsonResponse<Record<string, unknown>>(unitResponse);
  assert.equal(fetchedUnit.unitId, sourceBound.unit.unitId);
  assert.equal(Object.prototype.hasOwnProperty.call(fetchedUnit, 'vector'), false);

  const clustersResponse = await fetch(`${base}/runs/${completed.runId}/semantic-clusters`, {
    headers: ownerHeaders(),
  });
  assert.equal(clustersResponse.status, 200);
  const clusterList = await jsonResponse<{
    indexHash: string;
    clusters: Array<{ clusterId: string; centroidHash: string; labelStatus: string }>;
  }>(clustersResponse);
  assert.equal(clusterList.indexHash, firstManifest.indexHash);
  assert.ok(clusterList.clusters.length > 0);
  assert.equal(clusterList.clusters[0]!.labelStatus, 'machine-proposed');
  assert.equal(Object.prototype.hasOwnProperty.call(clusterList.clusters[0], 'centroid'), false);

  const bundleResponse = await fetch(`${base}/runs/${completed.runId}/reproducibility-bundle`, {
    headers: ownerHeaders(),
  });
  assert.equal(bundleResponse.status, 200);
  const bundle = await jsonResponse<{
    bundleHash: string;
    graph: { graphHash: string };
    tokenisationManifest: { manifestHash: string };
    semanticIndexManifest: SemanticManifest;
    scientificRunManifest: unknown;
    scientificRunSeal: unknown;
  }>(bundleResponse);
  assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
  assert.match(bundle.graph.graphHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.tokenisationManifest.manifestHash, firstManifest.tokenisationManifestHash);
  assert.equal(bundle.semanticIndexManifest.manifestHash, firstManifest.manifestHash);
  assert.ok(bundle.scientificRunManifest);
  assert.ok(bundle.scientificRunSeal);

  const forbidden = await fetch(`${base}/runs/${completed.runId}/semantic-index-manifest`, {
    headers: ownerHeaders('different-owner', 'e2e-project'),
  });
  assert.equal(forbidden.status, 404);

  await activeServer.close();
  activeServer = undefined;

  activeServer = await startStack({ runsFile, durabilityRoot, semanticRoot });
  base = `http://127.0.0.1:${activeServer.port}`;
  const persistedManifest = await semanticManifest(base, completed.runId);
  assert.equal(persistedManifest.indexHash, firstManifest.indexHash);
  assert.equal(persistedManifest.manifestHash, firstManifest.manifestHash);

  const persistedSearch = await semanticSearch(base, completed.runId, {
    query: 'therapeutic food mortality severe acute malnutrition',
    topK: 3,
    filters: { unitTypes: ['effect-estimate', 'outcome', 'study', 'claim'] },
  });
  assert.equal(persistedSearch.indexHash, firstManifest.indexHash);
  assert.equal(persistedSearch.results[0]?.unit.unitId, search.results[0]?.unit.unitId);

  await activeServer.close();
  activeServer = undefined;

  const entries = JSON.parse(await readFile(runsFile, 'utf8')) as Array<[
    string,
    { ownerSub: string; projectId: string; state: PipelineState },
  ]>;
  const stored = entries.find(([runId]) => runId === completed.runId);
  assert.ok(stored);
  stored[1].state.artifacts.semanticE2EAmendment = {
    title: 'Long-term post-discharge survival update',
    finding: 'An additional follow-up report described mortality after discharge among children recovering from severe acute malnutrition.',
    provenance: {
      recordId: 'e2e-follow-up-record',
      section: 'results',
      page: 12,
    },
  };
  stored[1].state.updatedAt = '2026-08-14T18:30:00.000Z';
  await writeFile(runsFile, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });

  activeServer = await startStack({ runsFile, durabilityRoot, semanticRoot });
  base = `http://127.0.0.1:${activeServer.port}`;
  const incrementalResponse = await fetch(`${base}/runs/${completed.runId}/semantic-index/rebuild`, {
    method: 'POST',
    headers: ownerHeaders(),
  });
  assert.equal(incrementalResponse.status, 200);
  const incremental = await jsonResponse<SemanticManifest>(incrementalResponse);
  assert.notEqual(incremental.indexHash, firstManifest.indexHash);
  assert.ok(incremental.embeddingReuse.reused > 0);
  assert.ok(incremental.embeddingReuse.generated > 0);
  assert.equal(
    incremental.embeddingReuse.reused + incremental.embeddingReuse.generated,
    incremental.counts.units,
  );

  const updatedSearch = await semanticSearch(base, completed.runId, {
    query: 'long-term post-discharge survival update mortality after discharge',
    topK: 5,
    filters: { artifactKeys: ['semanticE2EAmendment'] },
  });
  assert.ok(updatedSearch.results.length > 0);
  assert.equal(updatedSearch.results[0]!.unit.artifactKey, 'semanticE2EAmendment');
  assert.equal(updatedSearch.indexHash, incremental.indexHash);
});