import type { PipelineState, StageName } from './types.js';
import { scientificContentHash } from './canonical-hash.js';
import {
  verifyScientificRunSeal,
  type ScientificArtifactPlane,
  type ScientificArtifactReceipt,
  type ScientificRunLedger,
  type ScientificRunManifest,
  type ScientificRunSeal,
  type ScientificStageAttemptReceipt,
} from './scientific-run-manifest.js';
import { VERIFIER_READABLE_ARTIFACTS } from './verifier-policy.js';

export const VERIFIER_GRAPH_SCHEMA_VERSION = 'medantir-verifier-graph/1';

export type VerifierGraphNode =
  | {
      id: string;
      type: 'stage';
      stage: StageName;
      status: string;
    }
  | {
      id: string;
      type: 'module';
      moduleId: string;
      version: string;
      authority: string;
      contractHash: string;
    }
  | {
      id: string;
      type: 'attempt';
      stage: StageName;
      ordinal: number;
      attempt: number;
      status: ScientificStageAttemptReceipt['status'];
      cognitiveAction?: string;
    }
  | {
      id: string;
      type: 'artifact';
      key: string;
      hash: string;
      current: boolean;
      plane: ScientificArtifactPlane | 'historical';
      readable: boolean;
    };

export type VerifierGraphEdgeType =
  | 'ATTEMPT_OF'
  | 'MODULE_OBSERVED_IN'
  | 'MODULE_GOVERNS_ATTEMPT'
  | 'USED'
  | 'PRODUCED'
  | 'REWORK_FROM'
  | 'CURRENT_FROM';

export interface VerifierGraphEdge {
  id: string;
  type: VerifierGraphEdgeType;
  from: string;
  to: string;
}

