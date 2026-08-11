import type { HumanVerificationPort } from '../core/ports.js';
import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceExcerpt,
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
import { normaliseText, stableHash } from '../core/utils.js';
import {
  estimandVerificationItemId,
  type EstimandAdjudicationOverride,
} from './estimand-adjudication.js';
import type { CanonicalEstimand, EstimandLedgerRow } from './estimand-identity.js';

export interface EstimandVerificationAcknowledgement {
  itemId: string;
  proposalHash: string;
  verdict: 'accept';
  rationale: string;
  reviewerId?: string;
  decidedAt: string;
}

export interface EstimandVerificationIndexEntry {
  itemId: string;
  recordId: string;
  studyId: string;
  studyFamilyId?: string;
  outcome: string;
  estimandId: string;
  tableId?: string;
  page?: number;
}

function coverage(evidence: EvidenceExcerpt[]): VerificationItem['evidenceCoverage'] {
  return {
    rationale: evidence.some((entry) => entry.section === 'rationale'),
    objectives: evidence.some((entry) => entry.section === 'objectives'),
    results: evidence.some((entry) => entry.section === 'results'),
    discussion: evidence.some((entry) => entry.section === 'discussion'),
    limitations: evidence.some((entry) => entry.section === 'limitations'),
  };
}

function subjectCode(estimand: CanonicalEstimand): string {
  return `EST-${stableHash({
    studyId: estimand.source.studyId,
    outcome: normaliseText(estimand.outcome),
    tableId: estimand.source.tableId ?? '',
    page: estimand.source.page ?? 0,
  }).slice(0, 10).toUpperCase()}`;
}

function evidenceFor(estimand: CanonicalEstimand, mode: VerificationMode): EvidenceExcerpt[] {
  const code = subjectCode(estimand);
  const quote = estimand.source.verbatim
    ?? [estimand.source.rowLabel, estimand.source.columnHeader].filter(Boolean).join(' | ')
    ?? estimand.outcome;
  return [{
    id: `estimand-evidence-${stableHash({
      recordId: estimand.source.recordId,
      tableId: estimand.source.tableId,
      page: estimand.source.page,
      quote,
    }).slice(0, 20)}`,
    recordId: mode === 'blinded' ? code : estimand.source.recordId,
    section: 'results',
    page: estimand.source.page ?? 0,
    quote,
    source: 'full-text',
    ...(estimand.source.tableHeading ? { heading: estimand.source.tableHeading } : {}),
  }];
}

function proposedValue(estimand: CanonicalEstimand, mode: VerificationMode): Record<string, unknown> {
  const dimensions = {
    outcome: estimand.outcome,
    effectMeasure: estimand.effectMeasure,
    analysisScale: estimand.analysisScale,
    interventionOrExposure: estimand.interventionOrExposure,
    comparator: estimand.comparator,
    population: estimand.population,
    timeHorizon: estimand.timeHorizon,
    analysisPopulation: estimand.analysisPopulation,
    subgroup: estimand.subgroup,
    adjustment: estimand.adjustment,
    effectTarget: estimand.effectTarget,
    unresolvedDimensions: estimand.unresolvedDimensions,
  };
  if (mode === 'blinded') return dimensions;
  return {
    estimandId: estimand.estimandId,
    ...dimensions,
    source: estimand.source,
  };
}

function proposalHash(estimand: CanonicalEstimand): string {
  return stableHash({
    estimandId: estimand.estimandId,
    unresolvedDimensions: estimand.unresolvedDimensions,
    source: {
      recordId: estimand.source.recordId,
      tableId: estimand.source.tableId ?? null,
      page: estimand.source.page ?? null,
      rowLabel: estimand.source.rowLabel ?? null,
      columnHeader: estimand.source.columnHeader ?? null,
      verbatim: estimand.source.verbatim ?? null,
    },
  });
}

function acknowledged(
  estimand: CanonicalEstimand,
  acknowledgements: EstimandVerificationAcknowledgement[],
): boolean {
  const itemId = estimandVerificationItemId(estimand);
  const hash = proposalHash(estimand);
  return acknowledgements.some((entry) => entry.itemId === itemId && entry.proposalHash === hash && entry.verdict === 'accept');
}

