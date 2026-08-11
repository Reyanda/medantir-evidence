export type ReviewType =
  | 'systematic'
  | 'intervention'
  | 'diagnostic-accuracy'
  | 'overall-prognosis'
  | 'prognostic-factor'
  | 'prediction-model'
  | 'prevalence-incidence'
  | 'qualitative'
  | 'mixed-methods'
  | 'scoping'
  | 'rapid'
  | 'umbrella'
  | 'living'
  | 'network-meta-analysis'
  | 'adverse-effects'
  | 'economic'
  | 'implementation'
  | 'mechanistic'
  | 'animal'
  | 'environmental'
  | 'evidence-map';

export type ReviewCommissionStrategy =
  | 'de-novo'
  | 'update'
  | 'adopt-adapt'
  | 'overview'
  | 'living-update';

export type ReviewModule =
  | 'existing-review-surveillance'
  | 'primary-study-search'
  | 'citation-chaining'
  | 'deduplication'
  | 'screening'
  | 'full-text-retrieval'
  | 'section-aware-extraction'
  | 'study-family-linkage'
  | 'risk-of-bias'
  | 'quantitative-synthesis'
  | 'qualitative-synthesis'
  | 'certainty-assessment'
  | 'economic-synthesis'
  | 'equity-analysis'
  | 'living-surveillance'
  | 'human-verification';

export type EvidenceStream =
  | 'randomised'
  | 'non-randomised-intervention'
  | 'exposure'
  | 'diagnostic'
  | 'prognostic'
  | 'prediction-model'
  | 'prevalence-incidence'
  | 'qualitative'
  | 'economic'
  | 'implementation'
  | 'mechanistic'
  | 'animal'
  | 'environmental'
  | 'secondary-review';

export type StageName =
  | 'question'
  | 'identity'
  | 'protocol'
  | 'review-landscape'
  | 'protocol-draft'
  | 'search-build'
  | 'search-test'
  | 'protocol-finalise'
  | 'register-protocol'
  | 'search-execute'
  | 'deduplicate'
  | 'tiab-screen'
  | 'fulltext-retrieve'
  | 'pdf-to-text'
  | 'fulltext-screen'
  | 'extract'
  | 'risk-of-bias'
  | 'synthesise'
  | 'grade'
  | 'report'
  | 'human-verify';

export type StageStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'awaiting-human'
  | 'skipped';

export type VerificationMode = 'blinded' | 'unblinded';

export type RequiredEvidenceSection =
  | 'rationale'
  | 'objectives'
  | 'results'
  | 'discussion'
  | 'limitations';

export type EvidenceSectionName = RequiredEvidenceSection | 'methods' | 'other';



export type RegistrationTarget = 'prospero' | 'osf' | 'zenodo' | 'github';
export type RegistrationSubmissionMode = 'prepare-only' | 'draft' | 'submit';
export type RegistrationReceiptStatus =
  | 'not-requested'
  | 'prepared'
  | 'draft-created'
  | 'submitted'
  | 'published'
  | 'awaiting-human'
  | 'ineligible'
  | 'failed';

export interface ProtocolAuthor {
  givenName: string;
  familyName: string;
  email?: string;
  affiliation?: string;
  orcid?: string;
  roles?: string[];
  corresponding?: boolean;
}

export interface ResearcherIdentity {
  displayName: string;
  orcid?: string;
  authenticated: boolean;
  authenticationProvider: 'orcid' | 'local' | 'none';
  verifiedAt?: string;
  scopes: string[];
}

export interface ProtocolDevelopmentConfig {
  authors?: ProtocolAuthor[];
  anticipatedStartDate?: string;
  anticipatedCompletionDate?: string;
  funder?: string;
  grantNumber?: string;
  conflictsOfInterest?: string;
  language?: string;
  country?: string;
  correspondingAuthorEmail?: string;
  patientPublicInvolvement?: string;
  disseminationPlan?: string;
  dataManagementPlan?: string;
  searchPeerReviewRequired?: boolean;
  searchPeerReviewCompleted?: boolean;
  protocolVersion?: string;
}

export interface RegistrationConfig {
  enabled?: boolean;
  targets?: RegistrationTarget[];
  submissionMode?: RegistrationSubmissionMode;
  requireAuthenticatedOrcid?: boolean;
  credentialRefs?: Partial<Record<RegistrationTarget | 'orcid', string>>;
  embargoMonths?: number;
  publicOnApproval?: boolean;
  github?: {
    owner: string;
    repository: string;
    branch?: string;
    createRelease?: boolean;
    releaseTag?: string;
  };
  osf?: {
    projectId?: string;
    registrationSchemaId?: string;
    providerId?: string;
  };
  zenodo?: {
    sandbox?: boolean;
    community?: string;
  };
}

