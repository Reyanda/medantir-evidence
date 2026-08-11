import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrTrustStateReport } from '../src/benchmark/sr-trust-state.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';
import type { SrSecurePromotionSeal } from '../src/benchmark/sr-secure-promotion.js';
import type { SrProspectiveAuthorizationSeal } from '../src/benchmark/sr-prospective-authorization.js';
import type { SrReliabilityAuthorizationSeal } from '../src/benchmark/sr-reliability-authorization.js';
import type { SrDeploymentAuthorizationSeal } from '../src/benchmark/sr-deployment-authorization.js';

function fixture(input: {
  benchmarkTier: string;
  secureTier: 'none' | 'shadow-only' | 'supervised-future-review' | 'supervised-living-review';
  prospectiveTier: 'none' | 'shadow-only' | 'supervised-future-review' | 'supervised-living-review';
  reliabilityTier: 'none' | 'shadow-only' | 'prospective-pilot-only' | 'high-confidence-future-review' | 'high-confidence-living-review';
  deploymentTier: 'none' | 'shadow-only' | 'prospective-pilot-only' | 'high-confidence-future-review' | 'high-confidence-living-review';
}) {
  const tournament = {
    schemaVersion: 'medantir-srbench-suite/1',
    suiteId: 'S', suiteVersion: '1', suiteHash: '1'.repeat(64), models: ['m'], repeats: 1,
    cases: [], qualificationAdmissions: [], counterfactualChallenges: [], runs: [], driftSentinels: [], leaderboard: [],
    promotion: [{ requestedModel: 'm', tier: input.benchmarkTier, dossierHash: '2'.repeat(64) }],
    tournamentHash: '3'.repeat(64),
  } as unknown as SrBenchmarkTournamentResult;
  const secure = {
    schemaVersion: 'medantir-sr-secure-promotion/1', suiteHash: tournament.suiteHash, tournamentHash: tournament.tournamentHash,
    performanceSummaryHash: '4'.repeat(64), trustRegistryHash: '5'.repeat(64), policyHash: '6'.repeat(64),
    authorizations: [{ requestedModel: 'm', secureAuthorizationTier: input.secureTier, authorizationHash: '7'.repeat(64) }],
    sealHash: '8'.repeat(64),
  } as unknown as SrSecurePromotionSeal;
  const prospective = {
    schemaVersion: 'medantir-sr-prospective-authorization/1', securePromotionSealHash: secure.sealHash, policyHash: '9'.repeat(64),
    authorizations: [{ requestedModel: 'm', finalAuthorizationTier: input.prospectiveTier, authorizationHash: 'a'.repeat(64) }],
    sealHash: 'b'.repeat(64),
  } as unknown as SrProspectiveAuthorizationSeal;
  const reliability = {
    schemaVersion: 'medantir-sr-reliability-authorization/1', prospectiveAuthorizationSealHash: prospective.sealHash,
    reliabilityReportHashes: [], authorizations: [{ requestedModel: 'm', finalAuthorizationTier: input.reliabilityTier, authorizationHash: 'c'.repeat(64) }],
    sealHash: 'd'.repeat(64),
  } as unknown as SrReliabilityAuthorizationSeal;
  const deployment = {
    schemaVersion: 'medantir-sr-deployment-authorization/1', reliabilityAuthorizationSealHash: reliability.sealHash,
    expectedTrustRootHash: 'e'.repeat(64), trustRootHash: 'e'.repeat(64), trustRegistryHash: '5'.repeat(64), trustVerificationHash: 'f'.repeat(64),
    authorizations: [{ requestedModel: 'm', deploymentAuthorizationTier: input.deploymentTier, authorizationHash: '0'.repeat(64) }], deployableModels: [], sealHash: '1'.repeat(64),
  } as unknown as SrDeploymentAuthorizationSeal;
  return { tournament, secure, prospective, reliability, deployment };
}

function state(input: Parameters<typeof fixture>[0]) {
  const f = fixture(input);
  return createSrTrustStateReport({
    tournament: f.tournament,
    securePromotionSeal: f.secure,
    prospectiveAuthorizationSeal: f.prospective,
    reliabilityAuthorizationSeal: f.reliability,
    deploymentAuthorizationSeal: f.deployment,
  }).models[0]!;
}

test('high-confidence living state is the only state that permits supervised living review', () => {
  const result = state({
    benchmarkTier: 'supervised-living-review-eligible',
    secureTier: 'supervised-living-review',
    prospectiveTier: 'supervised-living-review',
    reliabilityTier: 'high-confidence-living-review',
    deploymentTier: 'high-confidence-living-review',
  });
  assert.equal(result.state, 'high-confidence-living');
  assert.equal(result.mayRunSupervisedFutureReview, true);
  assert.equal(result.mayRunSupervisedLivingReview, true);
  assert.equal(result.autonomousAuthorityGranted, false);
});

test('high-confidence future state cannot silently run a living review', () => {
  const result = state({
    benchmarkTier: 'supervised-living-review-eligible',
    secureTier: 'supervised-living-review',
    prospectiveTier: 'supervised-living-review',
    reliabilityTier: 'high-confidence-future-review',
    deploymentTier: 'high-confidence-future-review',
  });
  assert.equal(result.state, 'high-confidence-future');
  assert.equal(result.mayRunSupervisedFutureReview, true);
  assert.equal(result.mayRunSupervisedLivingReview, false);
});

test('prospective evidence below reliability threshold remains pilot-only', () => {
  const result = state({
    benchmarkTier: 'supervised-future-review-eligible',
    secureTier: 'supervised-future-review',
    prospectiveTier: 'supervised-future-review',
    reliabilityTier: 'prospective-pilot-only',
    deploymentTier: 'shadow-only',
  });
  assert.equal(result.state, 'prospective-pilot');
  assert.equal(result.mayRunShadowReview, true);
  assert.equal(result.mayRunSupervisedFutureReview, false);
});

test('secure retrospective evidence without prospective qualification remains non-production', () => {
  const result = state({
    benchmarkTier: 'supervised-future-review-eligible',
    secureTier: 'supervised-future-review',
    prospectiveTier: 'shadow-only',
    reliabilityTier: 'shadow-only',
    deploymentTier: 'shadow-only',
  });
  assert.equal(result.state, 'secure-retrospective');
  assert.equal(result.mayRunSupervisedFutureReview, false);
});

test('benchmark-only evidence never grants production authority', () => {
  const result = state({
    benchmarkTier: 'shadow-eligible',
    secureTier: 'shadow-only',
    prospectiveTier: 'shadow-only',
    reliabilityTier: 'shadow-only',
    deploymentTier: 'shadow-only',
  });
  assert.equal(result.state, 'benchmark-only');
  assert.equal(result.mayRunShadowReview, true);
  assert.equal(result.mayRunSupervisedFutureReview, false);
  assert.equal(result.mayRunSupervisedLivingReview, false);
});
