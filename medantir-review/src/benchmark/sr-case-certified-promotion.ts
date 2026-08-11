import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkTournamentResult } from './sr-benchmark-suite.js';
import type { SrQualificationTrustRegistry } from './sr-qualification-signatures.js';
import {
  verifySrQualifiedCaseCertification,
  type SrQualifiedCaseCertificationReceipt,
  type SrQualifiedCaseSignature,
} from './sr-qualified-case-certification.js';
import type { SrQualifiedCaseBinding } from './sr-qualified-case-binding.js';
import type { SrSecurePromotionSeal, SrSecureModelAuthorization } from './sr-secure-promotion.js';

export const SR_CASE_CERTIFIED_PROMOTION_SCHEMA_VERSION = 'medantir-sr-case-certified-promotion/1' as const;

export interface SrQualifiedCaseCertificationPackage {
  binding: SrQualifiedCaseBinding;
  receipt: SrQualifiedCaseCertificationReceipt;
  signatures: SrQualifiedCaseSignature[];
}

export interface SrCaseCertificationGateItem {
  caseId: string;
  candidateId?: string;
  admissionHash: string;
  required: boolean;
  valid: boolean;
  bindingHash?: string;
  certificationReceiptHash?: string;
  signatureVerificationHash?: string;
  trustedSigners: string[];
  trustedOrganizations: string[];
  reasons: string[];
  itemHash: string;
}

export interface SrCaseCertifiedPromotionGate {
  schemaVersion: typeof SR_CASE_CERTIFIED_PROMOTION_SCHEMA_VERSION;
  baseSecurePromotionSealHash: string;
  tournamentHash: string;
  trustRegistryHash: string;
  certificationItems: SrCaseCertificationGateItem[];
  allRequiredCasesCertified: boolean;
  effectiveSecurePromotionSeal: SrSecurePromotionSeal;
  gateHash: string;
}

function packageKey(value: SrQualifiedCaseCertificationPackage): string {
  return `${value.binding.caseId}\u0000${value.binding.candidateId}`;
}

function certificationItems(input: {
  tournament: SrBenchmarkTournamentResult;
  packages: SrQualifiedCaseCertificationPackage[];
  registry: SrQualificationTrustRegistry;
  minimumDistinctOrganizations: number;
}): SrCaseCertificationGateItem[] {
  const packageMap = new Map<string, SrQualifiedCaseCertificationPackage>();
  for (const item of input.packages) {
    const key = packageKey(item);
    if (packageMap.has(key)) throw new Error(`Case-certified promotion received duplicate certification package '${key}'.`);
    packageMap.set(key, item);
  }
  return input.tournament.qualificationAdmissions.map((admission) => {
    const required = admission.promotionAdmitted;
    const reasons: string[] = [];
    const key = `${admission.caseId}\u0000${admission.qualificationCandidateId ?? ''}`;
    const packageItem = packageMap.get(key);
    let valid = false;
    let trustedSigners: string[] = [];
    let trustedOrganizations: string[] = [];
    let signatureVerificationHash: string | undefined;
    if (required && !packageItem) reasons.push('Promotion-admitted review has no signed benchmark-case certification package.');
    if (packageItem) {
      if (packageItem.binding.caseHash !== admission.caseHash) reasons.push('Qualified-case binding caseHash does not match qualification admission.');
      if (packageItem.binding.candidateHash !== admission.candidateHash) reasons.push('Qualified-case binding candidateHash does not match qualification admission.');
      if (packageItem.binding.candidateId !== admission.qualificationCandidateId) reasons.push('Qualified-case binding candidateId does not match qualification admission.');
      const verification = verifySrQualifiedCaseCertification({
        binding: packageItem.binding,
        receipt: packageItem.receipt,
        signatures: packageItem.signatures,
        registry: input.registry,
        minimumDistinctOrganizations: input.minimumDistinctOrganizations,
      });
      signatureVerificationHash = verification.verificationHash;
      trustedSigners = verification.trustedSigners;
      trustedOrganizations = verification.trustedOrganizations;
      if (!verification.valid) {
        reasons.push('Benchmark-case certification signature quorum/stage reconciliation is invalid.');
        reasons.push(...verification.invalidSignatures.map((item) => `${item.keyId}: ${item.reason}`));
      }
      valid = reasons.length === 0 && verification.valid;
    }
    if (!required && !packageItem) valid = true;
    const base = {
      caseId: admission.caseId,
      ...(admission.qualificationCandidateId ? { candidateId: admission.qualificationCandidateId } : {}),
      admissionHash: admission.admissionHash,
      required,
      valid,
      ...(packageItem ? { bindingHash: packageItem.binding.bindingHash, certificationReceiptHash: packageItem.receipt.receiptHash } : {}),
      ...(signatureVerificationHash ? { signatureVerificationHash } : {}),
      trustedSigners,
      trustedOrganizations,
      reasons: [...new Set(reasons)].sort(),
    };
    return { ...base, itemHash: scientificContentHash(base) };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));
}

