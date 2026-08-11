import type { PipelineState } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import { invalidatePipelineFromStage } from '../protocols/replay-invalidation.js';
import type {
  RegistryUniverseAdjudication,
  RegistryUniverseRequiredField,
  RegistryUniverseReviewItem,
  RegistryUniverseReviewPackage,
} from './registry-result-universe-agent.js';
import type { RegistryEligibilityStatus, RegistryResultUniverseRecord } from './publication-bias-universe.js';

export interface RegistryUniverseAdjudicationSubmission {
  registryId: string;
  outcome: string;
  eligibilityStatus?: RegistryEligibilityStatus;
  resultsAvailable?: boolean | 'unknown';
  prespecifiedPrimaryOutcomeFound?: boolean | 'unknown';
  targetOutcomeReported?: boolean | 'unknown';
  publicationStatus?: RegistryResultUniverseRecord['publicationStatus'];
  evidenceIds: string[];
  rationale: string;
}

export interface RegistryUniverseResolutionReceipt {
  version: 1;
  receiptId: string;
  registryId: string;
  outcome: string;
  actorId: string;
  decidedAt: string;
  resolvedFields: RegistryUniverseRequiredField[];
  submittedValues: Partial<Pick<
    RegistryUniverseAdjudication,
    'eligibilityStatus' | 'resultsAvailable' | 'prespecifiedPrimaryOutcomeFound' | 'targetOutcomeReported' | 'publicationStatus'
  >>;
  evidenceIds: string[];
  rationale: string;
  beforeAdjudicationHash: string | null;
  afterAdjudicationHash: string;
  semanticHash: string;
}

export type ResumeGradePipeline = (state: PipelineState) => Promise<PipelineState>;

const ELIGIBILITY = new Set<RegistryEligibilityStatus>(['eligible', 'ineligible', 'unresolved']);
const PUBLICATION = new Set<RegistryResultUniverseRecord['publicationStatus']>(['published', 'preprint', 'registry-only', 'unpublished-known', 'unknown']);
const SCIENTIFIC_FIELDS: RegistryUniverseRequiredField[] = [
  'eligibilityStatus',
  'resultsAvailable',
  'prespecifiedPrimaryOutcomeFound',
  'targetOutcomeReported',
  'publicationStatus',
];

const DERIVED_REGISTRY_PUBLICATION_ARTIFACTS = [
  'registeredStudyResultUniverse',
  'registryUniverseReviewPackage',
  'registryUniverseQuality',
  'registryResultReferenceReceipts',
  'registryResultReferenceQuality',
  'registryPublicationDiscoveryRecords',
  'registryPublicationDiscoveryReceipts',
  'registryPublicationDiscoveryProvenance',
  'registryPublicationDiscoveryQuality',
  'registryPublicationLinkReceipts',
  'registryPublicationLinkageQuality',
  'registryResidualDebtQuality',
  'contributingRegistryDebtQuality',
  'publicationBiasUniverseAudits',
  'publicationBiasEvidenceCatalog',
] as const;

function tri(value: unknown, label: string): boolean | 'unknown' {
  if (value === true || value === false || value === 'unknown') return value;
  throw Object.assign(new Error(`${label} must be true, false, or 'unknown'`), { status: 400 });
}

