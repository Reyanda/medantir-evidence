import { createHash } from 'node:crypto';
import type { PipelineState, StageName } from '../core/types.js';
import { invalidatePipelineFromStage } from '../protocols/replay-invalidation.js';
import type { PublicationBiasUniversePolicy } from './publication-bias-universe.js';

export interface PublicationBiasUniversePolicyConfiguration {
  version: string;
  rationale: string;
  minimumEligibleUniverseRegistryCoverage: number;
  requireEligibilityResolvedForAssessmentBasis: boolean;
  requireResultAvailabilityKnownForAssessmentBasis: boolean;
  /** Conservative default is true when omitted for backwards-compatible frozen configurations. */
  requirePrimaryOutcomeSpecificationKnownForAssessmentBasis?: boolean;
  requireTargetOutcomeStatusKnownForAssessmentBasis: boolean;
  /** Conservative default is true: unknown publication linkage blocks a negative clearance. */
  requirePublicationStatusKnownForAssessmentBasis?: boolean;
}

export interface PublicationBiasUniversePolicyAmendment {
  version: 1;
  amendmentId: string;
  protocolHash: string;
  beforePolicyHash: string | null;
  afterPolicyHash: string;
  actorId: string;
  decidedAt: string;
  rationale: string;
  timing: 'prospective' | 'post-results-amendment';
  earliestReplayStage: 'grade';
  warning?: string;
}

const RESULT_STAGES = new Set<StageName>([
  'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve', 'pdf-to-text',
  'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise',
]);

const PUBLICATION_BIAS_DERIVED_ARTIFACTS = [
  'registeredStudyResultUniverse', 'registryUniverseReviewPackage', 'registryUniverseQuality',
  'registryPublicationLinkReceipts', 'registryPublicationLinkageQuality', 'registryResidualDebtQuality',
  'contributingRegistryDebtQuality',
  'publicationBiasUniverseAudits', 'publicationBiasEvidenceCatalog',
] as const;

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function clean(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function optionalBoolean(root: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = root[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') throw Object.assign(new Error(`${key} must be boolean when supplied`), { status: 400 });
  return value;
}

export function parsePublicationBiasUniversePolicyConfiguration(value: unknown): PublicationBiasUniversePolicyConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Publication-bias universe policy must be an object'), { status: 400 });
  }
  const root = value as Record<string, unknown>;
  if (typeof root.version !== 'string' || !root.version.trim()) throw Object.assign(new Error('Publication-bias universe policy version is required'), { status: 400 });
  if (typeof root.rationale !== 'string' || !root.rationale.trim()) throw Object.assign(new Error('Publication-bias universe policy rationale is required'), { status: 400 });
  if (typeof root.minimumEligibleUniverseRegistryCoverage !== 'number'
    || !Number.isFinite(root.minimumEligibleUniverseRegistryCoverage)
    || root.minimumEligibleUniverseRegistryCoverage < 0
    || root.minimumEligibleUniverseRegistryCoverage > 1) {
    throw Object.assign(new Error('minimumEligibleUniverseRegistryCoverage must be within [0,1]'), { status: 400 });
  }
  for (const key of [
    'requireEligibilityResolvedForAssessmentBasis',
    'requireResultAvailabilityKnownForAssessmentBasis',
    'requireTargetOutcomeStatusKnownForAssessmentBasis',
  ]) {
    if (typeof root[key] !== 'boolean') throw Object.assign(new Error(`${key} must be boolean`), { status: 400 });
  }
  return {
    version: root.version.trim(),
    rationale: root.rationale.trim(),
    minimumEligibleUniverseRegistryCoverage: root.minimumEligibleUniverseRegistryCoverage,
    requireEligibilityResolvedForAssessmentBasis: root.requireEligibilityResolvedForAssessmentBasis as boolean,
    requireResultAvailabilityKnownForAssessmentBasis: root.requireResultAvailabilityKnownForAssessmentBasis as boolean,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis:
      optionalBoolean(root, 'requirePrimaryOutcomeSpecificationKnownForAssessmentBasis', true),
    requireTargetOutcomeStatusKnownForAssessmentBasis: root.requireTargetOutcomeStatusKnownForAssessmentBasis as boolean,
    requirePublicationStatusKnownForAssessmentBasis:
      optionalBoolean(root, 'requirePublicationStatusKnownForAssessmentBasis', true),
  };
}