export interface HumanVerificationConfig {
  enabled?: boolean;
  mode?: VerificationMode;
  requireAllItems?: boolean;
  requiredEvidenceSections?: RequiredEvidenceSection[];
  reviewerId?: string;
}

export interface ResearchQuestion {
  title: string;
  objective: string;
  population?: string;
  interventionOrExposure?: string;
  comparator?: string;
  outcomes?: string[];
  studyDesigns?: string[];
  concepts?: string[];
}

export interface ExistingReviewCandidate {
  id: string;
  title: string;
  publicationYear: number;
  questionMatch: number;
  populationMatch: number;
  interventionOrExposureMatch: number;
  outcomeMatch: number;
  hasReproducibleSearch: boolean;
  hasExtractableStudyData: boolean;
  hasRiskOfBiasAssessment: boolean;
  hasCertaintyAssessment: boolean;
  trustworthinessTool?: 'AMSTAR 2' | 'ROBIS' | 'INSPECT-SR' | 'custom';
  trustworthinessRating?: 'high' | 'moderate' | 'low' | 'unclear';
  lastSearchDate?: string;
  includedStudyCount?: number;
  notes?: string[];
}

export interface ReviewCommissionDecision {
  strategy: ReviewCommissionStrategy;
  selectedReviewIds: string[];
  rationale: string[];
  candidateScores: Array<{
    id: string;
    directness: number;
    currency: number;
    trustworthiness: number;
    extractability: number;
    overall: number;
  }>;
  requiresPrimaryStudySearch: boolean;
  requiresHumanApproval: boolean;
}

export interface ReviewRequest {
  question: ResearchQuestion;
  reviewType: ReviewType;
  databases: string[];
  existingReviewCandidates?: ExistingReviewCandidate[];
  preferredCommissionStrategy?: ReviewCommissionStrategy;
  autoApproveHumanGates?: boolean;
  dualScreening?: boolean;
  targetReport?: string;
  humanVerification?: HumanVerificationConfig;
  protocolDevelopment?: ProtocolDevelopmentConfig;
  registration?: RegistrationConfig;
}

export interface EligibilityCriteria {
  include: string[];
  exclude: string[];
}

export type QuestionFramework =
  | 'PICO'
  | 'PECO'
  | 'PCC'
  | 'SPIDER'
  | 'PIRD'
  | 'PICOTS'
  | 'CoCoPop'
  | 'SPICE'
  | 'mechanism-context-outcome';

export type SynthesisMode =
  | 'meta-analysis'
  | 'network-meta-analysis'
  | 'diagnostic-meta-analysis'
  | 'prognostic-meta-analysis'
  | 'prediction-model-meta-analysis'
  | 'prevalence-meta-analysis'
  | 'narrative'
  | 'mapping'
  | 'mechanistic'
  | 'qualitative'
  | 'mixed-methods'
  | 'umbrella'
  | 'economic'
  | 'living';

export interface ReviewPlan {
  reviewType: ReviewType;
  questionFramework: QuestionFramework;
  reportingStandards: string[];
  protocolStandards: string[];
  searchStandards: string[];
  appraisalTools: string[];
  certaintyFramework: 'GRADE' | 'GRADE-CERQual' | 'GRADE-prognosis' | 'GRADE-DTA' | 'OHAT' | 'none';
  synthesisMode: SynthesisMode;
  commissionStrategy: ReviewCommissionStrategy;
  requiredModules: ReviewModule[];
  evidenceStreams: EvidenceStream[];
  eligibility: EligibilityCriteria;
  methodologyWarnings: string[];
}

export interface SearchStrategy {
  database: string;
  purpose?: 'primary-studies' | 'existing-reviews' | 'update' | 'surveillance' | 'reuse-verification';
  platform: string;
  query: string;
  generatedAt: string;
}

export interface SearchProvenance {
  database: string;
  platform: string;
  executedQuery: string;
  executedAt: string;
  resultCount: number;
  exportFormat: 'RIS' | 'NBIB' | 'BIBTEX' | 'JSON';
  warnings: string[];
}

export interface EvidenceRecord {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  year: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  sourceDatabases: string[];
  keywords?: string[];
  effect?: number;
  standardError?: number;
}

