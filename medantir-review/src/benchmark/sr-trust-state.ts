import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkTournamentResult } from './sr-benchmark-suite.js';
import type { SrSecurePromotionSeal } from './sr-secure-promotion.js';
import type { SrProspectiveAuthorizationSeal } from './sr-prospective-authorization.js';
import type { SrReliabilityAuthorizationSeal } from './sr-reliability-authorization.js';
import type { SrDeploymentAuthorizationSeal } from './sr-deployment-authorization.js';

export const SR_TRUST_STATE_SCHEMA_VERSION = 'medantir-sr-trust-state/1' as const;

export type SrModelTrustState =
  | 'unqualified'
  | 'benchmark-only'
  | 'secure-retrospective'
  | 'prospective-pilot'
  | 'high-confidence-future'
  | 'high-confidence-living';

export interface SrModelTrustStateRecord {
  requestedModel: string;
  state: SrModelTrustState;
  mayRunShadowReview: boolean;
  mayRunSupervisedFutureReview: boolean;
  mayRunSupervisedLivingReview: boolean;
  autonomousAuthorityGranted: false;
  evidence: {
    benchmarkPromotionTier: string;
    secureHistoricalTier: string;
    prospectiveAuthorizationTier: string;
    reliabilityAuthorizationTier: string;
    deploymentAuthorizationTier: string;
  };
  gateHashes: {
    benchmarkDossierHash?: string;
    secureAuthorizationHash?: string;
    prospectiveAuthorizationHash?: string;
    reliabilityAuthorizationHash?: string;
    deploymentAuthorizationHash?: string;
  };
  recordHash: string;
}

export interface SrTrustStateReport {
  schemaVersion: typeof SR_TRUST_STATE_SCHEMA_VERSION;
  suiteHash: string;
  tournamentHash: string;
  securePromotionSealHash: string;
  prospectiveAuthorizationSealHash: string;
  reliabilityAuthorizationSealHash: string;
  deploymentAuthorizationSealHash: string;
  models: SrModelTrustStateRecord[];
  reportHash: string;
}

function deriveState(input: {
  benchmarkTier: string;
  secureTier: string;
  prospectiveTier: string;
  reliabilityTier: string;
  deploymentTier: string;
}): SrModelTrustState {
  if (input.deploymentTier === 'high-confidence-living-review') return 'high-confidence-living';
  if (input.deploymentTier === 'high-confidence-future-review') return 'high-confidence-future';
  if (input.reliabilityTier === 'prospective-pilot-only') return 'prospective-pilot';
  if (input.secureTier === 'supervised-future-review' || input.secureTier === 'supervised-living-review') return 'secure-retrospective';
  if (input.benchmarkTier === 'shadow-eligible'
    || input.benchmarkTier === 'supervised-future-review-eligible'
    || input.benchmarkTier === 'supervised-living-review-eligible') return 'benchmark-only';
  return 'unqualified';
}

export function createSrTrustStateReport(input: {
  tournament: SrBenchmarkTournamentResult;
  securePromotionSeal: SrSecurePromotionSeal;
  prospectiveAuthorizationSeal: SrProspectiveAuthorizationSeal;
  reliabilityAuthorizationSeal: SrReliabilityAuthorizationSeal;
  deploymentAuthorizationSeal: SrDeploymentAuthorizationSeal;
}): SrTrustStateReport {
  if (input.securePromotionSeal.suiteHash !== input.tournament.suiteHash || input.securePromotionSeal.tournamentHash !== input.tournament.tournamentHash) {
    throw new Error('Trust-state secure promotion seal is bound to a different tournament/suite.');
  }
  if (input.prospectiveAuthorizationSeal.securePromotionSealHash !== input.securePromotionSeal.sealHash) throw new Error('Trust-state prospective seal does not bind the secure promotion seal.');
  if (input.reliabilityAuthorizationSeal.prospectiveAuthorizationSealHash !== input.prospectiveAuthorizationSeal.sealHash) throw new Error('Trust-state reliability seal does not bind the prospective authorization seal.');
  if (input.deploymentAuthorizationSeal.reliabilityAuthorizationSealHash !== input.reliabilityAuthorizationSeal.sealHash) throw new Error('Trust-state deployment seal does not bind the reliability authorization seal.');

  const models: SrModelTrustStateRecord[] = input.tournament.models.map((model) => {
    const benchmark = input.tournament.promotion.find((item) => item.requestedModel === model);
    const secure = input.securePromotionSeal.authorizations.find((item) => item.requestedModel === model);
    const prospective = input.prospectiveAuthorizationSeal.authorizations.find((item) => item.requestedModel === model);
    const reliability = input.reliabilityAuthorizationSeal.authorizations.find((item) => item.requestedModel === model);
    const deployment = input.deploymentAuthorizationSeal.authorizations.find((item) => item.requestedModel === model);
    if (!benchmark || !secure || !prospective || !reliability || !deployment) throw new Error(`Trust-state evidence is incomplete for model '${model}'.`);
    const state = deriveState({
      benchmarkTier: benchmark.tier,
      secureTier: secure.secureAuthorizationTier,
      prospectiveTier: prospective.finalAuthorizationTier,
      reliabilityTier: reliability.finalAuthorizationTier,
      deploymentTier: deployment.deploymentAuthorizationTier,
    });
    const base = {
      requestedModel: model,
      state,
      mayRunShadowReview: state !== 'unqualified',
      mayRunSupervisedFutureReview: state === 'high-confidence-future' || state === 'high-confidence-living',
      mayRunSupervisedLivingReview: state === 'high-confidence-living',
      autonomousAuthorityGranted: false as const,
      evidence: {
        benchmarkPromotionTier: benchmark.tier,
        secureHistoricalTier: secure.secureAuthorizationTier,
        prospectiveAuthorizationTier: prospective.finalAuthorizationTier,
        reliabilityAuthorizationTier: reliability.finalAuthorizationTier,
        deploymentAuthorizationTier: deployment.deploymentAuthorizationTier,
      },
      gateHashes: {
        benchmarkDossierHash: benchmark.dossierHash,
        secureAuthorizationHash: secure.authorizationHash,
        prospectiveAuthorizationHash: prospective.authorizationHash,
        reliabilityAuthorizationHash: reliability.authorizationHash,
        deploymentAuthorizationHash: deployment.authorizationHash,
      },
    };
    return { ...base, recordHash: scientificContentHash(base) };
  }).sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));
  const base = {
    schemaVersion: SR_TRUST_STATE_SCHEMA_VERSION,
    suiteHash: input.tournament.suiteHash,
    tournamentHash: input.tournament.tournamentHash,
    securePromotionSealHash: input.securePromotionSeal.sealHash,
    prospectiveAuthorizationSealHash: input.prospectiveAuthorizationSeal.sealHash,
    reliabilityAuthorizationSealHash: input.reliabilityAuthorizationSeal.sealHash,
    deploymentAuthorizationSealHash: input.deploymentAuthorizationSeal.sealHash,
    models,
  };
  return { ...base, reportHash: scientificContentHash(base) };
}
