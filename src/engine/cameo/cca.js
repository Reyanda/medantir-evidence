// Corrected Covered Area (CCA) — Pieper et al. 2014
// Quantifies primary-study overlap across systematic reviews for an edge.
//
// CCA = (N - R) / (R*C - R) * 100   where:
//   N = total inclusions across all cells
//   R = number of rows (primary studies)
//   C = number of columns (reviews)
//
// Interpretation bands: 0-5% slight, 6-10% moderate, 11-15% high, >15% very high

export const CCA_BANDS = {
  slight: { min: 0, max: 5 },
  moderate: { min: 6, max: 10 },
  high: { min: 11, max: 15 },
  veryHigh: { min: 16, max: Infinity },
};

/**
 * Build the edge-specific citation matrix M[s, r] = 1 if study s appears in review r.
 * @param {Array} studyIds - canonical study lineage IDs
 * @param {Array} reviews - [{ reviewId, includedStudyIds: Set }]
 * @returns {number[][]} M[row][col] where row=study, col=review
 */
export function buildCitationMatrix(studyIds, reviews) {
  const R = reviews.length;
  const C = studyIds.length;
  const M = Array.from({ length: C }, () => new Array(R).fill(0));
  const studyIndex = new Map(studyIds.map((id, i) => [id, i]));

  for (let r = 0; r < R; r++) {
    const included = reviews[r].includedStudyIds;
    for (const sid of included) {
      const i = studyIndex.get(sid);
      if (i !== undefined) M[i][r] = 1;
    }
  }
  return M;
}

/**
 * Compute Corrected Covered Area from the citation matrix.
 * @param {number[][]} M - citation matrix [studies][reviews]
 * @returns {number} CCA percentage (0-100)
 */
export function computeCCA(M) {
  if (!M.length || !M[0].length) return 0;
  const C = M.length;   // studies
  const R = M[0].length; // reviews

  if (R <= 1) return 0;

  let N = 0;
  let rowsWithData = 0;
  for (let i = 0; i < C; i++) {
    let hasData = false;
    for (let j = 0; j < R; j++) {
      N += M[i][j];
      if (M[i][j]) hasData = true;
    }
    if (hasData) rowsWithData++;
  }

  const denominator = rowsWithData * R - rowsWithData;
  if (denominator <= 0) return 0;
  return (100 * (N - rowsWithData)) / denominator;
}

/**
 * Compute pairwise CCA between each pair of reviews.
 * @param {number[][]} M - citation matrix
 * @returns {Object} { "r1::r2": cca_value, ... }
 */
export function computePairwiseCCA(M) {
  const R = M[0].length;
  const result = {};
  for (let r1 = 0; r1 < R; r1++) {
    for (let r2 = r1 + 1; r2 < R; r2++) {
      const pairMatrix = M.map(row => [row[r1], row[r2]]);
      result[`${r1}::${r2}`] = computeCCA(pairMatrix);
    }
  }
  return result;
}

/**
 * Classify CCA value into interpretation band.
 */
export function classifyCCA(cca) {
  if (cca <= 5) return 'slight';
  if (cca <= 10) return 'moderate';
  if (cca <= 15) return 'high';
  return 'veryHigh';
}

/**
 * Allocate fractional lineage credit across overlapping reviews.
 * Each study's contribution is split across reviews proportional to
 * review quality × verification ceiling, correcting for overlap.
 *
 * allocation[s, r] = verification[s] * M[s, r] * reviewQ[r] / Σ(M[s, k] * reviewQ[k])
 *
 * @param {number[][]} M - citation matrix
 * @param {number[]} reviewQ - carrier reliability per review
 * @param {number[]} verification - verification ceiling per study
 * @returns {{ allocation: number[][], reviewMass: number[] }}
 */
export function allocateFractionalCredit(M, reviewQ, verification) {
  const C = M.length;
  const R = M[0].length;
  const allocation = Array.from({ length: C }, () => new Array(R).fill(0));
  const reviewMass = new Array(R).fill(0);

  for (let s = 0; s < C; s++) {
    let denominator = 0;
    for (let r = 0; r < R; r++) {
      denominator += M[s][r] * reviewQ[r];
    }
    if (denominator === 0) continue;

    for (let r = 0; r < R; r++) {
      allocation[s][r] = (verification[s] * M[s][r] * reviewQ[r]) / denominator;
      reviewMass[r] += allocation[s][r];
    }
  }

  return { allocation, reviewMass };
}
