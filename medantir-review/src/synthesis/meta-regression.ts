import type { AnalysisEstimate } from './inverse-variance.js';
import { studentTQuantile } from './random-effects.js';

export interface MetaRegressionEstimate extends AnalysisEstimate {
  moderators: Record<string, number>;
}

export interface MetaRegressionCoefficient {
  term: string;
  estimate: number;
  standardError: number;
  confidenceInterval: [number, number];
}

export interface MetaRegressionResult {
  model: 'mixed-effects-meta-regression';
  k: number;
  moderatorNames: string[];
  coefficientCount: number;
  tauSquared: number;
  residualQ: number;
  residualDegreesOfFreedom: number;
  coefficients: MetaRegressionCoefficient[];
  fittedValues: Array<{ studyId: string; fitted: number; residual: number }>;
  applicability: {
    studiesPerModerator: number;
    minimumStudiesPerModerator: number;
    criterionMet: boolean;
    exploratory: boolean;
    warnings: string[];
  };
}

const EPS = 1e-12;

function validate(estimates: MetaRegressionEstimate[], moderatorNames: string[]): void {
  if (moderatorNames.length === 0) throw new Error('Meta-regression requires at least one moderator');
  const p = moderatorNames.length + 1;
  if (estimates.length <= p) throw new Error(`Meta-regression requires more studies than coefficients (${p})`);
  const seen = new Set<string>();
  for (const estimate of estimates) {
    if (!estimate.studyId.trim() || seen.has(estimate.studyId)) throw new Error(`Duplicate or empty meta-regression studyId ${estimate.studyId}`);
    seen.add(estimate.studyId);
    if (!Number.isFinite(estimate.effect) || !(estimate.standardError > 0) || !Number.isFinite(estimate.standardError)) {
      throw new Error(`Invalid effect/standard error for ${estimate.studyId}`);
    }
    for (const name of moderatorNames) {
      if (!Object.prototype.hasOwnProperty.call(estimate.moderators, name) || !Number.isFinite(estimate.moderators[name])) {
        throw new Error(`Moderator ${name} is missing/non-finite for ${estimate.studyId}`);
      }
    }
  }
}

function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let value = matrix[i]![j]!;
      for (let k = 0; k < j; k += 1) value -= lower[i]![k]! * lower[j]![k]!;
      if (i === j) {
        if (!(value > 1e-14)) throw new Error('Meta-regression design matrix is singular or not full rank');
        lower[i]![j] = Math.sqrt(value);
      } else {
        lower[i]![j] = value / lower[j]![j]!;
      }
    }
  }
  return lower;
}

function solve(lower: number[][], b: number[]): number[] {
  const n = b.length;
  const y = Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let value = b[i]!;
    for (let j = 0; j < i; j += 1) value -= lower[i]![j]! * y[j]!;
    y[i] = value / lower[i]![i]!;
  }
  const x = Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let value = y[i]!;
    for (let j = i + 1; j < n; j += 1) value -= lower[j]![i]! * x[j]!;
    x[i] = value / lower[i]![i]!;
  }
  return x;
}

function inverseFromCholesky(lower: number[][]): number[][] {
  const n = lower.length;
  const inverse = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let column = 0; column < n; column += 1) {
    const unit = Array<number>(n).fill(0);
    unit[column] = 1;
    const solution = solve(lower, unit);
    for (let row = 0; row < n; row += 1) inverse[row]![column] = solution[row]!;
  }
  return inverse;
}

function logDetFromCholesky(lower: number[][]): number {
  return 2 * lower.reduce((total, row, index) => total + Math.log(row[index]!), 0);
}

function design(estimates: MetaRegressionEstimate[], moderatorNames: string[]): number[][] {
  return estimates.map((estimate) => [1, ...moderatorNames.map((name) => estimate.moderators[name]!) ]);
}

function fitAtTau(estimates: MetaRegressionEstimate[], moderatorNames: string[], tauSquared: number) {
  const x = design(estimates, moderatorNames);
  const y = estimates.map((estimate) => estimate.effect);
  const variances = estimates.map((estimate) => estimate.standardError ** 2 + tauSquared);
  const weights = variances.map((variance) => 1 / variance);
  const p = moderatorNames.length + 1;
  const xtwx = Array.from({ length: p }, () => Array<number>(p).fill(0));
  const xtwy = Array<number>(p).fill(0);
  for (let i = 0; i < estimates.length; i += 1) {
    for (let a = 0; a < p; a += 1) {
      xtwy[a] += x[i]![a]! * weights[i]! * y[i]!;
      for (let b = 0; b < p; b += 1) xtwx[a]![b] += x[i]![a]! * weights[i]! * x[i]![b]!;
    }
  }
  const lower = cholesky(xtwx);
  const beta = solve(lower, xtwy);
  const covariance = inverseFromCholesky(lower);
  const fitted = x.map((row) => row.reduce((total, value, index) => total + value * beta[index]!, 0));
  const residuals = y.map((value, index) => value - fitted[index]!);
  const residualQ = residuals.reduce((total, residual, index) => total + weights[index]! * residual ** 2, 0);
  const objective = variances.reduce((total, variance) => total + Math.log(variance), 0)
    + logDetFromCholesky(lower)
    + residualQ;
  return { beta, covariance, fitted, residuals, residualQ, objective };
}

function sampleVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
}

export function estimateMetaRegressionTauSquaredREML(estimates: MetaRegressionEstimate[], moderatorNames: string[]): number {
  validate(estimates, moderatorNames);
  const effects = estimates.map((estimate) => estimate.effect);
  const within = estimates.map((estimate) => estimate.standardError ** 2);
  const baseline = fitAtTau(estimates, moderatorNames, 0).objective;
  let right = Math.max(1e-8, sampleVariance(effects), Math.max(...within));
  let fRight = fitAtTau(estimates, moderatorNames, right).objective;
  for (let i = 0; i < 60; i += 1) {
    const next = right * 2;
    const fNext = fitAtTau(estimates, moderatorNames, next).objective;
    if (fNext >= fRight) break;
    right = next;
    fRight = fNext;
  }
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 0;
  let b = right * 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = fitAtTau(estimates, moderatorNames, c).objective;
  let fd = fitAtTau(estimates, moderatorNames, d).objective;
  for (let i = 0; i < 300; i += 1) {
    if (fc < fd) {
      b = d; d = c; fd = fc; c = b - phi * (b - a); fc = fitAtTau(estimates, moderatorNames, c).objective;
    } else {
      a = c; c = d; fc = fd; d = a + phi * (b - a); fd = fitAtTau(estimates, moderatorNames, d).objective;
    }
    if (Math.abs(b - a) <= 1e-11 * Math.max(1, b)) break;
  }
  const candidate = Math.max(0, (a + b) / 2);
  return baseline <= fitAtTau(estimates, moderatorNames, candidate).objective + EPS ? 0 : candidate;
}

export function analyseMetaRegression(
  estimates: MetaRegressionEstimate[],
  moderatorNames: string[],
  options: { confidenceLevel?: number; minimumStudiesPerModerator?: number } = {},
): MetaRegressionResult {
  validate(estimates, moderatorNames);
  const tauSquared = estimateMetaRegressionTauSquaredREML(estimates, moderatorNames);
  const fit = fitAtTau(estimates, moderatorNames, tauSquared);
  const df = estimates.length - moderatorNames.length - 1;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) throw new Error('Meta-regression confidenceLevel must be in (0,1)');
  const critical = studentTQuantile(1 - ((1 - confidenceLevel) / 2), df);
  const terms = ['intercept', ...moderatorNames];
  const coefficients = terms.map((term, index): MetaRegressionCoefficient => {
    const standardError = Math.sqrt(fit.covariance[index]![index]!);
    return {
      term,
      estimate: fit.beta[index]!,
      standardError,
      confidenceInterval: [fit.beta[index]! - critical * standardError, fit.beta[index]! + critical * standardError],
    };
  });
  const minimum = options.minimumStudiesPerModerator ?? 10;
  const studiesPerModerator = estimates.length / moderatorNames.length;
  const criterionMet = estimates.length >= minimum * moderatorNames.length;
  const warnings: string[] = [];
  if (!criterionMet) warnings.push(`Only ${estimates.length} studies for ${moderatorNames.length} moderator(s); prespecified stability criterion requires at least ${minimum} studies per moderator.`);
  if (tauSquared === 0) warnings.push('Residual tau² estimated at zero; moderator uncertainty should not be interpreted as proof of no residual heterogeneity.');
  return {
    model: 'mixed-effects-meta-regression',
    k: estimates.length,
    moderatorNames: [...moderatorNames],
    coefficientCount: coefficients.length,
    tauSquared,
    residualQ: fit.residualQ,
    residualDegreesOfFreedom: df,
    coefficients,
    fittedValues: estimates.map((estimate, index) => ({ studyId: estimate.studyId, fitted: fit.fitted[index]!, residual: fit.residuals[index]! })),
    applicability: {
      studiesPerModerator,
      minimumStudiesPerModerator: minimum,
      criterionMet,
      exploratory: !criterionMet,
      warnings,
    },
  };
}
