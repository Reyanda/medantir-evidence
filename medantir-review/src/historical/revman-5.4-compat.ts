import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalStatisticalRuntimeFingerprint } from './review-reproduction.js';

export const REVMAN_54_COMPAT_VERSION = 'revman-5.4-compat/1' as const;

const Z_975 = 1.959963984540054;

export interface RevMan54BinaryStudy {
  studyId: string;
  experimentalEvents: number;
  experimentalTotal: number;
  controlEvents: number;
  controlTotal: number;
}

export interface RevMan54ContinuousStudy {
  studyId: string;
  experimentalMean: number;
  experimentalSd: number;
  experimentalTotal: number;
  controlMean: number;
  controlSd: number;
  controlTotal: number;
}

export interface RevMan54StudyEffect {
  studyId: string;
  effect: number;
  standardError: number;
  variance: number;
  corrected: boolean;
}

export interface RevMan54MetaAnalysisResult {
  engine: typeof REVMAN_54_COMPAT_VERSION;
  effectMeasure: 'RR' | 'MD';
  method: 'MH-DL-random' | 'IV-DL-random';
  studyCount: number;
  omittedStudyIds: string[];
  correctedStudyIds: string[];
  fixedEffect: number;
  fixedEffectAnalysisScale: number;
  q: number;
  df: number;
  tauSquared: number;
  iSquared: number;
  pooledEffect: number;
  pooledEffectAnalysisScale: number;
  standardError: number;
  ciLower: number;
  ciUpper: number;
  studyEffects: RevMan54StudyEffect[];
}

interface AnalysisEffect {
  studyId: string;
  theta: number;
  variance: number;
  corrected: boolean;
}

const ALGORITHM_CONTRACT = {
  version: REVMAN_54_COMPAT_VERSION,
  historicalScope: 'RevMan 5.4-era algorithms; pre-2024 random-effects semantics',
  sources: [
    'Cochrane Statistical Methods Group, Statistical algorithms in Review Manager, May 2022',
    'Cochrane Handbook archive v6.2 Chapter 10',
  ],
  randomEffects: {
    heterogeneityEstimator: 'DerSimonian-Laird moment estimator',
    summaryConfidenceInterval: 'Wald normal',
    binaryMHVariant: 'Q_MH for tau-squared; random summary uses inverse-variance weights 1/(SE_i^2 + tau^2)',
    continuousVariant: 'Q_IV for tau-squared; random summary uses inverse-variance weights 1/(SE_i^2 + tau^2)',
  },
  binaryRiskRatio: {
    analysisScale: 'natural-log',
    zeroCorrection: 'add 0.5 to all four cells only where a zero makes effect/SE undefined; omit double-zero and double-all-event studies',
    mhFixedRiskRatio: 'sum(a_i*n2_i/N_i) / sum(c_i*n1_i/N_i)',
    individualVariance: '1/a_i + 1/c_i - 1/n1_i - 1/n2_i',
    heterogeneity: 'sum(invVar_i * (logRR_i - logRR_MH)^2)',
  },
  continuousMeanDifference: {
    analysisScale: 'natural',
    studyEffect: 'mean_experimental - mean_control',
    individualVariance: 'sd1_i^2/n1_i + sd2_i^2/n2_i',
    fixedSummary: 'inverse-variance weighted mean',
    heterogeneity: 'sum(invVar_i * (MD_i - MD_IV)^2)',
  },
  iSquared: 'max((Q-df)/Q,0)*100; 0 when Q=0',
} as const;

export function revMan54AlgorithmContract(): typeof ALGORITHM_CONTRACT {
  return ALGORITHM_CONTRACT;
}

export function revMan54AlgorithmContractHash(): string {
  return scientificContentHash(ALGORITHM_CONTRACT);
}

