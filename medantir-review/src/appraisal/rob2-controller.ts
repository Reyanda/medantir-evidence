import type { PipelineState } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type {
  Rob2EvidenceReviewItem,
  Rob2EvidenceReviewPackage,
  Rob2SignalSubmission,
} from './rob2-agent.js';
import {
  assessRob2,
  ROB2_QUESTIONS,
  type Rob2DomainId,
  type Rob2Judgement,
  type Rob2JudgementOverride,
  type Rob2Response,
  type Rob2SignalResponse,
} from './rob2.js';

export interface Rob2ResponseSubmission {
  questionId: string;
  response: Rob2Response;
  rationale: string;
  evidenceIds: string[];
}

export interface Rob2OverrideSubmission {
  scope: Rob2DomainId | 'overall';
  from: Rob2Judgement;
  to: Rob2Judgement;
  rationale: string;
}

export interface Rob2ReviewSubmission {
  studyId: string;
  resultId: string;
  outcome: string;
  responses: Rob2ResponseSubmission[];
  overrides?: Rob2OverrideSubmission[];
}

export interface Rob2ReviewActor {
  sub: string;
}

export type ResumeRob2Pipeline = (state: PipelineState) => Promise<PipelineState>;

const RESPONSES = new Set<Rob2Response>(['Y', 'PY', 'PN', 'N', 'NI', 'NA']);
const JUDGEMENTS = new Set<Rob2Judgement>(['low', 'some-concerns', 'high']);
const SCOPES = new Set<Rob2DomainId | 'overall'>(['D1', 'D2', 'D3', 'D4', 'D5', 'overall']);
const QUESTION_IDS = new Set(ROB2_QUESTIONS.map((question) => question.id));

export function parseRob2ReviewSubmission(value: unknown): Rob2ReviewSubmission {
  if (!value || typeof value !== 'object') throw Object.assign(new Error('RoB 2 review submission must be an object'), { status: 400 });
  const candidate = value as Record<string, unknown>;
  for (const key of ['studyId', 'resultId', 'outcome']) {
    if (typeof candidate[key] !== 'string' || !String(candidate[key]).trim()) {
      throw Object.assign(new Error(`RoB 2 ${key} is required`), { status: 400 });
    }
  }
  if (!Array.isArray(candidate.responses) || candidate.responses.length === 0) {
    throw Object.assign(new Error('RoB 2 responses must be a non-empty array'), { status: 400 });
  }
  const seenQuestions = new Set<string>();
  const responses: Rob2ResponseSubmission[] = candidate.responses.map((raw) => {
    if (!raw || typeof raw !== 'object') throw Object.assign(new Error('RoB 2 response must be an object'), { status: 400 });
    const item = raw as Record<string, unknown>;
    if (typeof item.questionId !== 'string' || !item.questionId.trim()) throw Object.assign(new Error('RoB 2 questionId is required'), { status: 400 });
    const questionId = item.questionId.trim();
    if (!QUESTION_IDS.has(questionId)) throw Object.assign(new Error(`Unknown RoB 2 question ${questionId}`), { status: 400 });
    if (seenQuestions.has(questionId)) throw Object.assign(new Error(`Duplicate RoB 2 question ${questionId}`), { status: 400 });
    seenQuestions.add(questionId);
    if (typeof item.response !== 'string' || !RESPONSES.has(item.response as Rob2Response)) throw Object.assign(new Error(`Invalid RoB 2 response for ${questionId}`), { status: 400 });
    if (typeof item.rationale !== 'string' || !item.rationale.trim()) throw Object.assign(new Error(`RoB 2 rationale is required for ${questionId}`), { status: 400 });
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.some((id) => typeof id !== 'string')) throw Object.assign(new Error(`RoB 2 evidenceIds are invalid for ${questionId}`), { status: 400 });
    return {
      questionId,
      response: item.response as Rob2Response,
      rationale: item.rationale.trim(),
      evidenceIds: [...new Set((item.evidenceIds as string[]).map((id) => id.trim()).filter(Boolean))],
    };
  });

  let overrides: Rob2OverrideSubmission[] | undefined;
  if (candidate.overrides !== undefined) {
    if (!Array.isArray(candidate.overrides)) throw Object.assign(new Error('RoB 2 overrides must be an array'), { status: 400 });
    const seenScopes = new Set<string>();
    overrides = candidate.overrides.map((raw) => {
      if (!raw || typeof raw !== 'object') throw Object.assign(new Error('RoB 2 override must be an object'), { status: 400 });
      const item = raw as Record<string, unknown>;
      if (typeof item.scope !== 'string' || !SCOPES.has(item.scope as Rob2DomainId | 'overall')) throw Object.assign(new Error('RoB 2 override scope is invalid'), { status: 400 });
      if (seenScopes.has(item.scope)) throw Object.assign(new Error(`Duplicate RoB 2 override scope ${item.scope}`), { status: 400 });
      seenScopes.add(item.scope);
      if (typeof item.from !== 'string' || !JUDGEMENTS.has(item.from as Rob2Judgement)) throw Object.assign(new Error(`RoB 2 override from is invalid for ${item.scope}`), { status: 400 });
      if (typeof item.to !== 'string' || !JUDGEMENTS.has(item.to as Rob2Judgement)) throw Object.assign(new Error(`RoB 2 override to is invalid for ${item.scope}`), { status: 400 });
      if (item.from === item.to) throw Object.assign(new Error(`RoB 2 override ${item.scope} must change the judgement`), { status: 400 });
      if (typeof item.rationale !== 'string' || !item.rationale.trim()) throw Object.assign(new Error(`RoB 2 override rationale is required for ${item.scope}`), { status: 400 });
      return {
        scope: item.scope as Rob2DomainId | 'overall',
        from: item.from as Rob2Judgement,
        to: item.to as Rob2Judgement,
        rationale: item.rationale.trim(),
      };
    });
  }

  return {
    studyId: String(candidate.studyId).trim(),
    resultId: String(candidate.resultId).trim(),
    outcome: String(candidate.outcome).trim(),
    responses,
    ...(overrides ? { overrides } : {}),
  };
}