function triOptional(value: unknown, label: string): boolean | 'unknown' | undefined {
  return value === undefined ? undefined : tri(value, label);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function parseRegistryUniverseAdjudication(value: unknown): RegistryUniverseAdjudicationSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Registry-universe adjudication must be an object'), { status: 400 });
  }
  const root = value as Record<string, unknown>;
  if (typeof root.registryId !== 'string' || !root.registryId.trim()) throw Object.assign(new Error('registryId is required'), { status: 400 });
  if (typeof root.outcome !== 'string' || !root.outcome.trim()) throw Object.assign(new Error('outcome is required'), { status: 400 });
  if (root.eligibilityStatus !== undefined && (typeof root.eligibilityStatus !== 'string' || !ELIGIBILITY.has(root.eligibilityStatus as RegistryEligibilityStatus))) {
    throw Object.assign(new Error('eligibilityStatus is invalid'), { status: 400 });
  }
  if (root.publicationStatus !== undefined && (typeof root.publicationStatus !== 'string' || !PUBLICATION.has(root.publicationStatus as RegistryResultUniverseRecord['publicationStatus']))) {
    throw Object.assign(new Error('publicationStatus is invalid'), { status: 400 });
  }
  if (!Array.isArray(root.evidenceIds) || root.evidenceIds.some((id) => typeof id !== 'string')) {
    throw Object.assign(new Error('evidenceIds must be a string array'), { status: 400 });
  }
  if (typeof root.rationale !== 'string' || !root.rationale.trim()) throw Object.assign(new Error('rationale is required'), { status: 400 });
  const resultsAvailable = triOptional(root.resultsAvailable, 'resultsAvailable');
  const primaryOutcome = triOptional(root.prespecifiedPrimaryOutcomeFound, 'prespecifiedPrimaryOutcomeFound');
  const targetOutcome = triOptional(root.targetOutcomeReported, 'targetOutcomeReported');
  return {
    registryId: root.registryId.trim().toUpperCase(),
    outcome: root.outcome.trim(),
    ...(root.eligibilityStatus !== undefined ? { eligibilityStatus: root.eligibilityStatus as RegistryEligibilityStatus } : {}),
    ...(resultsAvailable !== undefined ? { resultsAvailable } : {}),
    ...(primaryOutcome !== undefined ? { prespecifiedPrimaryOutcomeFound: primaryOutcome } : {}),
    ...(targetOutcome !== undefined ? { targetOutcomeReported: targetOutcome } : {}),
    ...(root.publicationStatus !== undefined ? { publicationStatus: root.publicationStatus as RegistryResultUniverseRecord['publicationStatus'] } : {}),
    evidenceIds: unique(root.evidenceIds as string[]),
    rationale: root.rationale.trim(),
  };
}

function packageOf(state: PipelineState): RegistryUniverseReviewPackage {
  const value = state.artifacts.registryUniverseReviewPackage as RegistryUniverseReviewPackage | undefined;
  if (!value || value.version !== 1 || !Array.isArray(value.items)) {
    throw Object.assign(new Error('No active registry-universe review package'), { status: 409 });
  }
  return value;
}

function itemOf(state: PipelineState, submission: RegistryUniverseAdjudicationSubmission): RegistryUniverseReviewItem {
  const matches = packageOf(state).items.filter((item) =>
    item.registryId.toUpperCase() === submission.registryId.toUpperCase()
    && item.outcome.trim().toLowerCase() === submission.outcome.trim().toLowerCase());
  if (matches.length !== 1) {
    throw Object.assign(new Error(`Registry candidate ${submission.registryId}/${submission.outcome} is not uniquely active for review`), { status: 409 });
  }
  return matches[0]!;
}

function currentAdjudications(state: PipelineState): RegistryUniverseAdjudication[] {
  return Array.isArray(state.artifacts.registryUniverseAdjudications)
    ? state.artifacts.registryUniverseAdjudications as RegistryUniverseAdjudication[]
    : [];
}

function history(state: PipelineState): RegistryUniverseResolutionReceipt[] {
  return Array.isArray(state.artifacts.registryUniverseResolutionHistory)
    ? state.artifacts.registryUniverseResolutionHistory as RegistryUniverseResolutionReceipt[]
    : [];
}

function providedValues(submission: RegistryUniverseAdjudicationSubmission): RegistryUniverseResolutionReceipt['submittedValues'] {
  return {
    ...(submission.eligibilityStatus !== undefined ? { eligibilityStatus: submission.eligibilityStatus } : {}),
    ...(submission.resultsAvailable !== undefined ? { resultsAvailable: submission.resultsAvailable } : {}),
    ...(submission.prespecifiedPrimaryOutcomeFound !== undefined ? { prespecifiedPrimaryOutcomeFound: submission.prespecifiedPrimaryOutcomeFound } : {}),
    ...(submission.targetOutcomeReported !== undefined ? { targetOutcomeReported: submission.targetOutcomeReported } : {}),
    ...(submission.publicationStatus !== undefined ? { publicationStatus: submission.publicationStatus } : {}),
  };
}

