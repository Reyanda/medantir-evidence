import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrProspectiveAuthorizationSeal } from './sr-prospective-authorization.js';
import type { SrReliabilityEvidenceReport } from './sr-reliability-evidence.js';

export const SR_RELIABILITY_AUTHORIZATION_SCHEMA_VERSION = 'medantir-sr-reliability-authorization/1' as const;

export type SrReliabilityAuthorizationTier =
  | 'none'
  | 'shadow-only'
  | 'prospective-pilot-only'
  | 'high-confidence-future-review'
  | 'high-confidence-living-review';

export interface SrReliabilityModelAuthorization {
  requestedModel: string;
  prospectiveAuthorizationTier: string;
  reliabilityEvidenceTier: string;
  reliabilityLowerBound: number;
  finalAuthorizationTier: SrReliabilityAuthorizationTier;
  checks: Array<{
    code: string;
    passed: boolean;
    rationale: string;
  }>;
  autonomousAuthorityGranted: false;
  authorizationHash: string;
}

export interface SrReliabilityAuthorizationSeal {
  schemaVersion: typeof SR_RELIABILITY_AUTHORIZATION_SCHEMA_VERSION;
  prospectiveAuthorizationSealHash: string;
  reliabilityReportHashes: string[];
  authorizations: SrReliabilityModelAuthorization[];
  sealHash: string;
}

export function createSrReliabilityAuthorizationSeal(input: {
  prospectiveAuthorizationSeal: SrProspectiveAuthorizationSeal;
  reliabilityReports: SrReliabilityEvidenceReport[];
}): SrReliabilityAuthorizationSeal {
  const duplicate = input.reliabilityReports.find((report, index) => input.reliabilityReports.findIndex((item) => item.requestedModel === report.requestedModel) !== index);
  if (duplicate) throw new Error(`Reliability authorization received duplicate report for model '${duplicate.requestedModel}'.`);
  const reports = new Map(input.reliabilityReports.map((report) => [report.requestedModel, report]));
  const authorizations: SrReliabilityModelAuthorization[] = input.prospectiveAuthorizationSeal.authorizations.map((prospective) => {
    const reliability = reports.get(prospective.requestedModel);
    const futureEligible = prospective.finalAuthorizationTier === 'supervised-future-review'
      || prospective.finalAuthorizationTier === 'supervised-living-review';
    const livingEligible = prospective.finalAuthorizationTier === 'supervised-living-review';
    const futureReliability = reliability?.futureTargetMet === true;
    const livingReliability = reliability?.livingTargetMet === true;
    let finalAuthorizationTier: SrReliabilityAuthorizationTier = 'none';
    if (prospective.finalAuthorizationTier === 'shadow-only') finalAuthorizationTier = 'shadow-only';
    else if (futureEligible) {
      finalAuthorizationTier = 'prospective-pilot-only';
      if (futureReliability) finalAuthorizationTier = 'high-confidence-future-review';
      if (livingEligible && livingReliability) finalAuthorizationTier = 'high-confidence-living-review';
    }
    const checks = [
      {
        code: 'prospective-authorization',
        passed: futureEligible,
        rationale: 'The model must first pass historical, counterfactual, cryptographic and prerelease prospective gates.',
      },
      {
        code: 'future-reliability-bound',
        passed: futureReliability,
        rationale: 'High-confidence future-review use requires the prespecified exact lower confidence bound on independent perfect prospective reviews.',
      },
      {
        code: 'living-reliability-bound',
        passed: livingReliability,
        rationale: 'High-confidence living-review use requires the stronger prespecified reliability lower bound.',
      },
    ];
    const base = {
      requestedModel: prospective.requestedModel,
      prospectiveAuthorizationTier: prospective.finalAuthorizationTier,
      reliabilityEvidenceTier: reliability?.tier ?? 'missing',
      reliabilityLowerBound: reliability?.exactZeroFailureLowerBound ?? 0,
      finalAuthorizationTier,
      checks,
      autonomousAuthorityGranted: false as const,
    };
    return { ...base, authorizationHash: scientificContentHash(base) };
  }).sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));
  const base = {
    schemaVersion: SR_RELIABILITY_AUTHORIZATION_SCHEMA_VERSION,
    prospectiveAuthorizationSealHash: input.prospectiveAuthorizationSeal.sealHash,
    reliabilityReportHashes: input.reliabilityReports.map((report) => report.reportHash).sort(),
    authorizations,
  };
  return { ...base, sealHash: scientificContentHash(base) };
}
