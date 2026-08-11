import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrReliabilityAuthorizationSeal } from '../src/benchmark/sr-reliability-authorization.js';
import { createSrReliabilityEvidenceReport } from '../src/benchmark/sr-reliability-evidence.js';
import type { SrProspectiveAuthorizationSeal } from '../src/benchmark/sr-prospective-authorization.js';

function prospective(tier: 'shadow-only' | 'supervised-future-review' | 'supervised-living-review'): SrProspectiveAuthorizationSeal {
  return {
    schemaVersion: 'medantir-sr-prospective-authorization/1',
    securePromotionSealHash: '1'.repeat(64),
    policyHash: '2'.repeat(64),
    authorizations: [{
      requestedModel: 'model-a',
      secureHistoricalTier: tier === 'supervised-living-review' ? 'supervised-living-review' : tier === 'supervised-future-review' ? 'supervised-future-review' : 'shadow-only',
      prospectiveQualificationReady: tier !== 'shadow-only',
      prospectiveSummaryHash: tier !== 'shadow-only' ? '3'.repeat(64) : undefined,
      finalAuthorizationTier: tier,
      checks: [],
      autonomousAuthorityGranted: false,
      authorizationHash: '4'.repeat(64),
    }],
    sealHash: '5'.repeat(64),
  } as SrProspectiveAuthorizationSeal;
}

test('two perfect prospective holdouts support pilot use but not high-confidence trust', () => {
  const report = createSrReliabilityEvidenceReport({ requestedModel: 'model-a', independentProspectiveTrials: 2, perfectTrials: 2 });
  const seal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal: prospective('supervised-future-review'),
    reliabilityReports: [report],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.finalAuthorizationTier, 'prospective-pilot-only');
  assert.equal(auth.checks.find((check) => check.code === 'future-reliability-bound')!.passed, false);
});

test('29 perfect prospective reviews satisfy default high-confidence future-review threshold', () => {
  const report = createSrReliabilityEvidenceReport({ requestedModel: 'model-a', independentProspectiveTrials: 29, perfectTrials: 29 });
  const seal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal: prospective('supervised-future-review'),
    reliabilityReports: [report],
  });
  assert.equal(seal.authorizations[0]!.finalAuthorizationTier, 'high-confidence-future-review');
});

test('59 perfect prospective reviews plus living authorization satisfy high-confidence living-review threshold', () => {
  const report = createSrReliabilityEvidenceReport({ requestedModel: 'model-a', independentProspectiveTrials: 59, perfectTrials: 59 });
  const seal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal: prospective('supervised-living-review'),
    reliabilityReports: [report],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.finalAuthorizationTier, 'high-confidence-living-review');
  assert.equal(auth.autonomousAuthorityGranted, false);
  assert.match(seal.sealHash, /^[a-f0-9]{64}$/);
});

test('living benchmark controls cannot bypass weaker prospective reliability evidence', () => {
  const report = createSrReliabilityEvidenceReport({ requestedModel: 'model-a', independentProspectiveTrials: 29, perfectTrials: 29 });
  const seal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal: prospective('supervised-living-review'),
    reliabilityReports: [report],
  });
  assert.equal(seal.authorizations[0]!.finalAuthorizationTier, 'high-confidence-future-review');
  assert.equal(seal.authorizations[0]!.checks.find((check) => check.code === 'living-reliability-bound')!.passed, false);
});

test('one failure among many prospective reviews destroys v1 high-confidence authorization', () => {
  const report = createSrReliabilityEvidenceReport({ requestedModel: 'model-a', independentProspectiveTrials: 59, perfectTrials: 58 });
  const seal = createSrReliabilityAuthorizationSeal({
    prospectiveAuthorizationSeal: prospective('supervised-living-review'),
    reliabilityReports: [report],
  });
  assert.equal(seal.authorizations[0]!.finalAuthorizationTier, 'prospective-pilot-only');
  assert.equal(seal.authorizations[0]!.reliabilityLowerBound, 0);
});
