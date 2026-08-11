import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';
import type { HistoricalReportInventoryVerification } from './report-inventory-attestation.js';

/** Report inventory evidence can only constrain full-text exactness, never upgrade it. */
export function constrainHistoricalFullTextPlaneByInventory(input: {
  fullTextPlane: HistoricalReviewFrozenPlane;
  inventory: HistoricalReportInventoryVerification;
}): HistoricalReviewFrozenPlane {
  if (input.fullTextPlane.plane !== 'fulltext-corpus') {
    throw new Error(`Report-inventory constraint requires fulltext-corpus plane, received '${input.fullTextPlane.plane}'.`);
  }
  const replayFidelity = input.fullTextPlane.replayFidelity === 'exact'
    && input.inventory.computationalInventoryComplete
    ? 'exact'
    : 'unverified';
  const historicalProvenance = replayFidelity !== 'exact'
    ? 'unavailable'
    : input.fullTextPlane.historicalProvenance === 'original-exact'
      && input.inventory.originalInventoryComplete
      ? 'original-exact'
      : 'source-reconstructed';
  return {
    ...input.fullTextPlane,
    hash: scientificContentHash({
      fullTextPlaneHash: input.fullTextPlane.hash,
      reportInventoryVerificationHash: input.inventory.verificationHash,
    }),
    artifactKeys: [...new Set([
      ...input.fullTextPlane.artifactKeys,
      'historicalReportInventoryVerification',
    ])].sort(),
    replayFidelity,
    historicalProvenance,
    sourceReferences: [
      ...(input.fullTextPlane.sourceReferences ?? []),
      `Historical report inventory verification ${input.inventory.verificationHash}`,
    ].sort(),
  };
}
