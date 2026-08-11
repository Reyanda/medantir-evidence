import type { PipelineState } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import {
  validateClarificationResolution,
  type ClarificationIssue,
  type ClarificationResolution,
} from './review-spec.js';
import type { ClarificationResolutionLedger } from './autonomous-question-agent.js';

function issuesOf(state: PipelineState): ClarificationIssue[] {
  const issues = state.artifacts.clarificationIssues;
  return Array.isArray(issues) ? issues as ClarificationIssue[] : [];
}

function ledgerOf(state: PipelineState): ClarificationResolutionLedger {
  const ledger = state.artifacts.clarificationResolutionLedger as ClarificationResolutionLedger | undefined;
  return ledger?.version === 1 && Array.isArray(ledger.resolutions)
    ? ledger
    : { version: 1, resolutions: [] };
}

function semanticResolutionHash(resolution: ClarificationResolution): string {
  return stableHash({
    issueId: resolution.issueId,
    field: resolution.field,
    value: resolution.value,
    rationale: resolution.rationale.trim(),
    actorId: resolution.actorId,
  });
}

export function isClarificationResolutionRecorded(
  state: PipelineState,
  resolution: ClarificationResolution,
): boolean {
  const existing = ledgerOf(state).resolutions.find((candidate) => candidate.issueId === resolution.issueId);
  return Boolean(existing && semanticResolutionHash(existing) === semanticResolutionHash(resolution));
}

/**
 * Record one human clarification without directly changing ReviewSpec science.
 * The question agent must recompile the specification from this ledger on resume.
 * This separation prevents an API/UI caller from bypassing compiler validation.
 *
 * Clarification cycles are not retries. The orchestrator's attempt counter protects
 * against execution failures, so a valid answered question resets the operational
 * retry budget for the question stage. The prior attempt number remains preserved
 * in the audit/scientific ledgers.
 *
 * HTTP retries are semantically idempotent: the server-generated decision time is
 * intentionally excluded from duplicate identity. An identical answer from the
 * same authenticated actor therefore remains the same scientific decision even if
 * the client retries after losing the first response.
 */
export function recordClarificationResolution(
  state: PipelineState,
  resolution: ClarificationResolution,
  now = new Date().toISOString(),
): PipelineState {
  const ledger = ledgerOf(state);
  const existing = ledger.resolutions.find((candidate) => candidate.issueId === resolution.issueId);
  if (existing) {
    if (semanticResolutionHash(existing) === semanticResolutionHash(resolution)) return state;
    throw new Error(`Clarification issue ${resolution.issueId} already has a different recorded resolution`);
  }

  const issue = issuesOf(state).find((candidate) => candidate.id === resolution.issueId);
  if (!issue) throw new Error(`Clarification issue ${resolution.issueId} is not active on run ${state.runId}`);
  validateClarificationResolution(issue, resolution);

  state.artifacts.clarificationResolutionLedger = {
    version: 1,
    resolutions: [...ledger.resolutions, structuredClone(resolution)],
  } satisfies ClarificationResolutionLedger;
  delete state.artifacts.clarificationRequest;

  const questionStage = state.stages.question;
  if (questionStage.status !== 'awaiting-human' && questionStage.status !== 'pending') {
    throw new Error(`Cannot submit initial ReviewSpec clarification while question stage is ${questionStage.status}`);
  }
  const priorAttempt = questionStage.attempts;
  questionStage.status = 'pending';
  questionStage.attempts = 0;
  delete questionStage.startedAt;
  delete questionStage.completedAt;
  state.updatedAt = now;
  state.audit.push({
    id: `clar-audit-${stableHash({ runId: state.runId, issueId: issue.id, decision: semanticResolutionHash(resolution) }).slice(0, 24)}`,
    runId: state.runId,
    stage: 'question',
    event: 'clarification-resolved',
    timestamp: now,
    attempt: priorAttempt,
    details: {
      issueId: issue.id,
      field: issue.field,
      actorId: resolution.actorId,
      decidedAt: resolution.decidedAt,
      answerHash: stableHash(resolution.value),
      rationaleHash: stableHash(resolution.rationale),
      earliestAffectedStage: issue.earliestAffectedStage,
      retryBudgetReset: true,
    },
  });
  return state;
}
