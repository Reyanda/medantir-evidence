import { createHash } from 'node:crypto';

export type RegistryEligibilityStatus = 'eligible' | 'ineligible' | 'unresolved';

export interface RegistryResultUniverseRecord {
  version: 2;
  studyId: string;
  outcome: string;
  registryId?: string;
  eligibilityStatus: RegistryEligibilityStatus;
  contributesToSynthesis: boolean;
  registrySearched: boolean;
  registrationFound: boolean;
  resultsAvailable: boolean | 'unknown';
  prespecifiedPrimaryOutcomeFound: boolean | 'unknown';
  targetOutcomeReported: boolean | 'unknown';
  publicationStatus: 'published' | 'preprint' | 'registry-only' | 'unpublished-known' | 'unknown';
  evidenceIds: string[];
  sourceHash: string;
}

export type PublicationBiasUniverseSignalKind =
  | 'eligible-registered-study-without-results'
  | 'eligible-primary-outcome-not-reported'
  | 'eligible-unpublished-study';

export interface PublicationBiasUniverseSignal {
  id: string;
  kind: PublicationBiasUniverseSignalKind;
  studyId: string;
  outcome: string;
  strength: 1;
  evidenceIds: string[];
  description: string;
  signalHash: string;
}

export type PublicationBiasAuditDebtKind =
  | 'eligibility-unresolved'
  | 'eligible-study-registry-not-searched'
  | 'eligible-study-result-availability-unknown'
  | 'eligible-study-primary-outcome-specification-unknown'
  | 'eligible-study-target-outcome-status-unknown'
  | 'eligible-study-publication-status-unknown';

export interface PublicationBiasAuditDebt {
  id: string;
  kind: PublicationBiasAuditDebtKind;
  studyId: string;
  outcome: string;
  evidenceIds: string[];
  description: string;
  debtHash: string;
}

export interface PublicationBiasUniversePolicy {
  id: string;
  version: string;
  protocolHash: string;
  frozenAt: string;
  rationale: string;
  minimumEligibleUniverseRegistryCoverage: number;
  requireEligibilityResolvedForAssessmentBasis: boolean;
  requireResultAvailabilityKnownForAssessmentBasis: boolean;
  requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: boolean;
  requireTargetOutcomeStatusKnownForAssessmentBasis: boolean;
  requirePublicationStatusKnownForAssessmentBasis: boolean;
}

export interface PublicationBiasUniverseAudit {
  version: 2;
  outcome: string;
  contributingStudyCount: number;
  eligibleUniverseCount: number;
  unresolvedEligibilityCount: number;
  eligibleRegistrySearchCoverage: number;
  knownResultAvailabilityCount: number;
  knownPrimaryOutcomeSpecificationCount: number;
  knownTargetOutcomeStatusCount: number;
  knownPublicationStatusCount: number;
  signals: PublicationBiasUniverseSignal[];
  auditDebt: PublicationBiasAuditDebt[];
  assessmentBasisComplete: boolean;
  assessmentBasisEvidenceIds: string[];
  unresolvedReasons: string[];
  policyId: string;
  auditHash: string;
}

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

function validatePolicy(policy: PublicationBiasUniversePolicy): void {
  if (!policy.id.trim() || !policy.version.trim() || !policy.protocolHash.trim() || !policy.rationale.trim()) {
    throw new Error('Publication-bias universe policy requires id/version/protocolHash/rationale');
  }
  if (!Number.isFinite(Date.parse(policy.frozenAt))) throw new Error('Publication-bias universe policy frozenAt must be valid');
  if (!Number.isFinite(policy.minimumEligibleUniverseRegistryCoverage)
    || policy.minimumEligibleUniverseRegistryCoverage < 0
    || policy.minimumEligibleUniverseRegistryCoverage > 1) {
    throw new Error('minimumEligibleUniverseRegistryCoverage must be within [0,1]');
  }
}

