import type { AnalysisEstimate } from './inverse-variance.js';

export type TauSquaredEstimator = 'REML' | 'PM' | 'DL';
export type SummaryConfidenceMethod = 'wald' | 'hksj';

export interface RandomEffectsOptions {
  tauEstimator?: TauSquaredEstimator;
  confidenceMethod?: SummaryConfidenceMethod;
  confidenceLevel?: number;
  predictionInterval?: boolean;
}

export interface RandomEffectsStudyContribution {
  studyId: string;
  label: string;
  effect: number;
  variance: number;
  randomWeight: number;
  normalizedWeight: number;
}

export interface RandomEffectsSummary {
  model: 'random-effects-inverse-variance';
  tauEstimator: TauSquaredEstimator;
  confidenceMethod: SummaryConfidenceMethod;
  confidenceLevel: number;
  k: number;
  pooledEffect: number;
  pooledStandardError: number;
  confidenceInterval: [number, number];
  tauSquared: number;
  tau: number;
  cochranQ: number;
  qDegreesOfFreedom: number;
  qBasedI2: number;
  typicalWithinStudyVariance: number;
  tauBasedI2: number;
  hksjVarianceScale?: number;
  predictionInterval?: [number, number];
  predictionDegreesOfFreedom?: number;
  contributions: RandomEffectsStudyContribution[];
  warnings: string[];
}

