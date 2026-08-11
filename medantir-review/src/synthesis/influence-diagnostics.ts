import type { AnalysisEstimate } from './inverse-variance.js';
import {
  analyseRandomEffects,
  type SummaryConfidenceMethod,
  type TauSquaredEstimator,
} from './random-effects.js';

export interface InfluenceDiagnostic {
  studyId: string;
  omittedPooledEffect: number;
  pooledEffectShift: number;
  absolutePooledEffectShift: number;
  omittedTauSquared: number;
  tauSquaredShift: number;
  omittedConfidenceInterval: [number, number];
  nullCrossingChanged: boolean;
  standardizedRandomEffectsResidual: number;
  randomEffectsQContribution: number;
}

export interface InfluenceDiagnosticsResult {
  k: number;
  fullPooledEffect: number;
  fullTauSquared: number;
  fullConfidenceInterval: [number, number];
  diagnostics: InfluenceDiagnostic[];
  mostInfluentialByEffect: string | null;
  mostInfluentialByTauSquared: string | null;
  maxAbsoluteEffectShift: number;
  maxAbsoluteTauSquaredShift: number;
  nullCrossingChanges: string[];
  warnings: string[];
}

function crossesNull(interval: [number, number]): boolean {
  return interval[0] <= 0 && interval[1] >= 0;
}

/**
 * Leave-one-study-out sensitivity and transparent influence metrics.
 *
 * This module deliberately reports magnitudes rather than labeling a study
 * "influential" using an arbitrary hidden threshold. A protocol/user may layer
 * explicit action thresholds on these metrics later.
 */
export function analyseInfluence(
  estimates: AnalysisEstimate[],
  options: { tauEstimator?: TauSquaredEstimator; confidenceMethod?: SummaryConfidenceMethod } = {},
): InfluenceDiagnosticsResult {
  if (estimates.length < 3) throw new Error('Influence diagnostics require at least three studies');
  const tauEstimator = options.tauEstimator ?? 'REML';
  const confidenceMethod = options.confidenceMethod ?? 'wald';
  const full = analyseRandomEffects(estimates, { tauEstimator, confidenceMethod, predictionInterval: true });
  const fullNull = crossesNull(full.confidenceInterval);
  const diagnostics = estimates.map((estimate): InfluenceDiagnostic => {
    const reduced = estimates.filter((candidate) => candidate.studyId !== estimate.studyId);
    const omitted = analyseRandomEffects(reduced, { tauEstimator, confidenceMethod, predictionInterval: reduced.length >= 3 });
    const variance = estimate.standardError ** 2 + full.tauSquared;
    const residual = (estimate.effect - full.pooledEffect) / Math.sqrt(variance);
    const weight = 1 / variance;
    const qContribution = weight * ((estimate.effect - full.pooledEffect) ** 2);
    return {
      studyId: estimate.studyId,
      omittedPooledEffect: omitted.pooledEffect,
      pooledEffectShift: omitted.pooledEffect - full.pooledEffect,
      absolutePooledEffectShift: Math.abs(omitted.pooledEffect - full.pooledEffect),
      omittedTauSquared: omitted.tauSquared,
      tauSquaredShift: omitted.tauSquared - full.tauSquared,
      omittedConfidenceInterval: omitted.confidenceInterval,
      nullCrossingChanged: crossesNull(omitted.confidenceInterval) !== fullNull,
      standardizedRandomEffectsResidual: residual,
      randomEffectsQContribution: qContribution,
    };
  });
  const byEffect = [...diagnostics].sort((a, b) => b.absolutePooledEffectShift - a.absolutePooledEffectShift);
  const byTau = [...diagnostics].sort((a, b) => Math.abs(b.tauSquaredShift) - Math.abs(a.tauSquaredShift));
  const nullCrossingChanges = diagnostics.filter((item) => item.nullCrossingChanged).map((item) => item.studyId);
  const warnings: string[] = [];
  if (nullCrossingChanges.length) warnings.push(`Omitting ${nullCrossingChanges.length} study/studies changes whether the primary confidence interval crosses the null.`);
  if (estimates.length < 5) warnings.push('Influence diagnostics are unstable with fewer than five studies and should be interpreted descriptively.');
  return {
    k: estimates.length,
    fullPooledEffect: full.pooledEffect,
    fullTauSquared: full.tauSquared,
    fullConfidenceInterval: full.confidenceInterval,
    diagnostics,
    mostInfluentialByEffect: byEffect[0]?.studyId ?? null,
    mostInfluentialByTauSquared: byTau[0]?.studyId ?? null,
    maxAbsoluteEffectShift: byEffect[0]?.absolutePooledEffectShift ?? 0,
    maxAbsoluteTauSquaredShift: byTau[0] ? Math.abs(byTau[0].tauSquaredShift) : 0,
    nullCrossingChanges,
    warnings,
  };
}