function signal(input: Omit<PublicationBiasUniverseSignal, 'id' | 'strength' | 'signalHash'>): PublicationBiasUniverseSignal {
  const hashable = {
    kind: input.kind,
    studyId: input.studyId,
    outcome: input.outcome,
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    description: input.description,
  };
  const signalHash = hash(hashable);
  return {
    id: `pb-universe-${signalHash.slice(0, 24)}`,
    kind: input.kind,
    studyId: input.studyId,
    outcome: input.outcome,
    strength: 1,
    evidenceIds: hashable.evidenceIds,
    description: input.description,
    signalHash,
  };
}

function debt(input: Omit<PublicationBiasAuditDebt, 'id' | 'debtHash'>): PublicationBiasAuditDebt {
  const hashable = {
    kind: input.kind,
    studyId: input.studyId,
    outcome: input.outcome,
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    description: input.description,
  };
  const debtHash = hash(hashable);
  return {
    id: `pb-audit-debt-${debtHash.slice(0, 24)}`,
    kind: input.kind,
    studyId: input.studyId,
    outcome: input.outcome,
    evidenceIds: hashable.evidenceIds,
    description: input.description,
    debtHash,
  };
}

/**
 * Publication-bias audit over the full eligible evidence universe.
 *
 * Positive evidence and completeness debt are intentionally separate. Debt can
 * prevent a signal-free clearance but can never itself become a GRADE downgrade
 * signal. Registry-local silence is not equivalent to global publication absence.
 */
