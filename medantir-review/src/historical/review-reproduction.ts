import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalReplayCapsule } from './replay-capsule.js';
import type { HistoricalExecutionEnvironmentFingerprint } from './execution-environment.js';

export const HISTORICAL_REVIEW_REPRODUCTION_SCHEMA_VERSION = 'medantir-historical-review-reproduction/1' as const;

export type HistoricalReviewReproductionClaim =
  | 'end-to-end-exact'
  | 'computationally-exact-publication-incomplete'
  | 'partial-replay';

export type HistoricalPlaneReplayFidelity = 'exact' | 'unverified' | 'unavailable';
export type HistoricalPlaneProvenance = 'original-exact' | 'source-reconstructed' | 'aggregate-only' | 'unavailable';

export interface HistoricalReviewMethodsContract {
  reviewId: string;
  sourceReference: string;
  eligibility: {
    population: string[];
    interventionOrExposure: string[];
    comparator: string[];
    outcomes: string[];
    includedDesigns: string[];
    exclusions: string[];
  };
  screening: {
    titleAbstractScreeningReported: boolean;
    fullTextScreeningReported: boolean;
    reviewerCount?: number;
    independentReviewReported?: boolean;
    conflictResolutionReported?: boolean;
  };
  extraction: {
    reviewerCount?: number;
    independentReviewReported?: boolean;
    fields: string[];
  };
  appraisal: Array<{
    population: string;
    tool: string;
    scoreRange?: string;
    qualityThreshold?: string;
    independentReviewReported?: boolean;
  }>;
  synthesis: {
    software?: string;
    softwareVersion?: string;
    dichotomousMethod?: string;
    dichotomousMeasure?: string;
    continuousMethod?: string;
    continuousMeasure?: string;
    heterogeneityStatistic?: string;
    modelRule?: string;
    publicationBiasMethods?: string[];
  };
  reportedFlow?: Record<string, number>;
  reportedResults?: Array<{
    outcome: string;
    studies?: number;
    participants?: number;
    measure: string;
    estimate: number;
    ciLower: number;
    ciUpper: number;
    i2?: number;
    model?: string;
  }>;
  disclosureGaps: string[];
}

export interface HistoricalReviewFrozenPlane {
  plane:
    | 'search-import-dedup'
    | 'fulltext-corpus'
    | 'screening-decisions'
    | 'parsed-documents'
    | 'extraction-ledger'
    | 'appraisal-ledger'
    | 'synthesis-inputs'
    | 'synthesis-results'
    | 'report';
  hash: string;
  artifactKeys: string[];
  replayFidelity: HistoricalPlaneReplayFidelity;
  historicalProvenance: HistoricalPlaneProvenance;
  sourceReferences?: string[];
}

export interface HistoricalStatisticalRuntimeFingerprint {
  engine: string;
  version: string;
  packageVersions?: Record<string, string>;
  algorithmContractHash: string;
  numericTolerance: number;
}

export interface HistoricalReviewReproductionEnvelope {
  schemaVersion: typeof HISTORICAL_REVIEW_REPRODUCTION_SCHEMA_VERSION;
  reviewId: string;
  methodsContractHash: string;
  searchCapsuleId?: string;
  searchCapsuleHash?: string;
  frozenPlanes: HistoricalReviewFrozenPlane[];
  statisticalRuntime?: HistoricalStatisticalRuntimeFingerprint;
  executionEnvironmentHash?: string;
  claim: HistoricalReviewReproductionClaim;
  blockingGaps: string[];
  envelopeId: string;
}

export function historicalReviewMethodsContractHash(contract: HistoricalReviewMethodsContract): string {
  return scientificContentHash(contract);
}

const REQUIRED_PLANES: HistoricalReviewFrozenPlane['plane'][] = [
  'search-import-dedup',
  'fulltext-corpus',
  'screening-decisions',
  'parsed-documents',
  'extraction-ledger',
  'appraisal-ledger',
  'synthesis-inputs',
  'synthesis-results',
  'report',
];

