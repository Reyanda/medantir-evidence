import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_RELIABILITY_EVIDENCE_SCHEMA_VERSION = 'medantir-sr-reliability-evidence/1' as const;

export interface SrReliabilityEvidencePolicy {
  policyId: string;
  policyVersion: string;
  confidenceLevel: number;
  futureReviewLowerBoundTarget: number;
  livingReviewLowerBoundTarget: number;
}

export type SrReliabilityEvidenceTier =
  | 'insufficient'
  | 'prospective-validated'
  | 'high-confidence-future'
  | 'high-confidence-living';

export interface SrReliabilityEvidenceReport {
  schemaVersion: typeof SR_RELIABILITY_EVIDENCE_SCHEMA_VERSION;
  requestedModel: string;
  independentProspectiveTrials: number;
  perfectTrials: number;
  failures: number;
  confidenceLevel: number;
  exactZeroFailureLowerBound: number;
  futureReviewLowerBoundTarget: number;
  livingReviewLowerBoundTarget: number;
  zeroFailureTrialsRequiredForFutureTarget: number;
  zeroFailureTrialsRequiredForLivingTarget: number;
  futureTargetMet: boolean;
  livingTargetMet: boolean;
  tier: SrReliabilityEvidenceTier;
  rationale: string;
  reportHash: string;
}

function probability(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${label} must be strictly between 0 and 1.`);
}

export function exactZeroFailureReliabilityLowerBound(input: {
  trials: number;
  confidenceLevel: number;
}): number {
  if (!Number.isInteger(input.trials) || input.trials <= 0) throw new Error('Zero-failure reliability bound requires a positive integer trial count.');
  probability(input.confidenceLevel, 'confidenceLevel');
  const alpha = 1 - input.confidenceLevel;
  return Math.pow(alpha, 1 / input.trials);
}

export function zeroFailureTrialsRequired(input: {
  targetReliability: number;
  confidenceLevel: number;
}): number {
  probability(input.targetReliability, 'targetReliability');
  probability(input.confidenceLevel, 'confidenceLevel');
  const alpha = 1 - input.confidenceLevel;
  return Math.ceil(Math.log(alpha) / Math.log(input.targetReliability));
}

export function defaultSrReliabilityEvidencePolicy(): SrReliabilityEvidencePolicy {
  return {
    policyId: 'MEDANTIR-SR-RELIABILITY',
    policyVersion: '1.0.0',
    confidenceLevel: 0.95,
    futureReviewLowerBoundTarget: 0.90,
    livingReviewLowerBoundTarget: 0.95,
  };
}

export function createSrReliabilityEvidenceReport(input: {
  requestedModel: string;
  independentProspectiveTrials: number;
  perfectTrials: number;
  policy?: SrReliabilityEvidencePolicy;
}): SrReliabilityEvidenceReport {
  const policy = input.policy ?? defaultSrReliabilityEvidencePolicy();
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('Reliability evidence policy requires stable ID/version.');
  probability(policy.confidenceLevel, 'confidenceLevel');
  probability(policy.futureReviewLowerBoundTarget, 'futureReviewLowerBoundTarget');
  probability(policy.livingReviewLowerBoundTarget, 'livingReviewLowerBoundTarget');
  if (policy.livingReviewLowerBoundTarget < policy.futureReviewLowerBoundTarget) throw new Error('Living-review reliability target cannot be weaker than future-review target.');
  if (!Number.isInteger(input.independentProspectiveTrials) || input.independentProspectiveTrials < 0) throw new Error('independentProspectiveTrials must be a non-negative integer.');
  if (!Number.isInteger(input.perfectTrials) || input.perfectTrials < 0 || input.perfectTrials > input.independentProspectiveTrials) throw new Error('perfectTrials must be an integer within the prospective trial count.');
  if (!input.requestedModel.trim()) throw new Error('Reliability evidence requires requestedModel.');
  const failures = input.independentProspectiveTrials - input.perfectTrials;
  // The exact one-sided Clopper-Pearson lower bound has this closed form when
  // every Bernoulli trial succeeds. MEDANTIR v1 deliberately assigns zero when
  // any prospective review fails because production promotion already requires
  // zero failed review-level holdouts; no approximate general-case estimator is
  // silently substituted here.
  const exactZeroFailureLowerBound = input.independentProspectiveTrials > 0 && failures === 0
    ? exactZeroFailureReliabilityLowerBound({ trials: input.independentProspectiveTrials, confidenceLevel: policy.confidenceLevel })
    : 0;
  const zeroFailureTrialsRequiredForFutureTarget = zeroFailureTrialsRequired({ targetReliability: policy.futureReviewLowerBoundTarget, confidenceLevel: policy.confidenceLevel });
  const zeroFailureTrialsRequiredForLivingTarget = zeroFailureTrialsRequired({ targetReliability: policy.livingReviewLowerBoundTarget, confidenceLevel: policy.confidenceLevel });
  const futureTargetMet = failures === 0 && exactZeroFailureLowerBound >= policy.futureReviewLowerBoundTarget;
  const livingTargetMet = failures === 0 && exactZeroFailureLowerBound >= policy.livingReviewLowerBoundTarget;
  const tier: SrReliabilityEvidenceTier = livingTargetMet
    ? 'high-confidence-living'
    : futureTargetMet
      ? 'high-confidence-future'
      : failures === 0 && input.independentProspectiveTrials >= 2
        ? 'prospective-validated'
        : 'insufficient';
  const rationale = failures > 0
    ? `${failures} prospective review-level failure(s) occurred; v1 high-confidence reliability evidence requires zero failures.`
    : input.independentProspectiveTrials === 0
      ? 'No independent prospective review holdouts are available.'
      : `Observed ${input.perfectTrials}/${input.independentProspectiveTrials} perfect prospective reviews. The exact one-sided ${(policy.confidenceLevel * 100).toFixed(1)}% zero-failure lower bound is ${(exactZeroFailureLowerBound * 100).toFixed(2)}%.`;
  const base = {
    schemaVersion: SR_RELIABILITY_EVIDENCE_SCHEMA_VERSION,
    requestedModel: input.requestedModel.trim(),
    independentProspectiveTrials: input.independentProspectiveTrials,
    perfectTrials: input.perfectTrials,
    failures,
    confidenceLevel: policy.confidenceLevel,
    exactZeroFailureLowerBound,
    futureReviewLowerBoundTarget: policy.futureReviewLowerBoundTarget,
    livingReviewLowerBoundTarget: policy.livingReviewLowerBoundTarget,
    zeroFailureTrialsRequiredForFutureTarget,
    zeroFailureTrialsRequiredForLivingTarget,
    futureTargetMet,
    livingTargetMet,
    tier,
    rationale,
  };
  return { ...base, reportHash: scientificContentHash(base) };
}
