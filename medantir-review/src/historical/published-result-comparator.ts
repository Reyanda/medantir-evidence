import type { RevMan54MetaAnalysisResult } from './revman-5.4-compat.js';

export interface HistoricalPublishedResultTarget {
  outcome: string;
  studies?: number;
  participants?: number;
  measure: 'RR' | 'MD';
  estimate: number;
  ciLower: number;
  ciUpper: number;
  i2?: number;
  model?: string;
}

export interface HistoricalReproducedResult {
  outcome: string;
  studies: number;
  participants?: number;
  measure: 'RR' | 'MD';
  estimate: number;
  ciLower: number;
  ciUpper: number;
  i2: number;
  model: string;
  analysisEngine: string;
}

export interface HistoricalResultDifference {
  field: 'outcome' | 'measure' | 'studies' | 'participants' | 'estimate' | 'ciLower' | 'ciUpper' | 'i2' | 'model';
  expected: string | number;
  actual: string | number | undefined;
  absoluteDifference?: number;
  tolerance?: number;
}

export interface HistoricalResultComparison {
  outcome: string;
  exactWithinTolerance: boolean;
  differences: HistoricalResultDifference[];
  firstDifference?: HistoricalResultDifference;
}

export interface HistoricalResultComparisonPolicy {
  effectAbsoluteTolerance: number;
  i2AbsoluteTolerance: number;
  requireStudyCount: boolean;
  requireParticipantCount: boolean;
  requireModel: boolean;
}

export const DEFAULT_HISTORICAL_RESULT_COMPARISON_POLICY: HistoricalResultComparisonPolicy = {
  // Historical papers commonly print pooled effects/CIs to two decimals and I2
  // to whole percentages. These are publication-rounding tolerances, not
  // internal algorithm tolerances. Internal RevMan compatibility tests remain
  // at 1e-12.
  effectAbsoluteTolerance: 0.0050000001,
  i2AbsoluteTolerance: 0.5000001,
  requireStudyCount: true,
  requireParticipantCount: true,
  requireModel: true,
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function numericDifference(
  field: HistoricalResultDifference['field'],
  expected: number,
  actual: number,
  tolerance: number,
): HistoricalResultDifference | null {
  const absoluteDifference = Math.abs(actual - expected);
  if (absoluteDifference <= tolerance) return null;
  return { field, expected, actual, absoluteDifference, tolerance };
}

export function compareHistoricalPublishedResult(
  target: HistoricalPublishedResultTarget,
  actual: HistoricalReproducedResult,
  policy: HistoricalResultComparisonPolicy = DEFAULT_HISTORICAL_RESULT_COMPARISON_POLICY,
): HistoricalResultComparison {
  const differences: HistoricalResultDifference[] = [];
  if (normalized(target.outcome) !== normalized(actual.outcome)) {
    differences.push({ field: 'outcome', expected: target.outcome, actual: actual.outcome });
  }
  if (target.measure !== actual.measure) differences.push({ field: 'measure', expected: target.measure, actual: actual.measure });
  if (policy.requireStudyCount && target.studies !== undefined && target.studies !== actual.studies) {
    differences.push({ field: 'studies', expected: target.studies, actual: actual.studies });
  }
  if (policy.requireParticipantCount && target.participants !== undefined && target.participants !== actual.participants) {
    differences.push({ field: 'participants', expected: target.participants, actual: actual.participants });
  }
  const estimate = numericDifference('estimate', target.estimate, actual.estimate, policy.effectAbsoluteTolerance);
  if (estimate) differences.push(estimate);
  const ciLower = numericDifference('ciLower', target.ciLower, actual.ciLower, policy.effectAbsoluteTolerance);
  if (ciLower) differences.push(ciLower);
  const ciUpper = numericDifference('ciUpper', target.ciUpper, actual.ciUpper, policy.effectAbsoluteTolerance);
  if (ciUpper) differences.push(ciUpper);
  if (target.i2 !== undefined) {
    const i2 = numericDifference('i2', target.i2, actual.i2, policy.i2AbsoluteTolerance);
    if (i2) differences.push(i2);
  }
  if (policy.requireModel && target.model && normalized(target.model) !== normalized(actual.model)) {
    differences.push({ field: 'model', expected: target.model, actual: actual.model });
  }
  return {
    outcome: target.outcome,
    exactWithinTolerance: differences.length === 0,
    differences,
    ...(differences[0] ? { firstDifference: differences[0] } : {}),
  };
}

export function reproducedResultFromRevMan54(input: {
  outcome: string;
  participants?: number;
  result: RevMan54MetaAnalysisResult;
}): HistoricalReproducedResult {
  return {
    outcome: input.outcome,
    studies: input.result.studyCount,
    ...(input.participants !== undefined ? { participants: input.participants } : {}),
    measure: input.result.effectMeasure,
    estimate: input.result.pooledEffect,
    ciLower: input.result.ciLower,
    ciUpper: input.result.ciUpper,
    i2: input.result.iSquared,
    model: 'random effects',
    analysisEngine: input.result.engine,
  };
}

export function compareHistoricalResultSet(input: {
  targets: HistoricalPublishedResultTarget[];
  actual: HistoricalReproducedResult[];
  policy?: HistoricalResultComparisonPolicy;
}): {
  allExactWithinTolerance: boolean;
  comparisons: HistoricalResultComparison[];
  missingOutcomes: string[];
  unexpectedOutcomes: string[];
} {
  const actualByOutcome = new Map(input.actual.map((result) => [normalized(result.outcome), result]));
  const targetNames = new Set(input.targets.map((target) => normalized(target.outcome)));
  const comparisons: HistoricalResultComparison[] = [];
  const missingOutcomes: string[] = [];
  for (const target of input.targets) {
    const result = actualByOutcome.get(normalized(target.outcome));
    if (!result) {
      missingOutcomes.push(target.outcome);
      continue;
    }
    comparisons.push(compareHistoricalPublishedResult(target, result, input.policy));
  }
  const unexpectedOutcomes = input.actual
    .filter((result) => !targetNames.has(normalized(result.outcome)))
    .map((result) => result.outcome);
  return {
    allExactWithinTolerance: missingOutcomes.length === 0
      && unexpectedOutcomes.length === 0
      && comparisons.every((comparison) => comparison.exactWithinTolerance),
    comparisons,
    missingOutcomes,
    unexpectedOutcomes,
  };
}
