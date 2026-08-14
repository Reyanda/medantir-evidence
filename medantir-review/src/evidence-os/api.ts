import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
import { handleSemanticApi } from '../semantic/api.js';
import type { SemanticIndexManifest, SemanticIndexServicePort } from '../semantic/types.js';
import {
  EXTRACTION_FIELD_CONTRACTS,
  artifactValueForKey,
  buildArtifactTokenisationManifest,
  findExtractedStudies,
  tokenisableArtifacts,
  tokeniseArtifact,
  validateExtractedStudyImrad,
} from '../tokenisation/index.js';
import { buildEvidenceOsArchitectureManifest } from './architecture.js';
import { buildEvidenceCostLedger } from './cost-ledger.js';
import { projectPipelineToEvidenceGraph } from './projector.js';
import { buildEvidenceWorkflowPlan } from './workflow.js';
import type {
  EvidenceGraphSnapshot,
  ReproducibilityBundle,
  WorkflowRuntimeSnapshot,
} from './types.js';

export interface EvidenceOsApiResponse {
  status: number;
  payload: unknown;
}

export interface EvidenceOsApiInput {
  method?: string;
  pathname: string;
  query?: Record<string, string>;
  body?: unknown;
  stateFor(runId: string): Promise<PipelineState | undefined>;
  graphFor?(runId: string, state: PipelineState): Promise<EvidenceGraphSnapshot | null>;
  semanticIndexService?: SemanticIndexServicePort;
  runtimeSnapshot?: () => WorkflowRuntimeSnapshot;
  now?: () => string;
}

function extractionContractRegistry() {
  const content = {
    schemaVersion: 'medantir-extraction-field-contract-registry/1' as const,
    contracts: EXTRACTION_FIELD_CONTRACTS,
  };
  return { ...content, registryHash: scientificContentHash(content) };
}

function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MEDANTIR Evidence OS API',
      version: '0.8.0',
      description: 'Immutable evidence graph, artifact tokenisation, IMRAD extraction contracts, semantic evidence indexing, hybrid retrieval, clustering, workflow, cost, and reproducibility surfaces layered over the authenticated review service.',
    },
    paths: {
      '/evidence-os/architecture': { get: { summary: 'Capability and production-boundary manifest' } },
      '/evidence-os/openapi': { get: { summary: 'This OpenAPI document' } },
      '/evidence-os/extraction-field-contracts': { get: { summary: 'Versioned extraction-field and IMRAD contract registry' } },
      '/evidence-os/semantic-capabilities': { get: { summary: 'Semantic unit, embedding, retrieval, and clustering capability manifest' } },
      '/runs/{runId}/evidence-os': { get: { summary: 'Evidence OS run summary' } },
      '/runs/{runId}/evidence-graph': { get: { summary: 'Latest checkpoint-bound immutable evidence graph' } },
      '/runs/{runId}/evidence-objects/{objectId}': { get: { summary: 'One content-addressed evidence object' } },
      '/runs/{runId}/workflow-plan': { get: { summary: 'Deterministic review workflow DAG' } },
      '/runs/{runId}/cost-ledger': { get: { summary: 'Model routing and cost ledger' } },
      '/runs/{runId}/tokenisation-manifest': { get: { summary: 'Token counts, hashes, IMRAD coverage, and extraction-contract debt for every run artifact' } },
      '/runs/{runId}/artifact-tokens/{artifactKey}': { get: { summary: 'Stable structural and lexical tokens for one run artifact' } },
      '/runs/{runId}/extraction-validation': { get: { summary: 'IMRAD-bound extraction-field validation for every extracted study object' } },
      '/runs/{runId}/semantic-index-manifest': { get: { summary: 'Versioned semantic-index identity, embedding profile, counts, cost receipts, and limitations' } },
      '/runs/{runId}/semantic-units': { get: { summary: 'Paginated source-bound semantic units without exposing raw vectors' } },
      '/runs/{runId}/semantic-units/{semanticUnitId}': { get: { summary: 'One token-anchored semantic unit' } },
      '/runs/{runId}/semantic-clusters': { get: { summary: 'Deterministic semantic clusters and machine-proposed labels' } },
      '/runs/{runId}/semantic-clusters/{clusterId}': { get: { summary: 'One semantic cluster with source-bound member units' } },
      '/runs/{runId}/semantic-search': { post: { summary: 'Hybrid dense, BM25, exact-phrase, and metadata-filtered evidence retrieval' } },
      '/runs/{runId}/semantic-index/rebuild': { post: { summary: 'Force a versioned semantic-index rebuild using the configured embedding port' } },
      '/runs/{runId}/reproducibility-bundle': { get: { summary: 'Graph, workflow, tokenisation, semantic-index manifest, costs, scientific manifest, and seal' } },
    },
  };
}