function buildPackageItems(
  rows: EstimandLedgerRow[],
  records: EvidenceRecord[],
  acknowledgements: EstimandVerificationAcknowledgement[],
  mode: VerificationMode,
): { items: VerificationItem[]; index: EstimandVerificationIndexEntry[] } {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const items: VerificationItem[] = [];
  const index: EstimandVerificationIndexEntry[] = [];
  for (const row of rows) {
    const estimand = row.estimand;
    if (row.status !== 'identified' || !estimand || estimand.unresolvedDimensions.length === 0 || acknowledged(estimand, acknowledgements)) continue;
    const itemId = estimandVerificationItemId(estimand);
    const code = subjectCode(estimand);
    const evidence = evidenceFor(estimand, mode);
    const record = recordById.get(estimand.source.recordId);
    const item: VerificationItem = {
      id: itemId,
      category: 'extraction',
      sourceStage: 'extract',
      subjectCode: code,
      label: 'Estimand identity',
      proposition: `Confirm or amend the unresolved estimand dimensions for '${estimand.outcome}': ${estimand.unresolvedDimensions.join(', ')}.`,
      proposedValue: proposedValue(estimand, mode),
      rationale: [
        `The quantitative estimate is provenance-valid, but ${estimand.unresolvedDimensions.length} estimand dimension(s) are not resolved from the extracted source row.`,
        'Unknown dimensions are not imputed because they can change synthesis compatibility or same-family dependence decisions.',
      ],
      evidence,
      evidenceCoverage: coverage(evidence),
      ...(mode === 'unblinded' ? {
        context: {
          recordId: estimand.source.recordId,
          studyId: estimand.source.studyId,
          ...(record?.title ? { title: record.title } : {}),
          ...(record?.authors ? { authors: record.authors } : {}),
          ...(record?.journal ? { journal: record.journal } : {}),
          ...(record?.sourceDatabases ? { sourceDatabases: record.sourceDatabases } : {}),
        },
        machine: {
          agent: 'EstimandIdentityExtractionAgent',
          confidence: estimand.unresolvedDimensions.length === 0 ? 1 : Math.max(0.1, 1 - 0.15 * estimand.unresolvedDimensions.length),
        },
      } : {}),
    };
    items.push(item);
    index.push({
      itemId,
      recordId: estimand.source.recordId,
      studyId: estimand.source.studyId,
      ...(estimand.source.studyFamilyId ? { studyFamilyId: estimand.source.studyFamilyId } : {}),
      outcome: estimand.outcome,
      estimandId: estimand.estimandId,
      ...(estimand.source.tableId ? { tableId: estimand.source.tableId } : {}),
      ...(estimand.source.page !== undefined ? { page: estimand.source.page } : {}),
    });
  }
  return { items, index };
}

