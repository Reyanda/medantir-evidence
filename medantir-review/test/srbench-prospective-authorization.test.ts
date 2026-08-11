import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrProspectiveAuthorizationSeal } from '../src/benchmark/sr-prospective-authorization.js';
import type { SrSecurePromotionSeal } from '../src/benchmark/sr-secure-promotion.js';
import type { SrProspectiveQualificationSummary } from '../src/benchmark/sr-prospective-holdout.js';

function secureSeal(tier: 'supervised-future-review' | 'supervised-living-review'): SrSecurePromotionSeal {
  return {
    schemaVersion: 'medantir-sr-secure-promotion/1',
    suiteHash: '1'.repeat(64),
    tournamentHash: '2'.repeat(64),
    performanceSummaryHash: '3'.repeat(64),
    trustRegistryHash: '4'.repeat(64),
    policyHash: '5'.repeat(64),
    authorizations: [{
      requestedModel: 'model-a',
      benchmarkPromotionTier: tier === 'supervised-living-review' ? 'supervised-living-review-eligible' : 'supervised-future-review-eligible',
      secureAuthorizationTier: tier,
      checks: [],
      qualificationChecks: [],
      contaminationConcern: false,
      counterfactualCanarySr100Rate: 1,
      driftSentinelValid: tier === 'supervised-living-review',
      autonomousAuthorityGranted: false,
      authorizationHash: '6'.repeat(64),
    }],
    sealHash: '7'.repeat(64),
  };
}

function prospective(ready: boolean): SrProspectiveQualificationSummary {
  return {
    requestedModel: 'model-a',
    validHoldouts: ready ? 2 : 1,
    perfectHoldouts: ready ? 2 : 1,
    distinctDomains: ready ? ['cardiology', 'nutrition'] : ['nutrition'],
    allPerfect: ready,
    qualificationReady: ready,
    requiredHoldouts: 2,
    requiredDomains: 2,
    holdoutVerificationHashes: ready ? ['a'.repeat(64), 'b'.repeat(64)] : ['a'.repeat(64)],
    summaryHash: ready ? '8'.repeat(64) : '9'.repeat(64),
  };
}

test('historical SR100 without prerelease prospective validation is downgraded to shadow-only', () => {
  const seal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: secureSeal('supervised-future-review'),
    prospectiveSummaries: [],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.secureHistoricalTier, 'supervised-future-review');
  assert.equal(auth.prospectiveQualificationReady, false);
  assert.equal(auth.finalAuthorizationTier, 'shadow-only');
  assert.equal(auth.checks.find((check) => check.code === 'prospective-future-holdout')!.passed, false);
});

test('two perfect prerelease holdouts permit supervised future-review authorization', () => {
  const seal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: secureSeal('supervised-future-review'),
    prospectiveSummaries: [prospective(true)],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.prospectiveQualificationReady, true);
  assert.equal(auth.finalAuthorizationTier, 'supervised-future-review');
  assert.match(seal.sealHash, /^[a-f0-9]{64}$/);
});

test('secure living-review eligibility remains shadow-only until prospective qualification exists', () => {
  const seal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: secureSeal('supervised-living-review'),
    prospectiveSummaries: [prospective(false)],
  });
  assert.equal(seal.authorizations[0]!.finalAuthorizationTier, 'shadow-only');
});

test('secure living-review eligibility plus prospective qualification preserves supervised living authorization', () => {
  const seal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: secureSeal('supervised-living-review'),
    prospectiveSummaries: [prospective(true)],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.finalAuthorizationTier, 'supervised-living-review');
  assert.equal(auth.autonomousAuthorityGranted, false);
});

test('an imperfect prospective summary cannot be averaged into future-review authorization', () => {
  const seal = createSrProspectiveAuthorizationSeal({
    securePromotionSeal: secureSeal('supervised-future-review'),
    prospectiveSummaries: [prospective(false)],
  });
  assert.equal(seal.authorizations[0]!.finalAuthorizationTier, 'shadow-only');
});
