import type { ReviewType, StageName, ValidationResult, PipelineState } from '../core/types.js';
import { getReviewTypeProfile } from './methodology.js';

export interface StageProtocol {
  stage: StageName;
  requiredArtifacts: string[];
  producedArtifacts: string[];
  maxRetries: number;
  humanGate: 'never' | 'always' | 'on-warning';
  validate(state: PipelineState): ValidationResult;
}

export interface ReviewProtocol {
  reviewType: ReviewType;
  stages: StageProtocol[];
}

const allStages: StageName[] = [
  'question',
  'identity',
  'protocol',
  'review-landscape',
  'protocol-draft',
  'search-build',
  'search-test',
  'protocol-finalise',
  'register-protocol',
  'search-execute',
  'deduplicate',
  'tiab-screen',
  'fulltext-retrieve',
  'pdf-to-text',
  'fulltext-screen',
  'extract',
  'risk-of-bias',
  'synthesise',
  'grade',
  'report',
  'human-verify',
];

const stageIO: Record<StageName, { required: string[]; produced: string[] }> = {
  question: { required: [], produced: ['normalisedQuestion'] },
  identity: { required: ['normalisedQuestion'], produced: ['researcherIdentity'] },
  protocol: { required: ['normalisedQuestion', 'researcherIdentity'], produced: ['reviewPlan'] },
  'review-landscape': { required: ['reviewPlan'], produced: ['reviewCommissionDecision'] },
  'protocol-draft': { required: ['reviewPlan', 'reviewCommissionDecision', 'researcherIdentity'], produced: ['protocolDraft'] },
  'search-build': { required: ['reviewPlan', 'reviewCommissionDecision'], produced: ['searchStrategies'] },
  'search-test': { required: ['searchStrategies', 'protocolDraft'], produced: ['searchTestReport'] },
  'protocol-finalise': { required: ['protocolDraft', 'searchStrategies', 'searchTestReport'], produced: ['protocolPackage'] },
  'register-protocol': { required: ['protocolPackage', 'researcherIdentity'], produced: ['registrationPlan', 'registrationReceipts', 'protocolRegistrationLedger'] },
  'search-execute': { required: ['searchStrategies'], produced: ['searchResults', 'searchProvenance'] },
  deduplicate: { required: ['searchResults'], produced: ['uniqueRecords', 'deduplicationReport'] },
  'tiab-screen': { required: ['uniqueRecords', 'reviewPlan'], produced: ['tiabDecisions', 'tiabIncluded'] },
  'fulltext-retrieve': { required: ['tiabIncluded'], produced: ['fullTexts', 'retrievalReport'] },
  'pdf-to-text': { required: ['fullTexts'], produced: ['parsedDocuments'] },
  'fulltext-screen': { required: ['parsedDocuments', 'reviewPlan'], produced: ['fullTextDecisions', 'includedDocuments'] },
  extract: { required: ['includedDocuments'], produced: ['extractedStudies'] },
  'risk-of-bias': { required: ['extractedStudies', 'reviewPlan'], produced: ['riskOfBias'] },
  synthesise: { required: ['extractedStudies', 'reviewPlan'], produced: ['synthesis'] },
  grade: { required: ['synthesis', 'riskOfBias'], produced: ['grade'] },
  report: {
    required: ['reviewPlan', 'reviewCommissionDecision', 'deduplicationReport', 'tiabDecisions', 'fullTextDecisions', 'extractedStudies', 'synthesis'],
    produced: ['draftReport'],
  },
  'human-verify': {
    required: ['draftReport', 'tiabDecisions', 'fullTextDecisions', 'extractedStudies', 'synthesis'],
    produced: ['verificationPackage', 'verificationOutcome', 'finalReport'],
  },
};

function validateArtifacts(state: PipelineState, artifacts: string[]): ValidationResult {
  const missing = artifacts.filter((key) => !(key in state.artifacts));
  return {
    ok: missing.length === 0,
    issues: missing.map((key) => ({
      code: 'MISSING_ARTIFACT',
      message: `Required artifact '${key}' is missing`,
      severity: 'error' as const,
    })),
  };
}

function validateSearchExecution(state: PipelineState): ValidationResult {
  const base = validateArtifacts(state, stageIO['search-execute'].produced);
  if (!base.ok) return base;
  const provenance = Array.isArray(state.artifacts.searchProvenance)
    ? state.artifacts.searchProvenance as Array<{ database?: string; resultCount?: number; warnings?: string[] }>
    : [];
  const issues = [...base.issues];
  for (const requested of state.request.databases) {
    const source = provenance.find((entry) => entry.database?.toLowerCase() === requested.toLowerCase());
    if (!source) {
      issues.push({ code: 'SEARCH_SOURCE_MISSING', message: `Requested database '${requested}' has no execution provenance`, severity: 'error' as const });
      continue;
    }
    const warnings = (source.warnings ?? []).filter(Boolean);
    if (source.resultCount === 0) {
      issues.push({ code: 'SEARCH_SOURCE_EMPTY', message: `Requested database '${requested}' returned zero exported records`, severity: 'error' as const });
    }
    for (const warning of warnings) {
      if (/auth required|missing|expired|0 rows parsed|failed|error/i.test(warning)) {
        issues.push({ code: 'SEARCH_SOURCE_BLOCKED', message: `${requested}: ${warning}`, severity: 'error' as const });
      }
    }
  }
  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
}

export function createReviewProtocol(reviewType: ReviewType): ReviewProtocol {
  const profile = getReviewTypeProfile(reviewType);
  const omitted = new Set<StageName>();
  if (!profile.requiredModules.includes('risk-of-bias')) omitted.add('risk-of-bias');
  if (!profile.requiredModules.includes('certainty-assessment')) omitted.add('grade');

  const stages = allStages
    .filter((stage) => !omitted.has(stage))
    .map<StageProtocol>((stage) => {
      const io = stageIO[stage];
      const adjustedRequired = io.required.filter((artifact) => {
        if (artifact === 'riskOfBias' && omitted.has('risk-of-bias')) return false;
        return true;
      });
      return {
        stage,
        requiredArtifacts: adjustedRequired,
        producedArtifacts: io.produced,
        maxRetries: stage === 'search-execute' || stage === 'fulltext-retrieve' ? 2 : 1,
        humanGate:
          stage === 'protocol' || stage === 'review-landscape' || stage === 'protocol-finalise' || stage === 'register-protocol' || stage === 'fulltext-screen'
            ? 'always'
            : stage === 'search-test' || stage === 'search-execute'
              ? 'on-warning'
              : 'never',
        validate: (state) => stage === 'search-execute'
          ? validateSearchExecution(state)
          : validateArtifacts(state, io.produced),
      };
    });

  return { reviewType, stages };
}
