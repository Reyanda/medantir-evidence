import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalReviewFrozenPlane } from './review-reproduction.js';
import type { HistoricalIndexStateVerification } from './index-state-attestation.js';

/**
 * Database index-time evidence can only constrain a search-plane claim, never
 * upgrade an otherwise reconstructed capsule to original historical provenance.
 */
export function constrainHistoricalSearchPlaneByIndexState(input: {
  searchPlane: HistoricalReviewFrozenPlane;
  indexState: HistoricalIndexStateVerification;
}): HistoricalReviewFrozenPlane {
  if (input.searchPlane.plane !== 'search-import-dedup') {
    throw new Error(`Index-state constraint requires search-import-dedup plane, received '${input.searchPlane.plane}'.`);
  }
  if (input.searchPlane.replayFidelity !== 'exact') {
    return {
      ...input.searchPlane,
      historicalProvenance: input.searchPlane.historicalProvenance === 'original-exact'
        ? 'source-reconstructed'
        : input.searchPlane.historicalProvenance,
      hash: scientificContentHash({
        searchPlaneHash: input.searchPlane.hash,
        indexStateHash: input.indexState.verificationHash,
      }),
      sourceReferences: [
        ...(input.searchPlane.sourceReferences ?? []),
        `Historical database index-state verification ${input.indexState.verificationHash}`,
      ].sort(),
    };
  }
  const provenance = input.searchPlane.historicalProvenance === 'original-exact'
    && input.indexState.exactHistoricalIndexCoverage
    ? 'original-exact'
    : 'source-reconstructed';
  return {
    ...input.searchPlane,
    historicalProvenance: provenance,
    hash: scientificContentHash({
      searchPlaneHash: input.searchPlane.hash,
      indexStateHash: input.indexState.verificationHash,
    }),
    artifactKeys: [...new Set([
      ...input.searchPlane.artifactKeys,
      'historicalIndexStateVerification',
    ])].sort(),
    sourceReferences: [
      ...(input.searchPlane.sourceReferences ?? []),
      `Historical database index-state verification ${input.indexState.verificationHash}`,
    ].sort(),
  };
}
