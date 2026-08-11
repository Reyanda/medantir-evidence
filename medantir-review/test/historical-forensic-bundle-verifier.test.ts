import test from 'node:test';
import assert from 'node:assert/strict';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { createHistoricalReplayCapsule } from '../src/historical/replay-capsule.js';
import { buildHistoricalReplayCertificate } from '../src/historical/replay-certificate.js';
import { createHistoricalAppraisalLedger } from '../src/historical/appraisal-ledger.js';
import { createHistoricalScreeningDecisionLedger } from '../src/historical/screening-decision-ledger.js';
import { createHistoricalManualSearchLedger } from '../src/historical/manual-search-ledger.js';
import { createHistoricalExecutionEnvironmentFingerprint } from '../src/historical/execution-environment.js';
import { createHistoricalReviewReproductionEnvelope, type HistoricalReviewMethodsContract } from '../src/historical/review-reproduction.js';
import { revMan54RuntimeFingerprint } from '../src/historical/revman-5.4-compat.js';
import { createHistoricalReviewBundleManifest } from '../src/historical/bundle-manifest.js';
import { verifyHistoricalForensicBundle } from '../src/historical/forensic-bundle-verifier.js';

const methods: HistoricalReviewMethodsContract = {
  reviewId: 'PMC-FIXTURE',
  sourceReference: 'fixture publication',
  eligibility: { population: ['adults'], interventionOrExposure: ['drug'], comparator: ['control'], outcomes: ['mortality'], includedDesigns: ['RCT'], exclusions: [] },
  screening: { titleAbstractScreeningReported: true, fullTextScreeningReported: true },
  extraction: { fields: ['events', 'total'] },
  appraisal: [],
  synthesis: { software: 'Review Manager', softwareVersion: '5.4' },
  disclosureGaps: ['Original screening ledger unavailable.'],
};

function fixture() {
  const capsule = createHistoricalReplayCapsule({ benchmarkId: 'fixture-benchmark', historicalCutoff: '2021-01-01', sources: [] });
  const certificate = buildHistoricalReplayCertificate({ capsule, actualSources: [], actualCheckpoints: [] });
  const appraisalLedger = createHistoricalAppraisalLedger([], new Set());
  const screeningLedger = createHistoricalScreeningDecisionLedger({
    reviewId: methods.reviewId,
    aggregates: [{ stage: 'title-abstract', included: 1, excluded: 2, sourceReference: 'PRISMA' }],
  });
  const manualSearchLedger = createHistoricalManualSearchLedger({ reviewId: methods.reviewId, reportedAsPerformed: false, actions: [] });
  const executionEnvironment = createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'fixture-commit',
    runtime: { engine: 'node', version: 'v22.0.0', platform: 'linux', arch: 'x64' },
    locale: 'en-US', timezone: 'UTC', randomness: { policy: 'deterministic-no-rng' },
  });
  const statisticalRuntime = revMan54RuntimeFingerprint();
  const reviewEnvelope = createHistoricalReviewReproductionEnvelope({
    methods,
    searchCapsule: capsule,
    frozenPlanes: [
      {
        plane: 'search-import-dedup', hash: scientificContentHash(capsule.checkpoints), artifactKeys: ['searchResults'],
        replayFidelity: 'exact', historicalProvenance: 'source-reconstructed',
      },
      {
        plane: 'appraisal-ledger', hash: appraisalLedger.ledgerHash, artifactKeys: ['historicalAppraisalLedger'],
        replayFidelity: 'exact', historicalProvenance: 'source-reconstructed',
      },
    ],
    statisticalRuntime,
    executionEnvironment,
  });
  const publicationCapture = {
    requestedUrl: 'https://example.org/article.xml',
    finalUrl: 'https://example.org/article.xml',
    status: 200,
    contentType: 'application/xml',
    responseContractHash: 'a'.repeat(64),
    capturedAt: '2026-08-10T00:00:00Z',
    object: {
      objectId: `HOBJ-${'b'.repeat(64)}`,
      sha256: 'b'.repeat(64),
      byteLength: 100,
      role: 'fulltext-source' as const,
      mediaType: 'application/xml',
      recordId: methods.reviewId,
      accessClass: 'public' as const,
    },
  };
  const publicationTableManifest = [{ label: 'Table 3', structureHash: 'c'.repeat(64) }];
  const bundleManifest = createHistoricalReviewBundleManifest({
    reviewId: methods.reviewId,
    benchmarkId: capsule.benchmarkId,
    entries: [
      { logicalPath: 'search/capsule', kind: 'capsule', scientificHash: scientificContentHash(capsule), accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'search/replay-certificate', kind: 'certificate', scientificHash: scientificContentHash(certificate), accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'publication/pmc8500309.xml', kind: 'source-object', scientificHash: scientificContentHash(publicationCapture), byteHash: publicationCapture.object.sha256, byteLength: publicationCapture.object.byteLength, accessClass: 'public', requiredForClaim: true },
      { logicalPath: 'publication/table-manifest', kind: 'other-receipt', scientificHash: scientificContentHash(publicationTableManifest), accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'ledgers/appraisal', kind: 'ledger', scientificHash: appraisalLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'ledgers/screening-history', kind: 'ledger', scientificHash: screeningLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'ledgers/manual-search-history', kind: 'ledger', scientificHash: manualSearchLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'contracts/revman-5.4', kind: 'algorithm-contract', scientificHash: statisticalRuntime.algorithmContractHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'environment/reproducer', kind: 'environment', scientificHash: executionEnvironment.environmentHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
      { logicalPath: 'review/reproduction-envelope', kind: 'review-envelope', scientificHash: scientificContentHash(reviewEnvelope), accessClass: 'verifier-receipt-only', requiredForClaim: true },
    ],
  });
  return { capsule, certificate, appraisalLedger, screeningLedger, manualSearchLedger, executionEnvironment, reviewEnvelope, publicationCapture, publicationTableManifest, bundleManifest };
}

