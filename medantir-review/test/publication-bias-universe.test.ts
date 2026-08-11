import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPublicationBiasUniverse,
  type PublicationBiasUniversePolicy,
  type RegistryResultUniverseRecord,
} from '../src/certainty/publication-bias-universe.js';

const policy: PublicationBiasUniversePolicy = {
  id: 'pb-universe-policy-1',
  version: '1.0.0',
  protocolHash: 'protocol-1',
  frozenAt: '2026-08-11T08:00:00.000Z',
  rationale: 'Prospective registry/result/publication completeness policy.',
  minimumEligibleUniverseRegistryCoverage: 1,
  requireEligibilityResolvedForAssessmentBasis: true,
  requireResultAvailabilityKnownForAssessmentBasis: true,
  requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: true,
  requireTargetOutcomeStatusKnownForAssessmentBasis: true,
  requirePublicationStatusKnownForAssessmentBasis: true,
};

function record(studyId: string, overrides: Partial<RegistryResultUniverseRecord> = {}): RegistryResultUniverseRecord {
  return {
    version: 2,
    studyId,
    outcome: 'mortality',
    registryId: `NCT-${studyId}`,
    eligibilityStatus: 'eligible',
    contributesToSynthesis: true,
    registrySearched: true,
    registrationFound: true,
    resultsAvailable: true,
    prespecifiedPrimaryOutcomeFound: true,
    targetOutcomeReported: true,
    publicationStatus: 'published',
    evidenceIds: [`registry-${studyId}`],
    sourceHash: `hash-${studyId}`,
    ...overrides,
  };
}

test('eligible non-contributing registered study with no globally available results is positive publication-bias evidence', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1', 's2'],
    records: [
      record('s1'),
      record('s2'),
      record('s3', {
        contributesToSynthesis: false,
        resultsAvailable: false,
        targetOutcomeReported: false,
        publicationStatus: 'registry-only',
      }),
    ],
    policy,
  });
  assert.equal(audit.eligibleUniverseCount, 3);
  assert.equal(audit.contributingStudyCount, 2);
  assert.ok(audit.signals.some((signal) => signal.studyId === 's3' && signal.kind === 'eligible-registered-study-without-results'));
  assert.ok(audit.signals.some((signal) => signal.studyId === 's3' && signal.kind === 'eligible-unpublished-study'));
});

test('fully reconciled eligible universe may form a signal-free assessment basis', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1', 's2'],
    records: [record('s1'), record('s2')],
    policy,
  });
  assert.equal(audit.assessmentBasisComplete, true);
  assert.equal(audit.signals.length, 0);
  assert.equal(audit.auditDebt.length, 0);
  assert.equal(audit.eligibleRegistrySearchCoverage, 1);
  assert.equal(audit.knownPrimaryOutcomeSpecificationCount, 2);
  assert.equal(audit.knownPublicationStatusCount, 2);
  assert.ok(audit.assessmentBasisEvidenceIds.includes('registry-universe-record:hash-s1'));
});

test('unknown primary-outcome specification is completeness debt, not a positive publication-bias signal', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1', 's2'],
    records: [record('s1'), record('s2', { prespecifiedPrimaryOutcomeFound: 'unknown' })],
    policy,
  });
  assert.equal(audit.assessmentBasisComplete, false);
  assert.equal(audit.knownPrimaryOutcomeSpecificationCount, 1);
  assert.equal(audit.signals.length, 0);
  assert.ok(audit.auditDebt.some((item) => item.kind === 'eligible-study-primary-outcome-specification-unknown'));
  assert.ok(audit.unresolvedReasons.some((reason) => /primary-outcome status/i.test(reason)));
});

test('unknown publication linkage is completeness debt and cannot itself downgrade GRADE', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1'],
    records: [record('s1', { publicationStatus: 'unknown' })],
    policy,
  });
  assert.equal(audit.assessmentBasisComplete, false);
  assert.equal(audit.knownPublicationStatusCount, 0);
  assert.equal(audit.signals.length, 0);
  assert.ok(audit.auditDebt.some((item) => item.kind === 'eligible-study-publication-status-unknown'));
  assert.ok(audit.unresolvedReasons.some((reason) => /publication\/preprint linkage status/i.test(reason)));
});

test('unresolved registry eligibility prevents clearance but is not evidence of bias', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1'],
    records: [
      record('s1'),
      record('candidate', {
        eligibilityStatus: 'unresolved',
        contributesToSynthesis: false,
        resultsAvailable: 'unknown',
        prespecifiedPrimaryOutcomeFound: 'unknown',
        targetOutcomeReported: 'unknown',
        publicationStatus: 'unknown',
      }),
    ],
    policy,
  });
  assert.equal(audit.assessmentBasisComplete, false);
  assert.equal(audit.unresolvedEligibilityCount, 1);
  assert.equal(audit.signals.filter((signal) => signal.studyId === 'candidate').length, 0);
  assert.ok(audit.auditDebt.some((item) => item.kind === 'eligibility-unresolved'));
  assert.ok(audit.unresolvedReasons.some((reason) => /unresolved eligibility/i.test(reason)));
});

test('ineligible registry studies do not inflate the eligible completeness denominator', () => {
  const audit = auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1'],
    records: [
      record('s1'),
      record('wrong-population', {
        eligibilityStatus: 'ineligible',
        contributesToSynthesis: false,
        registrySearched: false,
        registrationFound: true,
        resultsAvailable: false,
        targetOutcomeReported: false,
        publicationStatus: 'registry-only',
      }),
    ],
    policy,
  });
  assert.equal(audit.eligibleUniverseCount, 1);
  assert.equal(audit.eligibleRegistrySearchCoverage, 1);
  assert.equal(audit.signals.filter((signal) => signal.studyId === 'wrong-population').length, 0);
  assert.equal(audit.auditDebt.filter((item) => item.studyId === 'wrong-population').length, 0);
});

test('every contributing study must still be represented in the registry/result universe', () => {
  assert.throws(() => auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1', 's2'],
    records: [record('s1')],
    policy,
  }), /Contributing study s2/);
});

test('duplicate study identity remains a hard ambiguity', () => {
  assert.throws(() => auditPublicationBiasUniverse({
    outcome: 'mortality',
    contributingStudyIds: ['s1'],
    records: [record('s1'), record('s1', { sourceHash: 'other' })],
    policy,
  }), /duplicate study identity/);
});
