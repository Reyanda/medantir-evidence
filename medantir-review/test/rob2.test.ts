import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceExcerpt } from '../src/core/types.js';
import {
  assessRob2,
  type Rob2Response,
  type Rob2SignalResponse,
} from '../src/appraisal/rob2.js';

const evidence = (questionId: string): EvidenceExcerpt => ({
  id: `e-${questionId}`,
  recordId: 'trial-1',
  section: 'methods',
  page: 1,
  quote: `Evidence supporting RoB 2 question ${questionId}`,
  source: 'full-text',
});

function response(questionId: string, value: Rob2Response, rationale = `Rationale for ${questionId}`): Rob2SignalResponse {
  return {
    questionId,
    response: value,
    rationale,
    evidence: value === 'NI' || value === 'NA' ? [] : [evidence(questionId)],
    source: 'human',
  };
}

const LOW_RESPONSES: Rob2SignalResponse[] = [
  response('1.1', 'Y'), response('1.2', 'Y'), response('1.3', 'N'),
  response('2.1', 'N'), response('2.2', 'N'), response('2.6', 'Y'),
  response('3.1', 'Y'),
  response('4.1', 'N'), response('4.2', 'N'), response('4.3', 'N'),
  response('5.1', 'Y'), response('5.2', 'N'), response('5.3', 'N'),
];

function assess(responses: Rob2SignalResponse[] = LOW_RESPONSES) {
  return assessRob2({
    studyId: 'study-1',
    resultId: 'result-mortality-28d',
    outcome: '28-day mortality',
    responses,
  });
}

function replace(base: Rob2SignalResponse[], ...changes: Rob2SignalResponse[]) {
  const byId = new Map(base.map((item) => [item.questionId, item]));
  for (const item of changes) byId.set(item.questionId, item);
  return [...byId.values()];
}

test('complete low-risk assignment-effect assessment is result-level and hash-stable', () => {
  const first = assess();
  const second = assess();
  assert.equal(first.complete, true);
  assert.equal(first.proposedOverall, 'low');
  assert.equal(first.finalOverall, 'low');
  assert.ok(first.domains.every((domain) => domain.proposedJudgement === 'low'));
  assert.equal(first.assessmentHash, second.assessmentHash);
  assert.equal(first.authority.toolVersion, '2019-08-22');
  assert.equal(first.authority.exactExcelAlgorithmParity, 'pending');
  assert.equal(first.authority.productionCertificationBlockedOnExactParity, true);
});

test('Domain 1 becomes high when allocation concealment is not supported', () => {
  const result = assess(replace(LOW_RESPONSES, response('1.2', 'N')));
  assert.equal(result.domains.find((domain) => domain.domain === 'D1')?.proposedJudgement, 'high');
  assert.equal(result.proposedOverall, 'high');
});

test('Domain 2 becomes high for outcome-relevant unbalanced trial-context deviations', () => {
  const result = assess(replace(
    LOW_RESPONSES,
    response('2.1', 'Y'),
    response('2.2', 'Y'),
    response('2.3', 'Y'),
    response('2.4', 'Y'),
    response('2.5', 'N'),
  ));
  const d2 = result.domains.find((domain) => domain.domain === 'D2');
  assert.equal(d2?.complete, true);
  assert.deepEqual(d2?.activeQuestionIds, ['2.1', '2.2', '2.6', '2.3', '2.4', '2.5']);
  assert.equal(d2?.proposedJudgement, 'high');
  assert.equal(result.proposedOverall, 'high');
});

test('Domain 2 analysis branch activates 2.7 and becomes high when impact may be substantial', () => {
  const result = assess(replace(
    LOW_RESPONSES,
    response('2.6', 'N'),
    response('2.7', 'Y'),
  ));
  const d2 = result.domains.find((domain) => domain.domain === 'D2');
  assert.ok(d2?.activeQuestionIds.includes('2.7'));
  assert.equal(d2?.proposedJudgement, 'high');
});

test('Domain 3 distinguishes could-depend from likely-depended missingness', () => {
  const some = assess(replace(
    LOW_RESPONSES,
    response('3.1', 'N'),
    response('3.2', 'N'),
    response('3.3', 'Y'),
    response('3.4', 'N'),
  ));
  assert.equal(some.domains.find((domain) => domain.domain === 'D3')?.proposedJudgement, 'some-concerns');

  const high = assess(replace(
    LOW_RESPONSES,
    response('3.1', 'N'),
    response('3.2', 'N'),
    response('3.3', 'Y'),
    response('3.4', 'Y'),
  ));
  assert.equal(high.domains.find((domain) => domain.domain === 'D3')?.proposedJudgement, 'high');
});

