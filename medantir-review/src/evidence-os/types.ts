import type { ReviewType, StageName, StageStatus } from '../core/types.js';

export const EVIDENCE_OS_SCHEMA_VERSION = 'medantir-evidence-os/1' as const;
export const EVIDENCE_OBJECT_SCHEMA_VERSION = 'medantir-evidence-object/1' as const;
export const EVIDENCE_GRAPH_SCHEMA_VERSION = 'medantir-evidence-graph/1' as const;

export type EvidenceObjectKind =
  | 'question'
  | 'protocol'
  | 'search-strategy'
  | 'search-execution'
  | 'retrieved-record'
  | 'deduplicated-record'
  | 'screening-decision'
  | 'full-text'
  | 'parsed-document'
  | 'evidence-excerpt'
  | 'study'
  | 'effect-estimate'
  | 'mechanism'
  | 'risk-of-bias'
  | 'certainty-assessment'
  | 'synthesis'
  | 'causal-claim'
  | 'causal-graph'
  | 'recommendation'
  | 'report'
  | 'verification-decision'
  | 'registry-receipt'
  | 'audit-event'
  | 'pipeline-stage'
  | 'cost-receipt'
  | 'living-review-event'
  | 'artifact';

export type EvidenceSourceClass =
  | 'user-input'
  | 'protocol'
  | 'bibliographic-api'
  | 'registry-api'
  | 'institutional-bridge'
  | 'full-text'
  | 'supplement'
  | 'derived-deterministically'
  | 'model-proposed'
  | 'human-adjudicated'
  | 'system-audit';

export interface EvidenceLocator {
  sourceObjectId?: string;
  recordId?: string;
  studyId?: string;
  uri?: string;
  page?: number;
  section?: string;
  quote?: string;
  tableOrFigure?: string;
  coordinates?: { x: number; y: number; width: number; height: number; unit: 'pt'; origin: 'top-left' };
}

export interface EvidenceProvenance {
  sourceClass: EvidenceSourceClass;
  sourceIds: string[];
  locators: EvidenceLocator[];
  actorId?: string;
  method?: string;
  software?: string;
  model?: string;
  provider?: string;
  requestHash?: string;
  outputHash?: string;
}

export interface EvidenceObject<T = unknown> {
  schemaVersion: typeof EVIDENCE_OBJECT_SCHEMA_VERSION;
  objectId: string;
  logicalId: string;
  kind: EvidenceObjectKind;
  version: number;
  contentHash: string;
  createdAt: string;
  sourceStage?: StageName;
  payload: T;
  provenance: EvidenceProvenance[];
  supersedes: string[];
  immutable: true;
}

export type EvidenceEdgeRelation =
  | 'depends-on'
  | 'produced-by'
  | 'derived-from'
  | 'retrieved-as'
  | 'deduplicated-to'
  | 'screened-by'
  | 'included-as'
  | 'parsed-as'
  | 'extracts'
  | 'supports'
  | 'contradicts'
  | 'appraised-by'
  | 'contributes-to'
  | 'graded-by'
  | 'reported-in'
  | 'verified-by'
  | 'supersedes'
  | 'updates';

export interface EvidenceGraphEdge {
  edgeId: string;
  fromObjectId: string;
  toObjectId: string;
  relation: EvidenceEdgeRelation;
  evidenceObjectIds: string[];
  metadata: Record<string, unknown>;
}

export interface EvidenceGraphSummary {
  objectCount: number;
  edgeCount: number;
  objectCountsByKind: Partial<Record<EvidenceObjectKind, number>>;
  sourceBoundObjectCount: number;
  humanAdjudicatedObjectCount: number;
  modelProposedObjectCount: number;
}

export interface EvidenceGraphSnapshot {
  schemaVersion: typeof EVIDENCE_GRAPH_SCHEMA_VERSION;
  reviewType: ReviewType;
  graphHash: string;
  generatedAt: string;
  rootObjectIds: string[];
  objects: EvidenceObject[];
  edges: EvidenceGraphEdge[];
  summary: EvidenceGraphSummary;
  metadata: Record<string, unknown>;
}

