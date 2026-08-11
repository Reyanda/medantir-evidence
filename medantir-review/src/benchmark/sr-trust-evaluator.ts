import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkTournamentResult } from './sr-benchmark-suite.js';
import { createSrCaseCertifiedPromotionGate, type SrQualifiedCaseCertificationPackage } from './sr-case-certified-promotion.js';
import { createSrDeploymentAuthorizationSeal, type SrDeploymentAuthorizationSeal } from './sr-deployment-authorization.js';
import { createSrTournamentPerformanceSummary, type SrTournamentPerformanceSummary } from './sr-performance-summary.js';
import {
  summarizeSrProspectiveQualification,
  verifySrProspectiveHoldout,
  type SrProspectiveExecutionReceipt,
  type SrProspectiveGoldRevealReceipt,
  type SrProspectiveHoldoutRegistration,
  type SrProspectiveQualificationSummary,
  type SrProspectiveScoreReceipt,
} from './sr-prospective-holdout.js';
import { createSrProspectiveAuthorizationSeal, type SrProspectiveAuthorizationSeal } from './sr-prospective-authorization.js';
import { createSrReliabilityAuthorizationSeal, type SrReliabilityAuthorizationSeal } from './sr-reliability-authorization.js';
import { createSrReliabilityEvidenceReport, type SrReliabilityEvidencePolicy, type SrReliabilityEvidenceReport } from './sr-reliability-evidence.js';
import { createSrSecurePromotionSeal, type SrSecurePromotionPolicy, type SrSignedQualificationProof } from './sr-secure-promotion.js';
import type { SrQualificationTrustRegistry } from './sr-qualification-signatures.js';
import type { SrQualificationTrustRoot } from './sr-qualification-trust-root.js';
import { createSrTrustStateReport, type SrTrustStateReport } from './sr-trust-state.js';

export const SR_TRUST_EVALUATOR_SCHEMA_VERSION = 'medantir-sr-trust-evaluator/1' as const;

export interface SrProspectiveHoldoutBundle {
  registration: SrProspectiveHoldoutRegistration;
  execution: SrProspectiveExecutionReceipt;
  gold: SrProspectiveGoldRevealReceipt;
  score: SrProspectiveScoreReceipt;
}

export interface SrTrustEvaluationResult {
  schemaVersion: typeof SR_TRUST_EVALUATOR_SCHEMA_VERSION;
  tournamentHash: string;
  performanceSummary: SrTournamentPerformanceSummary;
  baseSecurePromotionSealHash: string;
  caseCertificationGateHash: string;
  effectiveSecurePromotionSealHash: string;
  prospectiveSummaries: SrProspectiveQualificationSummary[];
  prospectiveAuthorizationSeal: SrProspectiveAuthorizationSeal;
  reliabilityReports: SrReliabilityEvidenceReport[];
  reliabilityAuthorizationSeal: SrReliabilityAuthorizationSeal;
  deploymentAuthorizationSeal: SrDeploymentAuthorizationSeal;
  trustStateReport: SrTrustStateReport;
  evaluationHash: string;
}

export function evaluateSrModelTrust(input: {
  tournament: SrBenchmarkTournamentResult;
  trustRegistry: SrQualificationTrustRegistry;
  trustRoot: SrQualificationTrustRoot;
  expectedTrustRootHash: string;
  qualificationProofs: SrSignedQualificationProof[];
  caseCertificationPackages: SrQualifiedCaseCertificationPackage[];
  prospectiveHoldouts: SrProspectiveHoldoutBundle[];
  securePromotionPolicy?: SrSecurePromotionPolicy;
  reliabilityPolicy?: SrReliabilityEvidencePolicy;
  now?: string;
}): SrTrustEvaluationResult {
  const performanceSummary = createSrTournamentPerformanceSummary(input.tournament);
  const baseSecurePromotionSeal = createSrSecurePromotionSeal({
    tournament: input.tournament,
    performanceSummary,
    trustRegistry: input.trustRegistry,
    qualificationProofs: input.qualificationProofs,
    ...(input.securePromotionPolicy ? { policy: input.securePromotionPolicy } : {}),
  });
  const caseCertificationGate = createSrCaseCertifiedPromotionGate({
    tournament: input.tournament,
    baseSecurePromotionSeal,
    trustRegistry: input.trustRegistry,
    certificationPackages: input.caseCertificationPackages,
  });

  const prospectiveSummaries: SrProspectiveQualificationSummary[] = input.tournament.models.map((model) => {
    const relevant = input.prospectiveHoldouts.filter((holdout) => holdout.registration.requestedModel === model);
    return summarizeSrProspectiveQualification({
      requestedModel: model,
      holdouts: relevant.map((holdout) => ({
        domain: holdout.registration.domain,
        verification: verifySrProspectiveHoldout(holdout),
      })),
    });
  });
  const prospectiveAuthorizationSeal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: caseCertificationGate.effectiveSecurePromotionSeal,
    prospectiveSummaries,
  });
  const reliabilityReports: SrReliabilityEvidenceReport[] = input.tournament.models.map((model) => {
    const relevant = input.prospectiveHoldouts.filter((holdout) => holdout.registration.requestedModel === model);
    const verifications = relevant.map((holdout) => verifySrProspectiveHoldout(holdout));
    return createSrReliabilityEvidenceReport({
      requestedModel: model,
      independentProspectiveTrials: verifications.length,
      perfectTrials: verifications.filter((verification) => verification.valid && verification.perfect).length,
      ...(input.reliabilityPolicy ? { policy: input.reliabilityPolicy } : {}),
    });
  });
  const reliabilityAuthorizationSeal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal,
    reliabilityReports,
  });
  const deploymentAuthorizationSeal = createSrDeploymentAuthorizationSeal({
    reliabilityAuthorizationSeal,
    trustRegistry: input.trustRegistry,
    trustRoot: input.trustRoot,
    expectedTrustRootHash: input.expectedTrustRootHash,
    ...(input.now ? { now: input.now } : {}),
  });
  const trustStateReport = createSrTrustStateReport({
    tournament: input.tournament,
    securePromotionSeal: caseCertificationGate.effectiveSecurePromotionSeal,
    prospectiveAuthorizationSeal,
    reliabilityAuthorizationSeal,
    deploymentAuthorizationSeal,
  });
  const base = {
    schemaVersion: SR_TRUST_EVALUATOR_SCHEMA_VERSION,
    tournamentHash: input.tournament.tournamentHash,
    performanceSummary,
    baseSecurePromotionSealHash: baseSecurePromotionSeal.sealHash,
    caseCertificationGateHash: caseCertificationGate.gateHash,
    effectiveSecurePromotionSealHash: caseCertificationGate.effectiveSecurePromotionSeal.sealHash,
    prospectiveSummaries,
    prospectiveAuthorizationSeal,
    reliabilityReports,
    reliabilityAuthorizationSeal,
    deploymentAuthorizationSeal,
    trustStateReport,
  };
  return { ...base, evaluationHash: scientificContentHash(base) };
}