export function auditPublicationBiasUniverse(input: {
  outcome: string;
  contributingStudyIds: string[];
  records: RegistryResultUniverseRecord[];
  policy: PublicationBiasUniversePolicy;
}): PublicationBiasUniverseAudit {
  validatePolicy(input.policy);
  const contributors = new Set(input.contributingStudyIds);
  if (contributors.size === 0) throw new Error('Publication-bias universe audit requires contributing studies');

  const outcomeRows = input.records.filter((record) => record.outcome === input.outcome);
  const unique = new Map<string, RegistryResultUniverseRecord>();
  for (const record of outcomeRows) {
    if (unique.has(record.studyId)) throw new Error(`Publication-bias universe contains duplicate study identity ${record.studyId}/${input.outcome}`);
    unique.set(record.studyId, record);
  }
  for (const studyId of contributors) {
    if (!unique.has(studyId)) throw new Error(`Contributing study ${studyId}/${input.outcome} is missing from the registry/result universe`);
  }

  const eligible = outcomeRows.filter((record) => record.eligibilityStatus === 'eligible');
  const unresolved = outcomeRows.filter((record) => record.eligibilityStatus === 'unresolved');
  const denominator = eligible.length;
  const eligibleRegistrySearchCoverage = denominator > 0
    ? eligible.filter((record) => record.registrySearched).length / denominator
    : 0;
  const knownResultAvailabilityCount = eligible.filter((record) => record.resultsAvailable !== 'unknown').length;
  const knownPrimaryOutcomeSpecificationCount = eligible.filter((record) => record.prespecifiedPrimaryOutcomeFound !== 'unknown').length;
  const knownTargetOutcomeStatusCount = eligible.filter((record) => record.targetOutcomeReported !== 'unknown').length;
  const knownPublicationStatusCount = eligible.filter((record) => record.publicationStatus !== 'unknown').length;
  const signals: PublicationBiasUniverseSignal[] = [];
  const auditDebt: PublicationBiasAuditDebt[] = [];

  for (const row of eligible) {
    if (!row.registrySearched) {
      auditDebt.push(debt({
        kind: 'eligible-study-registry-not-searched',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} was not reconciled against the prespecified registry search.`,
      }));
    }

    // These are positive signals only when global evidence-universe facts have
    // been established. ClinicalTrials.gov hasPostedResults=false never creates
    // resultsAvailable=false by itself.
    if (row.registrationFound && row.resultsAvailable === false) {
      signals.push(signal({
        kind: 'eligible-registered-study-without-results',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible registered study ${row.studyId} has no available result in the reconciled evidence universe.`,
      }));
    }
    if (row.prespecifiedPrimaryOutcomeFound === true && row.targetOutcomeReported === false) {
      signals.push(signal({
        kind: 'eligible-primary-outcome-not-reported',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} prespecified the target outcome as primary but did not report it in the reconciled available results.`,
      }));
    }
    if (row.publicationStatus === 'registry-only' || row.publicationStatus === 'unpublished-known') {
      signals.push(signal({
        kind: 'eligible-unpublished-study',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} is known to lack a full peer-reviewed publication in the reconciled evidence universe.`,
      }));
    }

    if (row.resultsAvailable === 'unknown') {
      auditDebt.push(debt({
        kind: 'eligible-study-result-availability-unknown',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} has unresolved result availability.`,
      }));
    }
    if (row.prespecifiedPrimaryOutcomeFound === 'unknown') {
      auditDebt.push(debt({
        kind: 'eligible-study-primary-outcome-specification-unknown',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} has unresolved prespecified-primary-outcome status for the target outcome.`,
      }));
    }
    if (row.targetOutcomeReported === 'unknown') {
      auditDebt.push(debt({
        kind: 'eligible-study-target-outcome-status-unknown',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} has unresolved target-outcome reporting status.`,
      }));
    }
    if (row.publicationStatus === 'unknown') {
      auditDebt.push(debt({
        kind: 'eligible-study-publication-status-unknown',
        studyId: row.studyId,
        outcome: input.outcome,
        evidenceIds: row.evidenceIds,
        description: `Eligible study ${row.studyId} has unresolved publication/preprint linkage status.`,
      }));
    }
  }

  for (const row of unresolved) {
    auditDebt.push(debt({
      kind: 'eligibility-unresolved',
      studyId: row.studyId,
      outcome: input.outcome,
      evidenceIds: row.evidenceIds,
      description: `Registry/result record ${row.studyId} has unresolved review eligibility and cannot be omitted from completeness accounting.`,
    }));
  }

  const unresolvedReasons: string[] = [];
  if (denominator === 0) unresolvedReasons.push('No eligible study universe is established for the target outcome.');
  if (eligibleRegistrySearchCoverage < input.policy.minimumEligibleUniverseRegistryCoverage) {
    unresolvedReasons.push(`Eligible-universe registry coverage ${eligibleRegistrySearchCoverage.toFixed(3)} is below policy minimum ${input.policy.minimumEligibleUniverseRegistryCoverage.toFixed(3)}.`);
  }
  if (input.policy.requireEligibilityResolvedForAssessmentBasis && unresolved.length > 0) {
    unresolvedReasons.push(`${unresolved.length} registry/result record(s) have unresolved eligibility.`);
  }
  if (input.policy.requireResultAvailabilityKnownForAssessmentBasis && knownResultAvailabilityCount !== eligible.length) {
    unresolvedReasons.push('Result availability is not known for every eligible study.');
  }
  if (input.policy.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis && knownPrimaryOutcomeSpecificationCount !== eligible.length) {
    unresolvedReasons.push('Prespecified-primary-outcome status is not known for every eligible study.');
  }
  if (input.policy.requireTargetOutcomeStatusKnownForAssessmentBasis && knownTargetOutcomeStatusCount !== eligible.length) {
    unresolvedReasons.push('Target-outcome reporting status is not known for every eligible study.');
  }
  if (input.policy.requirePublicationStatusKnownForAssessmentBasis && knownPublicationStatusCount !== eligible.length) {
    unresolvedReasons.push('Publication/preprint linkage status is not known for every eligible study.');
  }

  const assessmentBasisComplete = unresolvedReasons.length === 0;
  const assessmentBasisEvidenceIds = assessmentBasisComplete
    ? [...new Set(eligible.flatMap((row) => [...row.evidenceIds, `registry-universe-record:${row.sourceHash}`]))].sort()
    : [];
  const hashable = {
    version: 2 as const,
    outcome: input.outcome,
    contributingStudyCount: contributors.size,
    eligibleUniverseCount: eligible.length,
    unresolvedEligibilityCount: unresolved.length,
    eligibleRegistrySearchCoverage,
    knownResultAvailabilityCount,
    knownPrimaryOutcomeSpecificationCount,
    knownTargetOutcomeStatusCount,
    knownPublicationStatusCount,
    signals,
    auditDebt,
    assessmentBasisComplete,
    assessmentBasisEvidenceIds,
    unresolvedReasons,
    policyId: input.policy.id,
  };
  return { ...hashable, auditHash: hash(hashable) };
}