function reviewPackage(state: PipelineState): Rob2EvidenceReviewPackage {
  const value = state.artifacts.rob2EvidenceReviewPackage as Rob2EvidenceReviewPackage | undefined;
  if (!value || value.version !== 1 || !Array.isArray(value.items)) {
    throw Object.assign(new Error('No active RoB 2 evidence-review package'), { status: 409 });
  }
  return value;
}

function matchingItem(state: PipelineState, submission: Rob2ReviewSubmission): Rob2EvidenceReviewItem {
  const item = reviewPackage(state).items.find((candidate) =>
    candidate.studyId === submission.studyId &&
    candidate.resultId === submission.resultId &&
    candidate.outcome === submission.outcome,
  );
  if (!item) throw Object.assign(new Error(`RoB 2 result ${submission.resultId} is not active for evidence review`), { status: 409 });
  return item;
}

function clientSemanticHash(submission: Rob2ReviewSubmission): string {
  return stableHash({
    studyId: submission.studyId,
    resultId: submission.resultId,
    outcome: submission.outcome,
    responses: submission.responses.map((response) => ({
      questionId: response.questionId,
      response: response.response,
      rationale: response.rationale,
      evidenceIds: [...response.evidenceIds].sort(),
    })).sort((a, b) => a.questionId.localeCompare(b.questionId)),
    overrides: (submission.overrides ?? []).map((override) => ({
      scope: override.scope,
      from: override.from,
      to: override.to,
      rationale: override.rationale,
    })).sort((a, b) => a.scope.localeCompare(b.scope)),
  });
}

function recordedAsClientSubmission(submission: Rob2SignalSubmission): Rob2ReviewSubmission {
  return {
    studyId: submission.studyId,
    resultId: submission.resultId,
    outcome: submission.outcome,
    responses: submission.responses.map((response) => ({
      questionId: response.questionId,
      response: response.response,
      rationale: response.rationale,
      evidenceIds: response.evidence.map((excerpt) => excerpt.id),
    })),
    ...((submission.overrides?.length ?? 0) > 0
      ? {
          overrides: submission.overrides!.map((override) => ({
            scope: override.scope,
            from: override.from,
            to: override.to,
            rationale: override.rationale,
          })),
        }
      : {}),
  };
}

function semanticSubmissionHash(submission: Rob2SignalSubmission): string {
  return clientSemanticHash(recordedAsClientSubmission(submission));
}

