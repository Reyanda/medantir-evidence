import type { TrialRegistryMetadata } from '../core/trial-registry-metadata.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { ReviewSpec } from '../question/review-spec.js';
import type { RegistryEligibilityStatus } from './publication-bias-universe.js';

export type RegistryEligibilityFacetStatus = 'matched' | 'contradicted' | 'unresolved';

export interface RegistryEligibilityFacet {
  facet: 'design' | 'population' | 'intervention' | 'comparator' | 'outcome';
  status: RegistryEligibilityFacetStatus;
  target: string | string[];
  observed: string[];
  rationale: string;
}

export interface RegistrySourceEligibilityAssessment {
  version: 1;
  eligibilityStatus: RegistryEligibilityStatus;
  facets: RegistryEligibilityFacet[];
  exactMatchCount: number;
  contradictedFacets: string[];
  unresolvedFacets: string[];
  evidenceIds: string[];
  assessmentHash: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function exact(target: string, values: string[]): boolean {
  const wanted = normaliseText(target);
  return Boolean(wanted) && values.some((value) => normaliseText(value) === wanted);
}

function includesRandomizedDesign(values: string[]): boolean {
  return values.some((value) => /\brandomi[sz](?:ed|ation)?\b|\brct\b/i.test(value));
}

function includesNonRandomizedOnly(values: string[]): boolean {
  return values.length > 0 && values.every((value) => /\bnon[- ]?random|observational|cohort|case[- ]?control|cross[- ]?section/i.test(value));
}

function designFacet(spec: ReviewSpec, metadata: TrialRegistryMetadata): RegistryEligibilityFacet {
  const eligible = spec.fields.eligibleDesigns.value ?? [];
  const observed = unique([
    metadata.design.studyType ?? '',
    metadata.design.allocation ?? '',
    metadata.design.interventionModel ?? '',
  ]);
  const randomizedOnly = includesRandomizedDesign(eligible) && !includesNonRandomizedOnly(eligible);
  const registryExplicitlyRandomized = normaliseText(metadata.design.studyType ?? '') === 'interventional'
    && normaliseText(metadata.design.allocation ?? '') === 'randomized';
  const registryExplicitlyNonRandomized = normaliseText(metadata.design.studyType ?? '') === 'observational'
    || ['non randomized', 'na', 'n a'].includes(normaliseText(metadata.design.allocation ?? ''));
  if (randomizedOnly && registryExplicitlyNonRandomized) {
    return {
      facet: 'design', status: 'contradicted', target: eligible, observed,
      rationale: 'The frozen ReviewSpec requires randomized evidence, while the registry explicitly identifies a non-randomized/observational design.',
    };
  }
  if (randomizedOnly && registryExplicitlyRandomized) {
    return {
      facet: 'design', status: 'matched', target: eligible, observed,
      rationale: 'The registry explicitly reports an interventional randomized allocation matching the RCT-only ReviewSpec.',
    };
  }
  return {
    facet: 'design', status: 'unresolved', target: eligible, observed,
    rationale: 'Registry design fields do not prove exact compatibility or a safe structural contradiction with the frozen design criteria.',
  };
}

function stringFacet(input: {
  facet: RegistryEligibilityFacet['facet'];
  target: string | undefined;
  observed: string[];
  roleNote?: string;
}): RegistryEligibilityFacet {
  const target = input.target?.trim() ?? '';
  const observed = unique(input.observed);
  if (target && exact(target, observed)) {
    return {
      facet: input.facet, status: 'matched', target, observed,
      rationale: `An exact normalized ${input.facet} value in the registry matches the frozen ReviewSpec target${input.roleNote ? ` within ${input.roleNote}` : ''}.`,
    };
  }
  return {
    facet: input.facet, status: 'unresolved', target, observed,
    rationale: `No exact normalized ${input.facet} match was proven${input.roleNote ? ` within ${input.roleNote}` : ''}. Non-exact wording is not treated as incompatibility or equivalence.`,
  };
}

function isComparatorArm(type: string | undefined, label: string): boolean {
  const t = normaliseText(type ?? '');
  const l = normaliseText(label);
  return /comparator|placebo|sham|no intervention/.test(t)
    || /\bcontrol\b|\bplacebo\b|\busual care\b|\bstandard care\b/.test(l);
}

function isExperimentalArm(type: string | undefined, label: string): boolean {
  const t = normaliseText(type ?? '');
  const l = normaliseText(label);
  return t === 'experimental'
    || /\bexperimental\b|\btreatment\b|\bintervention\b/.test(l);
}

function armRoleNames(metadata: TrialRegistryMetadata, role: 'intervention' | 'comparator'): string[] {
  const selectedArms = metadata.arms.filter((arm) => role === 'comparator'
    ? isComparatorArm(arm.type, arm.label)
    : isExperimentalArm(arm.type, arm.label));
  const selectedLabels = new Set(selectedArms.map((arm) => normaliseText(arm.label)));
  const selectedInterventions = metadata.interventions.filter((item) =>
    item.armGroupLabels.some((label) => selectedLabels.has(normaliseText(label))));
  return unique([
    ...selectedArms.flatMap((arm) => [arm.label, ...arm.interventionNames]),
    ...selectedInterventions.flatMap((item) => [item.name, ...item.otherNames]),
  ]);
}

/**
 * Conservative eligibility classification from structured registry protocol data.
 *
 * Explicit structural design contradiction may auto-exclude. Positive automatic
 * inclusion requires exact deterministic matches on every core PICOD facet,
 * including arm-role-consistent intervention/comparator identity.
 * Missing/non-exact text never counts as a negative criterion.
 */
export function assessRegistrySourceEligibility(input: {
  reviewSpec: ReviewSpec;
  metadata: TrialRegistryMetadata;
  outcome: string;
}): RegistrySourceEligibilityAssessment {
  const spec = input.reviewSpec;
  const populationObserved = unique([
    ...input.metadata.conditions,
    input.metadata.eligibility.studyPopulation ?? '',
  ]);
  const outcomeObserved = unique([
    ...input.metadata.primaryOutcomes.map((item) => item.measure),
    ...input.metadata.secondaryOutcomes.map((item) => item.measure),
  ]);
  const facets: RegistryEligibilityFacet[] = [
    designFacet(spec, input.metadata),
    stringFacet({ facet: 'population', target: spec.fields.population.value, observed: populationObserved }),
    stringFacet({
      facet: 'intervention', target: spec.fields.interventionOrExposure.value,
      observed: armRoleNames(input.metadata, 'intervention'), roleNote: 'an experimental/treatment arm',
    }),
    stringFacet({
      facet: 'comparator', target: spec.fields.comparator.value,
      observed: armRoleNames(input.metadata, 'comparator'), roleNote: 'a comparator/control arm',
    }),
    stringFacet({ facet: 'outcome', target: input.outcome, observed: outcomeObserved }),
  ];
  const contradicted = facets.filter((facet) => facet.status === 'contradicted');
  const unresolved = facets.filter((facet) => facet.status === 'unresolved');
  const exactMatchCount = facets.filter((facet) => facet.status === 'matched').length;
  const eligibilityStatus: RegistryEligibilityStatus = contradicted.length > 0
    ? 'ineligible'
    : unresolved.length === 0
      ? 'eligible'
      : 'unresolved';
  const hashable = {
    version: 1 as const,
    registryId: input.metadata.registryId,
    reviewSpecHash: spec.hash,
    outcome: input.outcome,
    eligibilityStatus,
    facets,
  };
  const assessmentHash = stableHash(hashable);
  return {
    version: 1,
    eligibilityStatus,
    facets,
    exactMatchCount,
    contradictedFacets: contradicted.map((facet) => facet.facet),
    unresolvedFacets: unresolved.map((facet) => facet.facet),
    evidenceIds: [
      `registry-eligibility:${assessmentHash}`,
      `reviewspec:${spec.hash}:eligibility`,
      `registry-source:${stableHash(input.metadata)}`,
    ],
    assessmentHash,
  };
}