function providedFields(submission: RegistryUniverseAdjudicationSubmission): RegistryUniverseRequiredField[] {
  const values = providedValues(submission);
  return SCIENTIFIC_FIELDS.filter((field) => values[field] !== undefined);
}

function assertProgress(field: RegistryUniverseRequiredField, value: unknown): void {
  if (field === 'eligibilityStatus' && value === 'unresolved') {
    throw Object.assign(new Error('eligibilityStatus=unresolved does not resolve the active scientific question; amend the policy if the field is unknowable'), { status: 400 });
  }
  if (field !== 'eligibilityStatus' && value === 'unknown') {
    throw Object.assign(new Error(`${field}=unknown does not resolve the active scientific question; amend the policy if the field is unknowable`), { status: 400 });
  }
}

function semanticHash(input: {
  submission: RegistryUniverseAdjudicationSubmission;
  actorId: string;
}): string {
  return stableHash({
    registryId: input.submission.registryId.toUpperCase(),
    outcome: input.submission.outcome.trim().toLowerCase(),
    values: providedValues(input.submission),
    evidenceIds: unique(input.submission.evidenceIds),
    rationale: input.submission.rationale.trim(),
    actorId: input.actorId,
  });
}

function currentFor(
  values: RegistryUniverseAdjudication[],
  registryId: string,
  outcome: string,
): RegistryUniverseAdjudication | undefined {
  const matches = values.filter((item) =>
    item.registryId.toUpperCase() === registryId.toUpperCase()
    && item.outcome.trim().toLowerCase() === outcome.trim().toLowerCase());
  if (matches.length > 1) throw new Error(`Registry-universe current state contains duplicate adjudications for ${registryId}/${outcome}`);
  return matches[0];
}

function mergedAdjudication(input: {
  current: RegistryUniverseAdjudication | undefined;
  item: RegistryUniverseReviewItem;
  submission: RegistryUniverseAdjudicationSubmission;
  actorId: string;
  decidedAt: string;
}): RegistryUniverseAdjudication {
  const source = input.item.sourceDerived;
  const before = input.current;
  const values = providedValues(input.submission);
  const eligibilityStatus = values.eligibilityStatus ?? before?.eligibilityStatus ?? source.eligibilityStatus;
  const resultsAvailable = values.resultsAvailable ?? before?.resultsAvailable ?? source.resultsAvailable;
  const prespecifiedPrimaryOutcomeFound = values.prespecifiedPrimaryOutcomeFound ?? before?.prespecifiedPrimaryOutcomeFound ?? source.prespecifiedPrimaryOutcomeFound;
  const targetOutcomeReported = values.targetOutcomeReported ?? before?.targetOutcomeReported ?? source.targetOutcomeReported;
  const publicationStatus = values.publicationStatus ?? before?.publicationStatus ?? source.publicationStatus;
  const evidenceIds = unique([...(before?.evidenceIds ?? []), ...input.submission.evidenceIds]);
  const hashable = {
    registryId: input.submission.registryId.toUpperCase(),
    outcome: input.submission.outcome,
    eligibilityStatus,
    resultsAvailable,
    prespecifiedPrimaryOutcomeFound,
    targetOutcomeReported,
    publicationStatus,
    evidenceIds,
  };
  return {
    version: 1,
    ...hashable,
    rationale: input.submission.rationale,
    actorId: input.actorId,
    decidedAt: input.decidedAt,
    adjudicationHash: stableHash(hashable),
  };
}

