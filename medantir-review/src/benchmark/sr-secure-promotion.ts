import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkTournamentResult } from './sr-benchmark-suite.js';
import {
  createSrQualificationCandidate,
  type SrQualificationCandidateInput,
} from './sr-qualification-corpus.js';
import {
  verifySrQualificationReceiptSignatures,
  type SrQualificationReceiptSignature,
  type SrQualificationSignatureVerification,
  type SrQualificationTrustRegistry,
} from './sr-qualification-signatures.js';
import type { SrTournamentPerformanceSummary } from './sr-performance-summary.js';

export const SR_SECURE_PROMOTION_SCHEMA_VERSION = 'medantir-sr-secure-promotion/1' as const;

export type SrSecureAuthorizationTier =
  | 'none'
  | 'shadow-only'
  | 'supervised-future-review'
  | 'supervised-living-review';

export interface SrSignedQualificationProof {
  candidate: SrQualificationCandidateInput;
  signatures: SrQualificationReceiptSignature[];
}

export interface SrSecurePromotionPolicy {
  policyId: string;
  policyVersion: string;
  minimumDistinctVerifierOrganizations: number;
  requireAllPromotionReviewsCryptographicallyQualified: boolean;
  blockOnContaminationConcern: boolean;
  livingReviewRequiresPerfectCounterfactualCanaryRate: boolean;
}

export interface SrSecureQualificationCheck {
  candidateId: string;
  candidateHash?: string;
  admissionHash: string;
  qualified: boolean;
  trustedSigners: string[];
  trustedOrganizations: string[];
  signatureVerificationHash?: string;
  reasons: string[];
}

export interface SrSecureModelAuthorization {
  requestedModel: string;
  benchmarkPromotionTier: string;
  secureAuthorizationTier: SrSecureAuthorizationTier;
  checks: Array<{
    code: string;
    passed: boolean;
    rationale: string;
  }>;
  qualificationChecks: SrSecureQualificationCheck[];
  contaminationConcern: boolean;
  counterfactualCanarySr100Rate: number;
  driftSentinelValid: boolean;
  autonomousAuthorityGranted: false;
  authorizationHash: string;
}

export interface SrSecurePromotionSeal {
  schemaVersion: typeof SR_SECURE_PROMOTION_SCHEMA_VERSION;
  suiteHash: string;
  tournamentHash: string;
  performanceSummaryHash: string;
  trustRegistryHash: string;
  policyHash: string;
  authorizations: SrSecureModelAuthorization[];
  sealHash: string;
}

export function defaultSrSecurePromotionPolicy(): SrSecurePromotionPolicy {
  return {
    policyId: 'MEDANTIR-SR100-SECURE',
    policyVersion: '1.0.0',
    minimumDistinctVerifierOrganizations: 2,
    requireAllPromotionReviewsCryptographicallyQualified: true,
    blockOnContaminationConcern: true,
    livingReviewRequiresPerfectCounterfactualCanaryRate: true,
  };
}

