// QWoE — Quality-weighted Weight of Evidence
// Epidemiological and mechanistic domain scoring with Bradford Hill weighting.
// Based on QCAMEO §11–12.

import { DEFAULT_CONFIG } from './types.js';

/**
 * Aggregate epidemiological QWoE from 8 scored domains.
 *
 * Algorithm (from pseudocode §11):
 * 1. Sum weighted positive mass and contradiction mass across domains
 * 2. Compute coverage = assessedWeight / totalWeight
 * 3. rawPattern = (positive - contradiction) / (2 * assessedWeight)
 * 4. Apply GRADE ceiling and source reliability
 * 5. QWoE = rawPattern * reliability * coverage
 *
 * @param {Object} domains - { DOMAIN: { adjudicated: number|null }, ... }
 * @param {number} sourceReliability - mean verification ceiling of primary studies
 * @param {string} gradeCertainty - GRADE certainty (HIGH/MODERATE/LOW/VERY_LOW)
 * @param {Object} config - EPI weights configuration
 * @returns {Object} QWoE result
 */
export function aggregateEpiQWoE(domains, sourceReliability, gradeCertainty, config = DEFAULT_CONFIG) {
  const weights = config.epiWeights;
  let positiveMass = 0;
  let contradictionMass = 0;
  let assessedWeight = 0;

  for (const [domain, judgement] of Object.entries(domains)) {
    const s = judgement.adjudicated;
    if (s === null || s === undefined) continue;

    const w = weights[domain] || 1.0;
    assessedWeight += w;
    positiveMass += w * Math.max(s, 0);
    contradictionMass += w * Math.max(-s, 0);
  }

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (assessedWeight === 0 || totalWeight === 0) {
    return { qwoe: 0, positive: 0, contradiction: 0, coverage: 0, rawPattern: 0, reliability: 0, incomplete: true };
  }

  const positive = positiveMass / (2 * assessedWeight);
  const contradiction = contradictionMass / (2 * assessedWeight);
  const coverage = assessedWeight / totalWeight;
  const rawPattern = positive - contradiction;

  const G = config.gradeCoefficient[gradeCertainty] ?? 0.25;
  const reliability = Math.min(sourceReliability, G);
  const qwoe = rawPattern * reliability * coverage;

  return {
    qwoe, positive, contradiction, coverage, rawPattern, reliability,
    temporalityPass: (domains.TEMPORALITY?.adjudicated ?? -10) >= 1,
    temporalityFatal: (domains.TEMPORALITY?.adjudicated ?? 0) === -2,
    identificationPass: (domains.IDENTIFICATION?.adjudicated ?? -10) >= 1,
    identificationFatal: (domains.IDENTIFICATION?.adjudicated ?? 0) === -2,
    incomplete: false,
  };
}

/**
 * Aggregate mechanistic QWoE with validity/directness/independence weighting.
 *
 * Algorithm (from pseudocode §12):
 * For each mechanistic domain k, for each lineage j:
 *   weight = validity[j] * directness[j] * independence[j]
 *   aggregateDomain[k] = Σ(weight * score) / Σ(weight)
 *
 * Then compute aggregate QWoE using beta weights.
 *
 * @param {Object} domainsByLineage - { lineageId: { DOMAIN: score, ... }, ... }
 * @param {Array} lineages - [{ lineageId, validity, directness, independence }]
 * @param {Object} config
 * @returns {Object}
 */
export function aggregateMechQWoE(domainsByLineage, lineages, config = DEFAULT_CONFIG) {
  const weights = config.mechWeights;
  const lineageMap = new Map(lineages.map(l => [l.lineageId, l]));
  const aggregateDomain = {};

  for (const domain of Object.keys(weights)) {
    let numerator = 0;
    let denominator = 0;

    for (const [lineageId, domains] of Object.entries(domainsByLineage)) {
      const score = domains[domain];
      if (score === null || score === undefined) continue;

      const lineage = lineageMap.get(lineageId);
      if (!lineage) continue;

      const w = (lineage.validity || 0) * (lineage.directness || 0) * (lineage.independence || 0);
      numerator += w * score;
      denominator += w;
    }

    aggregateDomain[domain] = denominator > 0 ? numerator / denominator : null;
  }

  // Aggregate using beta weights
  let positiveMass = 0;
  let contradictionMass = 0;
  let assessedWeight = 0;

  for (const [domain, score] of Object.entries(aggregateDomain)) {
    if (score === null) continue;
    const w = weights[domain] || 1.0;
    assessedWeight += w;
    positiveMass += w * Math.max(score, 0);
    contradictionMass += w * Math.max(-score, 0);
  }

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (assessedWeight === 0 || totalWeight === 0) {
    return { qwoe: 0, positive: 0, contradiction: 0, coverage: 0, rawPattern: 0, methodReliability: 0, incomplete: true };
  }

  const positive = positiveMass / (2 * assessedWeight);
  const contradiction = contradictionMass / (2 * assessedWeight);
  const coverage = assessedWeight / totalWeight;
  const rawPattern = positive - contradiction;

  // Method reliability = mean of validity*directness, weighted by directness
  let qualityNum = 0, qualityDen = 0;
  for (const l of lineages) {
    const v = l.validity || 0;
    const d = l.directness || 0;
    const ind = l.independence || 0;
    qualityNum += d * ind * v;
    qualityDen += d * ind;
  }
  const methodReliability = qualityDen > 0 ? qualityNum / qualityDen : 0;

  const qwoe = rawPattern * methodReliability * coverage;

  return { qwoe, positive, contradiction, coverage, rawPattern, methodReliability, aggregateDomain, incomplete: false };
}

/**
 * Dual-blinded scoring helper: adjudicate disagreements between two reviewers.
 * Triggers third reviewer if |A - B| >= 2 or either gate is disputed.
 *
 * @param {number|null} scoreA
 * @param {number|null} scoreB
 * @returns {{ adjudicated: number|null, requiresThird: boolean }}
 */
export function adjudicateDomainScore(scoreA, scoreB) {
  if (scoreA === null && scoreB === null) return { adjudicated: null, requiresThird: false };
  if (scoreA === null) return { adjudicated: scoreB, requiresThird: false };
  if (scoreB === null) return { adjudicated: scoreA, requiresThird: false };

  const diff = Math.abs(scoreA - scoreB);
  if (diff >= 2 || (scoreA >= 0 && scoreB < 0) || (scoreB >= 0 && scoreA < 0)) {
    return { adjudicated: Math.round((scoreA + scoreB) / 2), requiresThird: true };
  }

  return { adjudicated: Math.round((scoreA + scoreB) / 2), requiresThird: false };
}
