import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFIER_FORBIDDEN_RAW_ARTIFACTS,
  VERIFIER_READABLE_ARTIFACTS,
  verifierArtifactReadable,
} from '../src/core/verifier-policy.js';

const safeHistoricalArtifacts = [
  'historicalReplayCapsule',
  'historicalReplayCertificate',
  'historicalReviewEnvelope',
  'historicalAppraisalLedger',
  'historicalScreeningLedger',
  'historicalManualSearchLedger',
  'historicalExecutionEnvironment',
  'historicalBundleManifest',
  'historicalPublicationCapture',
  'historicalPublicationTableManifest',
  'historicalOutcomeRowLedger',
  'historicalParserCheckpoints',
  'historicalResultComparison',
];

const rawHistoricalArtifacts = [
  'historicalObjectStore',
  'historicalArchiveObjects',
  'historicalFullTextBodies',
  'historicalParsedDocuments',
  'historicalRawPublicationXml',
];

test('historical verifier exposes only receipt/ledger/control artifacts explicitly reviewed for audit access', () => {
  for (const key of safeHistoricalArtifacts) {
    assert.equal(VERIFIER_READABLE_ARTIFACTS.has(key), true, `${key} should be explicitly readable`);
    assert.equal(verifierArtifactReadable(key), true);
    assert.equal(VERIFIER_FORBIDDEN_RAW_ARTIFACTS.has(key), false);
  }
});

test('raw historical archive/full-text/parser bodies are explicitly forbidden even if later code accidentally names them', () => {
  for (const key of rawHistoricalArtifacts) {
    assert.equal(VERIFIER_FORBIDDEN_RAW_ARTIFACTS.has(key), true, `${key} should be explicitly forbidden`);
    assert.equal(verifierArtifactReadable(key), false);
  }
});

test('new historical artifact names remain denied by default until deliberately allowlisted', () => {
  assert.equal(verifierArtifactReadable('historicalNewExperimentalBody'), false);
});
