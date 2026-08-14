import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
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
  stateFor(runId: string): Promise<PipelineState | undefined>;
  graphFor?(runId: string, state: PipelineState): Promise<EvidenceGraphSnapshot | null>;
  runtimeSnapshot?: () => WorkflowRuntimeSnapshot;
  now?: () => string;
}

function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MEDANTIR Evidence OS API',
      version: '0.6.0',
      description: 'Read-only immutable evidence graph, workflow, cost, architecture, and reproducibility surfaces layered over the authenticated review service.',
    },
    paths: {
      '/evidence-os/architecture': { get: { summary: 'Capability and production-boundary manifest' } },
      '/evidence-os/openapi': { get: { summary: 'This OpenAPI document' } },
      '/runs/{runId}/evidence-os': { get: { summary: 'Evidence OS run summary' } },
      '/runs/{runId}/evidence-graph': { get: { summary: 'Latest checkpoint-bound immutable evidence graph' } },
      '/runs/{runId}/evidence-objects/{objectId}': { get: { summary: 'One content-addressed evidence object' } },
      '/runs/{runId}/workflow-plan': { get: { summary: 'Deterministic review workflow DAG' } },
      '/runs/{runId}/cost-ledger': { get: { summary: 'Model routing and cost ledger' } },
      '/runs/{runId}/reproducibility-bundle': { get: { summary: 'Graph, workflow, costs, manifest, and scientific seal' } },
    },
  };
}

export function buildReproducibilityBundle(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
  persistedGraph?: EvidenceGraphSnapshot,
): ReproducibilityBundle {
  const workflow = buildEvidenceWorkflowPlan(state.request.reviewType, state, generatedAt);
  const graph = persistedGraph ?? projectPipelineToEvidenceGraph(state, generatedAt);
  const costLedger = buildEvidenceCostLedger(state, generatedAt);
  const protocolPackage = state.artifacts.protocolPackage as { checksum?: unknown } | undefined;
  const finalReport = state.artifacts.finalReport;
  const content = {
    schemaVersion: 'medantir-reproducibility-bundle/1' as const,
    generatedAt,
    workflow,
    graph,
    costLedger,
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
  if (input.method !== 'GET') return null;
  const now = input.now?.() ?? new Date().toISOString();
  if (input.pathname === '/evidence-os/architecture') {
    return { status: 200, payload: buildEvidenceOsArchitectureManifest(now) };
  }
  if (input.pathname === '/evidence-os/openapi') {
    return { status: 200, payload: openApiDocument() };
  }

  const summaryMatch = input.pathname.match(/^\/runs\/([^/]+)\/evidence-os$/);
  if (summaryMatch?.[1]) {
    const runId = decodeURIComponent(summaryMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    const workflow = buildEvidenceWorkflowPlan(selected.request.reviewType, selected, now);
    const graph = await graphFor(input, runId, selected, now);
    const costLedger = buildEvidenceCostLedger(selected, now);
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

  const bundleMatch = input.pathname.match(/^\/runs\/([^/]+)\/reproducibility-bundle$/);
  if (bundleMatch?.[1]) {
    const runId = decodeURIComponent(bundleMatch[1]);
    const selected = await runState(input, runId);
    if ('status' in selected) return selected;
    const graph = await graphFor(input, runId, selected, now);
    return { status: 200, payload: buildReproducibilityBundle(selected, now, graph) };
  }

  return null;
}
