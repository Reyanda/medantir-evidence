import type {
  Agent,
  AgentContext,
  AgentResult,
  ProtocolDraft,
  ProtocolPackage,
  ProtocolRegistrationLedger,
  RegistrationPlan,
  RegistrationReceipt,
  ResearcherIdentity,
  ReviewPlan,
  SearchStrategy,
  SearchStrategyTestReport,
} from '../core/types.js';
import type {
  ProtocolRegistryAdapter,
  ResearcherIdentityPort,
  SearchStrategyTestingPort,
} from '../core/ports.js';
import { id, stableHash } from '../core/utils.js';
import type { ExternalActionReconciliation } from '../durability/external-action-coordinator.js';
import { ExternalActionCoordinator } from '../durability/external-action-coordinator.js';
import { createProtocolDraft, renderProtocolMarkdown } from '../protocols/protocol-template-library.js';
import { buildRegistrationPlan } from '../registration/registry-profiles.js';
import { buildRegistrySubmissionDocuments } from '../registration/field-mapping.js';

function artifact<T>(context: AgentContext, key: string): T {
  if (!(key in context.state.artifacts)) throw new Error(`Artifact '${key}' not found`);
  return context.state.artifacts[key] as T;
}

export class ResearcherIdentityAgent implements Agent {
  readonly stage = 'identity' as const;
  constructor(private readonly identityPort: ResearcherIdentityPort) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const identity = await this.identityPort.resolve(context.state.request);
    const registration = context.state.request.registration;
    const warnings: string[] = [];
    if (registration?.enabled && registration.requireAuthenticatedOrcid && (!identity.authenticated || !identity.orcid)) {
      warnings.push('Registration policy requires an authenticated ORCID iD before submission.');
    }
    return { artifacts: { researcherIdentity: identity }, warnings };
  }
}

export class ProtocolDraftAgent implements Agent {
  readonly stage = 'protocol-draft' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const identity = artifact<ResearcherIdentity>(context, 'researcherIdentity');
    const draft = createProtocolDraft(context.state.request, plan, identity, context.now());
    return { artifacts: { protocolDraft: draft }, warnings: draft.checklist.filter((item) => item.status !== 'complete').map((item) => `${item.item}: ${item.evidence}`) };
  }
}

export class SearchStrategyTestAgent implements Agent {
  readonly stage = 'search-test' as const;
  constructor(private readonly tester: SearchStrategyTestingPort) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const strategies = artifact<SearchStrategy[]>(context, 'searchStrategies');
    const results = await Promise.all(strategies.map((strategy) => this.tester.test(strategy, context.state.request)));
    const errors = results.flatMap((result) => result.errors.map((error) => `${result.database}: ${error}`));
    const warnings = results.flatMap((result) => result.warnings.map((warning) => `${result.database}: ${warning}`));
    const peerReviewRequired = context.state.request.protocolDevelopment?.searchPeerReviewRequired ?? true;
    const peerReviewCompleted = context.state.request.protocolDevelopment?.searchPeerReviewCompleted ?? false;
    const report: SearchStrategyTestReport = {
      status: errors.length ? 'failed' : warnings.length ? 'warning' : 'passed',
      results,
      peerReviewRequired,
      peerReviewStatus: peerReviewRequired ? (peerReviewCompleted ? 'completed' : 'pending') : 'not-required',
      completedAt: context.now(),
    };
    if (errors.length) throw new Error(`Search strategy validation failed: ${errors.join('; ')}`);
    return { artifacts: { searchTestReport: report }, warnings };
  }
}

function citationCff(draft: ProtocolDraft, checksum: string): string {
  const authors = draft.authors.map((author) => `  - family-names: "${author.familyName.replaceAll('"', '\\"')}"\n    given-names: "${author.givenName.replaceAll('"', '\\"')}"${author.orcid ? `\n    orcid: "https://orcid.org/${author.orcid}"` : ''}`).join('\n');
  return `cff-version: 1.2.0\ntitle: "${draft.title.replaceAll('"', '\\"')}"\nmessage: "Please cite this registered systematic review protocol."\ntype: dataset\nauthors:\n${authors || '  - name: "Protocol guarantor"'}\nversion: "${draft.version}"\nabstract: "Protocol checksum ${checksum}"\n`;
}

