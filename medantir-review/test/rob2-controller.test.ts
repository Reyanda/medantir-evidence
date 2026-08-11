import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { EvidenceExcerpt, ExtractedStudy } from '../src/core/types.js';
import { Rob2AppraisalAgent, rob2ResultId } from '../src/appraisal/rob2-agent.js';
import {
  parseRob2ReviewSubmission,
  submitRob2ReviewAndResume,
} from '../src/appraisal/rob2-controller.js';

const evidence = (id: string, section: EvidenceExcerpt['section'] = 'methods'): EvidenceExcerpt => ({
  id,
  recordId: 'report-rct-controller',
  section,
  page: 3,
  quote: `Controller evidence ${id}`,
  source: 'full-text',
});

const excerpts = [
  evidence('r-random'), evidence('r-conceal'), evidence('r-baseline'), evidence('r-blind'),
  evidence('r-analysis'), evidence('r-missing', 'results'), evidence('r-measure', 'results'),
  evidence('r-plan'), evidence('r-select', 'results'),
];

const study: ExtractedStudy = {
  studyId: 'study-controller-rct',
  reportIds: ['report-rct-controller'],
  design: 'randomised controlled trial',
  population: 'adults',
  interventionOrExposure: 'intervention',
  comparator: 'placebo',
  outcomes: [{ name: 'mortality' }],
  mechanisms: [],
  funding: 'Not reported',
  rationale: 'Rationale',
  objectives: ['Objective'],
  resultsSummary: 'Results',
  discussionSummary: 'Discussion',
  limitations: [],
  sectionEvidence: {
    rationale: [], objectives: [], results: [excerpts[5]!, excerpts[6]!, excerpts[8]!], discussion: [], limitations: [],
  },
  fieldEvidence: {
    core: excerpts.slice(0, 5), outcomes: excerpts.slice(5, 7), protocol: [excerpts[7]!],
  },
  sourceQuotes: [],
};

function makeState() {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  });
  state.artifacts.extractedStudies = [study];
  return state;
}

function lowClientSubmission() {
  const e = (id: string) => [id];
  return {
    studyId: study.studyId,
    resultId: rob2ResultId(study.studyId, 'mortality'),
    outcome: 'mortality',
    responses: [
      { questionId: '1.1', response: 'Y', rationale: 'Random sequence.', evidenceIds: e('r-random') },
      { questionId: '1.2', response: 'Y', rationale: 'Concealed.', evidenceIds: e('r-conceal') },
      { questionId: '1.3', response: 'N', rationale: 'No baseline concern.', evidenceIds: e('r-baseline') },
      { questionId: '2.1', response: 'N', rationale: 'Participants blinded.', evidenceIds: e('r-blind') },
      { questionId: '2.2', response: 'N', rationale: 'Carers blinded.', evidenceIds: e('r-blind') },
      { questionId: '2.6', response: 'Y', rationale: 'Assignment analysis appropriate.', evidenceIds: e('r-analysis') },
      { questionId: '3.1', response: 'Y', rationale: 'Outcome data nearly complete.', evidenceIds: e('r-missing') },
      { questionId: '4.1', response: 'N', rationale: 'Measurement appropriate.', evidenceIds: e('r-measure') },
      { questionId: '4.2', response: 'N', rationale: 'Measurement equal by group.', evidenceIds: e('r-measure') },
      { questionId: '4.3', response: 'N', rationale: 'Assessors blinded.', evidenceIds: e('r-measure') },
      { questionId: '5.1', response: 'Y', rationale: 'Analysis was prespecified.', evidenceIds: e('r-plan') },
      { questionId: '5.2', response: 'N', rationale: 'No measurement selection.', evidenceIds: e('r-select') },
      { questionId: '5.3', response: 'N', rationale: 'No analysis selection.', evidenceIds: e('r-select') },
    ],
  };
}

