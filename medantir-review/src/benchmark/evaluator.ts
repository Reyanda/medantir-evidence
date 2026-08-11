import type {
  BenchmarkEvaluation,
  BenchmarkMode,
  BenchmarkObservation,
  BenchmarkTarget,
  DiscrepancyClass,
  DiscrepancyEvidence,
  BenchmarkMetricResult,
} from './types.js';

function formatExpected(target: BenchmarkTarget): string {
  if (target.kind === 'minimum') return `>= ${target.minimum}`;
  if (target.kind === 'numeric-tolerance') {
    const relative = target.relativeTolerance === undefined ? '' : ` or ${target.relativeTolerance * 100}% relative`;
    return `${target.expected} ± ${target.absoluteTolerance}${relative}`;
  }
  if (target.kind === 'exact') return String(target.expected);
  return `recall >= ${target.minimumRecall}${target.minimumPrecision === undefined ? '' : `; precision >= ${target.minimumPrecision}`}`;
}

function setMetrics(referenceIds: string[], recoveredIds: string[]): { recall: number; precision: number; f1: number } {
  const reference = new Set(referenceIds);
  const recovered = new Set(recoveredIds);
  const truePositive = [...recovered].filter((id) => reference.has(id)).length;
  const recall = reference.size === 0 ? 1 : truePositive / reference.size;
  const precision = recovered.size === 0 ? (reference.size === 0 ? 1 : 0) : truePositive / recovered.size;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { recall, precision, f1 };
}

function evaluateOne(target: BenchmarkTarget, observation: BenchmarkObservation | undefined): BenchmarkMetricResult {
  const base = {
    targetId: target.id,
    stage: target.stage,
    metric: target.metric,
    expected: formatExpected(target),
    evidence: observation?.evidence ?? [],
  };
  if (!observation) {
    return { ...base, status: 'missing', message: 'No benchmark observation was supplied.' };
  }

  if (target.kind === 'set-recovery') {
    const metrics = setMetrics(target.referenceIds, observation.recoveredIds ?? []);
    const precisionPass = target.minimumPrecision === undefined || metrics.precision >= target.minimumPrecision;
    const pass = metrics.recall >= target.minimumRecall && precisionPass;
    return {
      ...base,
      status: pass ? 'pass' : 'fail',
      observed: metrics.recall,
      score: metrics.f1,
      message: `Recall=${metrics.recall.toFixed(4)}, precision=${metrics.precision.toFixed(4)}, F1=${metrics.f1.toFixed(4)}.`,
    };
  }

  if (target.kind === 'minimum') {
    const value = typeof observation.value === 'number' ? observation.value : Number.NaN;
    const pass = Number.isFinite(value) && value >= target.minimum;
    const result: BenchmarkMetricResult = {
      ...base,
      status: pass ? 'pass' : 'fail',
      message: pass ? 'Minimum threshold met.' : 'Minimum threshold not met.',
    };
    if (observation.value !== undefined) result.observed = observation.value;
    if (Number.isFinite(value)) result.score = value;
    return result;
  }

  if (target.kind === 'numeric-tolerance') {
    const value = typeof observation.value === 'number' ? observation.value : Number.NaN;
    const absoluteDifference = Math.abs(value - target.expected);
    const relativeDifference = target.expected === 0 ? absoluteDifference : absoluteDifference / Math.abs(target.expected);
    const pass = Number.isFinite(value) && (
      absoluteDifference <= target.absoluteTolerance
      || (target.relativeTolerance !== undefined && relativeDifference <= target.relativeTolerance)
    );
    const result: BenchmarkMetricResult = {
      ...base,
      status: pass ? 'pass' : 'fail',
      message: pass
        ? `Estimate reproduced within tolerance; absolute difference=${absoluteDifference}.`
        : `Estimate differs beyond tolerance; absolute difference=${absoluteDifference}, relative difference=${relativeDifference}.`,
    };
    if (observation.value !== undefined) result.observed = observation.value;
    if (Number.isFinite(value)) result.score = absoluteDifference;
    return result;
  }

  const pass = observation.value === target.expected;
  const result: BenchmarkMetricResult = {
    ...base,
    status: pass ? 'pass' : 'fail',
    message: pass ? 'Exact target reproduced.' : 'Observed value does not exactly match the reference.',
  };
  if (observation.value !== undefined) result.observed = observation.value;
  return result;
}

export function classifyDiscrepancy(evidence: DiscrepancyEvidence): DiscrepancyClass {
  if (evidence.withinTolerance) return evidence.frozenSnapshot ? 'exact-match' : 'acceptable-tolerance';
  if (evidence.pipelineUnitFailure && evidence.sourceLevelProof) return 'pipeline-defect';
  if (
    evidence.sourceLevelProof
    && evidence.reproducedAcrossIndependentRuns
    && evidence.humanAdjudicated
    && !evidence.pipelineUnitFailure
  ) return 'candidate-source-review-error';
  if (!evidence.frozenSnapshot && evidence.databaseOrIndexChanged) return 'database-drift';
  if (evidence.publicationVersionChanged) return 'publication-version-drift';
  if (evidence.prespecifiedMethodDifference) return 'methodological-discretion';
  return 'unresolved';
}

export function evaluateBenchmark(input: {
  benchmarkId: string;
  mode: BenchmarkMode;
  targets: BenchmarkTarget[];
  observations: BenchmarkObservation[];
  discrepancyEvidence: DiscrepancyEvidence;
}): BenchmarkEvaluation {
  const observations = new Map(input.observations.map((observation) => [observation.targetId, observation]));
  const results = input.targets.map((target) => evaluateOne(target, observations.get(target.id)));
  const requiredTargets = input.targets.filter((target) => target.required);
  const requiredPassed = requiredTargets.filter((target) => results.find((result) => result.targetId === target.id)?.status === 'pass').length;
  return {
    benchmarkId: input.benchmarkId,
    mode: input.mode,
    passed: requiredPassed === requiredTargets.length,
    requiredPassed,
    requiredTotal: requiredTargets.length,
    results,
    discrepancyClass: classifyDiscrepancy(input.discrepancyEvidence),
  };
}

export function screeningMetrics(referenceIncludedIds: string[], predictedIncludedIds: string[], totalScreened: number): {
  recall: number;
  precision: number;
  f1: number;
  workSavedOverSampling95: number;
} {
  const metrics = setMetrics(referenceIncludedIds, predictedIncludedIds);
  const screenedByModel = predictedIncludedIds.length;
  const workSaved = totalScreened <= 0 ? 0 : 1 - screenedByModel / totalScreened;
  return { ...metrics, workSavedOverSampling95: Math.max(-1, Math.min(1, workSaved)) };
}
