import type { PipelineState, ReviewRequest, ResearcherIdentity, RegistrationTarget, RegistrationSubmissionMode } from './core/types.js';
import type { HumanVerificationPort, CredentialVaultPort, ResearcherIdentityPort, PipelineCheckpointPort } from './core/ports.js';
import { createLivePipelineAgents } from './agents/live-pipeline-agents.js';
import { ProtocolRegistrationAgent } from './agents/protocol-registration-agents.js';
import { EstimandAdjudicationExtractionAgent } from './agents/estimand-adjudication.js';
import { EstimandAdjudicationReportAgent } from './agents/estimand-adjudication-report.js';
import { EstimandDependenceGuardAgent } from './agents/estimand-dependence-guard.js';
import { EstimandHumanVerificationAgent } from './agents/estimand-human-verification.js';
import { EstimandAwareSynthesisAgent, EstimandIdentityExtractionAgent, EstimandReportAgent } from './agents/estimand-identity.js';
import { ProvenanceFirstExtractionAgent } from './agents/provenance-first-extraction.js';
import { QuarantinedDocumentParsingAgent, UnresolvedEvidenceReportAgent } from './agents/quarantined-document-parsing.js';
import { SectionAwareFullTextEligibilityAgent } from './agents/section-aware-eligibility.js';
import { EvidenceBoundStudyFamilyAgent } from './agents/study-family-evidence.js';
import { StudyFamilyEvidenceReportAgent } from './agents/study-family-evidence-report.js';
import { StudyFamilyHumanVerificationAgent } from './agents/study-family-human-verification.js';
import { StudyFamilyAwareExtractionAgent, StudyFamilyLinkageAgent, StudyFamilyReportAgent } from './agents/study-family-linkage.js';
import { EstimandAwareReviewAttentionObserver } from './cognitive/estimand-aware-attention.js';
import { FormatAwareDocumentIntelligenceExtractor } from './document/format-aware-document-intelligence.js';
import { evidenceAdapterFor, EpmcFullTextRetrieval, UnauthenticatedResearcherIdentityPort } from './adapters/real.js';
import { officialEvidenceAdapterFor } from './adapters/official-search.js';
import { SourceRichClinicalTrialsGovAdapter } from './adapters/clinicaltrials-rich.js';
import { RetryingEvidenceSourceAdapter } from './adapters/retry.js';
import { SourceCompilingAdapter } from './adapters/source-query-compiler.js';
import { institutionalAdapterFor } from './adapters/institutional.js';
import { PipelineOrchestrator } from './core/orchestrator.js';
import { createPipelineState } from './core/state.js';
import { createReviewProtocol } from './protocols/review-protocol.js';
import { DeterministicSearchStrategyTester } from './registration/search-testing.js';
import { OmniRouteInferencePort } from './inference/omniroute-inference.js';
import { ShadowModelTiabScreeningAgent } from './inference/shadow-screening-agent.js';
import { AutonomousQuestionAgent } from './question/autonomous-question-agent.js';
import { DurableSearchExecuteAgent } from './durability/durable-search-agent.js';
import type { ExternalActionCoordinator } from './durability/external-action-coordinator.js';
import { Rob2AppraisalAgent } from './appraisal/rob2-agent.js';
import { InterventionAppraisalRouterAgent } from './appraisal/intervention-appraisal-router.js';
import { createProductionInterventionExtractionAgent, createProductionInterventionSynthesisAgent } from './synthesis/intervention-production-agents.js';
import {
  createProductionInterventionGradeAgent,
  createProductionInterventionProtocolFinaliseAgent,
} from './certainty/intervention-certainty-agents.js';
import {
  ZenodoRegistryAdapter,
  GitHubRegistryAdapter,
  ProsperoBrowserRegistryAdapter,
  OsfBrowserRegistryAdapter,
  InMemoryCredentialVault,
  type AuthenticatedRegistrationBrowserPort,
} from './adapters/registration/registry-adapters.js';

export interface ForwardedIdentity { sub: string; projectId: string; token?: string }

export class BridgeAuthenticatedRegistrationBrowserPort implements AuthenticatedRegistrationBrowserPort {
  constructor(private readonly bridgeUrl: string, private readonly auth?: { token: string; projectId: string }) {}

