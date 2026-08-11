import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import type { EvidenceExcerpt, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { Rob2AppraisalAgent, rob2ResultId } from '../src/appraisal/rob2-agent.js';

const identityProvider = { authenticate: async () => ({ sub: 'rob2-api-user', projectId: 'rob2-api-project' }) };
const runsFile = () => `/tmp/medantir-rob2-api-${process.pid}-${Math.random().toString(36).slice(2)}.json`;

const excerpt = (id: string, section: EvidenceExcerpt['section'] = 'methods'): EvidenceExcerpt => ({
  id,
  recordId: 'rob2-api-report',
  section,
  page: 2,
  quote: `Evidence ${id}`,
  source: 'full-text',
});

const ev = [
  excerpt('api-random'), excerpt('api-conceal'), excerpt('api-baseline'), excerpt('api-blind'),
  excerpt('api-analysis'), excerpt('api-missing', 'results'), excerpt('api-measure', 'results'),
  excerpt('api-plan'), excerpt('api-select', 'results'),
];

const study: ExtractedStudy = {
  studyId: 'rob2-api-study',
  reportIds: ['rob2-api-report'],
  design: 'randomised controlled trial',
  population: 'adults',
  interventionOrExposure: 'treatment',
  comparator: 'placebo',
  outcomes: [{ name: 'mortality' }, { name: 'recovery' }],
  mechanisms: [], funding: 'Not reported', rationale: 'Rationale', objectives: ['Objective'],
  resultsSummary: 'Results', discussionSummary: 'Discussion', limitations: [],
  sectionEvidence: { rationale: [], objectives: [], results: [ev[5]!, ev[6]!, ev[8]!], discussion: [], limitations: [] },
  fieldEvidence: { core: ev.slice(0, 5), outcomes: ev.slice(5, 7), protocol: [ev[7]!] },
  sourceQuotes: [],
};

function submission(outcome: string) {
  const e = (id: string) => [id];
  return {
    studyId: study.studyId,
    resultId: rob2ResultId(study.studyId, outcome),
    outcome,
    responses: [
      { questionId: '1.1', response: 'Y', rationale: 'Random sequence.', evidenceIds: e('api-random') },
      { questionId: '1.2', response: 'Y', rationale: 'Allocation concealed.', evidenceIds: e('api-conceal') },
      { questionId: '1.3', response: 'N', rationale: 'No baseline concern.', evidenceIds: e('api-baseline') },
      { questionId: '2.1', response: 'N', rationale: 'Participants blinded.', evidenceIds: e('api-blind') },
      { questionId: '2.2', response: 'N', rationale: 'Carers blinded.', evidenceIds: e('api-blind') },
      { questionId: '2.6', response: 'Y', rationale: 'ITT analysis.', evidenceIds: e('api-analysis') },
      { questionId: '3.1', response: 'Y', rationale: 'Outcome data nearly complete.', evidenceIds: e('api-missing') },
      { questionId: '4.1', response: 'N', rationale: 'Appropriate measurement.', evidenceIds: e('api-measure') },
      { questionId: '4.2', response: 'N', rationale: 'Measurement equal by group.', evidenceIds: e('api-measure') },
      { questionId: '4.3', response: 'N', rationale: 'Assessors blinded.', evidenceIds: e('api-measure') },
      { questionId: '5.1', response: 'Y', rationale: 'Prespecified plan.', evidenceIds: e('api-plan') },
      { questionId: '5.2', response: 'N', rationale: 'No outcome selection.', evidenceIds: e('api-select') },
      { questionId: '5.3', response: 'N', rationale: 'No analysis selection.', evidenceIds: e('api-select') },
    ],
  };
}

test('RoB 2 API resolves one result at a time with authenticated attribution and no downstream advance while debt remains', async (t) => {
  process.env.REVIEW_LIVE = '1';
  const { startServer } = await import('../src/server.js');
  const file = runsFile();
  t.after(async () => {
    delete process.env.REVIEW_LIVE;
    await rm(file, { force: true });
    await rm(`${file}.durability`, { recursive: true, force: true });
  });

  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  });
  state.artifacts.extractedStudies = [study];
  state.artifacts.reviewSpec = {
    version: 1,
    reviewType: 'systematic',
    title: fixtureRequest.question.title,
    objective: fixtureRequest.question.objective,
    fields: {
      population: { value: 'adults', source: 'user-specified', rationale: 'test' },
      interventionOrExposure: { value: 'treatment', source: 'user-specified', rationale: 'test' },
      comparator: { value: 'placebo', source: 'user-specified', rationale: 'test' },
      outcomes: { value: ['mortality', 'recovery'], source: 'user-specified', rationale: 'test' },
      eligibleDesigns: { value: ['randomised controlled trial'], source: 'user-specified', rationale: 'test' },
      databases: { value: ['PubMed'], source: 'user-specified', rationale: 'test' },
      settings: { value: ['all'], source: 'reversible-default', rationale: 'test' },
      ageRange: { value: 'all', source: 'reversible-default', rationale: 'test' },
      dateLimits: { value: {}, source: 'reversible-default', rationale: 'test' },
      languages: { value: ['all languages'], source: 'reversible-default', rationale: 'test' },
      greyLiteraturePolicy: { value: 'include', source: 'reversible-default', rationale: 'test' },
      publicationStatusPolicy: { value: 'all', source: 'reversible-default', rationale: 'test' },
      primaryTimepoints: { value: ['all'], source: 'reversible-default', rationale: 'test' },
      secondaryTimepoints: { value: [], source: 'reversible-default', rationale: 'test' },
      effectMeasures: { value: ['appropriate'], source: 'protocol-derived', rationale: 'test' },
      subgroups: { value: [], source: 'reversible-default', rationale: 'test' },
      multiplicityRule: { value: 'separate', source: 'protocol-derived', rationale: 'test' },
      clusterRule: { value: 'adjust', source: 'protocol-derived', rationale: 'test' },
      multiArmRule: { value: 'dependence-aware', source: 'protocol-derived', rationale: 'test' },
      riskOfBiasTools: { value: ['RoB 2'], source: 'protocol-derived', rationale: 'test' },
      certaintyFramework: { value: 'GRADE', source: 'protocol-derived', rationale: 'test' },
      synthesisStrategy: { value: 'meta-analysis', source: 'protocol-derived', rationale: 'test' },
      registrationTargets: { value: [], source: 'reversible-default', rationale: 'test' },
      livingReviewPolicy: { value: 'Not a living review', source: 'protocol-derived', rationale: 'test' },
    },
    compiledAt: '2026-08-11T05:00:00.000Z',
    hash: 'test-review-spec-hash',
  };
  for (const [name, stage] of Object.entries(state.stages)) {
    if (name === 'risk-of-bias') break;
    stage.status = 'passed';
  }
  const first = await new Rob2AppraisalAgent().execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  Object.assign(state.artifacts, first.artifacts);
  state.stages['risk-of-bias'].status = 'awaiting-human';
  state.stages['risk-of-bias'].attempts = 1;
  await writeFile(file, JSON.stringify([[state.runId, { ownerSub: 'rob2-api-user', projectId: 'rob2-api-project', state }]]), { mode: 0o600 });

  const server = await startServer(0, { identityProvider, runsFile: file, durabilityRoot: `${file}.durability` });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const get = await fetch(`${base}/runs/${state.runId}/risk-of-bias`);
  assert.equal(get.status, 200);
  const packageBody = await get.json() as { reviewPackage: { items: Array<{ outcome: string }> } };
  assert.equal(packageBody.reviewPackage.items.length, 2);

  const post = await fetch(`${base}/runs/${state.runId}/risk-of-bias`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission('mortality')),
  });
  assert.equal(post.status, 202);
  const resumed = await post.json() as typeof state;
  assert.equal(resumed.stages['risk-of-bias'].status, 'awaiting-human');
  assert.equal(resumed.stages.synthesise.status, 'pending');
  const remaining = resumed.artifacts.rob2EvidenceReviewPackage as { items: Array<{ outcome: string }> };
  assert.deepEqual(remaining.items.map((item) => item.outcome), ['recovery']);
  const audit = resumed.audit.find((event) => event.event === 'rob2-evidence-review-submitted');
  assert.equal(audit?.details.actorId, 'user:rob2-api-user');
});
