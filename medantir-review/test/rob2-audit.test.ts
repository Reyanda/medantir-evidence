import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceExcerpt } from '../src/core/types.js';
import { assessRob2, type Rob2SignalResponse } from '../src/appraisal/rob2.js';

const ev = (id: string): EvidenceExcerpt => ({
  id: `audit-${id}`,
  recordId: 'audit-report',
  section: 'methods',
  page: 1,
  quote: `Audit evidence ${id}`,
  source: 'full-text',
});

const signal = (questionId: string, response: Rob2SignalResponse['response']): Rob2SignalResponse => ({
  questionId,
  response,
  rationale: `Rationale ${questionId}`,
  evidence: response === 'NI' || response === 'NA' ? [] : [ev(questionId)],
  source: 'human',
});

const low: Rob2SignalResponse[] = [
  signal('1.1', 'Y'), signal('1.2', 'Y'), signal('1.3', 'N'),
  signal('2.1', 'N'), signal('2.2', 'N'), signal('2.6', 'Y'),
  signal('3.1', 'Y'),
  signal('4.1', 'N'), signal('4.2', 'N'), signal('4.3', 'N'),
  signal('5.1', 'Y'), signal('5.2', 'N'), signal('5.3', 'N'),
];

test('domain override never overwrites immutable algorithm judgement', () => {
  const result = assessRob2({
    studyId: 'audit-study',
    resultId: 'audit-result',
    outcome: 'mortality',
    responses: low,
    overrides: [{
      scope: 'D1',
      from: 'low',
      to: 'some-concerns',
      rationale: 'External allocation information raises a concern.',
      actorId: 'reviewer:gm',
      decidedAt: '2026-08-11T05:00:00.000Z',
    }],
  });
  const d1 = result.domains.find((domain) => domain.domain === 'D1');
  assert.equal(d1?.algorithmJudgement, 'low');
  assert.equal(d1?.proposedJudgement, 'low');
  assert.equal(d1?.finalJudgement, 'some-concerns');
  assert.equal(result.algorithmOverall, 'low');
  assert.equal(result.proposedOverall, 'low');
  assert.equal(result.domainAdjustedOverall, 'some-concerns');
  assert.equal(result.finalOverall, 'some-concerns');
  assert.match(d1?.finalRationale.at(-1) ?? '', /Override by reviewer:gm/);
});

test('overall override is applied only after domain-adjusted overall', () => {
  const result = assessRob2({
    studyId: 'audit-study',
    resultId: 'audit-result',
    outcome: 'mortality',
    responses: low,
    overrides: [
      {
        scope: 'D1', from: 'low', to: 'some-concerns',
        rationale: 'Concern.', actorId: 'reviewer:gm', decidedAt: '2026-08-11T05:00:00.000Z',
      },
      {
        scope: 'overall', from: 'some-concerns', to: 'high',
        rationale: 'Multiple external concerns substantially lower confidence.', actorId: 'reviewer:gm', decidedAt: '2026-08-11T05:01:00.000Z',
      },
    ],
  });
  assert.equal(result.algorithmOverall, 'low');
  assert.equal(result.domainAdjustedOverall, 'some-concerns');
  assert.equal(result.finalOverall, 'high');
});

test('substantive answer to an inactive conditional question is audit-visible and incomplete', () => {
  const result = assessRob2({
    studyId: 'audit-study',
    resultId: 'audit-result',
    outcome: 'mortality',
    responses: [...low, signal('2.3', 'N')],
  });
  const d2 = result.domains.find((domain) => domain.domain === 'D2');
  assert.equal(d2?.complete, false);
  assert.deepEqual(d2?.inactiveResponseQuestionIds, ['2.3']);
  assert.ok(d2?.unsupportedQuestionIds.some((item) => item.includes('inactive conditional question')));
  assert.equal(result.complete, false);
});

test('NA on an inactive conditional question is accepted as explicit flow notation', () => {
  const result = assessRob2({
    studyId: 'audit-study',
    resultId: 'audit-result',
    outcome: 'mortality',
    responses: [...low, signal('2.3', 'NA')],
  });
  const d2 = result.domains.find((domain) => domain.domain === 'D2');
  assert.equal(d2?.complete, true);
  assert.deepEqual(d2?.inactiveResponseQuestionIds, []);
});

test('duplicate override scopes are rejected', () => {
  assert.throws(() => assessRob2({
    studyId: 'audit-study',
    resultId: 'audit-result',
    outcome: 'mortality',
    responses: low,
    overrides: [
      { scope: 'D1', from: 'low', to: 'some-concerns', rationale: 'A', actorId: 'r', decidedAt: '2026-08-11T05:00:00.000Z' },
      { scope: 'D1', from: 'low', to: 'high', rationale: 'B', actorId: 'r', decidedAt: '2026-08-11T05:01:00.000Z' },
    ],
  }), /Duplicate RoB 2 override scope/);
});