function zenodoJson(draft: ProtocolDraft, checksum: string): string {
  return JSON.stringify({
    title: draft.title,
    upload_type: 'publication',
    publication_type: 'other',
    description: `Registered systematic review protocol. Protocol checksum: ${checksum}`,
    creators: draft.authors.map((author) => ({ name: `${author.familyName}, ${author.givenName}`, ...(author.orcid ? { orcid: author.orcid } : {}) })),
    version: draft.version,
  }, null, 2);
}

export class ProtocolFinaliseAgent implements Agent {
  readonly stage = 'protocol-finalise' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const draft = artifact<ProtocolDraft>(context, 'protocolDraft');
    const strategies = artifact<SearchStrategy[]>(context, 'searchStrategies');
    const tests = artifact<SearchStrategyTestReport>(context, 'searchTestReport');
    if (tests.status === 'failed') throw new Error('Protocol cannot be finalised while search strategy tests are failing.');
    const markdown = renderProtocolMarkdown(draft, strategies, tests);
    const core = {
      protocolId: draft.id,
      version: draft.version,
      reviewType: draft.reviewType,
      markdown,
      strategies,
      tests,
    };
    const checksum = stableHash(core);
    const protocolJson = JSON.stringify({ ...draft, searchStrategies: strategies, searchTestReport: tests, checksum }, null, 2);
    const searchJson = JSON.stringify(strategies, null, 2);
    const testsJson = JSON.stringify(tests, null, 2);
    const registryDocuments = buildRegistrySubmissionDocuments(context.state.request, draft, strategies, tests, checksum);
    const registryManifest = JSON.stringify(registryDocuments, null, 2);
    const rawFiles = [
      { path: 'protocol/PROTOCOL.md', mediaType: 'text/markdown', content: markdown },
      { path: 'protocol/protocol.json', mediaType: 'application/json', content: protocolJson },
      { path: 'protocol/search-strategies.json', mediaType: 'application/json', content: searchJson },
      { path: 'protocol/search-test-report.json', mediaType: 'application/json', content: testsJson },
      { path: 'registration/registry-submission-documents.json', mediaType: 'application/json', content: registryManifest },
      ...registryDocuments.map((document) => ({
        path: `registration/${document.target}-field-map.json`,
        mediaType: 'application/json',
        content: JSON.stringify(document, null, 2),
      })),
      { path: 'CITATION.cff', mediaType: 'text/yaml', content: citationCff(draft, checksum) },
      { path: '.zenodo.json', mediaType: 'application/json', content: zenodoJson(draft, checksum) },
    ];
    const protocol: ProtocolPackage = {
      id: id(),
      reviewType: draft.reviewType,
      title: draft.title,
      version: draft.version,
      status: 'final',
      finalisedAt: context.now(),
      documentMarkdown: markdown,
      structuredProtocol: draft,
      searchStrategies: strategies,
      searchTestReport: tests,
      citations: draft.citations,
      checksum,
      files: rawFiles.map((file) => ({ ...file, checksum: stableHash(file.content) })),
    };
    return {
      artifacts: { protocolPackage: protocol },
      warnings: tests.peerReviewStatus === 'pending' ? ['Search peer review remains pending and must be completed before final registry submission.'] : [],
    };
  }
}

type ReconciliableRegistryAdapter = ProtocolRegistryAdapter & {
  reconcile?(input: {
    protocol: ProtocolPackage;
    request: AgentContext['state']['request'];
    identity: ResearcherIdentity;
    submissionMode: RegistrationPlan['submissionMode'];
    credentialReference?: string;
    idempotencyKey: string;
  }): Promise<ExternalActionReconciliation<RegistrationReceipt>>;
};