export async function submitRob2ReviewAndResume(input: {
  state: PipelineState;
  submission: Rob2ReviewSubmission;
  actor: Rob2ReviewActor;
  resume: ResumeRob2Pipeline;
  now?: string;
}): Promise<PipelineState> {
  if (!input.actor.sub.trim()) throw Object.assign(new Error('Authenticated RoB 2 reviewer is required'), { status: 401 });
  const ledger = Array.isArray(input.state.artifacts.rob2SignalSubmissions)
    ? input.state.artifacts.rob2SignalSubmissions as Rob2SignalSubmission[]
    : [];
  const existing = ledger.find((candidate) =>
    candidate.studyId === input.submission.studyId &&
    candidate.resultId === input.submission.resultId &&
    candidate.outcome === input.submission.outcome,
  );
  if (existing) {
    if (semanticSubmissionHash(existing) !== clientSemanticHash(input.submission)) {
      throw Object.assign(new Error(`RoB 2 result ${input.submission.resultId} already has a different submitted review`), { status: 409 });
    }
    return input.state;
  }

  const stage = input.state.stages['risk-of-bias'];
  if (stage.status !== 'awaiting-human' && stage.status !== 'pending') {
    throw Object.assign(new Error(`Cannot submit RoB 2 evidence review while stage is ${stage.status}`), { status: 409 });
  }
  const item = matchingItem(input.state, input.submission);
  const evidenceById = new Map(item.evidenceCatalog.map((excerpt) => [excerpt.id, excerpt]));
  const responses: Rob2SignalResponse[] = input.submission.responses.map((response) => {
    const unknown = response.evidenceIds.filter((id) => !evidenceById.has(id));
    if (unknown.length) throw Object.assign(new Error(`RoB 2 submission references unknown evidence id(s): ${unknown.join(', ')}`), { status: 400 });
    if (response.response !== 'NI' && response.response !== 'NA' && response.evidenceIds.length === 0) {
      throw Object.assign(new Error(`RoB 2 ${response.questionId} requires source evidence for ${response.response}`), { status: 400 });
    }
    return {
      questionId: response.questionId,
      response: response.response,
      rationale: response.rationale,
      evidence: response.evidenceIds.map((id) => evidenceById.get(id)!),
      source: 'human',
    };
  });
  const now = input.now ?? new Date().toISOString();
  const overrides: Rob2JudgementOverride[] | undefined = input.submission.overrides?.map((override) => ({
    ...override,
    actorId: `user:${input.actor.sub}`,
    decidedAt: now,
  }));
  const recorded: Rob2SignalSubmission = {
    studyId: input.submission.studyId,
    resultId: input.submission.resultId,
    outcome: input.submission.outcome,
    responses,
    ...(overrides ? { overrides } : {}),
  };

  let validation;
  try {
    validation = assessRob2({
      studyId: recorded.studyId,
      resultId: recorded.resultId,
      outcome: recorded.outcome,
      responses: recorded.responses,
      ...(recorded.overrides ? { overrides: recorded.overrides } : {}),
    });
  } catch (error) {
    throw Object.assign(new Error(`RoB 2 submission failed deterministic validation: ${error instanceof Error ? error.message : String(error)}`), { status: 400 });
  }
  if (!validation.complete) {
    const debt = validation.domains.flatMap((domain) => domain.unsupportedQuestionIds);
    throw Object.assign(new Error(`RoB 2 result-level submission is incomplete: ${debt.join('; ')}`), { status: 400 });
  }

  input.state.artifacts.rob2SignalSubmissions = [...ledger, structuredClone(recorded)];
  const priorAttempt = stage.attempts;
  stage.status = 'pending';
  stage.attempts = 0;
  delete stage.startedAt;
  delete stage.completedAt;
  input.state.updatedAt = now;
  input.state.audit.push({
    id: `rob2-review-${stableHash({ runId: input.state.runId, resultId: recorded.resultId, submission: semanticSubmissionHash(recorded) }).slice(0, 24)}`,
    runId: input.state.runId,
    stage: 'risk-of-bias',
    event: 'rob2-evidence-review-submitted',
    timestamp: now,
    attempt: priorAttempt,
    details: {
      studyId: recorded.studyId,
      resultId: recorded.resultId,
      outcome: recorded.outcome,
      actorId: `user:${input.actor.sub}`,
      submissionHash: semanticSubmissionHash(recorded),
      responseCount: responses.length,
      overrideCount: overrides?.length ?? 0,
      validatedAssessmentHash: validation.assessmentHash,
      retryBudgetReset: true,
    },
  });
  return input.resume(input.state);
}
