export interface AnalysisEstimate {
  studyId: string;
  label: string;
  outcome: string;
  effect: number;
  standardError: number;
  provenanceIds?: string[];
}

export interface AnalysedEstimate extends AnalysisEstimate {
  ciLow: number;
  ciHigh: number;
  rawWeight: number;
  weightPercent: number;
}

export interface InverseVarianceSummary {
  method: 'common-effect-inverse-variance';
  confidenceLevel: 0.95;
  outcome: string;
  k: number;
  rows: AnalysedEstimate[];
  pooledEffect: number;
  pooledStandardError: number;
  ciLow: number;
  ciHigh: number;
  q: number;
  i2: number;
  totalWeight: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

/**
 * Single source of truth for the common-effect inverse-variance calculation
 * used by synthesis and scientific figures. The renderer never recomputes a
 * different statistical model from the values shown in the table.
 */
export function analyseInverseVariance(
  estimates: AnalysisEstimate[],
  outcome: string,
): InverseVarianceSummary {
  if (estimates.length === 0) throw new Error(`No numeric estimates available for outcome '${outcome}'`);
  for (const estimate of estimates) {
    finite(estimate.effect, `${estimate.studyId} effect`);
    finite(estimate.standardError, `${estimate.studyId} standard error`);
    if (estimate.standardError <= 0) throw new Error(`${estimate.studyId} standard error must be > 0`);
  }

  const rawWeights = estimates.map((estimate) => 1 / (estimate.standardError ** 2));
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0) || !Number.isFinite(totalWeight)) throw new Error('Inverse-variance total weight is invalid');

  const pooledEffect = estimates.reduce(
    (sum, estimate, index) => sum + estimate.effect * (rawWeights[index] ?? 0),
    0,
  ) / totalWeight;
  const pooledStandardError = Math.sqrt(1 / totalWeight);
  const z = 1.959963984540054;
  const q = estimates.reduce(
    (sum, estimate, index) => sum + (rawWeights[index] ?? 0) * ((estimate.effect - pooledEffect) ** 2),
    0,
  );
  const degreesOfFreedom = Math.max(0, estimates.length - 1);
  const i2 = q <= 0 || degreesOfFreedom === 0
    ? 0
    : Math.max(0, Math.min(100, ((q - degreesOfFreedom) / q) * 100));

  const rows: AnalysedEstimate[] = estimates.map((estimate, index) => {
    const rawWeight = rawWeights[index]!;
    return {
      ...estimate,
      ciLow: estimate.effect - z * estimate.standardError,
      ciHigh: estimate.effect + z * estimate.standardError,
      rawWeight,
      weightPercent: (rawWeight / totalWeight) * 100,
    };
  });

  return {
    method: 'common-effect-inverse-variance',
    confidenceLevel: 0.95,
    outcome,
    k: rows.length,
    rows,
    pooledEffect,
    pooledStandardError,
    ciLow: pooledEffect - z * pooledStandardError,
    ciHigh: pooledEffect + z * pooledStandardError,
    q,
    i2,
    totalWeight,
  };
}

export function groupAnalysisEstimatesByOutcome(estimates: AnalysisEstimate[]): Map<string, AnalysisEstimate[]> {
  const groups = new Map<string, AnalysisEstimate[]>();
  for (const estimate of estimates) {
    const key = estimate.outcome.trim() || 'Primary outcome';
    const values = groups.get(key) ?? [];
    values.push(estimate);
    groups.set(key, values);
  }
  return groups;
}
