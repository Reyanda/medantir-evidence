import type { ImradRole } from '../tokenisation/types.js';

export const SEMANTIC_UNIT_SCHEMA_VERSION = 'medantir-semantic-unit/1' as const;
export const SEMANTIC_EMBEDDING_SCHEMA_VERSION = 'medantir-semantic-embedding/1' as const;
export const SEMANTIC_INDEX_SCHEMA_VERSION = 'medantir-semantic-index/1' as const;
export const SEMANTIC_CLUSTER_SCHEMA_VERSION = 'medantir-semantic-cluster/1' as const;

export type SemanticUnitType =
  | 'artifact'
  | 'section'
  | 'passage'
  | 'sentence'
  | 'claim'
  | 'extraction-field'
  | 'outcome'
  | 'estimand'
  | 'effect-estimate'
  | 'mechanism'
  | 'study'
  | 'table-row';

export type SemanticEmbeddingClass = 'deterministic-lexical-dense' | 'provider-semantic';
export type SemanticNormalization = 'none' | 'l2';
export type SemanticClusterLabelStatus = 'machine-proposed' | 'human-approved' | 'human-amended';

export type SemanticMetadataValue = string | number | boolean | string[] | number[] | null;

export interface SemanticUnit {
  schemaVersion: typeof SEMANTIC_UNIT_SCHEMA_VERSION;
  unitId: string;
  unitType: SemanticUnitType;
  artifactKey: string;
  artifactHash: string;
  tokenDocumentHash: string;
  tokenIds: string[];
  jsonPointers: string[];
  imradRole: ImradRole;
  semanticRoles: string[];
  text: string;
  normalizedText: string;
  textHash: string;
  sourceObjectIds: string[];
  metadata: Record<string, SemanticMetadataValue>;
  createdAt: string;
}

export interface SemanticEmbeddingProfile {
  provider: string;
  model: string;
  modelVersion?: string;
  dimensions?: number;
  normalization: SemanticNormalization;
  embeddingClass: SemanticEmbeddingClass;
}

export interface ResolvedSemanticEmbeddingProfile extends SemanticEmbeddingProfile {
  dimensions: number;
}

export interface SemanticEmbeddingReceipt {
  requestId?: string;
  inputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface SemanticEmbeddingBatch {
  profile: ResolvedSemanticEmbeddingProfile;
  vectors: number[][];
  receipts: SemanticEmbeddingReceipt[];
}

export interface SemanticEmbeddingPort {
  readonly profile: SemanticEmbeddingProfile;
  embed(texts: string[]): Promise<SemanticEmbeddingBatch>;
}

export interface SemanticEmbedding {
  schemaVersion: typeof SEMANTIC_EMBEDDING_SCHEMA_VERSION;
  embeddingId: string;
  semanticUnitId: string;
  unitTextHash: string;
  profile: ResolvedSemanticEmbeddingProfile;
  vector: number[];
  vectorHash: string;
  generatedAt: string;
}

export interface SemanticCluster {
  schemaVersion: typeof SEMANTIC_CLUSTER_SCHEMA_VERSION;
  clusterId: string;
  clusterRunId: string;
  unitType: SemanticUnitType;
  memberSemanticUnitIds: string[];
  centroid: number[];
  centroidHash: string;
  topTerms: string[];
  machineLabel: string;
  labelStatus: SemanticClusterLabelStatus;
  stability: number;
  generatedAt: string;
}

export interface SemanticIndexManifest {
  schemaVersion: 'medantir-semantic-index-manifest/1';
  runId: string;
  sourceStateHash: string;
  tokenisationManifestHash: string;
  unitProjectionVersion: string;
  embedding: ResolvedSemanticEmbeddingProfile;
  generatedAt: string;
  indexHash: string;
  manifestHash: string;
  counts: {
    units: number;
    embeddings: number;
    clusters: number;
    unitsByType: Partial<Record<SemanticUnitType, number>>;
    unitsByImradRole: Partial<Record<ImradRole, number>>;
  };
  embeddingReuse: {
    reused: number;
    generated: number;
  };
  embeddingUsage: {
    requests: number;
    inputTokens: number;
    pricedRequests: number;
    costUsd: number;
    latencyMs: number;
  };
  warnings: string[];
}

export interface SemanticIndexSnapshot {
  schemaVersion: typeof SEMANTIC_INDEX_SCHEMA_VERSION;
  runId: string;
  sourceStateHash: string;
  tokenisationManifestHash: string;
  unitProjectionVersion: string;
  generatedAt: string;
  units: SemanticUnit[];
  embeddings: SemanticEmbedding[];
  embeddingReceipts: SemanticEmbeddingReceipt[];
  clusters: SemanticCluster[];
  indexHash: string;
  manifest: SemanticIndexManifest;
}

export interface SemanticSearchFilters {
  unitTypes?: SemanticUnitType[];
  imradRoles?: ImradRole[];
  semanticRoles?: string[];
  artifactKeys?: string[];
  studyIds?: string[];
  clusterIds?: string[];
}

export interface SemanticSearchRequest {
  query: string;
  topK?: number;
  filters?: SemanticSearchFilters;
  denseWeight?: number;
  lexicalWeight?: number;
  exactPhraseWeight?: number;
}

export interface SemanticSearchResult {
  rank: number;
  unit: SemanticUnit;
  clusterIds: string[];
  score: number;
  denseScore: number;
  lexicalScore: number;
  exactPhraseScore: number;
}

export interface SemanticSearchResponse {
  schemaVersion: 'medantir-semantic-search-response/1';
  query: string;
  queryHash: string;
  indexHash: string;
  embedding: ResolvedSemanticEmbeddingProfile;
  results: SemanticSearchResult[];
  warnings: string[];
  searchHash: string;
}

export interface SemanticIndexRepository {
  getLatest(runId: string): Promise<SemanticIndexSnapshot | null>;
  put(snapshot: SemanticIndexSnapshot): Promise<void>;
}

export interface SemanticIndexServicePort {
  getOrBuild(runId: string, state: import('../core/types.js').PipelineState): Promise<SemanticIndexSnapshot>;
  rebuild(runId: string, state: import('../core/types.js').PipelineState): Promise<SemanticIndexSnapshot>;
  search(runId: string, state: import('../core/types.js').PipelineState, request: SemanticSearchRequest): Promise<SemanticSearchResponse>;
}
