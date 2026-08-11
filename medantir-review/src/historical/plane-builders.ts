import { scientificContentHash } from '../core/canonical-hash.js';
import { verifyHistoricalReplayCapsule, type HistoricalReplayCapsule } from './replay-capsule.js';
import type { HistoricalReplayCertificate } from './replay-certificate.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';
import type { HistoricalSourceVersionVerification } from './source-version-attestation.js';
import type { HistoricalAppraisalLedger } from './appraisal-ledger.js';
import type { HistoricalOutcomeRowLedger } from './outcome-row-ledger.js';
import type { HistoricalSynthesisReplayReceipt } from './synthesis-replay.js';

export function buildHistoricalSearchPlane(input: {
  capsule: HistoricalReplayCapsule;
  certificate: HistoricalReplayCertificate;
}): HistoricalReviewFrozenPlane {
  const integrity = verifyHistoricalReplayCapsule(input.capsule);
  if (!integrity.valid) throw new Error('Historical search plane cannot be created from an invalid capsule.');
  if (!input.certificate.exactMachineReplay || input.certificate.capsuleId !== input.capsule.capsuleId) {
    throw new Error('Historical search plane requires an exact replay certificate bound to the same capsule.');
  }
  return {
    plane: 'search-import-dedup',
    hash: scientificContentHash({ capsuleId: input.capsule.capsuleId, checkpoints: input.capsule.checkpoints }),
    artifactKeys: ['searchResults', 'searchProvenance', 'uniqueRecords', 'deduplicationReport'],
    replayFidelity: 'exact',
    historicalProvenance: input.capsule.reproductionClaim === 'publication-exact' ? 'original-exact' : 'source-reconstructed',
    sourceReferences: [`Historical replay capsule ${input.capsule.capsuleId}`],
  };
}

export function buildHistoricalFullTextPlane(input: {
  sourceManifest: HistoricalStudySourceManifest;
  versionVerification: HistoricalSourceVersionVerification;
}): HistoricalReviewFrozenPlane {
  if (input.sourceManifest.historicalCutoff !== input.versionVerification.historicalCutoff) {
    throw new Error('Historical full-text plane source manifest/version verification cutoffs differ.');
  }
  const replayExact = input.sourceManifest.exactSourceCoverage;
  return {
    plane: 'fulltext-corpus',
    hash: scientificContentHash({
      sourceManifestHash: input.sourceManifest.manifestHash,
      versionVerificationHash: input.versionVerification.verificationHash,
    }),
    artifactKeys: ['historicalStudySourceManifest', 'historicalSourceVersionVerification'],
    replayFidelity: replayExact ? 'exact' : 'unverified',
    historicalProvenance: input.versionVerification.exactHistoricalVersionCoverage
      ? 'original-exact'
      : replayExact ? 'source-reconstructed' : 'unavailable',
    sourceReferences: [
      `Study-source manifest ${input.sourceManifest.manifestHash}`,
      `Source-version verification ${input.versionVerification.verificationHash}`,
    ],
  };
}

export function buildHistoricalAppraisalPlane(
  ledger: HistoricalAppraisalLedger,
): HistoricalReviewFrozenPlane {
  const exactRows = ledger.rows.length > 0 && ledger.exactSourceBoundRows === ledger.rows.length;
  return {
    plane: 'appraisal-ledger',
    hash: ledger.ledgerHash,
    artifactKeys: ['historicalAppraisalLedger'],
    replayFidelity: exactRows ? 'exact' : 'unverified',
    // A publication table can reconstruct the reported scores exactly, but it
    // is not the original reviewer worksheet unless separately archived.
    historicalProvenance: exactRows ? 'source-reconstructed' : 'unavailable',
    sourceReferences: [`Historical appraisal ledger ${ledger.ledgerHash}`],
  };
}

export function buildHistoricalExtractionPlane(
  ledger: HistoricalOutcomeRowLedger,
): HistoricalReviewFrozenPlane {
  const exactRows = ledger.rows.length > 0 && ledger.unresolvedRows === 0 && ledger.poolableRows === ledger.rows.length;
  return {
    plane: 'extraction-ledger',
    hash: ledger.ledgerHash,
    artifactKeys: ['historicalOutcomeRowLedger'],
    replayFidelity: exactRows ? 'exact' : 'unverified',
    historicalProvenance: exactRows ? 'source-reconstructed' : 'unavailable',
    sourceReferences: [`Historical outcome-row ledger ${ledger.ledgerHash}`],
  };
}

function requireReplayReceipts(receipts: HistoricalSynthesisReplayReceipt[]): void {
  if (receipts.length === 0) throw new Error('Historical synthesis plane requires at least one synthesis replay receipt.');
  const duplicate = receipts.find((receipt, index) => receipts.findIndex((candidate) =>
    candidate.selector.outcome === receipt.selector.outcome
    && candidate.selector.measure === receipt.selector.measure
    && candidate.selector.timeHorizon === receipt.selector.timeHorizon
    && candidate.selector.analysisPopulation === receipt.selector.analysisPopulation
    && candidate.selector.subgroupLabel === receipt.selector.subgroupLabel) !== index);
  if (duplicate) throw new Error(`Historical synthesis receipts duplicate estimand '${duplicate.selector.outcome}'.`);
}

export function buildHistoricalSynthesisInputPlane(
  receipts: HistoricalSynthesisReplayReceipt[],
): HistoricalReviewFrozenPlane {
  requireReplayReceipts(receipts);
  return {
    plane: 'synthesis-inputs',
    hash: scientificContentHash(receipts.map((receipt) => ({
      selector: receipt.selector,
      synthesisInputsHash: receipt.synthesisInputsHash,
      selectedRowHashes: receipt.selectedRowHashes,
    })).sort((a, b) => scientificContentHash(a.selector).localeCompare(scientificContentHash(b.selector)))),
    artifactKeys: ['historicalSynthesisInputs'],
    replayFidelity: 'exact',
    historicalProvenance: 'source-reconstructed',
    sourceReferences: receipts.map((receipt) => `Synthesis input ${receipt.synthesisInputsHash}`).sort(),
  };
}

export function buildHistoricalSynthesisResultPlane(
  receipts: HistoricalSynthesisReplayReceipt[],
): HistoricalReviewFrozenPlane {
  requireReplayReceipts(receipts);
  const allPublishedTargetsMatch = receipts.every((receipt) => receipt.publishedComparison.exactWithinTolerance);
  return {
    plane: 'synthesis-results',
    hash: scientificContentHash(receipts.map((receipt) => ({
      selector: receipt.selector,
      replayHash: receipt.replayHash,
      publishedMatch: receipt.publishedComparison.exactWithinTolerance,
    })).sort((a, b) => scientificContentHash(a.selector).localeCompare(scientificContentHash(b.selector)))),
    artifactKeys: ['historicalSynthesisReplayReceipts', 'historicalResultComparison'],
    replayFidelity: allPublishedTargetsMatch ? 'exact' : 'unverified',
    historicalProvenance: allPublishedTargetsMatch ? 'source-reconstructed' : 'unavailable',
    sourceReferences: receipts.map((receipt) => `Synthesis replay ${receipt.replayHash}`).sort(),
  };
}