function evaluateGaps(input: {
  methods: HistoricalReviewMethodsContract;
  searchCapsule?: HistoricalReplayCapsule;
  frozenPlanes: HistoricalReviewFrozenPlane[];
  statisticalRuntime?: HistoricalStatisticalRuntimeFingerprint;
  executionEnvironment?: HistoricalExecutionEnvironmentFingerprint;
}): string[] {
  const gaps = [...input.methods.disclosureGaps];
  if (!input.searchCapsule) gaps.push('No historical search/import/dedup capsule is bound to the review envelope.');
  for (const required of REQUIRED_PLANES) {
    const plane = input.frozenPlanes.find((candidate) => candidate.plane === required);
    if (!plane) {
      gaps.push(`Historical frozen plane '${required}' is missing.`);
      continue;
    }
    if (plane.replayFidelity !== 'exact') {
      gaps.push(`Historical frozen plane '${required}' is not replay-exact (${plane.replayFidelity}).`);
    }
    if (plane.historicalProvenance !== 'original-exact') {
      gaps.push(`Historical frozen plane '${required}' is not original-exact (${plane.historicalProvenance}).`);
    }
  }
  if (!input.statisticalRuntime) gaps.push('No statistical runtime fingerprint is bound to the historical synthesis replay.');
  if (!input.executionEnvironment) gaps.push('No reproducer execution-environment fingerprint is bound to the historical review replay.');
  if (input.methods.synthesis.software && !input.methods.synthesis.softwareVersion) {
    gaps.push('The publication names statistical software but not a version.');
  }
  if (!input.methods.synthesis.modelRule) {
    gaps.push('The publication does not fully specify the fixed/random-effects model selection rule.');
  }
  if (!input.methods.screening.reviewerCount) gaps.push('The publication does not specify the number of screening reviewers.');
  if (!input.methods.screening.conflictResolutionReported) gaps.push('The publication does not fully specify screening conflict resolution.');
  return [...new Set(gaps)].sort();
}

function envelopeIdentity(input: Omit<HistoricalReviewReproductionEnvelope, 'envelopeId'>): unknown {
  return {
    ...input,
    frozenPlanes: [...input.frozenPlanes].sort((a, b) => a.plane.localeCompare(b.plane)),
  };
}

export function createHistoricalReviewReproductionEnvelope(input: {
  methods: HistoricalReviewMethodsContract;
  searchCapsule?: HistoricalReplayCapsule;
  frozenPlanes?: HistoricalReviewFrozenPlane[];
  statisticalRuntime?: HistoricalStatisticalRuntimeFingerprint;
  executionEnvironment?: HistoricalExecutionEnvironmentFingerprint;
}): HistoricalReviewReproductionEnvelope {
  const frozenPlanes = [...(input.frozenPlanes ?? [])]
    .map((plane) => ({
      ...plane,
      artifactKeys: [...plane.artifactKeys].sort(),
      ...(plane.sourceReferences ? { sourceReferences: [...new Set(plane.sourceReferences)].sort() } : {}),
    }))
    .sort((a, b) => a.plane.localeCompare(b.plane));
  const duplicatePlanes = frozenPlanes.filter((plane, index) => frozenPlanes.findIndex((candidate) => candidate.plane === plane.plane) !== index);
  if (duplicatePlanes.length > 0) throw new Error(`Historical review envelope duplicates frozen plane '${duplicatePlanes[0]!.plane}'.`);

  const blockingGaps = evaluateGaps({
    methods: input.methods,
    ...(input.searchCapsule ? { searchCapsule: input.searchCapsule } : {}),
    frozenPlanes,
    ...(input.statisticalRuntime ? { statisticalRuntime: input.statisticalRuntime } : {}),
    ...(input.executionEnvironment ? { executionEnvironment: input.executionEnvironment } : {}),
  });
  const computationallyComplete = Boolean(
    input.searchCapsule
    && REQUIRED_PLANES.every((required) => frozenPlanes.some((plane) => plane.plane === required && plane.replayFidelity === 'exact'))
    && input.statisticalRuntime
    && input.executionEnvironment,
  );
  const publicationComplete = blockingGaps.length === 0;
  const claim: HistoricalReviewReproductionClaim = computationallyComplete
    ? publicationComplete ? 'end-to-end-exact' : 'computationally-exact-publication-incomplete'
    : 'partial-replay';
  const base: Omit<HistoricalReviewReproductionEnvelope, 'envelopeId'> = {
    schemaVersion: HISTORICAL_REVIEW_REPRODUCTION_SCHEMA_VERSION,
    reviewId: input.methods.reviewId,
    methodsContractHash: historicalReviewMethodsContractHash(input.methods),
    ...(input.searchCapsule ? {
      searchCapsuleId: input.searchCapsule.capsuleId,
      searchCapsuleHash: scientificContentHash(input.searchCapsule),
    } : {}),
    frozenPlanes,
    ...(input.statisticalRuntime ? { statisticalRuntime: input.statisticalRuntime } : {}),
    ...(input.executionEnvironment ? { executionEnvironmentHash: input.executionEnvironment.environmentHash } : {}),
    claim,
    blockingGaps,
  };
  return { ...base, envelopeId: `HRR-${scientificContentHash(envelopeIdentity(base)).slice(0, 24)}` };
}
