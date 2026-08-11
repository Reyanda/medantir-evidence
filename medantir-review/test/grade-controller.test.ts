import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  buildGradeEvidenceCatalog,
  parseGradeReviewSubmission,
  submitGradeReviewAndResume,
} from '../src/certainty/grade-controller.js';

function state() {
  const value = createPipelineState(fixtureRequest);
  value.stages.grade.status = 'awaiting-human';
  value.stages.grade.attempts = 1;
  value.artifacts.protocolPackage = { checksum: 'grade-protocol-001' };
  value.artifacts.gradeEvidenceReviewPackage = {
    version: 1,
    framework: 'GRADE',
    reviewType: 'intervention-rct',
    createdAt: '2026-08-11T06:00:00.000Z',
    items: [{
      outcome: 'mortality',
      unresolvedDomains: ['indirectness', 'imprecision', 'publication-bias'],
      proposedDecisions: [],
      reason: 'Needs source-bound evidence.',
    }],
  };
  value.artifacts.extractedStudies = [{
    studyId: 's1', reportIds: ['r1'], design: 'randomised controlled trial', population: 'children',
    interventionOrExposure: 'treatment', comparator: 'control', outcomes: [{ name: 'mortality' }],
    mechanisms: [], limitations: [],
    sectionEvidence: { objectives: [], methods: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {
      core: [],
      outcomes: [{ id: 'n-source', recordId: 'r1', section: 'results', quote: 'A total of 500 participants were randomized.', page: 4 }],
    },
  }];
  value.artifacts.publicationBiasEvidenceCatalog = [
    { id: 'registry-audit', description: 'Prospective registry-to-publication completeness audit.' },
  ];
  return value;
}

test('GRADE evidence catalog assigns domain-specific evidence uses', () => {
  const catalog = buildGradeEvidenceCatalog(state());
  const protocol = catalog.find((item) => item.id === 'protocol:grade-protocol-001:review-question');
  const count = catalog.find((item) => item.id === 'n-source');
  const registry = catalog.find((item) => item.id === 'registry-audit');
  assert.deepEqual(protocol?.allowedUses, ['directness']);
  assert.ok(count?.allowedUses.includes('information-size'));
  assert.deepEqual(registry?.allowedUses, ['publication-bias']);
});

test('authenticated GRADE evidence submission records actor/time and is retry-idempotent', async () => {
  const value = state();
  let resumes = 0;
  const submission = parseGradeReviewSubmission({
    outcome: 'mortality',
    totalParticipants: 500,
    totalParticipantsEvidenceIds: ['n-source'],
    directness: {
      population: 'direct', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct',
      evidenceIds: ['protocol:grade-protocol-001:review-question'],
    },
    actorId: 'spoofed-client-identity',
  });
  const result = await submitGradeReviewAndResume({
    state: value,
    submission,
    actor: { sub: 'real-reviewer' },
    now: '2026-08-11T06:10:00.000Z',
    resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(resumes, 1);
  const ledger = result.artifacts.gradeOutcomeEvidenceLedger as Array<{ actorId: string; decidedAt: string; addedFields: string[] }>;
  assert.equal(ledger[0]?.actorId, 'user:real-reviewer');
  assert.equal(ledger[0]?.decidedAt, '2026-08-11T06:10:00.000Z');
  assert.ok(ledger[0]?.addedFields.includes('totalParticipants'));
  assert.ok(ledger[0]?.addedFields.includes('directness'));
  const stored = (result.artifacts.gradeOutcomeEvidence as Array<{ totalParticipantsEvidenceIds?: string[] }>)[0];
  assert.deepEqual(stored?.totalParticipantsEvidenceIds, ['n-source']);

  await submitGradeReviewAndResume({
    state: result,
    submission,
    actor: { sub: 'real-reviewer' },
    now: '2026-08-11T06:11:00.000Z',
    resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(resumes, 1, 'identical lost-response retry must not rerun GRADE');
});

test('publication-bias evidence requires an authorized assessment basis and client cannot set signal strength', async () => {
  const value = state();
  const wrong = parseGradeReviewSubmission({
    outcome: 'mortality',
    publicationBias: { assessmentEvidenceIds: ['protocol:grade-protocol-001:review-question'], signals: [] },
  });
  await assert.rejects(() => submitGradeReviewAndResume({ state: value, submission: wrong, actor: { sub: 'r' }, resume: async (pending) => pending }), /not authorized for publication-bias/);

  const valid = parseGradeReviewSubmission({
    outcome: 'mortality',
    publicationBias: {
      assessmentEvidenceIds: ['registry-audit'],
      signals: [{ id: 'registry-discrepancy', description: 'Registered primary outcome was not reported.', evidenceIds: ['registry-audit'], strength: 999 }],
    },
  });
  const result = await submitGradeReviewAndResume({ state: value, submission: valid, actor: { sub: 'r' }, resume: async (pending) => pending });
  const stored = (result.artifacts.gradeOutcomeEvidence as Array<{ publicationBias?: { signals: Array<{ id: string; strength: number }> } }>)[0];
  assert.equal(stored?.publicationBias?.signals.find((signal) => signal.id === 'registry-discrepancy')?.strength, 1);
  assert.equal(stored?.publicationBias?.signals.find((signal) => signal.id === '__assessment-basis__')?.strength, 0);
});

test('conflicting evidence requires an explicit amendment workflow', async () => {
  const value = state();
  const first = parseGradeReviewSubmission({
    outcome: 'mortality',
    directness: {
      population: 'direct', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct',
      evidenceIds: ['protocol:grade-protocol-001:review-question'],
    },
  });
  await submitGradeReviewAndResume({ state: value, submission: first, actor: { sub: 'r' }, resume: async (pending) => pending });
  const changed = parseGradeReviewSubmission({
    outcome: 'mortality',
    directness: {
      population: 'partial', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct',
      evidenceIds: ['protocol:grade-protocol-001:review-question'],
    },
  });
  await assert.rejects(() => submitGradeReviewAndResume({ state: value, submission: changed, actor: { sub: 'r' }, resume: async (pending) => pending }), /different directness evidence/);
});
