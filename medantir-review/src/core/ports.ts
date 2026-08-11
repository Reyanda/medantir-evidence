import type {
  FullTextDocument,
  ParsedDocument,
  SearchProvenance,
  SearchStrategy,
  EvidenceRecord,
  HumanVerificationPackage,
  HumanVerificationSubmission,
  PipelineState,
  ProtocolPackage,
  RegistrationReceipt,
  RegistrationSubmissionMode,
  RegistrationTarget,
  ResearcherIdentity,
  ReviewRequest,
  SearchStrategyTestResult,
  StageName,
} from './types.js';

export interface EvidenceSourceAdapter {
  readonly database: string;
  execute(strategy: SearchStrategy): Promise<{
    records: EvidenceRecord[];
    provenance: SearchProvenance;
  }>;
}

export interface FullTextRetrievalPort {
  retrieve(record: EvidenceRecord): Promise<FullTextDocument | null>;
}

export interface PdfTextExtractionPort {
  extract(document: FullTextDocument): Promise<ParsedDocument>;
}

export interface HumanDecisionPort {
  approve(input: {
    runId: string;
    stage: string;
    summary: string;
  }): Promise<boolean>;
}

export interface HumanVerificationPort {
  review(input: HumanVerificationPackage): Promise<HumanVerificationSubmission | null>;
}

/**
 * Durable orchestration checkpoint boundary.
 *
 * The orchestrator awaits this port after every authoritative state transition.
 * A checkpoint implementation may persist the run to a local transactional store,
 * database, object store, or another durability backend. Sequence allocation is a
 * storage concern: the implementation must serialize writes per run, assign the
 * next monotonic sequence itself, and be idempotent when the latest committed
 * checkpoint has the same run/stage/event/attempt/state identity.
 *
 * Implementations must not mutate the scientific state passed to them.
 */
export interface PipelineCheckpointPort {
  checkpoint(input: {
    state: PipelineState;
    stage: StageName;
    event: string;
    attempt: number;
    recordedAt: string;
  }): Promise<void>;
}

export interface SearchStrategyTestingPort {
  test(strategy: SearchStrategy, request: ReviewRequest): Promise<SearchStrategyTestResult>;
}

export interface ResearcherIdentityPort {
  resolve(request: ReviewRequest): Promise<ResearcherIdentity>;
}

export interface CredentialVaultPort {
  get(reference: string): Promise<string | null>;
}

export interface CredentialStorePort extends CredentialVaultPort {
  put(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface ProtocolRegistryAdapter {
  readonly target: RegistrationTarget;
  register(input: {
    protocol: ProtocolPackage;
    request: ReviewRequest;
    identity: ResearcherIdentity;
    submissionMode: RegistrationSubmissionMode;
    credentialReference?: string;
  }): Promise<RegistrationReceipt>;
}