const EPS = 1e-12;
const MAX_ITER = 300;

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validate(estimates: AnalysisEstimate[]): void {
  if (estimates.length < 2) throw new Error('Random-effects meta-analysis requires at least two estimates');
  const seen = new Set<string>();
  for (const estimate of estimates) {
    assertFinite(`effect for ${estimate.studyId}`, estimate.effect);
    assertFinite(`standard error for ${estimate.studyId}`, estimate.standardError);
    if (!(estimate.standardError > 0)) throw new Error(`Standard error for ${estimate.studyId} must be > 0`);
    if (!estimate.studyId.trim()) throw new Error('Every meta-analysis estimate requires a studyId');
    if (seen.has(estimate.studyId)) {
      throw new Error(`Dependent/duplicate study estimate detected for ${estimate.studyId}; supply one independent estimate per study or use a dependence-aware synthesis engine`);
    }
    seen.add(estimate.studyId);
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function weightedMean(effects: number[], variances: number[], tauSquared: number): { mean: number; weights: number[]; sumWeights: number } {
  const weights = variances.map((variance) => 1 / (variance + tauSquared));
  const sumWeights = sum(weights);
  if (!(sumWeights > 0) || !Number.isFinite(sumWeights)) throw new Error('Invalid inverse-variance weight sum');
  const mean = effects.reduce((total, effect, index) => total + effect * weights[index]!, 0) / sumWeights;
  return { mean, weights, sumWeights };
}

function qAt(effects: number[], variances: number[], tauSquared: number): number {
  const weighted = weightedMean(effects, variances, tauSquared);
  return effects.reduce((total, effect, index) => total + weighted.weights[index]! * ((effect - weighted.mean) ** 2), 0);
}

function fixedHeterogeneity(effects: number[], variances: number[]) {
  const fixed = weightedMean(effects, variances, 0);
  const q = effects.reduce((total, effect, index) => total + fixed.weights[index]! * ((effect - fixed.mean) ** 2), 0);
  const df = effects.length - 1;
  const i2 = q <= 0 ? 0 : Math.max(0, ((q - df) / q) * 100);
  return { q, df, i2, weights: fixed.weights, sumWeights: fixed.sumWeights };
}

export function estimateTauSquaredDL(estimates: AnalysisEstimate[]): number {
  validate(estimates);
  const effects = estimates.map((estimate) => estimate.effect);
  const variances = estimates.map((estimate) => estimate.standardError ** 2);
  const heterogeneity = fixedHeterogeneity(effects, variances);
  const sumWeightSquares = sum(heterogeneity.weights.map((weight) => weight ** 2));
  const c = heterogeneity.sumWeights - (sumWeightSquares / heterogeneity.sumWeights);
  if (!(c > 0)) return 0;
  return Math.max(0, (heterogeneity.q - heterogeneity.df) / c);
}

export function estimateTauSquaredPM(estimates: AnalysisEstimate[]): number {
  validate(estimates);
  const effects = estimates.map((estimate) => estimate.effect);
  const variances = estimates.map((estimate) => estimate.standardError ** 2);
  const target = estimates.length - 1;
  if (qAt(effects, variances, 0) <= target) return 0;

  let low = 0;
  let high = Math.max(1e-8, estimateTauSquaredDL(estimates), sampleVariance(effects));
  for (let i = 0; i < 80 && qAt(effects, variances, high) > target; i += 1) high *= 2;
  if (qAt(effects, variances, high) > target) throw new Error('Paule-Mandel tau² root could not be bracketed');

  for (let i = 0; i < MAX_ITER; i += 1) {
    const mid = (low + high) / 2;
    const value = qAt(effects, variances, mid);
    if (Math.abs(value - target) <= 1e-12 * Math.max(1, target)) return Math.max(0, mid);
    if (value > target) low = mid;
    else high = mid;
    if (Math.abs(high - low) <= 1e-12 * Math.max(1, high)) break;
  }
  return Math.max(0, (low + high) / 2);
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = sum(values) / values.length;
  return values.reduce((total, value) => total + ((value - mean) ** 2), 0) / (values.length - 1);
}

function remlObjective(effects: number[], variances: number[], tauSquared: number): number {
  if (tauSquared < 0 || !Number.isFinite(tauSquared)) return Number.POSITIVE_INFINITY;
  const weighted = weightedMean(effects, variances, tauSquared);
  const q = effects.reduce((total, effect, index) => total + weighted.weights[index]! * ((effect - weighted.mean) ** 2), 0);
  return variances.reduce((total, variance) => total + Math.log(variance + tauSquared), 0)
    + Math.log(weighted.sumWeights)
    + q;
}

export function estimateTauSquaredREML(estimates: AnalysisEstimate[]): number {
  validate(estimates);
  const effects = estimates.map((estimate) => estimate.effect);
  const variances = estimates.map((estimate) => estimate.standardError ** 2);
  const baseline = remlObjective(effects, variances, 0);
  let right = Math.max(1e-8, estimateTauSquaredPM(estimates), sampleVariance(effects), Math.max(...variances));
  let fRight = remlObjective(effects, variances, right);
  for (let i = 0; i < 60; i += 1) {
    const next = right * 2;
    const fNext = remlObjective(effects, variances, next);
    if (fNext >= fRight) break;
    right = next;
    fRight = fNext;
  }

  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 0;
  let b = right * 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = remlObjective(effects, variances, c);
  let fd = remlObjective(effects, variances, d);
  for (let i = 0; i < MAX_ITER; i += 1) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = remlObjective(effects, variances, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = remlObjective(effects, variances, d);
    }
    if (Math.abs(b - a) <= 1e-11 * Math.max(1, b)) break;
  }
  const candidate = Math.max(0, (a + b) / 2);
  const candidateObjective = remlObjective(effects, variances, candidate);
  return baseline <= candidateObjective + EPS ? 0 : candidate;
}

function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.99999999999980993;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) x += coefficients[i]! / (shifted + i + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const fpMin = 1e-300;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x / qap);
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return bt * betaContinuedFraction(a, b, x) / a;
  return 1 - bt * betaContinuedFraction(b, a, 1 - x) / b;
}

export function studentTCdf(t: number, degreesOfFreedom: number): number {
  if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) throw new Error('Student-t degrees of freedom must be > 0');
  if (!Number.isFinite(t)) return t < 0 ? 0 : 1;
  if (t === 0) return 0.5;
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  const ib = regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