export function buildReproducibilityBundle(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
  persistedGraph?: EvidenceGraphSnapshot,
  semanticIndexManifest?: SemanticIndexManifest,
): ReproducibilityBundle {
  const workflow = buildEvidenceWorkflowPlan(state.request.reviewType, state, generatedAt);
  const graph = persistedGraph ?? projectPipelineToEvidenceGraph(state, generatedAt);
  const costLedger = buildEvidenceCostLedger(state, generatedAt);
  const tokenisationManifest = buildArtifactTokenisationManifest(state, generatedAt);
  const protocolPackage = state.artifacts.protocolPackage as { checksum?: unknown } | undefined;
  const finalReport = state.artifacts.finalReport;
  const content = {
    schemaVersion: 'medantir-reproducibility-bundle/1' as const,
    generatedAt,
    workflow,
    graph,
    costLedger,
    tokenisationManifest,
    ...(semanticIndexManifest ? { semanticIndexManifest } : {}),
    scientificRunManifest: state.artifacts.scientificRunManifest ?? null,
    scientificRunSeal: state.artifacts.scientificRunSeal ?? null,
    ...(typeof protocolPackage?.checksum === 'string' ? { protocolChecksum: protocolPackage.checksum } : {}),
    ...(finalReport !== undefined ? { finalReportHash: scientificContentHash(finalReport) } : {}),
  };
  return {
    ...content,
    bundleHash: scientificContentHash(content),
  };
}

async function runState(input: EvidenceOsApiInput, runId: string): Promise<PipelineState | EvidenceOsApiResponse> {
  const state = await input.stateFor(runId);
  return state ?? { status: 404, payload: { error: 'Run not found' } };
}

async function graphFor(
  input: EvidenceOsApiInput,
  runId: string,
  state: PipelineState,
  generatedAt: string,
): Promise<EvidenceGraphSnapshot> {
  const persisted = input.graphFor ? await input.graphFor(runId, state) : null;
  return persisted ?? projectPipelineToEvidenceGraph(state, generatedAt);
}