export class ProtocolRegistrationAgent implements Agent {
  readonly stage = 'register-protocol' as const;
  private readonly adapters: Map<string, ProtocolRegistryAdapter>;
  constructor(
    adapters: ProtocolRegistryAdapter[],
    private readonly externalActions?: ExternalActionCoordinator,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.target, adapter]));
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const protocol = artifact<ProtocolPackage>(context, 'protocolPackage');
    const identity = artifact<ResearcherIdentity>(context, 'researcherIdentity');
    const plan = buildRegistrationPlan(context.state.request, identity, context.now());
    const receipts: RegistrationReceipt[] = [];

    if (!plan.enabled) {
      const ledger: ProtocolRegistrationLedger = {
        protocolId: protocol.id,
        protocolVersion: protocol.version,
        protocolChecksum: protocol.checksum,
        createdAt: context.now(),
        receipts: [],
        identity,
        noSecretsPersisted: true,
      };
      return { artifacts: { registrationPlan: plan, registrationReceipts: receipts, protocolRegistrationLedger: ledger } };
    }

    if (
      plan.submissionMode === 'submit' &&
      protocol.searchTestReport.peerReviewRequired &&
      protocol.searchTestReport.peerReviewStatus !== 'completed'
    ) {
      for (const decision of plan.eligibility) {
        receipts.push({
          target: decision.target,
          status: decision.eligible ? 'awaiting-human' : 'ineligible',
          message: decision.eligible
            ? 'Definitive registration is blocked until the required search-strategy peer review is completed and recorded.'
            : decision.rationale.join(' '),
          protocolChecksum: protocol.checksum,
          metadata: { peerReviewStatus: protocol.searchTestReport.peerReviewStatus, role: decision.role },
        });
      }
      const ledger: ProtocolRegistrationLedger = {
        protocolId: protocol.id,
        protocolVersion: protocol.version,
        protocolChecksum: protocol.checksum,
        createdAt: context.now(),
        receipts,
        identity,
        noSecretsPersisted: true,
      };
      return {
        artifacts: { registrationPlan: plan, registrationReceipts: receipts, protocolRegistrationLedger: ledger },
        warnings: [...plan.warnings, 'Search-strategy peer review is pending. Submission credentials were not used.'],
        awaitingHuman: { summary: 'Complete and document the required independent search-strategy peer review before registry submission.' },
      };
    }

    for (const decision of plan.eligibility) {
      if (!decision.eligible) {
        receipts.push({
          target: decision.target,
          status: 'ineligible' as const,
          message: decision.rationale.join(' '),
          protocolChecksum: protocol.checksum,
          metadata: { role: decision.role },
        });
        continue;
      }
      const adapter = this.adapters.get(decision.target);
      if (!adapter) {
        receipts.push({
          target: decision.target,
          status: 'prepared' as const,
          message: `Registration package prepared, but no ${decision.target} adapter is configured.`,
          protocolChecksum: protocol.checksum,
          metadata: { submissionRoute: decision.submissionRoute },
        });
        continue;
      }
      const credentialReference = context.state.request.registration?.credentialRefs?.[decision.target];
      const registrationInput = {
        protocol,
        request: context.state.request,
        identity,
        submissionMode: plan.submissionMode,
        ...(credentialReference ? { credentialReference } : {}),
      };

      let receipt: RegistrationReceipt;
      if (this.externalActions && plan.submissionMode !== 'prepare-only') {
        const reconciliable = adapter as ReconciliableRegistryAdapter;
        const execution = await this.externalActions.execute<RegistrationReceipt>({
          runId: context.state.runId,
          stage: 'register-protocol',
          kind: 'registry-registration',
          operationKey: `${decision.target}:${protocol.checksum}:${plan.submissionMode}`,
          request: {
            target: decision.target,
            protocolChecksum: protocol.checksum,
            protocolVersion: protocol.version,
            submissionMode: plan.submissionMode,
            identity: { displayName: identity.displayName, orcid: identity.orcid ?? null },
          },
          replayPolicy: 'require-reconciliation',
          perform: (idempotencyKey) => adapter.register({ ...registrationInput, idempotencyKey } as Parameters<ProtocolRegistryAdapter['register']>[0]),
          ...(reconciliable.reconcile
            ? {
                reconcile: (idempotencyKey: string) => reconciliable.reconcile!({
                  ...registrationInput,
                  idempotencyKey,
                }),
              }
            : {}),
          now: context.now,
        });
        receipt = {
          ...execution.response,
          metadata: {
            ...execution.response.metadata,
            externalActionId: execution.actionId,
            reusedExternalReceipt: execution.reusedReceipt,
            reconciledExternalAction: execution.reconciled,
          },
        };
      } else {
        receipt = await adapter.register(registrationInput);
      }
      receipts.push(receipt);
    }

    const ledger: ProtocolRegistrationLedger = {
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      protocolChecksum: protocol.checksum,
      createdAt: context.now(),
      receipts,
      identity,
      noSecretsPersisted: true,
    };
    const awaiting = receipts.filter((receipt) => receipt.status === 'awaiting-human');
    return {
      artifacts: { registrationPlan: plan, registrationReceipts: receipts, protocolRegistrationLedger: ledger },
      warnings: [...plan.warnings, ...receipts.filter((receipt) => receipt.status === 'failed').map((receipt) => receipt.message)],
      ...(awaiting.length > 0 ? { awaitingHuman: { summary: awaiting.map((receipt) => `${receipt.target}: ${receipt.message}`).join('; ') } } : {}),
    };
  }
}
