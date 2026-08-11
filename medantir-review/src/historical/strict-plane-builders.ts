import { scientificContentHash } from '../core/canonical-hash.js';
import { verifyHistoricalReplayCapsule, type HistoricalReplayCapsule } from './replay-capsule.js';
import type { HistoricalReplayCertificate } from './replay-certificate.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';
import type { HistoricalStudySourceManifest } from './study-source-manifest.js';
import type { HistoricalSourceVersionVerification } from './source-version-attestation.js';
import type { HistoricalAppraisalLedger } from './appraisal-ledger.js';
import {
  isHistoricalOutcomeRowPoolable,
  type HistoricalOutcomeRowLedger,
} from './outcome-row-ledger.js';
import type { HistoricalSynthesisReplayReceipt } from './synthesis-replay.js';
import type { HistoricalScreeningDecisionLedger } from './screening-decision-ledger.js';
import type { HistoricalScreeningAggregateReconciliation } from './screening-aggregate-reconciliation.js';

function exactPlane(
  plane: HistoricalReviewFrozenPlane['plane'],
  hash: string,
  artifactKeys: string[],
  historicalProvenance: HistoricalReviewFrozenPlane['historicalProvenance'],
  sourceReferences: string[],
): HistoricalReviewFrozenPlane {
  return {
    plane,
    hash,
    artifactKeys: [...artifactKeys].sort(),
    replayFidelity: 'exact',
    historicalProvenance,
    sourceReferences: [...new Set(sourceReferences)].sort(),
  };
}

export function buildStrictHistoricalSearchPlane(input: {
  capsule: HistoricalReplayCapsule;
  certificate: HistoricalReplayCertificate;
}): HistoricalReviewFrozenPlane {
  const integrity = verifyHistoricalReplayCapsule(input.capsule);
  if (!integrity.valid) throw new Error('Historical search plane cannot be created from an invalid capsule.');
  if (!input.certificate.exactMachineReplay || input.certificate.capsuleId !== input.capsule.capsuleId) {
    throw new Error('Historical search plane requires an exact replay certificate bound to the same capsule.');
  }
  return exactPlane(
    'search-import-dedup',
    scientificContentHash({ capsuleId: input.capsule.capsuleId, checkpoints: input.capsule.checkpoints }),
    ['searchResults', 'searchProvenance', 'uniqueRecords', 'deduplicationReport'],
    input.capsule.reproductionClaim === 'publication-exact' ? 'original-exact' : 'source-reconstructed',
    [`Historical replay capsule ${input.capsule.capsuleId}`],
  );
}

export function buildStrictHistoricalFullTextPlane(input: {
  sourceManifest: HistoricalStudySourceManifest;
  versionVerification: HistoricalSourceVersionVerification;
}): HistoricalReviewFrozenPlane {
  if (input.sourceManifest.historicalCutoff !== input.versionVerification.historicalCutoff) {
    throw new Error('Historical full-text plane source manifest/version verification cutoffs differ.');
  }
  if (!input.sourceManifest.exactSourceCoverage) {
    return {
      plane: 'fulltext-corpus',
      hash: scientificContentHash({
        sourceManifestHash: input.sourceManifest.manifestHash,
        versionVerificationHash: input.versionVerification.verificationHash,
      }),
      artifactKeys: ['historicalStudySourceManifest', 'historicalSourceVersionVerification'],
      replayFidelity: 'unverified',
      historicalProvenance: 'unavailable',
      sourceReferences: [
        `Study-source manifest ${input.sourceManifest.manifestHash}`,
        `Source-version verification ${input.versionVerification.verificationHash}`,
      ],
    };
  }
  return exactPlane(
    'fulltext-corpus',
    scientificContentHash({
      sourceManifestHash: input.sourceManifest.manifestHash,
      versionVerificationHash: input.versionVerification.verificationHash,
    }),
    ['historicalStudySourceManifest', 'historicalSourceVersionVerification'],
    input.versionVerification.exactHistoricalVersionCoverage ? 'original-exact' : 'source-reconstructed',
    [
      `Study-source manifest ${input.sourceManifest.manifestHash}`,
      `Source-version verification ${input.versionVerification.verificationHash}`,
    ],
  );
}