export async function handleEvidenceOsApi(input: EvidenceOsApiInput): Promise<EvidenceOsApiResponse | null> {
  const semantic = await handleSemanticApi({
    ...(input.method ? { method: input.method } : {}),
    pathname: input.pathname,
    ...(input.query ? { query: input.query } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    stateFor: input.stateFor,
    ...(input.semanticIndexService ? { service: input.semanticIndexService } : {}),
  });
  if (semantic) return semantic;
  if (input.method !== 'GET') return null;
  const now = input.now?.() ?? new Date().toISOString();
  if (input.pathname === '/evidence-os/architecture') {
    return { status: 200, payload: buildEvidenceOsArchitectureManifest(now) };
  }
  if (input.pathname === '/evidence-os/openapi') {
    return { status: 200, payload: openApiDocument() };
  }
  if (input.pathname === '/evidence-os/extraction-field-contracts') {
    return { status: 200, payload: extractionContractRegistry() };
  }

  const summaryMatch = input.pathname.match(/^\/runs\/([^/]+)\/evidence-os$/);
  if (summaryMatch?.[1]) {
    const runId = decodeURIComponent(summaryMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    const workflow = buildEvidenceWorkflowPlan(selected.request.reviewType, selected, now);
    const graph = await graphFor(input, runId, selected, now);
    const costLedger = buildEvidenceCostLedger(selected, now);
    const tokenisation = buildArtifactTokenisationManifest(selected, now);
    const semanticIndex = input.semanticIndexService
      ? (await input.semanticIndexService.getOrBuild(runId, selected)).manifest
      : null;
    return {
      status: 200,
      payload: {
        runId: selected.runId,
        reviewType: selected.request.reviewType,
        architecture: buildEvidenceOsArchitectureManifest(now),
        workflow: {
          workflowHash: workflow.workflowHash,
          nodes: workflow.nodes.length,
          currentBackend: workflow.backend.current,
          distributedExecution: workflow.backend.distributedExecution,
        },
        graph: { graphHash: graph.graphHash, ...graph.summary },
        costs: costLedger.totals,
        tokenisation: { manifestHash: tokenisation.manifestHash, ...tokenisation.totals },
        semanticIndex,
        runtime: input.runtimeSnapshot?.() ?? null,
        scientificRunManifest: selected.artifacts.scientificRunManifest ?? null,
        scientificRunSeal: selected.artifacts.scientificRunSeal ?? null,
      },
    };
  }

  const graphMatch = input.pathname.match(/^\/runs\/([^/]+)\/evidence-graph$/);
  if (graphMatch?.[1]) {
    const runId = decodeURIComponent(graphMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    return { status: 200, payload: await graphFor(input, runId, selected, now) };
  }

  const objectMatch = input.pathname.match(/^\/runs\/([^/]+)\/evidence-objects\/([^/]+)$/);
  if (objectMatch?.[1] && objectMatch[2]) {
    const runId = decodeURIComponent(objectMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    const graph = await graphFor(input, runId, selected, now);
    const objectId = decodeURIComponent(objectMatch[2]);
    const object = graph.objects.find((candidate) => candidate.objectId === objectId);
    return object ? { status: 200, payload: object } : { status: 404, payload: { error: 'Evidence object not found' } };
  }

  const workflowMatch = input.pathname.match(/^\/runs\/([^/]+)\/workflow-plan$/);
  if (workflowMatch?.[1]) {
    const selected = await runState(input, decodeURIComponent(workflowMatch[1]));
    if ('status' in selected) return selected;
    return { status: 200, payload: buildEvidenceWorkflowPlan(selected.request.reviewType, selected, now) };
  }

  const costMatch = input.pathname.match(/^\/runs\/([^/]+)\/cost-ledger$/);
  if (costMatch?.[1]) {
    const selected = await runState(input, decodeURIComponent(costMatch[1]));
    if ('status' in selected) return selected;
    return { status: 200, payload: buildEvidenceCostLedger(selected, now) };
  }

  const tokenisationMatch = input.pathname.match(/^\/runs\/([^/]+)\/tokenisation-manifest$/);
  if (tokenisationMatch?.[1]) {
    const selected = await runState(input, decodeURIComponent(tokenisationMatch[1]));
    if ('status' in selected) return selected;
    return { status: 200, payload: buildArtifactTokenisationManifest(selected, now) };
  }

  const artifactTokensMatch = input.pathname.match(/^\/runs\/([^/]+)\/artifact-tokens\/([^/]+)$/);
  if (artifactTokensMatch?.[1] && artifactTokensMatch[2]) {
    const selected = await runState(input, decodeURIComponent(artifactTokensMatch[1]));
    if ('status' in selected) return selected;
    const artifactKey = decodeURIComponent(artifactTokensMatch[2]);
    try {
      return { status: 200, payload: tokeniseArtifact(artifactKey, artifactValueForKey(selected, artifactKey), now) };
    } catch (error) {
      return { status: 404, payload: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  const extractionValidationMatch = input.pathname.match(/^\/runs\/([^/]+)\/extraction-validation$/);
  if (extractionValidationMatch?.[1]) {
    const selected = await runState(input, decodeURIComponent(extractionValidationMatch[1]));
    if ('status' in selected) return selected;
    const reports = tokenisableArtifacts(selected).flatMap(({ artifactKey, value }) => findExtractedStudies(value).map((study) => ({ artifactKey, validation: validateExtractedStudyImrad(study) })));
    const content = { schemaVersion: 'medantir-run-extraction-validation/1' as const, runId: selected.runId, reports };
    return { status: 200, payload: { ...content, validationHash: scientificContentHash(content) } };
  }

  const bundleMatch = input.pathname.match(/^\/runs\/([^/]+)\/reproducibility-bundle$/);
  if (bundleMatch?.[1]) {
    const runId = decodeURIComponent(bundleMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    const graph = await graphFor(input, runId, selected, now);
    const semanticIndexManifest = input.semanticIndexService
      ? (await input.semanticIndexService.getOrBuild(runId, selected)).manifest
      : undefined;
    return { status: 200, payload: buildReproducibilityBundle(selected, now, graph, semanticIndexManifest) };
  }

  return null;
}