export type CapabilityStatus =
  | 'operational'
  | 'operational-human-gated'
  | 'partial'
  | 'research-only'
  | 'external-certification-required'
  | 'planned';

export interface EvidenceOsCapability {
  id: string;
  label: string;
  status: CapabilityStatus;
  implementation: string[];
  proof: string[];
  limitations: string[];
  apiRoutes?: string[];
}

export interface EvidenceOsModule {
  id: string;
  label: string;
  purpose: string;
  capabilities: EvidenceOsCapability[];
}

export interface EvidenceOsRuntimeProfile {
  workflowBackend: 'in-process-durable';
  queueModel: 'single-replica-copy-on-write';
  persistence: 'hash-chained-file-checkpoints';
  objectModel: 'immutable-content-addressed';
  api: 'REST';
  authentication: 'Cognito-access-token';
  authorization: 'owner-and-project-scoped';
  deployment: 'container-and-single-replica-kubernetes';
  horizontalScaleReady: false;
}

export interface EvidenceOsArchitectureManifest {
  schemaVersion: typeof EVIDENCE_OS_SCHEMA_VERSION;
  product: 'MEDANTIR Evidence OS';
  version: string;
  generatedAt: string;
  manifestHash: string;
  modules: EvidenceOsModule[];
  runtime: EvidenceOsRuntimeProfile;
  coverage: Record<CapabilityStatus, number>;
  boundaries: string[];
}

export type WorkflowExecutionClass = 'deterministic' | 'external-io' | 'human-gated' | 'mixed';

export interface EvidenceWorkflowNode {
  nodeId: string;
  stage: StageName;
  position: number;
  dependsOn: string[];
  requiredArtifacts: string[];
  producedArtifacts: string[];
  maxRetries: number;
  humanGate: 'never' | 'always' | 'on-warning';
  executionClass: WorkflowExecutionClass;
  status?: StageStatus;
}

export interface EvidenceWorkflowPlan {
  schemaVersion: 'medantir-evidence-workflow/1';
  reviewType: ReviewType;
  workflowHash: string;
  generatedAt: string;
  acyclic: true;
  topologicalOrder: string[];
  nodes: EvidenceWorkflowNode[];
  backend: {
    current: 'in-process-durable';
    resumable: true;
    checkpointed: true;
    externalActionReconciliation: true;
    distributedExecution: false;
    supportedFutureBackends: Array<'Temporal' | 'Dagster' | 'Prefect' | 'Airflow'>;
  };
}

export type WorkflowJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WorkflowJobSnapshot {
  jobId: string;
  runId: string;
  kind: 'review-pipeline' | 'living-search' | 'report-regeneration' | 'verification-replay';
  status: WorkflowJobStatus;
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRuntimeSnapshot {
  schemaVersion: 'medantir-workflow-runtime/1';
  backend: 'in-process-durable';
  mode: 'single-replica';
  generatedAt: string;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  jobs: WorkflowJobSnapshot[];
}

export interface ModelCostEntry {
  entryId: string;
  sourcePath: string;
  requestedModel?: string;
  actualModel?: string;
  provider?: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
}

export interface EvidenceCostLedger {
  schemaVersion: 'medantir-cost-ledger/1';
  generatedAt: string;
  ledgerHash: string;
  entries: ModelCostEntry[];
  totals: {
    calls: number;
    pricedCalls: number;
    unpricedCalls: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number;
  };
}

export interface ReproducibilityBundle {
  schemaVersion: 'medantir-reproducibility-bundle/1';
  generatedAt: string;
  bundleHash: string;
  workflow: EvidenceWorkflowPlan;
  graph: EvidenceGraphSnapshot;
  costLedger: EvidenceCostLedger;
  scientificRunManifest: unknown;
  scientificRunSeal: unknown;
  protocolChecksum?: string;
  finalReportHash?: string;
}
