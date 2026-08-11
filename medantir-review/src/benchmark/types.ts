import type { ReviewType, StageName } from '../core/types.js';

export type BenchmarkTier = 'gold-data' | 'silver-review' | 'method-conformance';
export type BenchmarkMode = 'frozen-reproduction' | 'live-rerun' | 'independent-audit';
export type BenchmarkReadiness = 'ready' | 'requires-snapshot-onboarding' | 'methods-only';
export type PublicInputClass = 'fully-open' | 'open-reference-mixed-search-access' | 'methods-reference';

export type BenchmarkMetricName =
  | 'known-study-recall'
  | 'search-precision'
  | 'deduplication-precision'
  | 'deduplication-recall'
  | 'screening-recall'
  | 'screening-precision'
  | 'screening-f1'
  | 'work-saved-over-sampling-95'
  | 'full-text-retrieval-yield'
  | 'extraction-field-accuracy'
  | 'numeric-extraction-within-tolerance'
  | 'evidence-span-overlap'
  | 'required-section-coverage'
  | 'risk-of-bias-domain-agreement'
  | 'synthesis-estimate-within-tolerance'
  | 'synthesis-model-match'
  | 'certainty-domain-agreement'
  | 'prisma-count-consistency'
  | 'provenance-completeness'
  | 'human-adjudication-completeness';

export interface BenchmarkReferenceArtifact {
  name: string;
  kind: 'dataset' | 'protocol' | 'search-strategy' | 'included-studies' | 'extraction-table' | 'analysis-code' | 'risk-of-bias' | 'certainty' | 'report';
  access: 'open' | 'registration-required' | 'licensed';
  locator: string;
  version?: string;
  checksum?: string;
}

export interface BenchmarkCase {
  id: string;
  title: string;
  authority: string;
  reviewType: ReviewType;
  diseaseDomains: string[];
  tier: BenchmarkTier;
  readiness: BenchmarkReadiness;
  publicInputClass: PublicInputClass;
  supportedModes: BenchmarkMode[];
  referenceArtifacts: BenchmarkReferenceArtifact[];
  targetStages: StageName[];
  strengths: string[];
  cautions: string[];
}

export type BenchmarkTarget =
  | {
      id: string;
      stage: StageName;
      metric: BenchmarkMetricName;
      kind: 'minimum';
      minimum: number;
      required: boolean;
      rationale: string;
    }
  | {
      id: string;
      stage: StageName;
      metric: BenchmarkMetricName;
      kind: 'numeric-tolerance';
      expected: number;
      absoluteTolerance: number;
      relativeTolerance?: number;
      required: boolean;
      rationale: string;
    }
  | {
      id: string;
      stage: StageName;
      metric: BenchmarkMetricName;
      kind: 'exact';
      expected: string | number | boolean;
      required: boolean;
      rationale: string;
    }
  | {
      id: string;
      stage: StageName;
      metric: BenchmarkMetricName;
      kind: 'set-recovery';
      referenceIds: string[];
      minimumRecall: number;
      minimumPrecision?: number;
      required: boolean;
      rationale: string;
    };

export interface BenchmarkObservation {
  targetId: string;
  value?: string | number | boolean;
  recoveredIds?: string[];
  evidence: string[];
}

export type BenchmarkMetricStatus = 'pass' | 'fail' | 'missing';

export interface BenchmarkMetricResult {
  targetId: string;
  stage: StageName;
  metric: BenchmarkMetricName;
  status: BenchmarkMetricStatus;
  observed?: string | number | boolean;
  score?: number;
  expected: string;
  evidence: string[];
  message: string;
}

export type DiscrepancyClass =
  | 'exact-match'
  | 'acceptable-tolerance'
  | 'database-drift'
  | 'publication-version-drift'
  | 'methodological-discretion'
  | 'pipeline-defect'
  | 'candidate-source-review-error'
  | 'unresolved';

export interface DiscrepancyEvidence {
  withinTolerance: boolean;
  frozenSnapshot: boolean;
  databaseOrIndexChanged?: boolean;
  publicationVersionChanged?: boolean;
  prespecifiedMethodDifference?: boolean;
  sourceLevelProof?: boolean;
  reproducedAcrossIndependentRuns?: boolean;
  humanAdjudicated?: boolean;
  pipelineUnitFailure?: boolean;
}

export interface BenchmarkEvaluation {
  benchmarkId: string;
  mode: BenchmarkMode;
  passed: boolean;
  requiredPassed: number;
  requiredTotal: number;
  results: BenchmarkMetricResult[];
  discrepancyClass: DiscrepancyClass;
}
