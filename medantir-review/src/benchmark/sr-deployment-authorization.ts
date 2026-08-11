import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrQualificationTrustRegistry } from './sr-qualification-signatures.js';
import {
  verifySrQualificationTrustRoot,
  type SrQualificationTrustRoot,
} from './sr-qualification-trust-root.js';
import type { SrReliabilityAuthorizationSeal, SrReliabilityAuthorizationTier } from './sr-reliability-authorization.js';

export const SR_DEPLOYMENT_AUTHORIZATION_SCHEMA_VERSION = 'medantir-sr-deployment-authorization/1' as const;

export interface SrDeploymentModelAuthorization {
  requestedModel: string;
  evidenceAuthorizationTier: SrReliabilityAuthorizationTier;
  trustRootValid: boolean;
  deploymentAuthorizationTier: SrReliabilityAuthorizationTier;
  checks: Array<{
    code: string;
    passed: boolean;
    rationale: string;
  }>;
  autonomousAuthorityGranted: false;
  authorizationHash: string;
}

export interface SrDeploymentAuthorizationSeal {
  schemaVersion: typeof SR_DEPLOYMENT_AUTHORIZATION_SCHEMA_VERSION;
  reliabilityAuthorizationSealHash: string;
  expectedTrustRootHash: string;
  trustRootHash: string;
  trustRegistryHash: string;
  trustVerificationHash: string;
  authorizations: SrDeploymentModelAuthorization[];
  deployableModels: string[];
  sealHash: string;
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

export function createSrDeploymentAuthorizationSeal(input: {
  reliabilityAuthorizationSeal: SrReliabilityAuthorizationSeal;
  trustRegistry: SrQualificationTrustRegistry;
  trustRoot: SrQualificationTrustRoot;
  expectedTrustRootHash: string;
  now?: string;
}): SrDeploymentAuthorizationSeal {
  const expectedTrustRootHash = sha(input.expectedTrustRootHash, 'Deployment expectedTrustRootHash');
  const trust = verifySrQualificationTrustRoot({
    root: input.trustRoot,
    registry: input.trustRegistry,
    expectedRootHash: expectedTrustRootHash,
    ...(input.now ? { now: input.now } : {}),
  });
  const authorizations: SrDeploymentModelAuthorization[] = input.reliabilityAuthorizationSeal.authorizations.map((evidence) => {
    const evidenceDeployable = evidence.finalAuthorizationTier === 'high-confidence-future-review'
      || evidence.finalAuthorizationTier === 'high-confidence-living-review';
    const trustPassed = trust.valid && trust.registryTrusted;
    const deploymentAuthorizationTier: SrReliabilityAuthorizationTier = evidenceDeployable && trustPassed
      ? evidence.finalAuthorizationTier
      : evidence.finalAuthorizationTier === 'none'
        ? 'none'
        : 'shadow-only';
    const checks = [
      {
        code: 'evidence-authorization',
        passed: evidenceDeployable,
        rationale: 'Deployment requires a high-confidence reliability authorization, not only benchmark or pilot eligibility.',
      },
      {
        code: 'externally-pinned-trust-root',
        passed: trustPassed,
        rationale: 'The verifier registry must reconcile to the externally pinned qualification trust root.',
      },
    ];
    const base = {
      requestedModel: evidence.requestedModel,
      evidenceAuthorizationTier: evidence.finalAuthorizationTier,
      trustRootValid: trustPassed,
      deploymentAuthorizationTier,
      checks,
      autonomousAuthorityGranted: false as const,
    };
    return { ...base, authorizationHash: scientificContentHash(base) };
  }).sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));
  const deployableModels = authorizations
    .filter((item) => item.deploymentAuthorizationTier === 'high-confidence-future-review' || item.deploymentAuthorizationTier === 'high-confidence-living-review')
    .map((item) => item.requestedModel)
    .sort();
  const base = {
    schemaVersion: SR_DEPLOYMENT_AUTHORIZATION_SCHEMA_VERSION,
    reliabilityAuthorizationSealHash: input.reliabilityAuthorizationSeal.sealHash,
    expectedTrustRootHash,
    trustRootHash: input.trustRoot.rootHash,
    trustRegistryHash: input.trustRegistry.registryHash,
    trustVerificationHash: trust.verificationHash,
    authorizations,
    deployableModels,
  };
  return { ...base, sealHash: scientificContentHash(base) };
}
