import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_SCREENING_SAFETY_SCHEMA_VERSION = 'medantir-sr-screening-safety/1' as const;

export interface SrScreeningConfusionMatrix {
  truePositive: number;
  falseNegative: number;
  trueNegative: number;
  falsePositive: number;
}

export interface SrScreeningSafetyPolicy {
  policyId: string;
  policyVersion: string;
  minObservedSensitivity: number;
  minSensitivityLower95: number;
  maxObservedFalseNegativeRate: number;
  maxConservativeMissedPer1000: number;
}

export interface SrScreeningSafetyReport {
  schemaVersion: typeof SR_SCREENING_SAFETY_SCHEMA_VERSION;
  policy: SrScreeningSafetyPolicy;
  confusion: SrScreeningConfusionMatrix;
  validationSampleSize: number;
  validationPositiveCount: number;
  validationNegativeCount: number;
  observedPrevalence: number;
  observedSensitivity: number;
  observedSpecificity: number;
  observedPrecision: number;
  observedFalseNegativeRate: number;
  sensitivityWilson95: { lower: number; upper: number };
  prevalenceWilson95: { lower: number; upper: number };
  observedMissedPer1000Candidates: number;
  conservativeMissedPer1000Candidates: number;
  projectedCorpusSize?: number;
  projectedMissedObserved?: number;
  projectedMissedConservative?: number;
  gatePassed: boolean;
  failures: string[];
  reportHash: string;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function probability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return value;
}

