// Dependence-adjusted cross-stream triangulation.
// Based on QCAMEO §13.
// Penalises streams that share data sources or dominant bias families,
// producing an adjusted weight that reflects genuinely independent evidence.

import { DEFAULT_CONFIG } from './types.js';

/**
 * Construct evidence streams from epidemiological and mechanistic QWoE results.
 * @param {Object} epiQWoE - from aggregateEpiQWoE
 * @param {Object} mechQWoE - from aggregateMechQWoE
 * @param {Array} epiResults - selected primary-study result records
 * @param {Array} mechLineages - mechanistic lineages
 * @returns {Array} streams
 */
export function constructEvidenceStreams(epiQWoE, mechQWoE, epiResults, mechLineages) {
  const streams = [];

  // Epidemiological stream
  if (epiQWoE && !epiQWoE.incomplete) {
    streams.push({
      streamId: 'epidemiological',
      support: epiQWoE.rawPattern,
      credibility: epiQWoE.reliability,
      coverage: epiQWoE.coverage,
      dataLineages: new Set((epiResults || []).map(r => r.studyId)),
      dominantBiasFamily: detectDominantBiasFamily(epiResults || []),
      weight: 1.0,
    });
  }

  // Mechanistic stream
  if (mechQWoE && !mechQWoE.incomplete) {
    streams.push({
      streamId: 'mechanistic',
      support: mechQWoE.rawPattern,
      credibility: mechQWoE.methodReliability,
      coverage: mechQWoE.coverage,
      dataLineages: new Set((mechLineages || []).map(l => l.lineageId)),
      dominantBiasFamily: detectMechDominantBiasFamily(mechLineages || []),
      weight: 1.0,
    });
  }

  return streams;
}

function detectDominantBiasFamily(results) {
  const families = {};
  for (const r of results) {
    const fam = r.dominantBiasFamily || 'unclassified';
    families[fam] = (families[fam] || 0) + 1;
  }
  let max = 0, dominant = 'unclassified';
  for (const [fam, count] of Object.entries(families)) {
    if (count > max) { max = count; dominant = fam; }
  }
  return dominant;
}

function detectMechDominantBiasFamily(lineages) {
  const families = {};
  for (const l of lineages) {
    const fam = l.dominantBiasFamily || l.modelType || 'unclassified';
    families[fam] = (families[fam] || 0) + 1;
  }
  let max = 0, dominant = 'unclassified';
  for (const [fam, count] of Object.entries(families)) {
    if (count > max) { max = count; dominant = fam; }
  }
  return dominant;
}

/**
 * Dual-assess stream dependence. Two streams are dependent if they share:
 * - Data sources (overlapping study/lineage IDs)
 * - Dominant bias families
 * Dependence level scored via config.dependenceLevels.
 *
 * @param {Array} streams
 * @param {Object} config
 * @returns {number[][]} rho matrix [l][k] = dependence coefficient
 */
export function assessStreamDependence(streams, config = DEFAULT_CONFIG) {
  const n = streams.length;
  const rho = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { rho[i][j] = 1.0; continue; }

      const si = streams[i];
      const sj = streams[j];

      // Check shared data
      let sharedData = false;
      for (const id of si.dataLineages) {
        if (sj.dataLineages.has(id)) { sharedData = true; break; }
      }

      if (sharedData) {
        rho[i][j] = config.dependenceLevels.DUPLICATE_DATA_OR_ANALYSIS;
      } else if (si.dominantBiasFamily === sj.dominantBiasFamily && si.dominantBiasFamily !== 'unclassified') {
        rho[i][j] = config.dependenceLevels.INDEPENDENT_SAME_DOMINANT_BIAS;
      } else {
        rho[i][j] = config.dependenceLevels.DIFFERENT_DATA_DIFFERENT_BIAS;
      }
    }
  }

  return rho;
}

/**
 * Compute dependence-adjusted triangulation result.
 *
 * For each stream l:
 *   penalty = 1 + Σ_{k≠l} rho[l,k] * streams[k].credibility
 *   adjustedWeight[l] = credibility[l] / penalty
 *
 * Then:
 *   T = Σ(adjustedWeight * support) / Σ(adjustedWeight)
 *   agreement = 1 - Σ(adjustedWeight * |support - T|) / (2 * totalWeight)
 *   effectiveStreams = (totalWeight²) / ΣΣ(adjustedWeight[l] * adjustedWeight[k] * rho[l,k])
 *
 * @param {Array} streams
 * @param {number[][]} rho - dependence matrix
 * @returns {Object} triangulation result
 */
export function computeTriangulation(streams, rho) {
  if (!streams.length) {
    return { support: 0, agreement: 0, effectiveStreams: 0, displayQWoE: 0 };
  }

  const n = streams.length;
  const adjustedWeight = new Array(n).fill(0);

  for (let l = 0; l < n; l++) {
    let penalty = 1;
    for (let k = 0; k < n; k++) {
      if (k === l) continue;
      penalty += rho[l][k] * (streams[k].credibility || 0);
    }
    adjustedWeight[l] = (streams[l].credibility || 0) / penalty;
    streams[l].weight = adjustedWeight[l];
  }

  const totalWeight = adjustedWeight.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    return { support: 0, agreement: 0, effectiveStreams: 0, displayQWoE: 0 };
  }

  let T = 0;
  for (let l = 0; l < n; l++) {
    T += adjustedWeight[l] * (streams[l].support || 0);
  }
  T /= totalWeight;

  let agreementNum = 0;
  for (let l = 0; l < n; l++) {
    agreementNum += adjustedWeight[l] * Math.abs((streams[l].support || 0) - T);
  }
  const agreement = 1 - agreementNum / (2 * totalWeight);

  let quadraticDependence = 0;
  for (let l = 0; l < n; l++) {
    for (let k = 0; k < n; k++) {
      quadraticDependence += adjustedWeight[l] * adjustedWeight[k] * rho[l][k];
    }
  }
  const effectiveStreams = quadraticDependence > 0 ? (totalWeight * totalWeight) / quadraticDependence : 0;

  const coverage = streams.reduce((a, s) => a + (s.coverage || 0) * (s.weight || 0), 0) /
                   streams.reduce((a, s) => a + (s.weight || 0), 0);

  const displayQWoE = T * agreement * Math.min(1, effectiveStreams / 2) * coverage;

  return { support: T, agreement, effectiveStreams, displayQWoE, coverage, totalWeight, adjustedWeight };
}