  async submit(input: {
    target: 'prospero' | 'osf'; protocol: any; request: any; identity: any; submissionMode: any;
    authentication: 'orcid' | 'osf-oauth'; idempotencyKey?: string;
  }) {
    if (!this.auth?.token) throw new Error('Authenticated registration requires a verified user session.');
    const res = await fetch(`${this.bridgeUrl.replace(/\/$/, '')}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.auth.token}`,
        'x-actiora-project': this.auth.projectId,
      },
      body: JSON.stringify({
        action: 'register_submit',
        session: input.authentication === 'orcid' ? 'orcid/session' : 'osf/session',
        args: {
          target: input.target,
          submissionMode: input.submissionMode,
          protocol: input.protocol,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Registration bridge command failed (HTTP ${res.status})`);
    const data: any = await res.json();
    return {
      status: data.status ?? 'draft-created', externalId: data.externalId, url: data.url,
      message: data.message ?? `${input.target} registration submitted via bridge.`,
      metadata: { ...(data.metadata ?? {}), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) },
    };
  }
}

export class AuthenticatedResearcherIdentityPort implements ResearcherIdentityPort {
  constructor(private readonly credentialVault: CredentialVaultPort, private readonly auth?: { token: string; projectId: string }) {}

  async resolve(request: ReviewRequest): Promise<ResearcherIdentity> {
    const author = request.protocolDevelopment?.authors?.find((item) => item.corresponding) ?? request.protocolDevelopment?.authors?.[0];
    const credentialReference = request.registration?.credentialRefs?.orcid;
    let hasOrcid = false;
    const orcidId = author?.orcid;
    if (credentialReference) {
      try { if (await this.credentialVault.get(credentialReference)) hasOrcid = true; } catch { /* vault unavailable */ }
    }
    if (hasOrcid && orcidId) {
      return {
        displayName: author ? `${author.givenName} ${author.familyName}` : 'Guarantor',
        authenticated: true, authenticationProvider: 'orcid', orcid: orcidId,
        scopes: ['/authenticate'], verifiedAt: new Date().toISOString(),
      };
    }
    return {
      displayName: author ? `${author.givenName} ${author.familyName}` : 'Protocol guarantor not yet authenticated',
      authenticated: false, authenticationProvider: 'none', scopes: [],
    };
  }
}

function isClinicalTrialsDatabase(value: string): boolean {
  const clean = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return ['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(clean);
}

function realSearchAdapterFor(db: string, bridgeUrl: string, auth?: { token: string; projectId: string }) {
  if (isClinicalTrialsDatabase(db)) {
    return new SourceCompilingAdapter(new RetryingEvidenceSourceAdapter(new SourceRichClinicalTrialsGovAdapter()));
  }
  const institutional = institutionalAdapterFor(db, { bridgeUrl, auth });
  if (institutional) return institutional;
  const official = officialEvidenceAdapterFor(db);
  if (official) return new SourceCompilingAdapter(new RetryingEvidenceSourceAdapter(official));
  return evidenceAdapterFor(db, 50);
}

function registryPublicationDiscoveryAdapters() {
  return ['PubMed', 'Europe PMC'].flatMap((database) => {
    const adapter = officialEvidenceAdapterFor(database);
    return adapter ? [new RetryingEvidenceSourceAdapter(adapter)] : [];
  });
}

function optionalShadowScreening() {
  const model = process.env.OMNIROUTE_SHADOW_MODEL?.trim();
  if (!model) return null;
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();
  if (!apiKey) throw new Error('OMNIROUTE_SHADOW_MODEL is enabled but OMNIROUTE_API_KEY is not configured.');
  return {
    inference: new OmniRouteInferencePort({ apiKey, baseUrl: process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128', disableGatewayMemory: true, disableGatewayCache: true }),
    model,
    maxRecords: Number(process.env.OMNIROUTE_SHADOW_MAX_RECORDS ?? 50),
    concurrency: Number(process.env.OMNIROUTE_SHADOW_CONCURRENCY ?? 4),
  };
}

function rob2AppraisalAgent(): Rob2AppraisalAgent {
  const model = process.env.OMNIROUTE_ROB2_MODEL?.trim();
  if (!model) return new Rob2AppraisalAgent();
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();
  if (!apiKey) throw new Error('OMNIROUTE_ROB2_MODEL is enabled but OMNIROUTE_API_KEY is not configured.');
  return new Rob2AppraisalAgent({
    port: new OmniRouteInferencePort({ apiKey, baseUrl: process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128', disableGatewayMemory: true, disableGatewayCache: true }),
    model,
  });
}

function usesInterventionVertical(request: ReviewRequest): boolean {
  return new Set(['systematic', 'intervention', 'rapid', 'living', 'network-meta-analysis', 'adverse-effects']).has(request.reviewType);
}

function buildRealOrchestrator(
  request: ReviewRequest,
  humanVerificationPort: HumanVerificationPort | null,
  identity?: ForwardedIdentity,
  credentialVault?: CredentialVaultPort,
  checkpointPort?: PipelineCheckpointPort,
  externalActions?: ExternalActionCoordinator,
): PipelineOrchestrator {
  const bridgeUrl = process.env.REVIEW_BRIDGE_URL ?? 'http://bridge:10086';
  const auth = identity?.token ? { token: identity.token, projectId: identity.projectId } : undefined;
  const adapters = request.databases.map((db) => realSearchAdapterFor(db, bridgeUrl, auth));
  const browserPort = new BridgeAuthenticatedRegistrationBrowserPort(bridgeUrl, auth);
  const vault = credentialVault ?? new InMemoryCredentialVault();
  const documentExtractor = new FormatAwareDocumentIntelligenceExtractor();
  const registryAdapters = [
    new ProsperoBrowserRegistryAdapter(browserPort), new OsfBrowserRegistryAdapter(browserPort),
    new ZenodoRegistryAdapter({ credentialVault: vault }), new GitHubRegistryAdapter({ credentialVault: vault }),
  ];
  const common = {
    searchAdapters: adapters,
    fullTextRetrieval: new EpmcFullTextRetrieval(),
    pdfExtractor: documentExtractor,
    identity: auth ? new AuthenticatedResearcherIdentityPort(vault, auth) : new UnauthenticatedResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
    registryAdapters,
  };
  const baseAgents = createLivePipelineAgents(humanVerificationPort ? { ...common, humanVerification: humanVerificationPort } : common);
  const shadow = optionalShadowScreening();
  const interventionVertical = usesInterventionVertical(request);
  const interventionAppraisal = interventionVertical ? new InterventionAppraisalRouterAgent(rob2AppraisalAgent()) : null;
  const publicationDiscovery = interventionVertical ? registryPublicationDiscoveryAdapters() : [];

  const agents = baseAgents.map((agent) => {
    if (agent.stage === 'question') return new AutonomousQuestionAgent(agent);
    if (agent.stage === 'protocol-finalise' && interventionVertical) return createProductionInterventionProtocolFinaliseAgent(agent);
    if (agent.stage === 'register-protocol' && externalActions) return new ProtocolRegistrationAgent(registryAdapters, externalActions);
    if (agent.stage === 'search-execute' && externalActions) return new DurableSearchExecuteAgent(adapters, externalActions);
    if (agent.stage === 'tiab-screen' && shadow) {
      return new ShadowModelTiabScreeningAgent(agent, shadow.inference, { model: shadow.model, maxRecords: shadow.maxRecords, concurrency: shadow.concurrency });
    }
    if (agent.stage === 'pdf-to-text') return new QuarantinedDocumentParsingAgent(documentExtractor);
    if (agent.stage === 'fulltext-screen') {
      return new EvidenceBoundStudyFamilyAgent(new StudyFamilyLinkageAgent(new SectionAwareFullTextEligibilityAgent(agent)));
    }
    if (agent.stage === 'extract') {
      const scientificExtraction = new EstimandAdjudicationExtractionAgent(
        new EstimandIdentityExtractionAgent(
          new StudyFamilyAwareExtractionAgent(new ProvenanceFirstExtractionAgent(agent)),
        ),
      );
      return interventionVertical ? createProductionInterventionExtractionAgent(scientificExtraction) : scientificExtraction;
    }
    if (agent.stage === 'risk-of-bias' && interventionAppraisal) return interventionAppraisal;
    if (agent.stage === 'synthesise') {
      const scientificSynthesis = new EstimandDependenceGuardAgent(new EstimandAwareSynthesisAgent(agent));
      return interventionVertical ? createProductionInterventionSynthesisAgent(scientificSynthesis) : scientificSynthesis;
    }
    if (agent.stage === 'grade' && interventionVertical) {
      return createProductionInterventionGradeAgent(undefined, {
        publicationDiscoveryAdapters: publicationDiscovery,
        ...(externalActions ? { externalActions } : {}),
      });
    }
    if (agent.stage === 'report') {
      return new EstimandAdjudicationReportAgent(
        new EstimandReportAgent(new StudyFamilyEvidenceReportAgent(new StudyFamilyReportAgent(new UnresolvedEvidenceReportAgent(agent)))),
      );
    }
    if (agent.stage === 'human-verify') {
      const estimandGate = new EstimandHumanVerificationAgent(agent, humanVerificationPort ?? undefined);
      return new StudyFamilyHumanVerificationAgent(estimandGate, humanVerificationPort ?? undefined);
    }
    return agent;
  });
  return new PipelineOrchestrator(agents, {
    cognitiveObserver: new EstimandAwareReviewAttentionObserver(), maxCognitiveRollbacks: 3,
    ...(checkpointPort ? { checkpointPort } : {}),
  });
}

export async function runRealPipeline(
  request: ReviewRequest,
  humanVerificationPort: HumanVerificationPort | null = null,
  identity?: ForwardedIdentity,
  credentialVault?: CredentialVaultPort,
  checkpointPort?: PipelineCheckpointPort,
  externalActions?: ExternalActionCoordinator,
): Promise<PipelineState> {
  return buildRealOrchestrator(request, humanVerificationPort, identity, credentialVault, checkpointPort, externalActions).run(
    createPipelineState(request), createReviewProtocol(request.reviewType),
  );
}

export async function resumeRealPipeline(
  state: PipelineState,
  humanVerificationPort: HumanVerificationPort | null,
  identity?: ForwardedIdentity,
  credentialVault?: CredentialVaultPort,
  checkpointPort?: PipelineCheckpointPort,
  externalActions?: ExternalActionCoordinator,
): Promise<PipelineState> {
  return buildRealOrchestrator(state.request, humanVerificationPort, identity, credentialVault, checkpointPort, externalActions).run(
    state, createReviewProtocol(state.request.reviewType),
  );
}
