import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezePublicationBiasUniversePolicy,
  parsePublicationBiasUniversePolicyConfiguration,
} from '../src/certainty/publication-bias-universe-policy.js';

test('omitted primary-outcome and publication-linkage completeness rules default to conservative true', () => {
  const configuration = parsePublicationBiasUniversePolicyConfiguration({
    version: '1', rationale: 'Prospective completeness.', minimumEligibleUniverseRegistryCoverage: 1,
    requireEligibilityResolvedForAssessmentBasis: true,
    requireResultAvailabilityKnownForAssessmentBasis: true,
    requireTargetOutcomeStatusKnownForAssessmentBasis: true,
  });
  assert.equal(configuration.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis, true);
  assert.equal(configuration.requirePublicationStatusKnownForAssessmentBasis, true);
  const policy = freezePublicationBiasUniversePolicy({
    protocolHash: 'protocol-1', configuration, frozenAt: '2026-08-11T10:00:00.000Z',
  });
  assert.equal(policy.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis, true);
  assert.equal(policy.requirePublicationStatusKnownForAssessmentBasis, true);
});

test('conservative completeness dimensions may be explicitly relaxed but cannot be non-boolean', () => {
  const relaxed = parsePublicationBiasUniversePolicyConfiguration({
    version: '1', rationale: 'Explicit method choice.', minimumEligibleUniverseRegistryCoverage: 1,
    requireEligibilityResolvedForAssessmentBasis: true,
    requireResultAvailabilityKnownForAssessmentBasis: true,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: false,
    requireTargetOutcomeStatusKnownForAssessmentBasis: true,
    requirePublicationStatusKnownForAssessmentBasis: false,
  });
  assert.equal(relaxed.requirePrimaryOutcomeSpecificationKnownForAssessmentBasis, false);
  assert.equal(relaxed.requirePublicationStatusKnownForAssessmentBasis, false);
  assert.throws(() => parsePublicationBiasUniversePolicyConfiguration({
    version: '1', rationale: 'Invalid.', minimumEligibleUniverseRegistryCoverage: 1,
    requireEligibilityResolvedForAssessmentBasis: true,
    requireResultAvailabilityKnownForAssessmentBasis: true,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: 'yes',
    requireTargetOutcomeStatusKnownForAssessmentBasis: true,
  }), /must be boolean/);
  assert.throws(() => parsePublicationBiasUniversePolicyConfiguration({
    version: '1', rationale: 'Invalid.', minimumEligibleUniverseRegistryCoverage: 1,
    requireEligibilityResolvedForAssessmentBasis: true,
    requireResultAvailabilityKnownForAssessmentBasis: true,
    requireTargetOutcomeStatusKnownForAssessmentBasis: true,
    requirePublicationStatusKnownForAssessmentBasis: 'yes',
  }), /must be boolean/);
});
