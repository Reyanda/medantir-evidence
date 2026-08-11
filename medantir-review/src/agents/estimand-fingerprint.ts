import { normaliseText, stableHash } from '../core/utils.js';
import type {
  CanonicalEstimand,
  EstimandDimension,
  EstimandSubgroup,
} from './estimand-identity.js';

function fingerprintDimension<T extends string>(value: EstimandDimension<T>): unknown {
  if (value.status === 'resolved') return { status: value.status, value: value.value };
  if (value.status === 'ambiguous') return { status: value.status, candidates: value.candidates };
  return { status: value.status };
}

function fingerprintSubgroup(value: EstimandDimension<EstimandSubgroup> & { label?: string }): unknown {
  if (value.status === 'resolved') {
    return {
      status: value.status,
      value: value.value,
      ...(value.value === 'subgroup' ? { label: value.label ? normaliseText(value.label) : null } : {}),
    };
  }
  if (value.status === 'ambiguous') return { status: value.status, candidates: value.candidates };
  return { status: value.status };
}

/**
 * Recompute the report-independent estimand identity after a human amendment.
 *
 * Source/report/family identifiers are deliberately excluded. Scientific target
 * dimensions, including target population and an explicit subgroup label, are
 * included. This mirrors canonical extraction exactly and is guarded by parity
 * tests so adjudication cannot introduce a second identity algorithm.
 */
export function recomputeCanonicalEstimandId(estimand: CanonicalEstimand): string {
  const identity = {
    outcome: normaliseText(estimand.outcome),
    effectMeasure: estimand.effectMeasure,
    analysisScale: estimand.analysisScale,
    interventionOrExposure: normaliseText(estimand.interventionOrExposure),
    comparator: normaliseText(estimand.comparator),
    population: normaliseText(estimand.population),
    timeHorizon: fingerprintDimension(estimand.timeHorizon),
    analysisPopulation: fingerprintDimension(estimand.analysisPopulation),
    subgroup: fingerprintSubgroup(estimand.subgroup),
    adjustment: fingerprintDimension(estimand.adjustment),
    effectTarget: fingerprintDimension(estimand.effectTarget),
  };
  return `estimand-${stableHash(identity).slice(0, 24)}`;
}
