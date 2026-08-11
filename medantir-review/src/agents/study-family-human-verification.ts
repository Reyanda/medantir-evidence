import type { HumanVerificationPort } from '../core/ports.js';
import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceRecord,
  HumanOverrideEntry,
  HumanOverrideLedger,
  HumanVerificationDecision,
  HumanVerificationOutcome,
  HumanVerificationPackage,
  HumanVerificationSubmission,
  VerificationItem,
  VerificationMode,
} from '../core/types.js';
import { stableHash } from '../core/utils.js';
import {
  studyFamilyVerificationItemId,
  type EvidenceBoundStudyFamilyLink,
} from './study-family-evidence.js';

export interface StudyFamilyVerificationAcknowledgement {
  recordId: string;
  itemId: string;
  proposalHash: string;
  verdict: 'accept';
  rationale: string;
  reviewerId?: string;
  decidedAt: string;
}

function evidenceCoverage(evidence: VerificationItem['evidence']): VerificationItem['evidenceCoverage'] {
  return {
    rationale: evidence.some((entry) => entry.section === 'rationale'),
    objectives: evidence.some((entry) => entry.section === 'objectives'),
    results: evidence.some((entry) => entry.section === 'results'),
    discussion: evidence.some((entry) => entry.section === 'discussion'),
    limitations: evidence.some((entry) => entry.section === 'limitations'),
  };
}

function withVisibility(item: VerificationItem, mode: VerificationMode): VerificationItem {
  if (mode === 'unblinded') return item;
  const { context: _context, machine: _machine, ...blinded } = item;
  return blinded;
}

function familyProposalHash(link: EvidenceBoundStudyFamilyLink): string {
  return stableHash({
    familyId: link.familyId,
    role: link.role,
    registryIds: link.registryIds,
    linkageBasis: link.linkageBasis,
    evidenceIds: link.evidence.map((entry) => entry.id),
    reasons: link.reasons,
  });
}

function acknowledgedProposal(
  link: EvidenceBoundStudyFamilyLink,
  acknowledgements: StudyFamilyVerificationAcknowledgement[],
): boolean {
  const hash = familyProposalHash(link);
  return acknowledgements.some((entry) =>
    entry.recordId === link.recordId
    && entry.itemId === studyFamilyVerificationItemId(link.recordId)
    && entry.proposalHash === hash
    && entry.verdict === 'accept');
}

function buildItems(
  links: EvidenceBoundStudyFamilyLink[],
  records: EvidenceRecord[],
  acknowledgements: StudyFamilyVerificationAcknowledgement[],
  mode: VerificationMode,
): VerificationItem[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  return links
    .filter((link) => link.requiresHumanReview)
    .filter((link) => !acknowledgedProposal(link, acknowledgements))
    .map((link) => {
      const record = recordById.get(link.recordId);
      const proposition = link.linkageBasis === 'ambiguous-multiple-registry-ids'
        ? 'The parent participant-study family for this report requires adjudication because multiple registry identifiers are present.'
        : 'This report should remain a singleton study family unless the verifier can establish its parent participant-study identity.';
      const item: VerificationItem = {
        id: studyFamilyVerificationItemId(link.recordId),
        category: 'fulltext-screening',
        sourceStage: 'fulltext-screen',
        subjectCode: `FAMILY-${stableHash(link.recordId).slice(0, 8).toUpperCase()}`,
        label: 'Study-family identity',
        proposition,
        proposedValue: {
          familyId: link.familyId,
          role: link.role,
          registryIds: link.registryIds,
          linkageBasis: link.linkageBasis,
          requiresHumanReview: link.requiresHumanReview,
        },
        rationale: link.reasons,
        evidence: link.evidence,
        evidenceCoverage: evidenceCoverage(link.evidence),
        ...(record ? {
          context: {
            recordId: record.id,
            title: record.title,
            authors: record.authors,
            ...(record.journal ? { journal: record.journal } : {}),
            sourceDatabases: record.sourceDatabases,
          },
        } : {}),
        machine: { agent: 'StudyFamilyLinkageAgent', confidence: link.confidence },
      };
      return withVisibility(item, mode);
    });
}

function validateSubmission(
  submission: HumanVerificationSubmission,
  verificationPackage: HumanVerificationPackage,
  requireAllItems: boolean,
): { decisions: HumanVerificationDecision[]; missing: string[] } {
  if (submission.packageId !== verificationPackage.id) {
    throw new Error('Study-family verification submission does not match the active package');
  }
  if (submission.mode !== verificationPackage.mode) {
    throw new Error('Study-family verification mode does not match the active package');
  }
  const validIds = new Set(verificationPackage.items.map((item) => item.id));
  const seen = new Set<string>();
  for (const decision of submission.decisions) {
    if (!validIds.has(decision.itemId)) throw new Error(`Unknown study-family verification item '${decision.itemId}'`);
    if (seen.has(decision.itemId)) throw new Error(`Duplicate study-family verification decision for '${decision.itemId}'`);
    if (!decision.rationale.trim()) throw new Error(`Human rationale is required for '${decision.itemId}'`);
    if (decision.verdict === 'amend' && decision.amendedValue === undefined) {
      throw new Error(`Amended value is required for '${decision.itemId}'`);
    }
    seen.add(decision.itemId);
  }
  const missing = requireAllItems
    ? verificationPackage.items.filter((item) => !seen.has(item.id)).map((item) => item.id)
    : [];
  return { decisions: submission.decisions, missing };
}