export function revMan54RuntimeFingerprint(): HistoricalStatisticalRuntimeFingerprint {
  return {
    engine: 'MEDANTIR RevMan 5.4 compatibility engine',
    version: REVMAN_54_COMPAT_VERSION,
    algorithmContractHash: revMan54AlgorithmContractHash(),
    numericTolerance: 1e-12,
  };
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number.`);
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
}

function validateBinaryStudy(study: RevMan54BinaryStudy): void {
  positiveInteger(study.experimentalTotal, `${study.studyId} experimental total`);
  positiveInteger(study.controlTotal, `${study.studyId} control total`);
  if (!Number.isInteger(study.experimentalEvents) || study.experimentalEvents < 0 || study.experimentalEvents > study.experimentalTotal) {
    throw new Error(`${study.studyId} experimental events must be an integer between 0 and total.`);
  }
  if (!Number.isInteger(study.controlEvents) || study.controlEvents < 0 || study.controlEvents > study.controlTotal) {
    throw new Error(`${study.studyId} control events must be an integer between 0 and total.`);
  }
}

function binaryRiskRatioEffect(study: RevMan54BinaryStudy): AnalysisEffect | null {
  validateBinaryStudy(study);
  let a = study.experimentalEvents;
  let b = study.experimentalTotal - study.experimentalEvents;
  let c = study.controlEvents;
  let d = study.controlTotal - study.controlEvents;

  // RevMan relative-effect rule: no-events-in-both-groups and all-events-in-
  // both-groups studies contain no relative-effect information and are omitted.
  if ((a === 0 && c === 0) || (b === 0 && d === 0)) return null;

  // For RR, a zero in either event cell makes RR/log(RR)/SE undefined. The
  // documented RevMan correction adds 0.5 to every cell of that study.
  const corrected = a === 0 || c === 0;
  if (corrected) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  const n1 = a + b;
  const n2 = c + d;
  const rr = (a / n1) / (c / n2);
  const variance = (1 / a) + (1 / c) - (1 / n1) - (1 / n2);
  if (!(rr > 0) || !(variance > 0) || !Number.isFinite(variance)) {
    throw new Error(`RevMan 5.4 RR effect is not estimable for study '${study.studyId}'.`);
  }
  return { studyId: study.studyId, theta: Math.log(rr), variance, corrected };
}

function dlTauSquared(q: number, effects: AnalysisEffect[]): number {
  const weights = effects.map((effect) => 1 / effect.variance);
  const sumW = weights.reduce((sum, value) => sum + value, 0);
  const sumW2 = weights.reduce((sum, value) => sum + (value * value), 0);
  const denominator = sumW - (sumW2 / sumW);
  const df = effects.length - 1;
  if (df <= 0 || denominator <= 0 || q <= df) return 0;
  return Math.max((q - df) / denominator, 0);
}

function iSquared(q: number, df: number): number {
  if (!(q > 0) || df <= 0) return 0;
  return Math.max((q - df) / q, 0) * 100;
}

function randomSummary(effects: AnalysisEffect[], tauSquared: number): { theta: number; se: number } {
  const weights = effects.map((effect) => 1 / (effect.variance + tauSquared));
  const sumW = weights.reduce((sum, value) => sum + value, 0);
  if (!(sumW > 0)) throw new Error('RevMan 5.4 random-effects summary has no positive study weight.');
  const theta = effects.reduce((sum, effect, index) => sum + (weights[index]! * effect.theta), 0) / sumW;
  return { theta, se: Math.sqrt(1 / sumW) };
}

export function revMan54RandomEffectsRiskRatio(studies: RevMan54BinaryStudy[]): RevMan54MetaAnalysisResult {
  if (studies.length === 0) throw new Error('RevMan 5.4 RR meta-analysis requires at least one study.');
  const included: Array<{ study: RevMan54BinaryStudy; effect: AnalysisEffect }> = [];
  const omittedStudyIds: string[] = [];
  for (const study of studies) {
    const effect = binaryRiskRatioEffect(study);
    if (!effect) omittedStudyIds.push(study.studyId);
    else included.push({ study, effect });
  }
  if (included.length === 0) throw new Error('RevMan 5.4 RR meta-analysis has no estimable studies after relative-effect omissions.');

  // Equation (3): MH fixed RR is algebraically sum(a*n2/N)/sum(c*n1/N).
  let numerator = 0;
  let denominator = 0;
  for (const { study, effect } of included) {
    let a = study.experimentalEvents;
    let b = study.experimentalTotal - study.experimentalEvents;
    let c = study.controlEvents;
    let d = study.controlTotal - study.controlEvents;
    if (effect.corrected) {
      a += 0.5; b += 0.5; c += 0.5; d += 0.5;
    }
    const n1 = a + b;
    const n2 = c + d;
    const total = n1 + n2;
    numerator += (a * n2) / total;
    denominator += (c * n1) / total;
  }
  if (!(numerator > 0) || !(denominator > 0)) throw new Error('RevMan 5.4 MH RR fixed-effect denominator/numerator is non-positive.');
  const fixedEffect = numerator / denominator;
  const fixedTheta = Math.log(fixedEffect);
  const effects = included.map((item) => item.effect);
  const q = effects.reduce((sum, effect) => sum + ((1 / effect.variance) * ((effect.theta - fixedTheta) ** 2)), 0);
  const df = effects.length - 1;
  const tauSquared = dlTauSquared(q, effects);
  const pooled = randomSummary(effects, tauSquared);
  return {
    engine: REVMAN_54_COMPAT_VERSION,
    effectMeasure: 'RR',
    method: 'MH-DL-random',
    studyCount: effects.length,
    omittedStudyIds,
    correctedStudyIds: effects.filter((effect) => effect.corrected).map((effect) => effect.studyId),
    fixedEffect,
    fixedEffectAnalysisScale: fixedTheta,
    q,
    df,
    tauSquared,
    iSquared: iSquared(q, df),
    pooledEffect: Math.exp(pooled.theta),
    pooledEffectAnalysisScale: pooled.theta,
    standardError: pooled.se,
    ciLower: Math.exp(pooled.theta - (Z_975 * pooled.se)),
    ciUpper: Math.exp(pooled.theta + (Z_975 * pooled.se)),
    studyEffects: effects.map((effect) => ({
      studyId: effect.studyId,
      effect: Math.exp(effect.theta),
      standardError: Math.sqrt(effect.variance),
      variance: effect.variance,
      corrected: effect.corrected,
    })),
  };
}

function validateContinuousStudy(study: RevMan54ContinuousStudy): AnalysisEffect {
  positiveInteger(study.experimentalTotal, `${study.studyId} experimental total`);
  positiveInteger(study.controlTotal, `${study.studyId} control total`);
  finiteNonNegative(study.experimentalSd, `${study.studyId} experimental SD`);
  finiteNonNegative(study.controlSd, `${study.studyId} control SD`);
  if (!Number.isFinite(study.experimentalMean) || !Number.isFinite(study.controlMean)) {
    throw new Error(`${study.studyId} means must be finite.`);
  }
  const theta = study.experimentalMean - study.controlMean;
  const variance = ((study.experimentalSd ** 2) / study.experimentalTotal)
    + ((study.controlSd ** 2) / study.controlTotal);
  if (!(variance > 0)) throw new Error(`RevMan 5.4 MD variance must be positive for '${study.studyId}'.`);
  return { studyId: study.studyId, theta, variance, corrected: false };
}

export function revMan54RandomEffectsMeanDifference(studies: RevMan54ContinuousStudy[]): RevMan54MetaAnalysisResult {
  if (studies.length === 0) throw new Error('RevMan 5.4 MD meta-analysis requires at least one study.');
  const effects = studies.map(validateContinuousStudy);
  const fixedWeights = effects.map((effect) => 1 / effect.variance);
  const sumW = fixedWeights.reduce((sum, value) => sum + value, 0);
  const fixedTheta = effects.reduce((sum, effect, index) => sum + (fixedWeights[index]! * effect.theta), 0) / sumW;
  const q = effects.reduce((sum, effect, index) => sum + (fixedWeights[index]! * ((effect.theta - fixedTheta) ** 2)), 0);
  const df = effects.length - 1;
  const tauSquared = dlTauSquared(q, effects);
  const pooled = randomSummary(effects, tauSquared);
  return {
    engine: REVMAN_54_COMPAT_VERSION,
    effectMeasure: 'MD',
    method: 'IV-DL-random',
    studyCount: effects.length,
    omittedStudyIds: [],
    correctedStudyIds: [],
    fixedEffect: fixedTheta,
    fixedEffectAnalysisScale: fixedTheta,
    q,
    df,
    tauSquared,
    iSquared: iSquared(q, df),
    pooledEffect: pooled.theta,
    pooledEffectAnalysisScale: pooled.theta,
    standardError: pooled.se,
    ciLower: pooled.theta - (Z_975 * pooled.se),
    ciUpper: pooled.theta + (Z_975 * pooled.se),
    studyEffects: effects.map((effect) => ({
      studyId: effect.studyId,
      effect: effect.theta,
      standardError: Math.sqrt(effect.variance),
      variance: effect.variance,
      corrected: false,
    })),
  };
}
