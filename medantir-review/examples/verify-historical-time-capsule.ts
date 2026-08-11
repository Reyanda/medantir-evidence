import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HistoricalReplayCapsule } from '../src/historical/replay-capsule.js';
import type { HistoricalReplayCertificate } from '../src/historical/replay-certificate.js';
import type { HistoricalReviewReproductionEnvelope } from '../src/historical/review-reproduction.js';
import type { HistoricalAppraisalLedger } from '../src/historical/appraisal-ledger.js';
import type { HistoricalScreeningDecisionLedger } from '../src/historical/screening-decision-ledger.js';
import type { HistoricalManualSearchLedger } from '../src/historical/manual-search-ledger.js';
import type { HistoricalExecutionEnvironmentFingerprint } from '../src/historical/execution-environment.js';
import type { HistoricalReviewBundleManifest } from '../src/historical/bundle-manifest.js';
import {
  verifyHistoricalForensicBundle,
  type HistoricalPublicationCaptureVerifierReceipt,
} from '../src/historical/forensic-bundle-verifier.js';

const artifactDir = resolve(process.env.HISTORICAL_CAPSULE_ARTIFACT_DIR ?? 'artifacts/historical-replay');

async function json<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(artifactDir, name), 'utf8')) as T;
}

const artifacts = {
  capsule: await json<HistoricalReplayCapsule>('jak-covid-2021-capsule.json'),
  certificate: await json<HistoricalReplayCertificate>('jak-covid-2021-certificate.json'),
  publicationCapture: await json<HistoricalPublicationCaptureVerifierReceipt>('jak-covid-2021-publication-capture.json'),
  publicationTableManifest: await json<unknown>('jak-covid-2021-publication-tables.json'),
  appraisalLedger: await json<HistoricalAppraisalLedger>('jak-covid-2021-appraisal-ledger.json'),
  screeningLedger: await json<HistoricalScreeningDecisionLedger>('jak-covid-2021-screening-ledger.json'),
  manualSearchLedger: await json<HistoricalManualSearchLedger>('jak-covid-2021-manual-search-ledger.json'),
  executionEnvironment: await json<HistoricalExecutionEnvironmentFingerprint>('jak-covid-2021-execution-environment.json'),
  reviewEnvelope: await json<HistoricalReviewReproductionEnvelope>('jak-covid-2021-review-envelope.json'),
  bundleManifest: await json<HistoricalReviewBundleManifest>('jak-covid-2021-bundle-manifest.json'),
};

const verification = verifyHistoricalForensicBundle(artifacts);
if (!verification.valid) {
  throw new Error(`Serialized historical forensic bundle failed verification: ${JSON.stringify(verification.errors)}`);
}

await writeFile(
  resolve(artifactDir, 'jak-covid-2021-forensic-verification.json'),
  `${JSON.stringify(verification, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  valid: verification.valid,
  capsuleValid: verification.capsuleValid,
  manifestValid: verification.manifestValid,
  verifiedEntryCount: verification.verifiedEntryCount,
  artifactDir,
}, null, 2));
