import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';
import type {
  HistoricalParserCheckpoint,
  HistoricalParserReplayCertificate,
} from './frozen-document-ports.js';

export interface HistoricalParsedDocumentPlaneReceipt {
  requiredRecordIds: string[];
  exactRecordIds: string[];
  missingRecordIds: string[];
  failedRecordIds: string[];
  checkpointHash: string;
  certificateHash: string;
}

function requiredRecordIds(sourceManifest: HistoricalStudySourceManifest): string[] {
  const ids = sourceManifest.reports
    .filter((report) => report.requiredForReproduction && report.resultBearing)
    .map((report) => report.sourceObject?.recordId ?? report.reportId)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(ids)].sort();
}

export function buildHistoricalParsedDocumentPlane(input: {
  sourceManifest: HistoricalStudySourceManifest;
  checkpoints: HistoricalParserCheckpoint[];
  certificates: HistoricalParserReplayCertificate[];
}): { plane: HistoricalReviewFrozenPlane; receipt: HistoricalParsedDocumentPlaneReceipt } {
  const required = requiredRecordIds(input.sourceManifest);
  if (required.length === 0) throw new Error('Historical parsed-document plane requires result-bearing source records.');
  const checkpointByRecord = new Map<string, HistoricalParserCheckpoint>();
  for (const checkpoint of input.checkpoints) {
    if (checkpointByRecord.has(checkpoint.recordId)) throw new Error(`Duplicate historical parser checkpoint '${checkpoint.recordId}'.`);
    checkpointByRecord.set(checkpoint.recordId, checkpoint);
  }
  const certificateByRecord = new Map<string, HistoricalParserReplayCertificate>();
  for (const certificate of input.certificates) {
    if (certificateByRecord.has(certificate.recordId)) throw new Error(`Duplicate historical parser replay certificate '${certificate.recordId}'.`);
    certificateByRecord.set(certificate.recordId, certificate);
  }

  const missingRecordIds = required.filter((recordId) => !checkpointByRecord.has(recordId) || !certificateByRecord.has(recordId));
  const failedRecordIds = required.filter((recordId) => {
    const certificate = certificateByRecord.get(recordId);
    const checkpoint = checkpointByRecord.get(recordId);
    return Boolean(certificate && checkpoint && (
      !certificate.exact
      || !certificate.sourceObjectMatches
      || !certificate.parserContractMatches
      || !certificate.parsedDocumentMatches
      || certificate.expectedParsedHash !== checkpoint.parsedDocumentHash
    ));
  });
  const exactRecordIds = required.filter((recordId) => !missingRecordIds.includes(recordId) && !failedRecordIds.includes(recordId));
  const checkpointHash = scientificContentHash(input.checkpoints
    .map((checkpoint) => ({
      recordId: checkpoint.recordId,
      sourceObjectId: checkpoint.sourceObjectId,
      sourceSha256: checkpoint.sourceSha256,
      parserContractHash: checkpoint.parserContractHash,
      parsedObjectId: checkpoint.parsedObjectId,
      parsedDocumentHash: checkpoint.parsedDocumentHash,
    }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId)));
  const certificateHash = scientificContentHash(input.certificates
    .map((certificate) => ({
      recordId: certificate.recordId,
      sourceObjectMatches: certificate.sourceObjectMatches,
      parserContractMatches: certificate.parserContractMatches,
      parsedDocumentMatches: certificate.parsedDocumentMatches,
      exact: certificate.exact,
      expectedParsedHash: certificate.expectedParsedHash,
      actualParsedHash: certificate.actualParsedHash ?? null,
    }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId)));
  const receipt: HistoricalParsedDocumentPlaneReceipt = {
    requiredRecordIds: required,
    exactRecordIds,
    missingRecordIds,
    failedRecordIds,
    checkpointHash,
    certificateHash,
  };
  const replayExact = input.sourceManifest.exactSourceCoverage
    && missingRecordIds.length === 0
    && failedRecordIds.length === 0
    && exactRecordIds.length === required.length;
  return {
    plane: {
      plane: 'parsed-documents',
      hash: scientificContentHash(receipt),
      artifactKeys: ['historicalParserCheckpoints', 'historicalParserReplayCertificates'],
      replayFidelity: replayExact ? 'exact' : 'unverified',
      historicalProvenance: replayExact ? 'source-reconstructed' : 'unavailable',
      sourceReferences: [
        `Parser checkpoint set ${checkpointHash}`,
        `Parser replay certificate set ${certificateHash}`,
      ],
    },
    receipt,
  };
}