function effectiveAuthorization(input: {
  authorization: SrSecureModelAuthorization;
  allRequiredCasesCertified: boolean;
}): SrSecureModelAuthorization {
  const preservingProduction = input.allRequiredCasesCertified;
  const requestedTier = input.authorization.secureAuthorizationTier;
  const secureAuthorizationTier = preservingProduction
    ? requestedTier
    : requestedTier === 'none'
      ? 'none'
      : 'shadow-only';
  const checks = [
    ...input.authorization.checks.filter((check) => check.code !== 'signed-benchmark-case-certification'),
    {
      code: 'signed-benchmark-case-certification',
      passed: input.allRequiredCasesCertified,
      rationale: 'Every promotion-contributing qualified review must have independently signed stage-level benchmark-case reconciliation.',
    },
  ];
  const base = {
    ...input.authorization,
    secureAuthorizationTier,
    checks,
  };
  const { authorizationHash: _oldHash, ...withoutHash } = base;
  return { ...withoutHash, authorizationHash: scientificContentHash(withoutHash) };
}

export function createSrCaseCertifiedPromotionGate(input: {
  tournament: SrBenchmarkTournamentResult;
  baseSecurePromotionSeal: SrSecurePromotionSeal;
  trustRegistry: SrQualificationTrustRegistry;
  certificationPackages: SrQualifiedCaseCertificationPackage[];
  minimumDistinctOrganizations?: number;
}): SrCaseCertifiedPromotionGate {
  if (input.baseSecurePromotionSeal.suiteHash !== input.tournament.suiteHash
    || input.baseSecurePromotionSeal.tournamentHash !== input.tournament.tournamentHash) {
    throw new Error('Case-certified promotion base secure seal is bound to a different tournament/suite.');
  }
  const minimumDistinctOrganizations = input.minimumDistinctOrganizations ?? 2;
  if (!Number.isInteger(minimumDistinctOrganizations) || minimumDistinctOrganizations < 1) throw new Error('Case-certified promotion requires minimumDistinctOrganizations >= 1.');
  const items = certificationItems({
    tournament: input.tournament,
    packages: input.certificationPackages,
    registry: input.trustRegistry,
    minimumDistinctOrganizations,
  });
  const required = items.filter((item) => item.required);
  const allRequiredCasesCertified = required.length > 0 && required.every((item) => item.valid);
  const authorizations = input.baseSecurePromotionSeal.authorizations
    .map((authorization) => effectiveAuthorization({ authorization, allRequiredCasesCertified }))
    .sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));
  const effectiveBase = {
    ...input.baseSecurePromotionSeal,
    policyHash: scientificContentHash({
      basePolicyHash: input.baseSecurePromotionSeal.policyHash,
      caseCertificationItemHashes: items.map((item) => item.itemHash),
      minimumDistinctOrganizations,
    }),
    authorizations,
  };
  const { sealHash: _oldSealHash, ...withoutSealHash } = effectiveBase;
  const effectiveSecurePromotionSeal: SrSecurePromotionSeal = {
    ...withoutSealHash,
    sealHash: scientificContentHash(withoutSealHash),
  };
  const base = {
    schemaVersion: SR_CASE_CERTIFIED_PROMOTION_SCHEMA_VERSION,
    baseSecurePromotionSealHash: input.baseSecurePromotionSeal.sealHash,
    tournamentHash: input.tournament.tournamentHash,
    trustRegistryHash: input.trustRegistry.registryHash,
    certificationItems: items,
    allRequiredCasesCertified,
    effectiveSecurePromotionSeal,
  };
  return { ...base, gateHash: scientificContentHash(base) };
}