export function buildStrictHistoricalScreeningPlane(input: {
  ledger: HistoricalScreeningDecisionLedger;
  aggregateReconciliation?: HistoricalScreeningAggregateReconciliation;
}): HistoricalReviewFrozenPlane {
  if (input.ledger.status === 'row-exact') {
    return exactPlane(
      'screening-decisions',
      input.ledger.ledgerHash,
      ['historicalScreeningLedger'],
      'original-exact',
      [`Historical screening ledger ${input.ledger.ledgerHash}`],
    );
  }
  if (input.ledger.status === 'row-reconstructed') {
    return exactPlane(
      'screening-decisions',
      input.ledger.ledgerHash,
      ['historicalScreeningLedger'],
      'source-reconstructed',
      [`Historical screening ledger ${input.ledger.ledgerHash}`],
    );
  }
  if (input.ledger.status === 'aggregate-only' && input.aggregateReconciliation?.aggregateMatch) {
    return exactPlane(
      'screening-decisions',
      scientificContentHash({ ledgerHash: input.ledger.ledgerHash, reconciliation: input.aggregateReconciliation }),
      ['historicalScreeningLedger', 'historicalScreeningAggregateReconciliation'],
      'aggregate-only',
      [`Historical aggregate screening ledger ${input.ledger.ledgerHash}`],
    );
  }
  return {
    plane: 'screening-decisions',
    hash: input.ledger.ledgerHash,
    artifactKeys: ['historicalScreeningLedger'],
    replayFidelity: 'unverified',
    historicalProvenance: input.ledger.status === 'aggregate-only' ? 'aggregate-only' : 'unavailable',
    sourceReferences: [`Historical screening ledger ${input.ledger.ledgerHash}`],
  };
}

export function buildStrictHistoricalAppraisalPlane(
  ledger: HistoricalAppraisalLedger,
): HistoricalReviewFrozenPlane {
  const allRowsSourceBound = ledger.rows.length > 0 && ledger.exactSourceBoundRows === ledger.rows.length;
  if (!allRowsSourceBound) {
    return {
      plane: 'appraisal-ledger',
      hash: ledger.ledgerHash,
      artifactKeys: ['historicalAppraisalLedger'],
      replayFidelity: 'unverified',
      historicalProvenance: ledger.rows.length > 0 ? 'source-reconstructed' : 'unavailable',
      sourceReferences: [`Historical appraisal ledger ${ledger.ledgerHash}`],
    };
  }
  return exactPlane(
    'appraisal-ledger',
    ledger.ledgerHash,
    ['historicalAppraisalLedger'],
    'source-reconstructed',
    [`Historical appraisal ledger ${ledger.ledgerHash}`],
  );
}

export function buildStrictHistoricalExtractionPlane(
  ledger: HistoricalOutcomeRowLedger,
): HistoricalReviewFrozenPlane {
  const hasRows = ledger.rows.length > 0;
  const unresolved = ledger.rows.some((row) => row.contributionStatus === 'unresolved');
  const invalidContributing = ledger.rows.some((row) =>
    row.contributionStatus === 'contributing' && !isHistoricalOutcomeRowPoolable(row));
  const replayExact = hasRows && !unresolved && !invalidContributing;
  return {
    plane: 'extraction-ledger',
    hash: ledger.ledgerHash,
    artifactKeys: ['historicalOutcomeRowLedger'],
    replayFidelity: replayExact ? 'exact' : 'unverified',
    historicalProvenance: replayExact ? 'source-reconstructed' : 'unavailable',
    sourceReferences: [`Historical outcome-row ledger ${ledger.ledgerHash}`],
  };
}

function requireSynthesisReceipts(receipts: HistoricalSynthesisReplayReceipt[]): void {
  if (receipts.length === 0) throw new Error('Historical synthesis plane requires at least one synthesis replay receipt.');
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const identity = scientificContentHash(receipt.selector);
    if (seen.has(identity)) throw new Error(`Historical synthesis receipts duplicate estimand '${receipt.selector.outcome}'.`);
    seen.add(identity);
  }
}

export function buildStrictHistoricalSynthesisInputPlane(
  receipts: HistoricalSynthesisReplayReceipt[],
): HistoricalReviewFrozenPlane {
  requireSynthesisReceipts(receipts);
  return exactPlane(
    'synthesis-inputs',
    scientificContentHash(receipts.map((receipt) => ({
      selector: receipt.selector,
      synthesisInputsHash: receipt.synthesisInputsHash,
      selectedRowHashes: receipt.selectedRowHashes,
    })).sort((a, b) => scientificContentHash(a.selector).localeCompare(scientificContentHash(b.selector)))),
    ['historicalSynthesisInputs'],
    'source-reconstructed',
    receipts.map((receipt) => `Synthesis input ${receipt.synthesisInputsHash}`),
  );
}

export function buildStrictHistoricalSynthesisResultPlane(
  receipts: HistoricalSynthesisReplayReceipt[],
): HistoricalReviewFrozenPlane {
  requireSynthesisReceipts(receipts);
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