function organizationForSigner(registry: SrQualificationTrustRegistry, keyId: string): string {
  const key = registry.keys.find((item) => item.keyId === keyId);
  return key?.organization?.trim() || `key:${keyId}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function verifyQualificationProof(input: {
  admission: SrBenchmarkTournamentResult['qualificationAdmissions'][number];
  proof: SrSignedQualificationProof | undefined;
  registry: SrQualificationTrustRegistry;
  policy: SrSecurePromotionPolicy;
}): SrSecureQualificationCheck {
  const reasons: string[] = [];
  if (!input.admission.qualificationCandidateId) {
    reasons.push('Promotion admission has no qualification candidate identity.');
  }
  if (!input.admission.promotionAdmitted) reasons.push('Qualification admission itself is not promotion-admitted.');
  if (!input.proof) {
    reasons.push('No signed qualification proof supplied for the admitted review.');
    return {
      candidateId: input.admission.qualificationCandidateId ?? 'unknown',
      candidateHash: input.admission.candidateHash,
      admissionHash: input.admission.admissionHash,
      qualified: false,
      trustedSigners: [],
      trustedOrganizations: [],
      reasons,
    };
  }

  let candidate;
  try {
    candidate = createSrQualificationCandidate(input.proof.candidate);
  } catch (error) {
    reasons.push(`Qualification candidate reconstruction failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      candidateId: input.admission.qualificationCandidateId ?? input.proof.candidate.candidateId,
      candidateHash: input.admission.candidateHash,
      admissionHash: input.admission.admissionHash,
      qualified: false,
      trustedSigners: [],
      trustedOrganizations: [],
      reasons,
    };
  }
  if (candidate.candidateId !== input.admission.qualificationCandidateId) reasons.push('Signed proof candidate ID does not match qualification admission.');
  if (candidate.candidateHash !== input.admission.candidateHash) reasons.push('Signed proof candidate hash does not match qualification admission.');
  if (!candidate.promotionEligible || candidate.readiness !== 'validation-ready') reasons.push('Signed proof candidate is not validation-ready.');
  if (!candidate.independentVerification) reasons.push('Signed proof candidate has no candidate-wide independent verification receipt.');

  let signatureVerification: SrQualificationSignatureVerification | undefined;
  if (candidate.independentVerification) {
    try {
      signatureVerification = verifySrQualificationReceiptSignatures({
        receipt: candidate.independentVerification,
        signatures: input.proof.signatures,
        registry: input.registry,
      });
      if (!signatureVerification.valid) reasons.push('Qualification signature quorum is not satisfied.');
    } catch (error) {
      reasons.push(`Qualification signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const trustedSigners = signatureVerification?.trustedSigners ?? [];
  const trustedOrganizations = unique(trustedSigners.map((keyId) => organizationForSigner(input.registry, keyId)));
  if (trustedOrganizations.length < input.policy.minimumDistinctVerifierOrganizations) {
    reasons.push(`Qualification signatures represent ${trustedOrganizations.length} distinct verifier organization(s); policy requires ${input.policy.minimumDistinctVerifierOrganizations}.`);
  }
  return {
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    admissionHash: input.admission.admissionHash,
    qualified: reasons.length === 0,
    trustedSigners,
    trustedOrganizations,
    ...(signatureVerification ? { signatureVerificationHash: signatureVerification.verificationHash } : {}),
    reasons: [...new Set(reasons)].sort(),
  };
}

export function createSrSecurePromotionSeal(input: {
  tournament: SrBenchmarkTournamentResult;
  performanceSummary: SrTournamentPerformanceSummary;
  trustRegistry: SrQualificationTrustRegistry;
  qualificationProofs: SrSignedQualificationProof[];
  policy?: SrSecurePromotionPolicy;
}): SrSecurePromotionSeal {
  const policy = input.policy ?? defaultSrSecurePromotionPolicy();
  if (!Number.isInteger(policy.minimumDistinctVerifierOrganizations) || policy.minimumDistinctVerifierOrganizations < 1) {
    throw new Error('Secure promotion policy requires minimumDistinctVerifierOrganizations >= 1.');
  }
  if (input.performanceSummary.suiteHash !== input.tournament.suiteHash || input.performanceSummary.tournamentHash !== input.tournament.tournamentHash) {
    throw new Error('Secure promotion performance summary is bound to a different tournament/suite.');
  }
  const proofByCandidate = new Map<string, SrSignedQualificationProof>();
  for (const proof of input.qualificationProofs) {
    const id = proof.candidate.candidateId.trim();
    if (!id) throw new Error('Signed qualification proof requires candidate ID.');
    if (proofByCandidate.has(id)) throw new Error(`Secure promotion received duplicate signed proof for candidate '${id}'.`);
    proofByCandidate.set(id, proof);
  }
  const admitted = input.tournament.qualificationAdmissions.filter((item) => item.promotionAdmitted);
  const qualificationChecks = admitted.map((admission) => verifyQualificationProof({
    admission,
    proof: admission.qualificationCandidateId ? proofByCandidate.get(admission.qualificationCandidateId) : undefined,
    registry: input.trustRegistry,
    policy,
  }));
  const allQualified = qualificationChecks.length > 0 && qualificationChecks.every((item) => item.qualified);

  const authorizations: SrSecureModelAuthorization[] = input.tournament.models.map((model) => {
    const promotion = input.tournament.promotion.find((item) => item.requestedModel === model);
    const performance = input.performanceSummary.models.find((item) => item.requestedModel === model);
    if (!promotion || !performance) throw new Error(`Secure promotion is missing benchmark/performance evidence for model '${model}'.`);
    const driftSentinelValid = input.tournament.driftSentinels.find((item) => item.requestedModel === model)?.valid === true;
    const qualificationPassed = !policy.requireAllPromotionReviewsCryptographicallyQualified || allQualified;
    const contaminationPassed = !policy.blockOnContaminationConcern || !performance.contaminationConcern;
    const canaryPassed = !policy.livingReviewRequiresPerfectCounterfactualCanaryRate
      || (performance.counterfactualCanary.challengedRuns > 0 && performance.counterfactualCanary.sr100Rate === 1);
    const futureBenchmarkEligible = promotion.tier === 'supervised-future-review-eligible' || promotion.tier === 'supervised-living-review-eligible';
    const livingBenchmarkEligible = promotion.tier === 'supervised-living-review-eligible';
    const checks = [
      { code: 'benchmark-future-eligibility', passed: futureBenchmarkEligible, rationale: 'Base SR100 policy must qualify the model for supervised prospective use.' },
      { code: 'cryptographic-qualification-quorum', passed: qualificationPassed, rationale: 'Every promotion-contributing review must have independently signed qualification evidence.' },
      { code: 'counterfactual-contamination', passed: contaminationPassed, rationale: 'High published-review scores cannot override a counterfactual memorization concern.' },
      { code: 'counterfactual-canary-sr100', passed: canaryPassed, rationale: 'Operational counterfactual canaries must reproduce exactly before living-review use.' },
      { code: 'drift-sentinel', passed: driftSentinelValid, rationale: 'Living-review use requires a current challenged-canary drift sentinel.' },
    ];
    let secureAuthorizationTier: SrSecureAuthorizationTier = 'none';
    if (futureBenchmarkEligible && qualificationPassed && contaminationPassed) {
      secureAuthorizationTier = 'supervised-future-review';
      if (livingBenchmarkEligible && canaryPassed && driftSentinelValid) secureAuthorizationTier = 'supervised-living-review';
    } else if (promotion.tier === 'shadow-eligible' && contaminationPassed) {
      secureAuthorizationTier = 'shadow-only';
    }
    const base = {
      requestedModel: model,
      benchmarkPromotionTier: promotion.tier,
      secureAuthorizationTier,
      checks,
      qualificationChecks,
      contaminationConcern: performance.contaminationConcern,
      counterfactualCanarySr100Rate: performance.counterfactualCanary.sr100Rate,
      driftSentinelValid,
      autonomousAuthorityGranted: false as const,
    };
    return { ...base, authorizationHash: scientificContentHash(base) };
  }).sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));

  const base = {
    schemaVersion: SR_SECURE_PROMOTION_SCHEMA_VERSION,
    suiteHash: input.tournament.suiteHash,
    tournamentHash: input.tournament.tournamentHash,
    performanceSummaryHash: input.performanceSummary.summaryHash,
    trustRegistryHash: input.trustRegistry.registryHash,
    policyHash: scientificContentHash(policy),
    authorizations,
  };
  return { ...base, sealHash: scientificContentHash(base) };
}