export interface EvidenceExcerpt {
  id: string;
  recordId: string;
  section: EvidenceSectionName;
  page: number;
  quote: string;
  source: 'title-abstract' | 'full-text' | 'derived';
  heading?: string;
  uri?: string;
}

export interface ScreeningDecision {
  recordId: string;
  decision: 'include' | 'exclude' | 'uncertain';
  reason: string;
  confidence: number;
  evidence: string[];
  evidenceExcerpts?: EvidenceExcerpt[];
  humanOverride?: boolean;
}

export interface FullTextDocument {
  recordId: string;
  uri: string;
  mimeType: 'application/pdf' | 'text/plain';
  content?: string;
  retrievedAt: string;
  legalAccessRoute: string;
}

export interface ParsedSection {
  name: EvidenceSectionName;
  heading: string;
  pageStart: number;
  pageEnd: number;
  text: string;
}

export interface ParsedDocument {
  recordId: string;
  text: string;
  pages: Array<{ page: number; text: string }>;
  sections: ParsedSection[];
  extractionMethod: 'native' | 'ocr' | 'mock';
}

export interface ExtractedStudy {
  studyId: string;
  reportIds: string[];
  design: string;
  population: string;
  interventionOrExposure: string;
  comparator: string;
  outcomes: Array<{ name: string; effect?: number; standardError?: number }>;
  mechanisms: string[];
  funding: string;
  rationale: string;
  objectives: string[];
  resultsSummary: string;
  discussionSummary: string;
  limitations: string[];
  sectionEvidence: Record<RequiredEvidenceSection, EvidenceExcerpt[]>;
  fieldEvidence: Record<string, EvidenceExcerpt[]>;
  sourceQuotes: Array<{ field: string; section: EvidenceSectionName; page: number; quote: string }>;
}

export interface RiskOfBiasAssessment {
  studyId: string;
  tool: string;
  domains: Array<{
    domain: string;
    judgement: 'low' | 'some-concerns' | 'high';
    rationale: string;
    evidence?: EvidenceExcerpt[];
    humanOverride?: boolean;
  }>;
  overall: 'low' | 'some-concerns' | 'high';
}

export interface SynthesisResult {
  mode: ReviewPlan['synthesisMode'];
  status?: 'computed' | 'narrative' | 'deferred-specialist';
  modelSpecification?: string;
  specialistAdapter?: string;
  capabilityWarnings?: string[];
  includedStudies: number;
  pooledEffect?: number;
  standardError?: number;
  heterogeneity?: number;
  narrative: string;
  evidence?: EvidenceExcerpt[];
  humanOverride?: boolean;
}

export interface GradeAssessment {
  outcome: string;
  certainty: 'high' | 'moderate' | 'low' | 'very-low' | 'not-applicable';
  rationale: string[];
  evidence?: EvidenceExcerpt[];
  humanOverride?: boolean;
}

export interface FinalReport {
  title: string;
  abstract: string;
  prisma: {
    identified: number;
    afterDeduplication: number;
    tiabIncluded: number;
    fullTextIncluded: number;
  };
  sections: Record<string, string>;
  appendices: Record<string, unknown>;
  verification?: HumanVerificationOutcome;
}

export type VerificationCategory =
  | 'tiab-screening'
  | 'fulltext-screening'
  | 'extraction'
  | 'risk-of-bias'
  | 'synthesis'
  | 'grade'
  | 'report';

export interface VerificationItem {
  id: string;
  category: VerificationCategory;
  sourceStage: StageName;
  subjectCode: string;
  label: string;
  proposition: string;
  proposedValue: unknown;
  rationale: string[];
  evidence: EvidenceExcerpt[];
  evidenceCoverage: Record<RequiredEvidenceSection, boolean>;
  context?: {
    recordId?: string;
    studyId?: string;
    title?: string;
    authors?: string[];
    journal?: string;
    sourceDatabases?: string[];
    funding?: string;
  };
  machine?: {
    agent: string;
    confidence?: number;
  };
}

export interface HumanVerificationPackage {
  id: string;
  runId: string;
  mode: VerificationMode;
  createdAt: string;
  requiredEvidenceSections: RequiredEvidenceSection[];
  blindedFields: string[];
  items: VerificationItem[];
}

export type HumanVerdict = 'accept' | 'reject' | 'amend' | 'defer';

export interface HumanVerificationDecision {
  itemId: string;
  verdict: HumanVerdict;
  rationale: string;
  amendedValue?: unknown;
  reviewerId?: string;
  decidedAt?: string;
}

export interface HumanVerificationSubmission {
  packageId: string;
  mode: VerificationMode;
  decisions: HumanVerificationDecision[];
}