function validateSubmission(
  submission: HumanVerificationSubmission,
  verificationPackage: HumanVerificationPackage,
  requireAllItems: boolean,
): { decisions: HumanVerificationDecision[]; missing: string[] } {
  if (submission.packageId !== verificationPackage.id) {
    throw new Error('Estimand verification submission does not match the active package.');
  }
  if (submission.mode !== verificationPackage.mode) {
    throw new Error('Estimand verification mode does not match the active package.');
  }
  const validIds = new Set(verificationPackage.items.map((item) => item.id));
  const seen = new Set<string>();
  for (const decision of submission.decisions) {
    if (!validIds.has(decision.itemId)) throw new Error(`Unknown estimand verification item '${decision.itemId}'.`);
    if (seen.has(decision.itemId)) throw new Error(`Duplicate estimand verification decision for '${decision.itemId}'.`);
    if (!decision.rationale.trim()) throw new Error(`Human rationale is required for '${decision.itemId}'.`);
    if (decision.verdict === 'amend' && decision.amendedValue === undefined) {
      throw new Error(`Amended value is required for '${decision.itemId}'.`);
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
    ...(amended > 0 ? { requiresRerunFrom: 'extract' } : {}),
  };
}

function mergeAmendedValues(existing: unknown, next: unknown): EstimandAdjudicationOverride {
  const left = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as EstimandAdjudicationOverride
    : {};
  const right = next && typeof next === 'object' && !Array.isArray(next)
    ? next as EstimandAdjudicationOverride
    : {};
  return {
    ...left,
    ...right,
    ...(right.subgroup ? { subgroup: right.subgroup } : left.subgroup ? { subgroup: left.subgroup } : {}),
  };
}

function mergeOverrides(
  context: AgentContext,
  decisions: HumanVerificationDecision[],
): HumanOverrideLedger {
  const existing = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
  const merged = new Map<string, HumanOverrideEntry>();
  for (const entry of existing?.entries ?? []) merged.set(entry.itemId, entry);
  for (const decision of decisions.filter((candidate) => candidate.verdict === 'amend')) {
    const prior = merged.get(decision.itemId);
    merged.set(decision.itemId, {
      itemId: decision.itemId,
      sourceStage: 'extract',
      amendedValue: mergeAmendedValues(prior?.amendedValue, decision.amendedValue),
      rationale: decision.rationale,
      ...(decision.reviewerId ? { reviewerId: decision.reviewerId } : prior?.reviewerId ? { reviewerId: prior.reviewerId } : {}),
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
  rows: EstimandLedgerRow[],
  decisions: HumanVerificationDecision[],
): EstimandVerificationAcknowledgement[] {
  const existing = Array.isArray(context.state.artifacts.estimandVerificationAcknowledgements)
    ? context.state.artifacts.estimandVerificationAcknowledgements as EstimandVerificationAcknowledgement[]
    : [];
  const estimandByItem = new Map(
    rows
      .filter((row): row is EstimandLedgerRow & { estimand: CanonicalEstimand } => row.status === 'identified' && Boolean(row.estimand))
      .map((row) => [estimandVerificationItemId(row.estimand), row.estimand]),
  );
  const merged = new Map(existing.map((entry) => [`${entry.itemId}:${entry.proposalHash}`, entry]));
  for (const decision of decisions.filter((candidate) => candidate.verdict === 'accept')) {
    const estimand = estimandByItem.get(decision.itemId);
    if (!estimand) throw new Error(`Cannot find accepted estimand proposition '${decision.itemId}'.`);
    const entry: EstimandVerificationAcknowledgement = {
      itemId: decision.itemId,
      proposalHash: proposalHash(estimand),
      verdict: 'accept',
      rationale: decision.rationale,
      ...(decision.reviewerId ? { reviewerId: decision.reviewerId } : {}),
      decidedAt: decision.decidedAt ?? context.now(),
    };
    merged.set(`${entry.itemId}:${entry.proposalHash}`, entry);
  }
  return [...merged.values()];
}

function attachAudit(
  context: AgentContext,
  result: AgentResult,
  current?: {
    verificationPackage?: HumanVerificationPackage;
    outcome?: HumanVerificationOutcome;
    acknowledgements?: EstimandVerificationAcknowledgement[];
    index?: EstimandVerificationIndexEntry[];
  },
): AgentResult {
  const verificationPackage = current?.verificationPackage
    ?? context.state.artifacts.estimandVerificationPackage as HumanVerificationPackage | undefined;
  const outcome = current?.outcome
    ?? context.state.artifacts.estimandVerificationOutcome as HumanVerificationOutcome | undefined;
  const acknowledgements = current?.acknowledgements
    ?? (Array.isArray(context.state.artifacts.estimandVerificationAcknowledgements)
      ? context.state.artifacts.estimandVerificationAcknowledgements as EstimandVerificationAcknowledgement[]
      : []);
  const index = current?.index
    ?? (Array.isArray(context.state.artifacts.estimandVerificationIndex)
      ? context.state.artifacts.estimandVerificationIndex as EstimandVerificationIndexEntry[]
      : []);
  const auditArtifacts = {
    ...(verificationPackage ? { estimandVerificationPackage: verificationPackage } : {}),
    ...(outcome ? { estimandVerificationOutcome: outcome } : {}),
    ...(acknowledgements.length > 0 ? { estimandVerificationAcknowledgements: acknowledgements } : {}),
    ...(index.length > 0 ? { estimandVerificationIndex: index } : {}),
  };
  const finalReport = result.artifacts.finalReport as { appendices?: Record<string, unknown> } | undefined;
  if (!finalReport || (!verificationPackage && !outcome && acknowledgements.length === 0 && index.length === 0)) {
    return { ...result, artifacts: { ...result.artifacts, ...auditArtifacts } };
  }
  return {
    ...result,
    artifacts: {
      ...result.artifacts,
      ...auditArtifacts,
      finalReport: {
        ...finalReport,
        appendices: {
          ...(finalReport.appendices ?? {}),
          estimandVerification: {
            ...(verificationPackage ? { package: verificationPackage } : {}),
            ...(outcome ? { outcome } : {}),
            acknowledgements,
            index,
          },
        },
      },
    },
  };
}

/**
 * Human gate for unresolved evidence-bound estimand dimensions.
 *
 * Family identity is expected to be adjudicated by the outer family gate first.
 * Amendments enter the shared override ledger at `extract` and force replay of
 * canonical estimand identity, synthesis compatibility and report artifacts.
 */
export class EstimandHumanVerificationAgent implements Agent {
  readonly stage = 'human-verify' as const;

  constructor(
    private readonly base: Agent,
    private readonly verificationPort?: HumanVerificationPort,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    if (context.state.request.humanVerification?.enabled === false) {
      return this.base.execute(context);
    }

    const rows = Array.isArray(context.state.artifacts.estimandLedger)
      ? context.state.artifacts.estimandLedger as EstimandLedgerRow[]
      : [];
    const records = Array.isArray(context.state.artifacts.uniqueRecords)
      ? context.state.artifacts.uniqueRecords as EvidenceRecord[]
      : [];
    const acknowledgements = Array.isArray(context.state.artifacts.estimandVerificationAcknowledgements)
      ? context.state.artifacts.estimandVerificationAcknowledgements as EstimandVerificationAcknowledgement[]
      : [];
    const mode = context.state.request.humanVerification?.mode ?? 'unblinded';
    const requireAllItems = context.state.request.humanVerification?.requireAllItems ?? true;
    const built = buildPackageItems(rows, records, acknowledgements, mode);

    if (built.items.length === 0) {
      return attachAudit(context, await this.base.execute(context));
    }

    const verificationPackage: HumanVerificationPackage = {
      id: `verify-estimand-${stableHash({ runId: context.state.runId, mode, items: built.items }).slice(0, 24)}`,
      runId: context.state.runId,
      mode,
      createdAt: context.now(),
      requiredEvidenceSections: ['results'],
      blindedFields: mode === 'blinded'
        ? ['record identifiers', 'study identifiers', 'study-family identity', 'authors', 'journal', 'source databases', 'agent identity', 'model confidence']
        : [],
      items: built.items,
    };

    const submission = this.verificationPort ? await this.verificationPort.review(verificationPackage) : null;
    if (!submission) {
      return {
        artifacts: {
          estimandVerificationPackage: verificationPackage,
          estimandVerificationIndex: built.index,
        },
        awaitingHuman: {
          summary: `Human estimand adjudication is required for ${built.items.length} evidence-bound quantitative proposition(s).`,
        },
      };
    }

    const validated = validateSubmission(submission, verificationPackage, requireAllItems);
    const verificationOutcome = outcomeFor(verificationPackage, validated.decisions, validated.missing, context.now());
    if (verificationOutcome.status === 'incomplete' || verificationOutcome.rejected > 0) {
      return {
        artifacts: {
          estimandVerificationPackage: verificationPackage,
          estimandVerificationOutcome: verificationOutcome,
          estimandVerificationIndex: built.index,
        },
        awaitingHuman: {
          summary: verificationOutcome.rejected > 0
            ? `${verificationOutcome.rejected} estimand proposition(s) were rejected and require amendment or adjudication.`
            : `${verificationOutcome.deferred} estimand proposition(s) remain incomplete or deferred.`,
        },
      };
    }

    const amendments = validated.decisions.filter((decision) => decision.verdict === 'amend');
    if (amendments.length > 0) {
      return {
        artifacts: {
          estimandVerificationPackage: verificationPackage,
          estimandVerificationOutcome: verificationOutcome,
          estimandVerificationIndex: built.index,
          humanOverrides: mergeOverrides(context, validated.decisions),
        },
        rework: {
          fromStage: 'extract',
          reason: `${amendments.length} human estimand amendment(s) must regenerate estimand identity, compatibility and every dependent synthesis/report artifact.`,
        },
      };
    }

    const accepted = mergeAcknowledgements(context, rows, validated.decisions);
    return attachAudit(
      context,
      await this.base.execute(context),
      {
        verificationPackage,
        outcome: verificationOutcome,
        acknowledgements: accepted,
        index: built.index,
      },
    );
  }
}
