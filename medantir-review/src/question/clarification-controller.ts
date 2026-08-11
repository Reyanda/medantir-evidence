import type { PipelineState } from '../core/types.js';
import {
  isClarificationResolutionRecorded,
  recordClarificationResolution,
} from './clarification-state.js';
import type { ClarificationResolution, ReviewSpecFieldName } from './review-spec.js';

export interface ClarificationSubmission {
  issueId: string;
  field: ReviewSpecFieldName;
  value: unknown;
  rationale: string;
}

export interface ClarificationActor {
  sub: string;
}

export type ResumePipeline = (state: PipelineState) => Promise<PipelineState>;

const FIELD_NAMES = new Set<ReviewSpecFieldName>([
  'population',
  'interventionOrExposure',
  'comparator',
  'outcomes',
  'eligibleDesigns',
  'databases',
  'settings',
  'ageRange',
  'dateLimits',
  'languages',
  'greyLiteraturePolicy',
  'publicationStatusPolicy',
  'primaryTimepoints',
  'secondaryTimepoints',
  'effectMeasures',
  'subgroups',
  'multiplicityRule',
  'clusterRule',
  'multiArmRule',
  'riskOfBiasTools',
  'certaintyFramework',
  'synthesisStrategy',
  'registrationTargets',
  'livingReviewPolicy',
]);

export function parseClarificationSubmission(value: unknown): ClarificationSubmission {
  if (!value || typeof value !== 'object') throw Object.assign(new Error('Clarification submission must be an object'), { status: 400 });
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.issueId !== 'string' || !candidate.issueId.trim()) {
    throw Object.assign(new Error('Clarification issueId is required'), { status: 400 });
  }
  if (typeof candidate.field !== 'string' || !FIELD_NAMES.has(candidate.field as ReviewSpecFieldName)) {
    throw Object.assign(new Error('Clarification field is invalid'), { status: 400 });
  }
  if (typeof candidate.rationale !== 'string' || !candidate.rationale.trim()) {
    throw Object.assign(new Error('Clarification rationale is required'), { status: 400 });
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'value')) {
    throw Object.assign(new Error('Clarification value is required'), { status: 400 });
  }
  return {
    issueId: candidate.issueId.trim(),
    field: candidate.field as ReviewSpecFieldName,
    value: structuredClone(candidate.value),
    rationale: candidate.rationale.trim(),
  };
}

/**
 * Authenticated application service for one clarification answer.
 *
 * Client payloads cannot choose actor identity or decision time. Those values are
 * injected from the authenticated request/session and server clock. The state
 * primitive validates the issue and records an immutable audit fingerprint before
 * the caller-provided resume function can execute another scientific stage.
 *
 * A semantically identical HTTP retry is returned idempotently without invoking
 * the resume callback again. This prevents lost-response retries from consuming a
 * second question attempt or advancing unrelated scientific work twice.
 */
export async function submitClarificationAndResume(input: {
  state: PipelineState;
  submission: ClarificationSubmission;
  actor: ClarificationActor;
  resume: ResumePipeline;
  now?: string;
}): Promise<PipelineState> {
  if (!input.actor.sub.trim()) throw Object.assign(new Error('Authenticated clarification actor is required'), { status: 401 });
  const now = input.now ?? new Date().toISOString();
  const resolution: ClarificationResolution = {
    issueId: input.submission.issueId,
    field: input.submission.field,
    value: structuredClone(input.submission.value),
    rationale: input.submission.rationale,
    actorId: `user:${input.actor.sub}`,
    decidedAt: now,
  };
  if (isClarificationResolutionRecorded(input.state, resolution)) return input.state;
  recordClarificationResolution(input.state, resolution, now);
  return input.resume(input.state);
}