export interface HumanOverrideEntry {
  itemId: string;
  sourceStage: StageName;
  amendedValue: unknown;
  rationale: string;
  reviewerId?: string;
  decidedAt: string;
}

export interface HumanOverrideLedger {
  version: number;
  entries: HumanOverrideEntry[];
}

export interface HumanVerificationOutcome {
  packageId: string;
  mode: VerificationMode;
  status: 'accepted' | 'changes-requested' | 'incomplete';
  accepted: number;
  rejected: number;
  amended: number;
  deferred: number;
  completedAt: string;
  decisions: HumanVerificationDecision[];
  requiresRerunFrom?: StageName;
}


export interface ProtocolCitation {
  id: string;
  title: string;
  organisation?: string;
  year?: number;
  url: string;
  doi?: string;
  accessedAt: string;
}

export interface ProtocolSection {
  id: string;
  heading: string;
  purpose: string;
  content: string;
  required: boolean;
  citations: string[];
  validationRules: string[];
}

export interface ProtocolDraft {
  id: string;
  reviewType: ReviewType;
  title: string;
  version: string;
  status: 'draft';
  createdAt: string;
  authors: ProtocolAuthor[];
  sections: ProtocolSection[];
  citations: ProtocolCitation[];
  checklist: Array<{ item: string; status: 'complete' | 'partial' | 'missing'; evidence: string }>;
}

export interface SearchStrategyTestResult {
  database: string;
  platform: string;
  syntaxValid: boolean;
  conceptsCovered: string[];
  conceptsMissing: string[];
  pilotResultCount?: number;
  warnings: string[];
  errors: string[];
  testedAt: string;
  testedQuery: string;
}

export interface SearchStrategyTestReport {
  status: 'passed' | 'warning' | 'failed';
  results: SearchStrategyTestResult[];
  peerReviewRequired: boolean;
  peerReviewStatus: 'not-required' | 'pending' | 'completed';
  completedAt: string;
}

export interface ProtocolPackage {
  id: string;
  reviewType: ReviewType;
  title: string;
  version: string;
  status: 'final';
  finalisedAt: string;
  documentMarkdown: string;
  structuredProtocol: ProtocolDraft;
  searchStrategies: SearchStrategy[];
  searchTestReport: SearchStrategyTestReport;
  citations: ProtocolCitation[];
  checksum: string;
  files: Array<{ path: string; mediaType: string; content: string; checksum: string }>;
}

export interface RegistryEligibilityDecision {
  target: RegistrationTarget;
  eligible: boolean;
  role: 'prospective-registry' | 'general-registration' | 'archival-doi' | 'version-control';
  rationale: string[];
  requiredAuthentication: 'orcid' | 'oauth' | 'token' | 'github-app' | 'none';
  submissionRoute: 'api' | 'browser' | 'hybrid';
}

export interface RegistrationPlan {
  enabled: boolean;
  submissionMode: RegistrationSubmissionMode;
  selectedTargets: RegistrationTarget[];
  eligibility: RegistryEligibilityDecision[];
  requiresHumanApproval: boolean;
  warnings: string[];
  createdAt: string;
}

export interface RegistrationReceipt {
  target: RegistrationTarget;
  status: RegistrationReceiptStatus;
  externalId?: string;
  url?: string;
  doi?: string;
  version?: string;
  submittedAt?: string;
  message: string;
  protocolChecksum: string;
  metadata: Record<string, unknown>;
}

export interface ProtocolRegistrationLedger {
  protocolId: string;
  protocolVersion: string;
  protocolChecksum: string;
  createdAt: string;
  receipts: RegistrationReceipt[];
  identity: ResearcherIdentity;
  noSecretsPersisted: true;
}

export interface AuditEvent {
  id: string;
  runId: string;
  stage: StageName;
  event: string;
  timestamp: string;
  attempt: number;
  details: Record<string, unknown>;
}

export interface StageState {
  name: StageName;
  status: StageStatus;
  attempts: number;
  errors: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineState {
  runId: string;
  request: ReviewRequest;
  stages: Record<StageName, StageState>;
  artifacts: Record<string, unknown>;
  audit: AuditEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface AgentResult {
  artifacts: Record<string, unknown>;
  warnings?: string[];
  awaitingHuman?: {
    summary: string;
  };
  rework?: {
    fromStage: StageName;
    reason: string;
  };
}

export interface AgentContext {
  state: PipelineState;
  now(): string;
}

export interface Agent {
  readonly stage: StageName;
  execute(context: AgentContext): Promise<AgentResult>;
}
