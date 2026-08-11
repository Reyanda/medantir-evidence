import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrProspectiveQualificationSummary } from './sr-prospective-holdout.js';
import type { SrSecurePromotionSeal, SrSecureAuthorizationTier } from './sr-secure-promotion.js';

export const SR_PROSPECTIVE_AUTHORIZATION_SCHEMA_VERSION = 'medantir-sr-prospective-authorization/1' as const;

export type SrFinalAuthorizationTier = SrSecureAuthorizationTier;

export interface SrProspectiveAuthorizationPolicy {
  policyId: string;
  policyVersion: string;
  requireProspectiveQualificationForFutureReview: boolean;
  requireProspectiveQualificationForLivingReview: boolean;
}

export interface SrFinalModelAuthorization {
  requestedModel: string;
  secureHistoricalTier: SrSecureAuthorizationTier;
  prospectiveQualificationReady: boolean;
  prospectiveSummaryHash?: string;
  finalAuthorizationTier: SrFinalAuthorizationTier;
  checks: Array<{
    code: string;
    passed: boolean;
    rationale: string;
  }>;
  autonomousAuthorityGranted: false;
  authorizationHash: string;
}

export interface SrProspectiveAuthorizationSeal {
  schemaVersion: typeof SR_PROSPECTIVE_AUTHORIZATION_SCHEMA_VERSION;
  securePromotionSealHash: string;
  policyHash: string;
  authorizations: SrFinalModelAuthorization[];
  sealHash: string;
}

export function defaultSrProspectiveAuthorizationPolicy(): SrProspectiveAuthorizationPolicy {
  return {
    policyId: 'MEDANTIR-SR100-PROSPECTIVE',
    policyVersion: '1.0.0',
    requireProspectiveQualificationForFutureReview: true,
    requireProspectiveQualificationForLivingReview: true,
  };
}

export function createSrProspectiveAuthorizationSeal(input: {
  securePromotionSeal: SrSecurePromotionSeal;
  prospectiveSummaries: SrProspectiveQualificationSummary[];
  policy?: SrProspectiveAuthorizationPolicy;
}): SrProspectiveAuthorizationSeal {
  const policy = input.policy ?? defaultSrProspectiveAuthorizationPolicy();
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('Prospective authorization policy requires stable ID/version.');
  const duplicate = input.prospectiveSummaries.find((summary, index) => input.prospectiveSummaries.findIndex((item) => item.requestedModel === summary.requestedModel) !== index);
  if (duplicate) throw new Error(`Prospective authorization received duplicate summary for model '${duplicate.requestedModel}'.`);
  const summaryByModel = new Map(input.prospectiveSummaries.map((summary) => [summary.requestedModel, summary]));

  const authorizations = input.securePromotionSeal.authorizations.map((secure) => {
    const prospective = summaryByModel.get(secure.requestedModel);
    const prospectiveReady = prospective?.qualificationReady === true;
    const futureNeedsProspective = policy.requireProspectiveQualificationForFutureReview
      && (secure.secureAuthorizationTier === 'supervised-future-review' || secure.secureAuthorizationTier === 'supervised-living-review');
    const livingNeedsProspective = policy.requireProspectiveQualificationForLivingReview
      && secure.secureAuthorizationTier === 'supervised-living-review';
    const prospectiveFuturePassed = !futureNeedsProspective || prospectiveReady;
    const prospectiveLivingPassed = !livingNeedsProspective || prospectiveReady;

    let finalAuthorizationTier: SrFinalAuthorizationTier = secure.secureAuthorizationTier;
    if (!prospectiveFuturePassed) {
      finalAuthorizationTier = secure.secureAuthorizationTier === 'none' ? 'none' : 'shadow-only';
    } else if (secure.secureAuthorizationTier === 'supervised-living-review' && !prospectiveLivingPassed) {
      finalAuthorizationTier = 'supervised-future-review';
    }

    const checks = [
      {
        code: 'secure-historical-authorization',
        passed: secure.secureAuthorizationTier === 'supervised-future-review' || secure.secureAuthorizationTier === 'supervised-living-review',
        rationale: 'Historical/counterfactual/cryptographic SR100 controls must first grant secure supervised review eligibility.',
      },
      {
        code: 'prospective-future-holdout',
        passed: prospectiveFuturePassed,
        rationale: 'Prospective future-review authorization requires preregistered, prerelease perfect holdouts under the configured policy.',
      },
      {
        code: 'prospective-living-holdout',
        passed: prospectiveLivingPassed,
        rationale: 'Living-review authorization requires prospective evidence that the frozen model generalizes to unseen reviews.',
      },
    ];
    const base = {
      requestedModel: secure.requestedModel,
      secureHistoricalTier: secure.secureAuthorizationTier,
      prospectiveQualificationReady: prospectiveReady,
      ...(prospective ? { prospectiveSummaryHash: prospective.summaryHash } : {}),
      finalAuthorizationTier,
      checks,
      autonomousAuthorityGranted: false as const,
    };
    return { ...base, authorizationHash: scientificContentHash(base) };
  }).sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));

  const base = {
    schemaVersion: SR_PROSPECTIVE_AUTHORIZATION_SCHEMA_VERSION,
    securePromotionSealHash: input.securePromotionSeal.sealHash,
    policyHash: scientificContentHash(policy),
    authorizations,
  };
  return { ...base, sealHash: scientificContentHash(base) };
}