test('forensic bundle verifier cross-reconciles capsule, certificate, envelope, ledgers, environment and publication byte receipt', () => {
  const artifacts = fixture();
  const verification = verifyHistoricalForensicBundle(artifacts);
  assert.equal(verification.valid, true);
  assert.equal(verification.capsuleValid, true);
  assert.equal(verification.manifestValid, true);
  assert.equal(verification.verifiedEntryCount, 10);
  assert.deepEqual(verification.errors, []);
});

test('self-consistent manifest cannot be paired with a different historical envelope/environment', () => {
  const artifacts = fixture();
  const changedEnvironment = { ...artifacts.executionEnvironment, environmentHash: 'f'.repeat(64) };
  const verification = verifyHistoricalForensicBundle({ ...artifacts, executionEnvironment: changedEnvironment });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /execution-environment hash/i.test(error)));
  assert.ok(verification.errors.some((error) => /environment\/reproducer/i.test(error)));
});

test('publication receipt byte tampering is detected even when raw body is not in verifier bundle', () => {
  const artifacts = fixture();
  const publicationCapture = structuredClone(artifacts.publicationCapture);
  publicationCapture.object.sha256 = 'e'.repeat(64);
  const verification = verifyHistoricalForensicBundle({ ...artifacts, publicationCapture });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /publication bundle byte hash/i.test(error)));
  assert.ok(verification.errors.some((error) => /object ID does not correspond/i.test(error)));
});

test('wrong appraisal ledger cannot hide behind an otherwise valid bundle root', () => {
  const artifacts = fixture();
  const appraisalLedger = { ...artifacts.appraisalLedger, ledgerHash: 'd'.repeat(64) };
  const verification = verifyHistoricalForensicBundle({ ...artifacts, appraisalLedger });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /appraisal plane/i.test(error)));
  assert.ok(verification.errors.some((error) => /ledgers\/appraisal/i.test(error)));
});
