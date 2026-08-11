import type { AnalysisEstimate } from './inverse-variance.js';

export interface CorrelatedStudyEstimate extends AnalysisEstimate {
  contrastId: string;
}

export interface CorrelatedStudyBlock {
  studyId: string;
  estimates: CorrelatedStudyEstimate[];
  covariance: number[][];
  estimandCompatibilityReceipt: string;
}

export interface CollapsedStudyEstimate extends AnalysisEstimate {
  sourceContrastIds: string[];
  covarianceAware: true;
  withinStudyInformation: number;
}

function assertMatrix(matrix: number[][], size: number): void {
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) {
    throw new Error(`Covariance matrix must be ${size}x${size}`);
  }
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const value = matrix[i]![j]!;
      if (!Number.isFinite(value)) throw new Error('Covariance matrix contains a non-finite value');
      if (Math.abs(value - matrix[j]![i]!) > 1e-10 * Math.max(1, Math.abs(value))) {
        throw new Error('Covariance matrix must be symmetric');
      }
    }
    if (!(matrix[i]![i]! > 0)) throw new Error('Covariance matrix diagonal must be > 0');
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
        if (!(value > 1e-14)) throw new Error('Covariance matrix is not positive definite');
        lower[i]![j] = Math.sqrt(value);
      } else {
        lower[i]![j] = value / lower[j]![j]!;
      }
    }
  }
  return lower;
}

function solveCholesky(lower: number[][], vector: number[]): number[] {
  const n = vector.length;
  const y = Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let value = vector[i]!;
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

export function collapseCorrelatedStudyBlock(block: CorrelatedStudyBlock): CollapsedStudyEstimate {
  if (!block.studyId.trim()) throw new Error('Correlated study block requires studyId');
  if (!block.estimandCompatibilityReceipt.trim()) throw new Error('Covariance-aware collapse requires an estimand compatibility receipt');
  if (block.estimates.length < 2) throw new Error('Covariance-aware collapse requires at least two correlated estimates');
  if (block.estimates.some((estimate) => estimate.studyId !== block.studyId)) {
    throw new Error('Every estimate in a correlated block must have the block studyId');
  }
  const outcomes = new Set(block.estimates.map((estimate) => estimate.outcome));
  if (outcomes.size !== 1) throw new Error('Correlated estimates must target one outcome');
  const contrastIds = block.estimates.map((estimate) => estimate.contrastId);
  if (new Set(contrastIds).size !== contrastIds.length) throw new Error('Correlated contrast IDs must be unique');
  assertMatrix(block.covariance, block.estimates.length);

  for (let i = 0; i < block.estimates.length; i += 1) {
    const variance = block.estimates[i]!.standardError ** 2;
    if (Math.abs(block.covariance[i]![i]! - variance) > 1e-9 * Math.max(1, variance)) {
      throw new Error(`Covariance diagonal for ${block.estimates[i]!.contrastId} does not match squared standard error`);
    }
  }

  const lower = cholesky(block.covariance);
  const ones = Array<number>(block.estimates.length).fill(1);
  const effects = block.estimates.map((estimate) => estimate.effect);
  const inverseTimesOne = solveCholesky(lower, ones);
  const inverseTimesEffect = solveCholesky(lower, effects);
  const information = inverseTimesOne.reduce((total, value) => total + value, 0);
  if (!(information > 0)) throw new Error('Covariance-aware information must be > 0');
  const numerator = inverseTimesEffect.reduce((total, value) => total + value, 0);
  const effect = numerator / information;
  const variance = 1 / information;

  return {
    studyId: block.studyId,
    label: block.estimates[0]!.label,
    outcome: block.estimates[0]!.outcome,
    effect,
    standardError: Math.sqrt(variance),
    provenanceIds: [
      block.estimandCompatibilityReceipt,
      ...new Set(block.estimates.flatMap((estimate) => estimate.provenanceIds)),
    ],
    sourceContrastIds: contrastIds,
    covarianceAware: true,
    withinStudyInformation: information,
  };
}

export function sharedComparatorCovariance(input:
  | {
      measure: 'RR';
      comparatorEvents: number;
      comparatorTotal: number;
    }
  | {
      measure: 'OR';
      comparatorEvents: number;
      comparatorTotal: number;
    }
  | {
      measure: 'RD';
      comparatorEvents: number;
      comparatorTotal: number;
    }
  | {
      measure: 'MD';
      comparatorSd: number;
      comparatorN: number;
    }
): number {
  if (input.measure === 'MD') {
    if (!(input.comparatorSd > 0) || !Number.isFinite(input.comparatorSd)) throw new Error('comparatorSd must be > 0');
    if (!Number.isInteger(input.comparatorN) || input.comparatorN < 2) throw new Error('comparatorN must be an integer >= 2');
    return input.comparatorSd ** 2 / input.comparatorN;
  }
  if (!Number.isInteger(input.comparatorTotal) || input.comparatorTotal <= 0) throw new Error('comparatorTotal must be a positive integer');
  if (!Number.isInteger(input.comparatorEvents) || input.comparatorEvents < 0 || input.comparatorEvents > input.comparatorTotal) throw new Error('comparatorEvents are invalid');
  const c = input.comparatorEvents;
  const d = input.comparatorTotal - c;
  if (input.measure === 'RR') {
    if (c === 0) throw new Error('Shared-control log RR covariance is undefined with zero comparator events without an explicit corrected table');
    return (1 / c) - (1 / input.comparatorTotal);
  }
  if (input.measure === 'OR') {
    if (c === 0 || d === 0) throw new Error('Shared-control log OR covariance is undefined with a zero comparator cell without an explicit corrected table');
    return (1 / c) + (1 / d);
  }
  const p = c / input.comparatorTotal;
  return p * (1 - p) / input.comparatorTotal;
}

export function twoContrastSharedComparatorCovarianceMatrix(input: {
  firstVariance: number;
  secondVariance: number;
  sharedCovariance: number;
}): number[][] {
  if (!(input.firstVariance > 0) || !(input.secondVariance > 0)) throw new Error('Contrast variances must be > 0');
  if (!Number.isFinite(input.sharedCovariance) || input.sharedCovariance < 0) throw new Error('Shared covariance must be finite and >= 0');
  if (input.sharedCovariance >= Math.sqrt(input.firstVariance * input.secondVariance)) {
    throw new Error('Shared covariance implies a singular or invalid correlation');
  }
  return [
    [input.firstVariance, input.sharedCovariance],
    [input.sharedCovariance, input.secondVariance],
  ];
}