test('authenticated RoB 2 submission resolves evidence IDs, records actor, and resumes appraisal', async () => {
  const state = makeState();
  const agent = new Rob2AppraisalAgent();
  const first = await agent.execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages['risk-of-bias'].status = 'awaiting-human';
  state.stages['risk-of-bias'].attempts = 1;

  let resumeCalls = 0;
  const submission = parseRob2ReviewSubmission(lowClientSubmission());
  const final = await submitRob2ReviewAndResume({
    state,
    submission,
    actor: { sub: 'rob2-reviewer' },
    now: '2026-08-11T05:05:00.000Z',
    resume: async (pending) => {
      resumeCalls += 1;
      const result = await agent.execute({ state: pending, now: () => '2026-08-11T05:05:01.000Z' });
      Object.assign(pending.artifacts, result.artifacts);
      pending.stages['risk-of-bias'].status = result.awaitingHuman ? 'awaiting-human' : 'passed';
      return pending;
    },
  });

  assert.equal(resumeCalls, 1);
  assert.equal(final.stages['risk-of-bias'].status, 'passed');
  const assessment = (final.artifacts.rob2Assessments as Array<{ finalOverall: string; complete: boolean }>)[0];
  assert.equal(assessment?.complete, true);
  assert.equal(assessment?.finalOverall, 'low');
  const audit = final.audit.find((event) => event.event === 'rob2-evidence-review-submitted');
  assert.equal(audit?.details.actorId, 'user:rob2-reviewer');
  const ledger = final.artifacts.rob2SignalSubmissions as Array<{ responses: Array<{ evidence: EvidenceExcerpt[] }> }>;
  assert.equal(ledger[0]?.responses[0]?.evidence[0]?.id, 'r-random');
});

test('lost-response retry is semantically idempotent and does not resume twice', async () => {
  const state = makeState();
  const agent = new Rob2AppraisalAgent();
  const first = await agent.execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages['risk-of-bias'].status = 'awaiting-human';
  const submission = parseRob2ReviewSubmission(lowClientSubmission());
  let resumeCalls = 0;
  const resume = async (pending: typeof state) => {
    resumeCalls += 1;
    pending.stages['risk-of-bias'].status = 'passed';
    return pending;
  };
  await submitRob2ReviewAndResume({ state, submission, actor: { sub: 'reviewer' }, resume, now: '2026-08-11T05:05:00.000Z' });
  await submitRob2ReviewAndResume({ state, submission, actor: { sub: 'reviewer' }, resume, now: '2026-08-11T05:06:00.000Z' });
  assert.equal(resumeCalls, 1);
});

test('conflicting retry and unknown evidence are rejected before state mutation', async () => {
  const state = makeState();
  const agent = new Rob2AppraisalAgent();
  const first = await agent.execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages['risk-of-bias'].status = 'awaiting-human';

  const badEvidence = lowClientSubmission();
  badEvidence.responses[0]!.evidenceIds = ['invented-source'];
  await assert.rejects(() => submitRob2ReviewAndResume({
    state,
    submission: parseRob2ReviewSubmission(badEvidence),
    actor: { sub: 'reviewer' },
    resume: async (pending) => pending,
  }), /unknown evidence id/i);
  assert.equal(state.artifacts.rob2SignalSubmissions, undefined);

  const good = parseRob2ReviewSubmission(lowClientSubmission());
  await submitRob2ReviewAndResume({
    state,
    submission: good,
    actor: { sub: 'reviewer' },
    resume: async (pending) => { pending.stages['risk-of-bias'].status = 'passed'; return pending; },
  });
  const conflicting = parseRob2ReviewSubmission({
    ...lowClientSubmission(),
    responses: lowClientSubmission().responses.map((item, index) => index === 0 ? { ...item, rationale: 'Different rationale.' } : item),
  });
  await assert.rejects(() => submitRob2ReviewAndResume({
    state,
    submission: conflicting,
    actor: { sub: 'reviewer' },
    resume: async (pending) => pending,
  }), /different submitted review/i);
});
