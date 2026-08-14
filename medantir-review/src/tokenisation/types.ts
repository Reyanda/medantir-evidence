import type { EvidenceSectionName } from '../core/types.js';

export const ARTIFACT_TOKEN_DOCUMENT_SCHEMA = 'medantir-artifact-token-document/1' as const;
export const ARTIFACT_TOKENISATION_MANIFEST_SCHEMA = 'medantir-artifact-tokenisation-manifest/1' as const;
export const EXTRACTION_FIELD_CONTRACT_SCHEMA = 'medantir-extraction-field-contract/1' as const;

export type ImradRole =
  | 'title'
  | 'abstract'
  | 'introduction'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'limitations'
  | 'references'
  | 'supplement'
  | 'front-matter'
  | 'other'
  | 'not-applicable';

export type ArtifactTokenKind =
  | 'object-start'
  | 'object-end'
  | 'array-start'
  | 'array-end'
  | 'field'
  | 'array-item'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'word'
  | 'identifier'
  | 'citation'
  | 'operator'
  | 'punctuation';

export interface ArtifactToken {
  tokenId: string;
  sequence: number;
  artifactKey: string;
  jsonPointer: string;
  parentTokenId: string | null;
  kind: ArtifactTokenKind;
  imradRole: ImradRole;
  semanticRoles: string[];
  text?: string;
  normalized?: string;
  startOffset?: number;
  endOffset?: number;
  characterLength?: number;
  valueHash?: string;
}

export interface ArtifactTokenDocument {
  schemaVersion: typeof ARTIFACT_TOKEN_DOCUMENT_SCHEMA;
  artifactKey: string;
  artifactHash: string;
  documentHash: string;
  generatedAt: string;
  tokens: ArtifactToken[];
  counts: {
    total: number;
    structural: number;
    lexical: number;
    byKind: Partial<Record<ArtifactTokenKind, number>>;
    byImradRole: Partial<Record<ImradRole, number>>;
  };
  modelBudget: {
    method: 'utf8-four-byte-estimate';
    estimatedTokens: number;
    exact: false;
  };
}

export type ExtractionValueType = 'string' | 'string-array' | 'number' | 'number-optional' | 'object-array' | 'identifier';
export type EvidenceBinding = 'none' | 'field' | 'section';

export interface ExtractionFieldContract {
  schemaVersion: typeof EXTRACTION_FIELD_CONTRACT_SCHEMA;
  field: string;
  pathPattern: string;
  valueType: ExtractionValueType;
  cardinality: 'one' | 'zero-or-one' | 'one-or-more' | 'zero-or-more';
  evidenceBinding: EvidenceBinding;
  allowedImradRoles: ImradRole[];
  semanticRole: string;
  rationale: string;
}

export type ExtractionContractIssueCode =
  | 'UNKNOWN_EXTRACTION_FIELD'
  | 'MISSING_FIELD_EVIDENCE'
  | 'EVIDENCE_SECTION_OUTSIDE_CONTRACT'
  | 'EVIDENCE_SECTION_MISMATCH'
  | 'INVALID_EVIDENCE_LOCATOR'
  | 'VALUE_TYPE_MISMATCH'
  | 'DUPLICATE_SOURCE_QUOTE';

export interface ExtractionContractIssue {
  code: ExtractionContractIssueCode;
  severity: 'error' | 'warning';
  studyId: string;
  field: string;
  jsonPointer: string;
  message: string;
  evidenceId?: string;
  observedSection?: EvidenceSectionName;
  allowedImradRoles?: ImradRole[];
}

export interface ExtractionContractValidation {
  schemaVersion: 'medantir-extraction-contract-validation/1';
  studyId: string;
  valid: boolean;
  validationHash: string;
  checkedFields: string[];
  issues: ExtractionContractIssue[];
}

export interface ArtifactTokenisationManifestEntry {
  artifactKey: string;
  source: 'request' | 'stages' | 'audit' | 'artifact';
  artifactHash: string;
  documentHash: string;
  totalTokens: number;
  lexicalTokens: number;
  estimatedModelTokens: number;
  countsByImradRole: Partial<Record<ImradRole, number>>;
  extractedStudyCount: number;
  extractionContractErrors: number;
  extractionContractWarnings: number;
}

export interface ArtifactTokenisationManifest {
  schemaVersion: typeof ARTIFACT_TOKENISATION_MANIFEST_SCHEMA;
  runId: string;
  generatedAt: string;
  manifestHash: string;
  entries: ArtifactTokenisationManifestEntry[];
  totals: {
    artifacts: number;
    tokens: number;
    lexicalTokens: number;
    estimatedModelTokens: number;
    extractedStudies: number;
    extractionContractErrors: number;
    extractionContractWarnings: number;
  };
}

export interface ModelTokenCounterPort {
  readonly counterId: string;
  readonly exact: true;
  count(text: string): number;
}

export interface ContextPlanChunk {
  chunkId: string;
  artifactKey: string;
  imradRole: ImradRole;
  boundary: string;
  tokenDocumentHash: string;
  tokenIds: string[];
  text: string;
  modelTokens: number;
  countMethod: 'exact-adapter' | 'utf8-four-byte-estimate';
  splitBoundary: boolean;
}

export interface ArtifactContextPlan {
  schemaVersion: 'medantir-artifact-context-plan/1';
  planHash: string;
  maxContextTokens: number;
  reservedOutputTokens: number;
  usableInputTokens: number;
  countMethod: 'exact-adapter' | 'utf8-four-byte-estimate';
  counterId?: string;
  chunks: ContextPlanChunk[];
  warnings: string[];
}