test('Domain 4 high-risk path requires likely influence when assessors were aware', () => {
  const result = assess(replace(
    LOW_RESPONSES,
    response('4.3', 'Y'),
    response('4.4', 'Y'),
    response('4.5', 'Y'),
  ));
  const d4 = result.domains.find((domain) => domain.domain === 'D4');
  assert.deepEqual(d4?.activeQuestionIds, ['4.1', '4.2', '4.3', '4.4', '4.5']);
  assert.equal(d4?.proposedJudgement, 'high');
});

test('Domain 5 becomes high when result-based selection from eligible measurements is likely', () => {
  const result = assess(replace(LOW_RESPONSES, response('5.2', 'PY')));
  assert.equal(result.domains.find((domain) => domain.domain === 'D5')?.proposedJudgement, 'high');
  assert.equal(result.proposedOverall, 'high');
});

test('unsupported evidence responses make the domain incomplete instead of silently passing', () => {
  const responses = replace(LOW_RESPONSES, {
    questionId: '1.1',
    response: 'Y',
    rationale: 'Claims randomization without source support.',
    evidence: [],
    source: 'model-proposed',
    confidence: 0.99,
  });
  const result = assess(responses);
  const d1 = result.domains.find((domain) => domain.domain === 'D1');
  assert.equal(d1?.complete, false);
  assert.equal(result.complete, false);
  assert.ok(d1?.unsupportedQuestionIds.some((item) => item.includes('requires evidence')));
});

test('missing active conditional answer keeps a domain incomplete', () => {
  const responses = replace(LOW_RESPONSES, response('2.1', 'Y'))
    .filter((item) => item.questionId !== '2.3');
  const result = assess(responses);
  const d2 = result.domains.find((domain) => domain.domain === 'D2');
  assert.ok(d2?.activeQuestionIds.includes('2.3'));
  assert.equal(d2?.complete, false);
  assert.ok(d2?.unsupportedQuestionIds.includes('2.3'));
});

test('multiple some-concerns domains trigger explicit escalation rather than silent high-risk conversion', () => {
  const responses = replace(
    LOW_RESPONSES,
    response('1.1', 'NI'),
    response('1.2', 'NI'),
    response('1.3', 'NI'),
    response('5.1', 'NI'),
  );
  const result = assess(responses);
  assert.equal(result.proposedOverall, 'some-concerns');
  assert.equal(result.multipleSomeConcernsEscalation, true);
});

test('domain and overall overrides require attributable justification', () => {
  const base = assess();
  const overridden = assessRob2({
    studyId: 'study-1',
    resultId: 'result-mortality-28d',
    outcome: '28-day mortality',
    responses: LOW_RESPONSES,
    overrides: [{
      scope: 'overall',
      from: base.proposedOverall,
      to: 'some-concerns',
      rationale: 'External methodological information raises a concern not encoded by the conservative mapping.',
      actorId: 'reviewer:gm',
      decidedAt: '2026-08-11T05:00:00.000Z',
    }],
  });
  assert.equal(overridden.proposedOverall, 'low');
  assert.equal(overridden.finalOverall, 'some-concerns');
  assert.equal(overridden.overrides[0]?.actorId, 'reviewer:gm');

  assert.throws(() => assessRob2({
    studyId: 'study-1',
    resultId: 'result-mortality-28d',
    outcome: '28-day mortality',
    responses: LOW_RESPONSES,
    overrides: [{
      scope: 'overall', from: 'low', to: 'high', rationale: '', actorId: '', decidedAt: 'bad-date',
    }],
  }), /actorId|rationale|decidedAt/);
});

test('unsupported RoB 2 variants are refused rather than routed through the parallel-assignment algorithm', () => {
  assert.throws(() => assessRob2({
    studyId: 'study-1',
    resultId: 'result-1',
    outcome: 'mortality',
    trialDesign: 'cluster' as never,
    responses: LOW_RESPONSES,
  }), /not implemented/);
  assert.throws(() => assessRob2({
    studyId: 'study-1',
    resultId: 'result-1',
    outcome: 'mortality',
    effectOfInterest: 'adherence' as never,
    responses: LOW_RESPONSES,
  }), /not implemented/);
});
