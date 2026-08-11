import { scientificContentHash } from '../core/canonical-hash.js';
import { verifyHistoricalReplayCapsule, type HistoricalReplayCapsule } from './replay-capsule.js';
import type { HistoricalReplayCertificate } from './replay-certificate.js';
import type { HistoricalReviewReproductionEnvelope } from './review-reproduction.js';
import type { HistoricalAppraisalLedger } from './appraisal-ledger.js';
import type { HistoricalScreeningDecisionLedger } from './screening-decision-ledger.js';
import type { HistoricalManualSearchLedger } from './manual-search-ledger.js';
import type { HistoricalExecutionEnvironmentFingerprint } from './execution-environment.js';
import type { HistoricalVerifierObjectReceipt } from './evidence-plane-archive.js';
import {
  verifyHistoricalReviewBundleManifest,
  type HistoricalReviewBundleManifest,
} from './bundle-manifest.js';

export interface HistoricalPublicationCaptureVerifierReceipt {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  responseContractHash: string;
  capturedAt: string;
  object: HistoricalVerifierObjectReceipt;
}

export interface HistoricalForensicBundleArtifacts {
  capsule: HistoricalReplayCapsule;
  certificate: HistoricalReplayCertificate;
  reviewEnvelope: HistoricalReviewReproductionEnvelope;
  appraisalLedger: HistoricalAppraisalLedger;
  screeningLedger: HistoricalScreeningDecisionLedger;
  manualSearchLedger: HistoricalManualSearchLedger;
  executionEnvironment: HistoricalExecutionEnvironmentFingerprint;
  publicationCapture: HistoricalPublicationCaptureVerifierReceipt;
  publicationTableManifest: unknown;
  bundleManifest: HistoricalReviewBundleManifest;
}

export interface HistoricalForensicBundleVerification {
  valid: boolean;
  errors: string[];
  capsuleValid: boolean;
  manifestValid: boolean;
  verifiedEntryCount: number;
}

function manifestEntry(manifest: HistoricalReviewBundleManifest, logicalPath: string) {
  return manifest.entries.find((entry) => entry.logicalPath === logicalPath);
}

function requireScientificHash(
  manifest: HistoricalReviewBundleManifest,
  logicalPath: string,
  value: unknown,
  errors: string[],
): void {
  const entry = manifestEntry(manifest, logicalPath);
  if (!entry) {
    errors.push(`Bundle manifest is missing '${logicalPath}'.`);
    return;
  }
  const actual = scientificContentHash(value);
  if (entry.scientificHash !== actual) errors.push(`Bundle entry '${logicalPath}' scientific hash does not match supplied artifact.`);
}

export function verifyHistoricalForensicBundle(
  artifacts: HistoricalForensicBundleArtifacts,
): HistoricalForensicBundleVerification {
  const errors: string[] = [];
  const capsuleVerification = verifyHistoricalReplayCapsule(artifacts.capsule);
  if (!capsuleVerification.valid) errors.push('Historical replay capsule failed internal integrity verification.');
  const manifestVerification = verifyHistoricalReviewBundleManifest(artifacts.bundleManifest);
  if (!manifestVerification.valid) errors.push('Historical bundle manifest failed internal integrity verification.');

  if (artifacts.certificate.capsuleId !== artifacts.capsule.capsuleId) {
    errors.push('Historical replay certificate is bound to a different capsule ID.');
  }
  if (artifacts.reviewEnvelope.searchCapsuleId !== artifacts.capsule.capsuleId) {
    errors.push('Historical review envelope is bound to a different search capsule ID.');
  }
  if (artifacts.reviewEnvelope.searchCapsuleHash !== scientificContentHash(artifacts.capsule)) {
    errors.push('Historical review envelope search-capsule hash does not match the supplied capsule.');
  }
  if (artifacts.reviewEnvelope.executionEnvironmentHash !== artifacts.executionEnvironment.environmentHash) {
    errors.push('Historical review envelope execution-environment hash does not match the supplied environment fingerprint.');
  }
  const appraisalPlane = artifacts.reviewEnvelope.frozenPlanes.find((plane) => plane.plane === 'appraisal-ledger');
  if (!appraisalPlane || appraisalPlane.hash !== artifacts.appraisalLedger.ledgerHash) {
    errors.push('Historical review envelope appraisal plane does not match the supplied appraisal ledger.');
  }

  requireScientificHash(artifacts.bundleManifest, 'search/capsule', artifacts.capsule, errors);
  requireScientificHash(artifacts.bundleManifest, 'search/replay-certificate', artifacts.certificate, errors);
  requireScientificHash(artifacts.bundleManifest, 'publication/pmc8500309.xml', artifacts.publicationCapture, errors);
  requireScientificHash(artifacts.bundleManifest, 'publication/table-manifest', artifacts.publicationTableManifest, errors);
  const appraisalEntry = manifestEntry(artifacts.bundleManifest, 'ledgers/appraisal');
  if (!appraisalEntry || appraisalEntry.scientificHash !== artifacts.appraisalLedger.ledgerHash) {
    errors.push("Bundle entry 'ledgers/appraisal' does not match the supplied appraisal ledger hash.");
  }
  const screeningEntry = manifestEntry(artifacts.bundleManifest, 'ledgers/screening-history');
  if (!screeningEntry || screeningEntry.scientificHash !== artifacts.screeningLedger.ledgerHash) {
    errors.push("Bundle entry 'ledgers/screening-history' does not match the supplied screening ledger hash.");
  }
  const manualEntry = manifestEntry(artifacts.bundleManifest, 'ledgers/manual-search-history');
  if (!manualEntry || manualEntry.scientificHash !== artifacts.manualSearchLedger.ledgerHash) {
    errors.push("Bundle entry 'ledgers/manual-search-history' does not match the supplied manual-search ledger hash.");
  }
  const environmentEntry = manifestEntry(artifacts.bundleManifest, 'environment/reproducer');
  if (!environmentEntry || environmentEntry.scientificHash !== artifacts.executionEnvironment.environmentHash) {
    errors.push("Bundle entry 'environment/reproducer' does not match the supplied execution environment hash.");
  }
  requireScientificHash(artifacts.bundleManifest, 'review/reproduction-envelope', artifacts.reviewEnvelope, errors);

  const publicationEntry = manifestEntry(artifacts.bundleManifest, 'publication/pmc8500309.xml');
  if (publicationEntry) {
    if (publicationEntry.byteHash !== artifacts.publicationCapture.object.sha256) {
      errors.push('Publication bundle byte hash does not match the publication object receipt.');
    }
    if (publicationEntry.byteLength !== artifacts.publicationCapture.object.byteLength) {
      errors.push('Publication bundle byte length does not match the publication object receipt.');
    }
    if (artifacts.publicationCapture.object.objectId !== `HOBJ-${artifacts.publicationCapture.object.sha256}`) {
      errors.push('Publication object ID does not correspond to its SHA-256 receipt.');
    }
  }

  const expectedPaths = [
    'search/capsule',
    'search/replay-certificate',
    'publication/pmc8500309.xml',
    'publication/table-manifest',
    'ledgers/appraisal',
    'ledgers/screening-history',
    'ledgers/manual-search-history',
    'contracts/revman-5.4',
    'environment/reproducer',
    'review/reproduction-envelope',
  ];
  const verifiedEntryCount = expectedPaths.filter((path) => Boolean(manifestEntry(artifacts.bundleManifest, path))).length;
  return {
    valid: errors.length === 0,
    errors,
    capsuleValid: capsuleVerification.valid,
    manifestValid: manifestVerification.valid,
    verifiedEntryCount,
  };
}