function outcomeFor(
  verificationPackage: HumanVerificationPackage,
  decisions: HumanVerificationDecision[],
  missing: string[],
  now: string,
): HumanVerificationOutcome {
  const accepted = decisions.filter((decision) => decision.verdict === 'accept').length;
  const rejected = decisions.filter((decision) => decision.verdict === 'reject').length;
  const amended = decisions.filter((decision) => decision.verdict === 'amend').length;
  const deferred = decisions.filter((decision) => decision.verdict === 'defer').length + missing.length;
  return {
    packageId: verificationPackage.id,
    mode: verificationPackage.mode,
    status: missing.length > 0 || deferred > 0
      ? 'incomplete'
      : rejected > 0 || amended > 0
        ? 'changes-requested'
        : 'accepted',
    accepted,
    rejected,
    amended,
    deferred,
    completedAt: now,
    decisions,
  };
}

function mergeOverrides(
  context: AgentContext,
  items: VerificationItem[],
  decisions: HumanVerificationDecision[],
): HumanOverrideLedger {
  const existing = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const merged = new Map<string, HumanOverrideEntry>();
  for (const entry of existing?.entries ?? []) merged.set(entry.itemId, entry);
  for (const decision of decisions.filter((candidate) => candidate.verdict === 'amend')) {
    const item = itemById.get(decision.itemId);
    if (!item) throw new Error(`Cannot find amended study-family verification item '${decision.itemId}'`);
    merged.set(decision.itemId, {
      itemId: decision.itemId,
      sourceStage: 'fulltext-screen',
      amendedValue: decision.amendedValue,
      rationale: decision.rationale,
      ...(decision.reviewerId ? { reviewerId: decision.reviewerId } : {}),
      decidedAt: decision.decidedAt ?? context.now(),
    });
  }
  return {
    version: (existing?.version ?? 0) + 1,
    entries: [...merged.values()],
  };
}

function mergeAcknowledgements(
  context: AgentContext,
  links: EvidenceBoundStudyFamilyLink[],
  decisions: HumanVerificationDecision[],
): StudyFamilyVerificationAcknowledgement[] {
  const existing = Array.isArray(context.state.artifacts.studyFamilyVerificationAcknowledgements)
    ? context.state.artifacts.studyFamilyVerificationAcknowledgements as StudyFamilyVerificationAcknowledgement[]
    : [];
  const linkByItem = new Map(links.map((link) => [studyFamilyVerificationItemId(link.recordId), link]));
  const merged = new Map(existing.map((entry) => [`${entry.itemId}:${entry.proposalHash}`, entry]));
  for (const decision of decisions.filter((candidate) => candidate.verdict === 'accept')) {
    const link = linkByItem.get(decision.itemId);
    if (!link) throw new Error(`Cannot find accepted study-family proposal '${decision.itemId}'`);
    const entry: StudyFamilyVerificationAcknowledgement = {
      recordId: link.recordId,
      itemId: decision.itemId,
      proposalHash: familyProposalHash(link),
      verdict: 'accept',
      rationale: decision.rationale,
      ...(decision.reviewerId ? { reviewerId: decision.reviewerId } : {}),
      decidedAt: decision.decidedAt ?? context.now(),
    };
    merged.set(`${entry.itemId}:${entry.proposalHash}`, entry);
  }
  return [...merged.values()];
}

