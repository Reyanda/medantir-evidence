import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
import type { SemanticIndexServicePort, SemanticSearchRequest } from './types.js';

export interface SemanticApiResponse {
  status: number;
  payload: unknown;
}

export interface SemanticApiInput {
  method?: string;
  pathname: string;
  query?: Record<string, string>;
  body?: unknown;
  stateFor(runId: string): Promise<PipelineState | undefined>;
  service?: SemanticIndexServicePort;
}

function publicCluster(cluster: import('./types.js').SemanticCluster) {
  const { centroid: _centroid, ...publicValue } = cluster;
  return publicValue;
}

function capabilities() {
  const content = {
    schemaVersion: 'medantir-semantic-capabilities/1' as const,
    product: 'MEDANTIR Semantic Evidence Index' as const,
    version: '0.8.0',
    capabilities: {
      sourceBoundUnits: true,
      deterministicScientificIdentity: true,
      deterministicLocalEmbeddings: true,
      providerSemanticEmbeddings: true,
      hybridRetrieval: true,
      metadataFiltering: true,
      clustering: true,
      immutablePersistence: true,
      incrementalRebuild: true,
      rawVectorsPublic: false,
      rawCentroidsPublic: false,
    },
    semanticUnits: ['artifact', 'section', 'passage', 'sentence', 'claim', 'extraction-field', 'outcome', 'estimand', 'effect-estimate', 'mechanism', 'study', 'table-row'],
    retrieval: ['dense-cosine', 'BM25', 'exact-phrase', 'metadata-filtering', 'hybrid-weighted-ranking'],
    clustering: ['deterministic-spherical-kmeans', 'farthest-first-initialisation', 'machine-proposed-labels'],
    embeddingModes: [
      { mode: 'local', class: 'deterministic-lexical-dense', autonomous: true, externalNetwork: false },
      { mode: 'openai-compatible', class: 'provider-semantic', autonomous: true, externalNetwork: true, requires: ['base URL', 'API key', 'model'] },
    ],
    boundaries: [
      'Embeddings and clusters are rebuildable projections and never replace scientific token, artifact, or evidence-object identity.',
      'Local deterministic embeddings provide lexical-dense retrieval, not deep semantic equivalence.',
      'Cluster labels are navigation aids until attributable human approval or amendment.',
      'Search results preserve exact token, JSON Pointer, IMRAD, artifact, and study provenance.',
    ],
  };
  return { ...content, capabilityHash: scientificContentHash(content) };
}

async function stateFor(input: SemanticApiInput, runId: string): Promise<PipelineState | SemanticApiResponse> {
  const state = await input.stateFor(runId);
  return state ?? { status: 404, payload: { error: 'Run not found' } };
}

function serviceFor(input: SemanticApiInput): SemanticIndexServicePort | SemanticApiResponse {
  return input.service ?? { status: 503, payload: { error: 'Semantic index service is not configured' } };
}

function pagination(query: Record<string, string> | undefined): { offset: number; limit: number } {
  const offset = Number(query?.offset ?? 0);
  const limit = Number(query?.limit ?? 100);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Semantic unit offset must be a non-negative integer.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Semantic unit limit must be an integer between 1 and 500.');
  return { offset, limit };
}

function searchRequest(body: unknown): SemanticSearchRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Semantic search requires a JSON object body.');
  const record = body as Record<string, unknown>;
  if (typeof record.query !== 'string') throw new Error('Semantic search body requires a string query.');
  return body as SemanticSearchRequest;
}

export async function handleSemanticApi(input: SemanticApiInput): Promise<SemanticApiResponse | null> {
  if (input.pathname === '/evidence-os/semantic-capabilities' && input.method === 'GET') return { status: 200, payload: capabilities() };
  const service = serviceFor(input);

  const manifestMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-index-manifest$/);
  if (manifestMatch?.[1] && input.method === 'GET') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(manifestMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.getOrBuild(runId, selected);
    return { status: 200, payload: snapshot.manifest };
  }

  const unitsMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-units$/);
  if (unitsMatch?.[1] && input.method === 'GET') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(unitsMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.getOrBuild(runId, selected);
    const { offset, limit } = pagination(input.query);
    const units = snapshot.units.slice(offset, offset + limit);
    return { status: 200, payload: { schemaVersion: 'medantir-semantic-unit-page/1', runId, indexHash: snapshot.indexHash, offset, limit, total: snapshot.units.length, units } };
  }

  const unitMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-units\/([^/]+)$/);
  if (unitMatch?.[1] && unitMatch[2] && input.method === 'GET') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(unitMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.getOrBuild(runId, selected);
    const unitId = decodeURIComponent(unitMatch[2]);
    const unit = snapshot.units.find((candidate) => candidate.unitId === unitId);
    return unit ? { status: 200, payload: unit } : { status: 404, payload: { error: 'Semantic unit not found' } };
  }

  const clustersMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-clusters$/);
  if (clustersMatch?.[1] && input.method === 'GET') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(clustersMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.getOrBuild(runId, selected);
    return { status: 200, payload: { schemaVersion: 'medantir-semantic-cluster-list/1', runId, indexHash: snapshot.indexHash, clusters: snapshot.clusters.map(publicCluster) } };
  }

  const clusterMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-clusters\/([^/]+)$/);
  if (clusterMatch?.[1] && clusterMatch[2] && input.method === 'GET') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(clusterMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.getOrBuild(runId, selected);
    const clusterId = decodeURIComponent(clusterMatch[2]);
    const cluster = snapshot.clusters.find((candidate) => candidate.clusterId === clusterId);
    if (!cluster) return { status: 404, payload: { error: 'Semantic cluster not found' } };
    const members = cluster.memberSemanticUnitIds.map((unitId) => snapshot.units.find((unit) => unit.unitId === unitId)).filter(Boolean);
    return { status: 200, payload: { cluster: publicCluster(cluster), members } };
  }

  const searchMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-search$/);
  if (searchMatch?.[1] && input.method === 'POST') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(searchMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    try {
      return { status: 200, payload: await service.search(runId, selected, searchRequest(input.body)) };
    } catch (error) {
      return { status: 400, payload: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  const rebuildMatch = input.pathname.match(/^\/runs\/([^/]+)\/semantic-index\/rebuild$/);
  if (rebuildMatch?.[1] && input.method === 'POST') {
    if ('status' in service) return service;
    const runId = decodeURIComponent(rebuildMatch[1]);
    const selected = await stateFor(input, runId);
    if ('status' in selected) return selected;
    const snapshot = await service.rebuild(runId, selected);
    return { status: 200, payload: snapshot.manifest };
  }

  return null;
}