export function studentTQuantile(probability: number, degreesOfFreedom: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error('Student-t probability must be in (0,1)');
  if (probability === 0.5) return 0;
  if (probability < 0.5) return -studentTQuantile(1 - probability, degreesOfFreedom);
  let low = 0;
  let high = 1;
  while (studentTCdf(high, degreesOfFreedom) < probability) {
    high *= 2;
    if (high > 1e8) throw new Error('Student-t quantile could not be bracketed');
  }
  for (let i = 0; i < 250; i += 1) {
    const mid = (low + high) / 2;
    const cdf = studentTCdf(mid, degreesOfFreedom);
    if (Math.abs(cdf - probability) < 1e-13) return mid;
    if (cdf < probability) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function normalQuantile975(): number {
  return 1.959963984540054;
}

function criticalValue(level: number, method: SummaryConfidenceMethod, k: number): number {
  if (!(level > 0 && level < 1)) throw new Error('Confidence level must be in (0,1)');
  const probability = 1 - ((1 - level) / 2);
  if (Math.abs(level - 0.95) < 1e-14 && method === 'wald') return normalQuantile975();
  if (method === 'hksj') return studentTQuantile(probability, k - 1);
  // Normal inverse CDF is needed only for non-default confidence levels. Use the
  // t distribution with a very large df as a deterministic normal approximation.
  return studentTQuantile(probability, 1e7);
}

function tauSquared(estimates: AnalysisEstimate[], estimator: TauSquaredEstimator): number {
  if (estimator === 'DL') return estimateTauSquaredDL(estimates);
  if (estimator === 'PM') return estimateTauSquaredPM(estimates);
  return estimateTauSquaredREML(estimates);
}

export function analyseRandomEffects(
  estimates: AnalysisEstimate[],
  options: RandomEffectsOptions = {},
): RandomEffectsSummary {
  validate(estimates);
  const tauEstimator = options.tauEstimator ?? 'REML';
  const confidenceMethod = options.confidenceMethod ?? 'wald';
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const effects = estimates.map((estimate) => estimate.effect);
  const variances = estimates.map((estimate) => estimate.standardError ** 2);
  const tau2 = tauSquared(estimates, tauEstimator);
  const weighted = weightedMean(effects, variances, tau2);
  const fixed = fixedHeterogeneity(effects, variances);
  const k = estimates.length;
  const qRandom = effects.reduce((total, effect, index) => total + weighted.weights[index]! * ((effect - weighted.mean) ** 2), 0);
  const hksjScale = qRandom / (k - 1);
  const waldSe = Math.sqrt(1 / weighted.sumWeights);
  const pooledSe = confidenceMethod === 'hksj'
    ? Math.sqrt(hksjScale / weighted.sumWeights)
    : waldSe;
  const critical = criticalValue(confidenceLevel, confidenceMethod, k);
  const ci: [number, number] = [
    weighted.mean - critical * pooledSe,
    weighted.mean + critical * pooledSe,
  ];
  const typicalVarianceNumerator = (k - 1) * fixed.sumWeights;
  const typicalVarianceDenominator = (fixed.sumWeights ** 2) - sum(fixed.weights.map((weight) => weight ** 2));
  const typicalWithinStudyVariance = typicalVarianceDenominator > 0
    ? typicalVarianceNumerator / typicalVarianceDenominator
    : 0;
  const tauBasedI2 = tau2 <= 0 ? 0 : 100 * tau2 / (tau2 + typicalWithinStudyVariance);
  const warnings: string[] = [];
  if (confidenceMethod === 'hksj' && tau2 === 0) {
    warnings.push('HKSJ selected with tau²=0; the adjusted interval can be narrower than the Wald interval.');
  }
  if (confidenceMethod === 'hksj' && k <= 3) {
    warnings.push('HKSJ with two or three studies can yield very wide intervals; compare with the Wald method as a sensitivity analysis.');
  }
  if (k <= 3) warnings.push('Between-study heterogeneity is poorly estimated with very few studies.');

  let predictionInterval: [number, number] | undefined;
  let predictionDegreesOfFreedom: number | undefined;
  if (options.predictionInterval !== false) {
    if (k < 3) {
      warnings.push('Prediction interval withheld because fewer than three studies are available.');
    } else {
      const multiplier = confidenceMethod === 'hksj'
        ? studentTQuantile(1 - ((1 - confidenceLevel) / 2), k - 1)
        : criticalValue(confidenceLevel, 'wald', k);
      const spread = Math.sqrt(tau2 + pooledSe ** 2);
      predictionInterval = [weighted.mean - multiplier * spread, weighted.mean + multiplier * spread];
      predictionDegreesOfFreedom = confidenceMethod === 'hksj' ? k - 1 : Number.POSITIVE_INFINITY;
    }
  }

  const contributions = estimates.map((estimate, index): RandomEffectsStudyContribution => ({
    studyId: estimate.studyId,
    label: estimate.label,
    effect: estimate.effect,
    variance: variances[index]!,
    randomWeight: weighted.weights[index]!,
    normalizedWeight: weighted.weights[index]! / weighted.sumWeights,
  }));

  return {
    model: 'random-effects-inverse-variance',
    tauEstimator,
    confidenceMethod,
    confidenceLevel,
    k,
    pooledEffect: weighted.mean,
    pooledStandardError: pooledSe,
    confidenceInterval: ci,
    tauSquared: tau2,
    tau: Math.sqrt(tau2),
    cochranQ: fixed.q,
    qDegreesOfFreedom: fixed.df,
    qBasedI2: fixed.i2,
    typicalWithinStudyVariance,
    tauBasedI2,
    ...(confidenceMethod === 'hksj' ? { hksjVarianceScale: hksjScale } : {}),
    ...(predictionInterval ? { predictionInterval } : {}),
    ...(predictionDegreesOfFreedom !== undefined ? { predictionDegreesOfFreedom } : {}),
    contributions,
    warnings,
  };
}

export interface RandomEffectsSensitivitySet {
  primary: RandomEffectsSummary;
  sensitivity: RandomEffectsSummary[];
  methodAgreement: {
    pooledEffectRange: [number, number];
    tauSquaredRange: [number, number];
    confidenceIntervalsCrossNullDifferently: boolean;
  };
}

export function analyseRandomEffectsSensitivity(
  estimates: AnalysisEstimate[],
  input: { primaryTauEstimator?: TauSquaredEstimator; primaryConfidenceMethod?: SummaryConfidenceMethod } = {},
): RandomEffectsSensitivitySet {
  const primary = analyseRandomEffects(estimates, {
    tauEstimator: input.primaryTauEstimator ?? 'REML',
    confidenceMethod: input.primaryConfidenceMethod ?? 'wald',
    predictionInterval: true,
  });
  const configurations: Array<[TauSquaredEstimator, SummaryConfidenceMethod]> = [
    ['REML', 'wald'], ['REML', 'hksj'],
    ['PM', 'wald'], ['PM', 'hksj'],
    ['DL', 'wald'], ['DL', 'hksj'],
  ];
  const sensitivity = configurations
    .filter(([tau, ci]) => !(tau === primary.tauEstimator && ci === primary.confidenceMethod))
    .map(([tauEstimator, confidenceMethod]) => analyseRandomEffects(estimates, { tauEstimator, confidenceMethod, predictionInterval: true }));
  const all = [primary, ...sensitivity];
  const pooled = all.map((analysis) => analysis.pooledEffect);
  const taus = all.map((analysis) => analysis.tauSquared);
  const crosses = all.map((analysis) => analysis.confidenceInterval[0] <= 0 && analysis.confidenceInterval[1] >= 0);
  return {
    primary,
    sensitivity,
    methodAgreement: {
      pooledEffectRange: [Math.min(...pooled), Math.max(...pooled)],
      tauSquaredRange: [Math.min(...taus), Math.max(...taus)],
      confidenceIntervalsCrossNullDifferently: new Set(crosses).size > 1,
    },
  };
}
