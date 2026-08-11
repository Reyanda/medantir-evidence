export interface BinaryStudy2x2 {
  studyId: string;
  label: string;
  interventionEvents: number;
  interventionTotal: number;
  comparatorEvents: number;
  comparatorTotal: number;
  provenanceIds: string[];
}

export interface RareEventStudyDiagnostic {
  studyId: string;
  totalEvents: number;
  totalParticipants: number;
  eventRate: number;
  allocationRatio: number;
  singleZero: boolean;
  doubleZero: boolean;
}

export interface MantelHaenszelSummary {
  method: 'MH-RR' | 'MH-OR';
  kInput: number;
  kInformative: number;
  pooledLogEffect: number;
  pooledEffect: number;
  standardError: number;
  confidenceInterval: [number, number];
  diagnostics: RareEventStudyDiagnostic[];
  excludedDoubleZeroStudyIds: string[];
  warnings: string[];
}

export interface PetoSummary {
  method: 'Peto-OR';
  kInput: number;
  kInformative: number;
  pooledLogOddsRatio: number;
  pooledOddsRatio: number;
  standardError: number;
  confidenceInterval: [number, number];
  diagnostics: RareEventStudyDiagnostic[];
  excludedDoubleZeroStudyIds: string[];
  applicability: {
    maxObservedEventRate: number;
    maxAllocationImbalance: number;
    approximateEffectMagnitude: number;
    rareEventsCriterionMet: boolean;
    allocationBalanceCriterionMet: boolean;
    smallEffectCriterionMet: boolean;
    warnings: string[];
  };
}

const Z975 = 1.959963984540054;

function validate(studies: BinaryStudy2x2[]): void {
  if (studies.length === 0) throw new Error('Rare-event synthesis requires at least one study');
  const seen = new Set<string>();
  for (const study of studies) {
    if (!study.studyId.trim()) throw new Error('Binary study requires studyId');
    if (seen.has(study.studyId)) throw new Error(`Duplicate/dependent binary study ${study.studyId}`);
    seen.add(study.studyId);
    for (const [name, value] of [
      ['interventionEvents', study.interventionEvents], ['interventionTotal', study.interventionTotal],
      ['comparatorEvents', study.comparatorEvents], ['comparatorTotal', study.comparatorTotal],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`${study.studyId} ${name} must be a non-negative integer`);
    }
    if (study.interventionTotal <= 0 || study.comparatorTotal <= 0) throw new Error(`${study.studyId} arm totals must be > 0`);
    if (study.interventionEvents > study.interventionTotal || study.comparatorEvents > study.comparatorTotal) {
      throw new Error(`${study.studyId} event count exceeds arm total`);
    }
  }
}

function diagnostic(study: BinaryStudy2x2): RareEventStudyDiagnostic {
  const totalEvents = study.interventionEvents + study.comparatorEvents;
  const totalParticipants = study.interventionTotal + study.comparatorTotal;
  const doubleZero = study.interventionEvents === 0 && study.comparatorEvents === 0;
  const singleZero = !doubleZero && (study.interventionEvents === 0 || study.comparatorEvents === 0);
  const ratio = study.interventionTotal / study.comparatorTotal;
  return {
    studyId: study.studyId,
    totalEvents,
    totalParticipants,
    eventRate: totalEvents / totalParticipants,
    allocationRatio: ratio,
    singleZero,
    doubleZero,
  };
}

function informative(studies: BinaryStudy2x2[]) {
  const diagnostics = studies.map(diagnostic);
  const excludedDoubleZeroStudyIds = diagnostics.filter((item) => item.doubleZero).map((item) => item.studyId);
  return {
    diagnostics,
    excludedDoubleZeroStudyIds,
    studies: studies.filter((study) => !(study.interventionEvents === 0 && study.comparatorEvents === 0)),
  };
}

function ci(logEffect: number, standardError: number): [number, number] {
  return [Math.exp(logEffect - Z975 * standardError), Math.exp(logEffect + Z975 * standardError)];
}

export function mantelHaenszelRiskRatio(studies: BinaryStudy2x2[]): MantelHaenszelSummary {
  validate(studies);
  const filtered = informative(studies);
  if (filtered.studies.length === 0) throw new Error('MH risk ratio has no informative studies; all studies are double-zero');
  let r = 0;
  let s = 0;
  let varianceNumerator = 0;
  for (const study of filtered.studies) {
    const a = study.interventionEvents;
    const c = study.comparatorEvents;
    const n1 = study.interventionTotal;
    const n0 = study.comparatorTotal;
    const n = n1 + n0;
    const m = a + c;
    r += a * n0 / n;
    s += c * n1 / n;
    varianceNumerator += ((n1 * n0 * m) - (a * c * n)) / (n ** 2);
  }
  if (!(r > 0) || !(s > 0)) {
    throw new Error('MH risk ratio is undefined because the pooled numerator or denominator event information is zero');
  }
  const logEffect = Math.log(r / s);
  const variance = varianceNumerator / (r * s);
  if (!(variance > 0) || !Number.isFinite(variance)) throw new Error('MH risk-ratio variance is invalid');
  const standardError = Math.sqrt(variance);
  const warnings: string[] = [];
  if (filtered.excludedDoubleZeroStudyIds.length) {
    warnings.push(`${filtered.excludedDoubleZeroStudyIds.length} double-zero study/studies contribute no relative-effect information to MH RR but remain in the audit ledger.`);
  }
  return {
    method: 'MH-RR',
    kInput: studies.length,
    kInformative: filtered.studies.length,
    pooledLogEffect: logEffect,
    pooledEffect: Math.exp(logEffect),
    standardError,
    confidenceInterval: ci(logEffect, standardError),
    diagnostics: filtered.diagnostics,
    excludedDoubleZeroStudyIds: filtered.excludedDoubleZeroStudyIds,
    warnings,
  };
}