/** Wilson score interval for a binomial proportion, z=1.959963984540054 for 95%. */
export function wilson95(successes: number, total: number): { lower: number; upper: number } {
  nonNegativeInteger(successes, 'Wilson successes');
  nonNegativeInteger(total, 'Wilson total');
  if (successes > total) throw new Error('Wilson successes cannot exceed total.');
  if (total === 0) throw new Error('Wilson interval requires a positive denominator.');
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = successes / total;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

export function defaultHighRecallScreeningPolicy(): SrScreeningSafetyPolicy {
  return {
    policyId: 'MEDANTIR-SCREENING-HIGH-RECALL',
    policyVersion: '1.0.0',
    minObservedSensitivity: 0.95,
    minSensitivityLower95: 0.90,
    maxObservedFalseNegativeRate: 0.05,
    maxConservativeMissedPer1000: 50,
  };
}

function normalizePolicy(policy: SrScreeningSafetyPolicy): SrScreeningSafetyPolicy {
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('Screening safety policy requires stable ID/version.');
  return {
    policyId: policy.policyId.trim(),
    policyVersion: policy.policyVersion.trim(),
    minObservedSensitivity: probability(policy.minObservedSensitivity, 'minObservedSensitivity'),
    minSensitivityLower95: probability(policy.minSensitivityLower95, 'minSensitivityLower95'),
    maxObservedFalseNegativeRate: probability(policy.maxObservedFalseNegativeRate, 'maxObservedFalseNegativeRate'),
    maxConservativeMissedPer1000: nonNegative(policy.maxConservativeMissedPer1000, 'maxConservativeMissedPer1000'),
  };
}

export function createSrScreeningSafetyReport(input: {
  confusion: SrScreeningConfusionMatrix;
  policy?: SrScreeningSafetyPolicy;
  projectedCorpusSize?: number;
}): SrScreeningSafetyReport {
  const confusion: SrScreeningConfusionMatrix = {
    truePositive: nonNegativeInteger(input.confusion.truePositive, 'truePositive'),
    falseNegative: nonNegativeInteger(input.confusion.falseNegative, 'falseNegative'),
    trueNegative: nonNegativeInteger(input.confusion.trueNegative, 'trueNegative'),
    falsePositive: nonNegativeInteger(input.confusion.falsePositive, 'falsePositive'),
  };
  const policy = normalizePolicy(input.policy ?? defaultHighRecallScreeningPolicy());
  const validationPositiveCount = confusion.truePositive + confusion.falseNegative;
  const validationNegativeCount = confusion.trueNegative + confusion.falsePositive;
  const validationSampleSize = validationPositiveCount + validationNegativeCount;
  if (validationSampleSize === 0) throw new Error('Screening safety report requires at least one validation record.');
  if (validationPositiveCount === 0) throw new Error('Screening safety report requires at least one gold-positive validation record.');
  if (validationNegativeCount === 0) throw new Error('Screening safety report requires at least one gold-negative validation record.');

  let projectedCorpusSize: number | undefined;
  if (input.projectedCorpusSize !== undefined) {
    projectedCorpusSize = nonNegativeInteger(input.projectedCorpusSize, 'projectedCorpusSize');
  }

  const observedPrevalence = validationPositiveCount / validationSampleSize;
  const observedSensitivity = confusion.truePositive / validationPositiveCount;
  const observedSpecificity = confusion.trueNegative / validationNegativeCount;
  const observedPrecision = confusion.truePositive + confusion.falsePositive > 0
    ? confusion.truePositive / (confusion.truePositive + confusion.falsePositive)
    : 0;
  const observedFalseNegativeRate = confusion.falseNegative / validationPositiveCount;
  const sensitivityWilson95 = wilson95(confusion.truePositive, validationPositiveCount);
  const prevalenceWilson95 = wilson95(validationPositiveCount, validationSampleSize);

  // Observed misses per 1000 random candidate records are simply FN / n * 1000.
  const observedMissedPer1000Candidates = 1000 * confusion.falseNegative / validationSampleSize;
  // Conservative burden combines the upper 95% prevalence bound with the lower 95% sensitivity bound.
  // This intentionally errs toward overestimating missed eligible studies rather than understating review risk.
  const conservativeMissedPer1000Candidates = 1000 * prevalenceWilson95.upper * (1 - sensitivityWilson95.lower);
  const projectedMissedObserved = projectedCorpusSize === undefined
    ? undefined
    : projectedCorpusSize * observedMissedPer1000Candidates / 1000;
  const projectedMissedConservative = projectedCorpusSize === undefined
    ? undefined
    : projectedCorpusSize * conservativeMissedPer1000Candidates / 1000;

  const failures: string[] = [];
  if (observedSensitivity < policy.minObservedSensitivity) {
    failures.push(`Observed sensitivity ${(observedSensitivity * 100).toFixed(2)}% is below policy minimum ${(policy.minObservedSensitivity * 100).toFixed(2)}%.`);
  }
  if (sensitivityWilson95.lower < policy.minSensitivityLower95) {
    failures.push(`Sensitivity 95% lower bound ${(sensitivityWilson95.lower * 100).toFixed(2)}% is below policy minimum ${(policy.minSensitivityLower95 * 100).toFixed(2)}%.`);
  }
  if (observedFalseNegativeRate > policy.maxObservedFalseNegativeRate) {
    failures.push(`Observed false-negative rate ${(observedFalseNegativeRate * 100).toFixed(2)}% exceeds policy maximum ${(policy.maxObservedFalseNegativeRate * 100).toFixed(2)}%.`);
  }
  if (conservativeMissedPer1000Candidates > policy.maxConservativeMissedPer1000) {
    failures.push(`Conservative missed-study burden ${conservativeMissedPer1000Candidates.toFixed(2)} per 1000 candidates exceeds policy maximum ${policy.maxConservativeMissedPer1000.toFixed(2)}.`);
  }

  const base = {
    schemaVersion: SR_SCREENING_SAFETY_SCHEMA_VERSION,
    policy,
    confusion,
    validationSampleSize,
    validationPositiveCount,
    validationNegativeCount,
    observedPrevalence,
    observedSensitivity,
    observedSpecificity,
    observedPrecision,
    observedFalseNegativeRate,
    sensitivityWilson95,
    prevalenceWilson95,
    observedMissedPer1000Candidates,
    conservativeMissedPer1000Candidates,
    ...(projectedCorpusSize !== undefined ? { projectedCorpusSize } : {}),
    ...(projectedMissedObserved !== undefined ? { projectedMissedObserved } : {}),
    ...(projectedMissedConservative !== undefined ? { projectedMissedConservative } : {}),
    gatePassed: failures.length === 0,
    failures,
  };
  return { ...base, reportHash: scientificContentHash(base) };
}