export interface VerifierRunGraph {
  schemaVersion: typeof VERIFIER_GRAPH_SCHEMA_VERSION;
  runId: string;
  sealDigest: string;
  sealValid: true;
  nodes: VerifierGraphNode[];
  edges: VerifierGraphEdge[];
  counts: {
    stages: number;
    modules: number;
    attempts: number;
    currentArtifacts: number;
    historicalArtifactVersions: number;
    replayEdges: number;
  };
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function requiredControls(state: PipelineState): {
  manifest: ScientificRunManifest;
  seal: ScientificRunSeal;
  lineage: ScientificArtifactReceipt[];
  ledger: ScientificRunLedger;
} {
  const manifest = state.artifacts.scientificRunManifest as ScientificRunManifest | undefined;
  const seal = state.artifacts.scientificRunSeal as ScientificRunSeal | undefined;
  const lineage = Array.isArray(state.artifacts.scientificArtifactLineage)
    ? state.artifacts.scientificArtifactLineage as ScientificArtifactReceipt[]
    : undefined;
  const ledger = state.artifacts.scientificRunLedger as ScientificRunLedger | undefined;
  if (!manifest || !seal || !lineage || !ledger) throw httpError(404, 'Scientific verifier bundle is not available for this run yet.');
  if (!verifyScientificRunSeal(manifest, seal)) throw httpError(409, 'Scientific run seal verification failed.');
  return { manifest, seal, lineage, ledger };
}

function stageId(stage: string): string {
  return `stage:${stage}`;
}

function moduleId(id: string): string {
  return `module:${id}`;
}

function attemptId(receipt: ScientificStageAttemptReceipt, ordinal: number): string {
  return `attempt:${receipt.stage}:${ordinal}:${receipt.attempt}`;
}

function artifactId(key: string, hash: string): string {
  return `artifact:${encodeURIComponent(key)}:${hash.slice(0, 24)}`;
}

function edgeId(type: VerifierGraphEdgeType, from: string, to: string): string {
  return `edge:${type}:${scientificContentHash({ from, to }).slice(0, 20)}`;
}

function addEdge(edges: VerifierGraphEdge[], type: VerifierGraphEdgeType, from: string, to: string): void {
  const id = edgeId(type, from, to);
  if (!edges.some((edge) => edge.id === id)) edges.push({ id, type, from, to });
}

function currentReceiptByKey(lineage: ScientificArtifactReceipt[]): Map<string, ScientificArtifactReceipt> {
  return new Map(lineage.map((receipt) => [receipt.key, receipt]));
}

function artifactVersionNode(
  nodes: Map<string, VerifierGraphNode>,
  key: string,
  hash: string,
  currentReceipt: ScientificArtifactReceipt | undefined,
): string {
  const id = artifactId(key, hash);
  if (nodes.has(id)) return id;
  const current = currentReceipt?.hash === hash;
  nodes.set(id, {
    id,
    type: 'artifact',
    key,
    hash,
    current,
    plane: current ? currentReceipt!.plane : 'historical',
    readable: current && VERIFIER_READABLE_ARTIFACTS.has(key),
  });
  return id;
}

/**
 * Build a verifier-safe run graph using only sealed/receipted metadata.
 *
 * No artifact body is inspected or copied into the graph. Historical artifact
 * versions are represented only by key + scientific hash, allowing replay and
 * abandoned outputs to remain auditable without exposing their contents.
 */
export function buildVerifierRunGraph(state: PipelineState): VerifierRunGraph {
  const { manifest, seal, lineage, ledger } = requiredControls(state);
  const nodes = new Map<string, VerifierGraphNode>();
  const edges: VerifierGraphEdge[] = [];
  const currentByKey = currentReceiptByKey(lineage);

  for (const [stage, status] of Object.entries(manifest.stageStatuses)) {
    nodes.set(stageId(stage), {
      id: stageId(stage),
      type: 'stage',
      stage: stage as StageName,
      status,
    });
  }

  for (const contract of manifest.sealedContent.moduleContracts) {
    nodes.set(moduleId(contract.id), {
      id: moduleId(contract.id),
      type: 'module',
      moduleId: contract.id,
      version: contract.version,
      authority: contract.authority,
      contractHash: contract.contractHash,
    });
  }

  for (const receipt of lineage) {
    const id = artifactVersionNode(nodes, receipt.key, receipt.hash, receipt);
    if (receipt.producerStage) addEdge(edges, 'CURRENT_FROM', id, stageId(receipt.producerStage));
  }

  ledger.attempts.forEach((receipt, index) => {
    const ordinal = index + 1;
    const aId = attemptId(receipt, ordinal);
    nodes.set(aId, {
      id: aId,
      type: 'attempt',
      stage: receipt.stage,
      ordinal,
      attempt: receipt.attempt,
      status: receipt.status,
      ...(receipt.cognitiveAction ? { cognitiveAction: receipt.cognitiveAction } : {}),
    });
    addEdge(edges, 'ATTEMPT_OF', aId, stageId(receipt.stage));

    for (const governedBy of receipt.moduleIds) {
      const mId = moduleId(governedBy);
      addEdge(edges, 'MODULE_GOVERNS_ATTEMPT', mId, aId);
      addEdge(edges, 'MODULE_OBSERVED_IN', mId, stageId(receipt.stage));
    }

    for (const [key, hash] of Object.entries(receipt.declaredInputs)) {
      const artifact = artifactVersionNode(nodes, key, hash, currentByKey.get(key));
      addEdge(edges, 'USED', aId, artifact);
    }

    for (const [key, hash] of Object.entries(receipt.changedOutputs)) {
      if (!hash) continue;
      const artifact = artifactVersionNode(nodes, key, hash, currentByKey.get(key));
      addEdge(edges, 'PRODUCED', aId, artifact);
      if (currentByKey.get(key)?.hash === hash) addEdge(edges, 'CURRENT_FROM', artifact, aId);
    }

    if (receipt.reworkFrom) addEdge(edges, 'REWORK_FROM', aId, stageId(receipt.reworkFrom));
  });

  const values = [...nodes.values()];
  return {
    schemaVersion: VERIFIER_GRAPH_SCHEMA_VERSION,
    runId: state.runId,
    sealDigest: seal.digest,
    sealValid: true,
    nodes: values.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    counts: {
      stages: values.filter((node) => node.type === 'stage').length,
      modules: values.filter((node) => node.type === 'module').length,
      attempts: values.filter((node) => node.type === 'attempt').length,
      currentArtifacts: values.filter((node) => node.type === 'artifact' && node.current).length,
      historicalArtifactVersions: values.filter((node) => node.type === 'artifact' && !node.current).length,
      replayEdges: edges.filter((edge) => edge.type === 'REWORK_FROM').length,
    },
  };
}