export function mantelHaenszelOddsRatio(studies: BinaryStudy2x2[]): MantelHaenszelSummary {
  validate(studies);
  const filtered = informative(studies);
  if (filtered.studies.length === 0) throw new Error('MH odds ratio has no informative studies; all studies are double-zero');
  let r = 0;
  let s = 0;
  let p = 0;
  let q = 0;
  let u = 0;
  for (const study of filtered.studies) {
    const a = study.interventionEvents;
    const b = study.interventionTotal - a;
    const c = study.comparatorEvents;
    const d = study.comparatorTotal - c;
    const n = a + b + c + d;
    const ad = a * d;
    const bc = b * c;
    r += ad / n;
    s += bc / n;
    p += ((a + d) * ad) / (n ** 2);
    q += (((a + d) * bc) + ((b + c) * ad)) / (n ** 2);
    u += ((b + c) * bc) / (n ** 2);
  }
  if (!(r > 0) || !(s > 0)) {
    throw new Error('MH odds ratio is undefined because the pooled cross-product numerator or denominator is zero');
  }
  const logEffect = Math.log(r / s);
  const variance = (p / (2 * r * r)) + (q / (2 * r * s)) + (u / (2 * s * s));
  if (!(variance > 0) || !Number.isFinite(variance)) throw new Error('MH odds-ratio variance is invalid');
  const standardError = Math.sqrt(variance);
  const warnings: string[] = [];
  if (filtered.excludedDoubleZeroStudyIds.length) warnings.push(`${filtered.excludedDoubleZeroStudyIds.length} double-zero study/studies contribute no relative-effect information to MH OR.`);
  return {
    method: 'MH-OR',
    kInput: studies.length,
    kInformative: filtered.studies.length,
    pooledLogEffect: logEffect,
    pooledEffect: Math.exp(logEffect),
    standardError,
    confidenceInterval: ci(logEffect, standardError),
    diagnostics: filtered.diagnostics,
    excludedDoubleZeroStudyIds: filtered.excludedDoubleZeroStudyIds,
    warnings,
  };
}

export function petoOddsRatio(
  studies: BinaryStudy2x2[],
  options: { maxEventRate?: number; maxAllocationRatio?: number; maxAbsLogOr?: number } = {},
): PetoSummary {
  validate(studies);
  const filtered = informative(studies);
  if (filtered.studies.length === 0) throw new Error('Peto OR has no informative studies; all studies are double-zero');
  let oe = 0;
  let varianceSum = 0;
  for (const study of filtered.studies) {
    const a = study.interventionEvents;
    const c = study.comparatorEvents;
    const n1 = study.interventionTotal;
    const n0 = study.comparatorTotal;
    const n = n1 + n0;
    const m = a + c;
    const nonEvents = n - m;
    const expected = n1 * m / n;
    const variance = n > 1 ? (n1 * n0 * m * nonEvents) / ((n ** 2) * (n - 1)) : 0;
    oe += a - expected;
    varianceSum += variance;
  }
  if (!(varianceSum > 0)) throw new Error('Peto OR total information is zero');
  const logOr = oe / varianceSum;
  const standardError = Math.sqrt(1 / varianceSum);
  const maxEventRate = Math.max(...filtered.diagnostics.map((item) => item.eventRate));
  const maxAllocationImbalance = Math.max(...filtered.diagnostics.map((item) => Math.max(item.allocationRatio, 1 / item.allocationRatio)));
  const rareThreshold = options.maxEventRate ?? 0.10;
  const balanceThreshold = options.maxAllocationRatio ?? 2;
  const effectThreshold = options.maxAbsLogOr ?? Math.log(2);
  const rareEventsCriterionMet = maxEventRate <= rareThreshold;
  const allocationBalanceCriterionMet = maxAllocationImbalance <= balanceThreshold;
  const smallEffectCriterionMet = Math.abs(logOr) <= effectThreshold;
  const applicabilityWarnings: string[] = [];
  if (!rareEventsCriterionMet) applicabilityWarnings.push(`Observed event rate ${maxEventRate.toFixed(3)} exceeds the prespecified Peto rare-event threshold ${rareThreshold}.`);
  if (!allocationBalanceCriterionMet) applicabilityWarnings.push(`Allocation imbalance ${maxAllocationImbalance.toFixed(2)} exceeds the prespecified Peto ratio threshold ${balanceThreshold}.`);
  if (!smallEffectCriterionMet) applicabilityWarnings.push(`Approximate |log OR|=${Math.abs(logOr).toFixed(3)} exceeds the prespecified small-effect threshold ${effectThreshold.toFixed(3)}.`);
  if (filtered.excludedDoubleZeroStudyIds.length) applicabilityWarnings.push(`${filtered.excludedDoubleZeroStudyIds.length} double-zero study/studies contribute no Peto information.`);
  return {
    method: 'Peto-OR',
    kInput: studies.length,
    kInformative: filtered.studies.length,
    pooledLogOddsRatio: logOr,
    pooledOddsRatio: Math.exp(logOr),
    standardError,
    confidenceInterval: ci(logOr, standardError),
    diagnostics: filtered.diagnostics,
    excludedDoubleZeroStudyIds: filtered.excludedDoubleZeroStudyIds,
    applicability: {
      maxObservedEventRate: maxEventRate,
      maxAllocationImbalance,
      approximateEffectMagnitude: Math.abs(logOr),
      rareEventsCriterionMet,
      allocationBalanceCriterionMet,
      smallEffectCriterionMet,
      warnings: applicabilityWarnings,
    },
  };
}