export async function submitRegistryUniverseAdjudicationAndResume(input: {
  state: PipelineState;
  submission: RegistryUniverseAdjudicationSubmission;
  actor: { sub: string };
  resume: ResumeGradePipeline;
  now?: string;
}): Promise<PipelineState> {
  if (!input.actor.sub.trim()) throw Object.assign(new Error('Authenticated registry-universe reviewer is required'), { status: 401 });
  const actorId = `user:${input.actor.sub.trim()}`;
  const semantic = semanticHash({ submission: input.submission, actorId });
  if (history(input.state).some((receipt) => receipt.semanticHash === semantic)) return input.state;

  const grade = input.state.stages.grade;
  if (!['pending', 'awaiting-human', 'failed'].includes(grade.status)) {
    throw Object.assign(new Error(`Cannot submit registry-universe adjudication while grade stage is ${grade.status}`), { status: 409 });
  }

  const item = itemOf(input.state, input.submission);
  const fields = providedFields(input.submission);
  if (fields.length === 0) throw Object.assign(new Error('At least one currently required registry-universe field must be supplied'), { status: 400 });
  const notRequired = fields.filter((field) => !item.requiredFields.includes(field));
  if (notRequired.length > 0) {
    throw Object.assign(new Error(`Submission attempts to change field(s) that are not currently unresolved: ${notRequired.join(', ')}`), { status: 409 });
  }
  const values = providedValues(input.submission);
  for (const field of fields) assertProgress(field, values[field]);

  const knownEvidence = new Set(item.evidenceIds);
  const unknownEvidence = input.submission.evidenceIds.filter((id) => !knownEvidence.has(id));
  if (unknownEvidence.length > 0) {
    throw Object.assign(new Error(`Registry adjudication references unknown evidence id(s): ${unknownEvidence.join(', ')}`), { status: 400 });
  }
  if (input.submission.evidenceIds.length === 0) {
    throw Object.assign(new Error('Registry-universe scientific resolution requires source evidence IDs'), { status: 400 });
  }

  const adjudications = currentAdjudications(input.state);
  const current = currentFor(adjudications, input.submission.registryId, input.submission.outcome);
  const now = input.now ?? new Date().toISOString();
  const next = mergedAdjudication({ current, item, submission: input.submission, actorId, decidedAt: now });
  const beforeHash = current?.adjudicationHash ?? null;
  const receiptHashable = {
    registryId: input.submission.registryId.toUpperCase(),
    outcome: input.submission.outcome,
    actorId,
    resolvedFields: fields,
    submittedValues: values,
    evidenceIds: unique(input.submission.evidenceIds),
    rationale: input.submission.rationale,
    beforeAdjudicationHash: beforeHash,
    afterAdjudicationHash: next.adjudicationHash,
    semanticHash: semantic,
  };
  const receipt: RegistryUniverseResolutionReceipt = {
    version: 1,
    receiptId: `registry-resolution-${stableHash(receiptHashable).slice(0, 24)}`,
    ...receiptHashable,
    decidedAt: now,
  };

  input.state.artifacts.registryUniverseAdjudications = current
    ? adjudications.map((candidate) => candidate === current ? next : candidate)
    : [...adjudications, next];
  input.state.artifacts.registryUniverseResolutionHistory = [...history(input.state), receipt];

  const invalidation = invalidatePipelineFromStage(input.state, 'grade', {
    preserveArtifacts: [
      'registryUniverseAdjudications',
      'registryUniverseResolutionHistory',
      'gradePolicySet',
      'gradePolicyAmendments',
      'publicationBiasUniversePolicy',
      'publicationBiasUniversePolicyAmendments',
      'registrySearchSourceAmendments',
    ],
    extraArtifacts: [...DERIVED_REGISTRY_PUBLICATION_ARTIFACTS],
  });
  input.state.updatedAt = now;
  input.state.audit.push({
    id: `registry-universe-audit-${receipt.receiptId.slice(-24)}`,
    runId: input.state.runId,
    stage: 'grade',
    event: 'registry-universe-fields-resolved',
    timestamp: now,
    attempt: 0,
    details: {
      registryId: next.registryId,
      outcome: next.outcome,
      actorId,
      receiptId: receipt.receiptId,
      resolvedFields: fields,
      beforeAdjudicationHash: beforeHash,
      afterAdjudicationHash: next.adjudicationHash,
      replayFrom: 'grade',
      invalidatedStages: invalidation.resetStages,
      removedArtifacts: invalidation.removedArtifacts,
    },
  });
  return input.resume(input.state);
}