function normalizedConfiguration(configuration: PublicationBiasUniversePolicyConfiguration) {
  return {
    ...configuration,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis:
      configuration.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis ?? true,
    requirePublicationStatusKnownForAssessmentBasis:
      configuration.requirePublicationStatusKnownForAssessmentBasis ?? true,
  };
}

function protocolHash(state: PipelineState): string {
  const pkg = state.artifacts.protocolPackage as { checksum?: unknown } | undefined;
  const value = typeof pkg?.checksum === 'string' ? pkg.checksum.trim() : '';
  if (!value) throw Object.assign(new Error('Publication-bias universe policy requires a final protocol checksum'), { status: 409 });
  return value;
}

export function freezePublicationBiasUniversePolicy(input: {
  protocolHash: string;
  configuration: PublicationBiasUniversePolicyConfiguration;
  frozenAt: string;
}): PublicationBiasUniversePolicy {
  const p = clean(input.protocolHash, 'protocolHash');
  if (!Number.isFinite(Date.parse(input.frozenAt))) throw new Error('Publication-bias universe policy frozenAt must be valid');
  const configuration = normalizedConfiguration(input.configuration);
  const hashable = { protocolHash: p, configuration };
  return {
    id: `pb-universe-policy-${hash(hashable).slice(0, 24)}`,
    version: clean(configuration.version, 'policy version'),
    protocolHash: p,
    frozenAt: input.frozenAt,
    rationale: clean(configuration.rationale, 'policy rationale'),
    minimumEligibleUniverseRegistryCoverage: configuration.minimumEligibleUniverseRegistryCoverage,
    requireEligibilityResolvedForAssessmentBasis: configuration.requireEligibilityResolvedForAssessmentBasis,
    requireResultAvailabilityKnownForAssessmentBasis: configuration.requireResultAvailabilityKnownForAssessmentBasis,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis:
      configuration.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis,
    requireTargetOutcomeStatusKnownForAssessmentBasis: configuration.requireTargetOutcomeStatusKnownForAssessmentBasis,
    requirePublicationStatusKnownForAssessmentBasis: configuration.requirePublicationStatusKnownForAssessmentBasis,
  };
}

export function publicationBiasUniversePolicySemanticHash(policy: PublicationBiasUniversePolicy): string {
  return hash({
    id: policy.id,
    version: policy.version,
    protocolHash: policy.protocolHash,
    rationale: policy.rationale,
    minimumEligibleUniverseRegistryCoverage: policy.minimumEligibleUniverseRegistryCoverage,
    requireEligibilityResolvedForAssessmentBasis: policy.requireEligibilityResolvedForAssessmentBasis,
    requireResultAvailabilityKnownForAssessmentBasis: policy.requireResultAvailabilityKnownForAssessmentBasis,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: policy.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis,
    requireTargetOutcomeStatusKnownForAssessmentBasis: policy.requireTargetOutcomeStatusKnownForAssessmentBasis,
    requirePublicationStatusKnownForAssessmentBasis: policy.requirePublicationStatusKnownForAssessmentBasis,
  });
}

function historyHasResults(state: PipelineState): boolean {
  const ledger = state.artifacts.scientificRunLedger as { attempts?: Array<{ stage?: StageName }> } | undefined;
  if ((ledger?.attempts ?? []).some((attempt) => attempt.stage && RESULT_STAGES.has(attempt.stage))) return true;
  return [...RESULT_STAGES].some((name) => {
    const status = state.stages[name]?.status;
    return status === 'running' || status === 'passed' || status === 'awaiting-human' || status === 'failed';
  });
}

function reopenProtocolGate(state: PipelineState): boolean {
  const stage = state.stages['protocol-finalise'];
  const req = state.artifacts.publicationBiasUniversePolicyRequirement as { protocolHash?: unknown } | undefined;
  if (!req || typeof req.protocolHash !== 'string') return false;
  if (stage.status !== 'awaiting-human' && stage.status !== 'failed') return false;
  stage.status = 'pending';
  stage.attempts = 0;
  stage.errors = [];
  delete stage.startedAt;
  delete stage.completedAt;
  return true;
}