function attachFamilyAudit(
  context: AgentContext,
  result: AgentResult,
  current?: {
    verificationPackage?: HumanVerificationPackage;
    outcome?: HumanVerificationOutcome;
    acknowledgements?: StudyFamilyVerificationAcknowledgement[];
  },
): AgentResult {
  const verificationPackage = current?.verificationPackage
    ?? context.state.artifacts.studyFamilyVerificationPackage as HumanVerificationPackage | undefined;
  const outcome = current?.outcome
    ?? context.state.artifacts.studyFamilyVerificationOutcome as HumanVerificationOutcome | undefined;
  const acknowledgements = current?.acknowledgements
    ?? (Array.isArray(context.state.artifacts.studyFamilyVerificationAcknowledgements)
      ? context.state.artifacts.studyFamilyVerificationAcknowledgements as StudyFamilyVerificationAcknowledgement[]
      : []);

  const familyArtifacts = {
    ...(verificationPackage ? { studyFamilyVerificationPackage: verificationPackage } : {}),
    ...(outcome ? { studyFamilyVerificationOutcome: outcome } : {}),
    ...(acknowledgements.length > 0 ? { studyFamilyVerificationAcknowledgements: acknowledgements } : {}),
  };
  const finalReport = result.artifacts.finalReport as { appendices?: Record<string, unknown> } | undefined;
  if (!finalReport || (!verificationPackage && !outcome && acknowledgements.length === 0)) {
    return {
      ...result,
      artifacts: { ...result.artifacts, ...familyArtifacts },
    };
  }

  return {
    ...result,
    artifacts: {
      ...result.artifacts,
      ...familyArtifacts,
      finalReport: {
        ...finalReport,
        appendices: {
          ...(finalReport.appendices ?? {}),
          studyFamilyVerification: {
            ...(verificationPackage ? { package: verificationPackage } : {}),
            ...(outcome ? { outcome } : {}),
            acknowledgements,
          },
        },
      },
    },
  };
}

/**
 * Human-verification pre-gate for unresolved report → study-family identity.
 *
 * It uses the same HumanVerificationPackage/HumanVerificationPort contract as
 * the general review verifier. Accepted unresolved proposals are acknowledged
 * against a proposal hash. Amendments enter the shared human override ledger
 * and force deterministic re-execution from full-text family linkage.
 */
export class StudyFamilyHumanVerificationAgent implements Agent {
  readonly stage = 'human-verify' as const;

  constructor(
    private readonly base: Agent,
    private readonly verificationPort?: HumanVerificationPort,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    if (context.state.request.humanVerification?.enabled === false) {
      return this.base.execute(context);
    }

    const links = Array.isArray(context.state.artifacts.studyFamilyLinks)
      ? context.state.artifacts.studyFamilyLinks as EvidenceBoundStudyFamilyLink[]
      : [];
    const records = Array.isArray(context.state.artifacts.uniqueRecords)
      ? context.state.artifacts.uniqueRecords as EvidenceRecord[]
      : [];
    const acknowledgements = Array.isArray(context.state.artifacts.studyFamilyVerificationAcknowledgements)
      ? context.state.artifacts.studyFamilyVerificationAcknowledgements as StudyFamilyVerificationAcknowledgement[]
      : [];
    const mode = context.state.request.humanVerification?.mode ?? 'unblinded';
    const requireAllItems = context.state.request.humanVerification?.requireAllItems ?? true;
    const items = buildItems(links, records, acknowledgements, mode);

    if (items.length === 0) {
      return attachFamilyAudit(context, await this.base.execute(context));
    }

    const verificationPackage: HumanVerificationPackage = {
      id: `verify-family-${stableHash({ runId: context.state.runId, mode, items }).slice(0, 24)}`,
      runId: context.state.runId,
      mode,
      createdAt: context.now(),
      requiredEvidenceSections: [],
      blindedFields: mode === 'blinded'
        ? ['record identifiers', 'authors', 'journal', 'source databases', 'agent identity', 'model confidence']
        : [],
      items,
    };

    const submission = this.verificationPort ? await this.verificationPort.review(verificationPackage) : null;
    if (!submission) {
      return {
        artifacts: { studyFamilyVerificationPackage: verificationPackage },
        awaitingHuman: {
          summary: `Human study-family adjudication is required for ${items.length} evidence-bound report identity proposition(s).`,
        },
      };
    }

    const validated = validateSubmission(submission, verificationPackage, requireAllItems);
    const outcome = outcomeFor(verificationPackage, validated.decisions, validated.missing, context.now());
    if (outcome.status === 'incomplete' || outcome.rejected > 0) {
      return {
        artifacts: {
          studyFamilyVerificationPackage: verificationPackage,
          studyFamilyVerificationOutcome: outcome,
        },
        awaitingHuman: {
          summary: outcome.rejected > 0
            ? `${outcome.rejected} study-family identity proposition(s) were rejected and require amendment or adjudication.`
            : `${outcome.deferred} study-family identity proposition(s) remain incomplete or deferred.`,
        },
      };
    }

    const amendments = validated.decisions.filter((decision) => decision.verdict === 'amend');
    if (amendments.length > 0) {
      return {
        artifacts: {
          studyFamilyVerificationPackage: verificationPackage,
          studyFamilyVerificationOutcome: outcome,
          humanOverrides: mergeOverrides(context, items, validated.decisions),
        },
        rework: {
          fromStage: 'fulltext-screen',
          reason: `${amendments.length} human study-family amendment(s) must regenerate family identity and every dependent extraction/synthesis artefact.`,
        },
      };
    }

    const accepted = mergeAcknowledgements(context, links, validated.decisions);
    return attachFamilyAudit(
      context,
      await this.base.execute(context),
      { verificationPackage, outcome, acknowledgements: accepted },
    );
  }
}