export function recordPublicationBiasUniversePolicy(input: {
  state: PipelineState;
  configuration: PublicationBiasUniversePolicyConfiguration;
  actorId: string;
  decidedAt: string;
}): { state: PipelineState; receipt: PublicationBiasUniversePolicyAmendment; changed: boolean } {
  const actorId = clean(input.actorId, 'actorId');
  if (!Number.isFinite(Date.parse(input.decidedAt))) throw new Error('decidedAt must be valid');
  const pHash = protocolHash(input.state);
  const after = freezePublicationBiasUniversePolicy({
    protocolHash: pHash,
    configuration: input.configuration,
    frozenAt: input.decidedAt,
  });
  const before = input.state.artifacts.publicationBiasUniversePolicy as PublicationBiasUniversePolicy | undefined;
  const beforeHash = before ? publicationBiasUniversePolicySemanticHash(before) : null;
  const afterHash = publicationBiasUniversePolicySemanticHash(after);
  if (before && beforeHash === afterHash) {
    const ledger = Array.isArray(input.state.artifacts.publicationBiasUniversePolicyAmendments)
      ? input.state.artifacts.publicationBiasUniversePolicyAmendments as PublicationBiasUniversePolicyAmendment[]
      : [];
    const existing = ledger.find((item) => item.afterPolicyHash === afterHash);
    const gateReopened = reopenProtocolGate(input.state);
    if (existing) return { state: input.state, receipt: existing, changed: gateReopened };
  }

  const timing: PublicationBiasUniversePolicyAmendment['timing'] = historyHasResults(input.state)
    ? 'post-results-amendment'
    : 'prospective';
  const warning = timing === 'post-results-amendment'
    ? 'Publication-bias registry/result completeness rules were introduced or changed after results existed and must be disclosed as a post-results methodological amendment.'
    : undefined;
  const receipt: PublicationBiasUniversePolicyAmendment = {
    version: 1,
    amendmentId: `pb-universe-amend-${hash({ pHash, beforeHash, afterHash, actorId }).slice(0, 24)}`,
    protocolHash: pHash,
    beforePolicyHash: beforeHash,
    afterPolicyHash: afterHash,
    actorId,
    decidedAt: input.decidedAt,
    rationale: input.configuration.rationale,
    timing,
    earliestReplayStage: 'grade',
    ...(warning ? { warning } : {}),
  };

  const invalidation = invalidatePipelineFromStage(input.state, 'grade', {
    preserveArtifacts: [
      'gradePolicySet', 'gradePolicyAmendments',
      'publicationBiasUniversePolicyAmendments',
      'registryUniverseAdjudications', 'registryUniverseResolutionHistory', 'registrySearchSourceAmendments',
    ],
    extraArtifacts: [...PUBLICATION_BIAS_DERIVED_ARTIFACTS],
  });
  input.state.artifacts.publicationBiasUniversePolicy = after;
  const ledger = Array.isArray(input.state.artifacts.publicationBiasUniversePolicyAmendments)
    ? input.state.artifacts.publicationBiasUniversePolicyAmendments as PublicationBiasUniversePolicyAmendment[]
    : [];
  input.state.artifacts.publicationBiasUniversePolicyAmendments = [...ledger, receipt];
  if (warning) input.state.artifacts.publicationBiasUniversePolicyLateAmendment = { amendmentId: receipt.amendmentId, warning };
  else delete input.state.artifacts.publicationBiasUniversePolicyLateAmendment;
  const gateReopened = reopenProtocolGate(input.state);
  input.state.updatedAt = input.decidedAt;
  input.state.audit.push({
    id: `pb-universe-policy-audit-${hash(receipt).slice(0, 24)}`,
    runId: input.state.runId,
    stage: 'grade',
    event: 'publication-bias-universe-policy-amended',
    timestamp: input.decidedAt,
    attempt: 0,
    details: {
      amendmentId: receipt.amendmentId,
      actorId,
      timing,
      protocolHash: pHash,
      gateReopened,
      earliestReplayStage: 'grade',
      invalidatedStages: invalidation.resetStages,
      removedArtifacts: invalidation.removedArtifacts,
      ...(warning ? { warning } : {}),
    },
  });
  return { state: input.state, receipt, changed: true };
}
