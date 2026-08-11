import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import type { ExtractedStudy, EvidenceExcerpt } from '../src/core/types.js';
import type { ModelInferencePort, ModelInferenceRequest, ModelInferenceResult } from '../src/inference/model-inference.js';
import { modelInferenceOutputHash, modelInferenceRequestHash } from '../src/inference/model-inference.js';
import {
  Rob2AppraisalAgent,
  parseRob2ModelAnswers,
  rob2ResultId,
  type Rob2SignalSubmission,
} from '../src/appraisal/rob2-agent.js';
import type { Rob2SignalResponse } from '../src/appraisal/rob2.js';

const excerpt = (id: string, section: EvidenceExcerpt['section'] = 'methods'): EvidenceExcerpt => ({
  id,
  recordId: 'trial-report-1',
  section,
  page: 2,
  quote: `Source evidence ${id}`,
  source: 'full-text',
});

const evidence = [
  excerpt('e-random'), excerpt('e-conceal'), excerpt('e-baseline'), excerpt('e-blind'),
  excerpt('e-analysis'), excerpt('e-missing', 'results'), excerpt('e-measure', 'results'),
  excerpt('e-plan'), excerpt('e-selection', 'results'),
];

const study: ExtractedStudy = {
  studyId: 'study-rct-1',
  reportIds: ['trial-report-1'],
  design: 'randomised controlled trial',
  population: 'adults',
  interventionOrExposure: 'intervention',
  comparator: 'placebo',
  outcomes: [{ name: 'mortality', effect: -0.1, standardError: 0.05 }],
  mechanisms: [],
  funding: 'Not reported',
  rationale: 'Trial rationale',
  objectives: ['Estimate effect'],
  resultsSummary: 'Results',
  discussionSummary: 'Discussion',
  limitations: [],
  sectionEvidence: {
    rationale: [],
    objectives: [],
    results: [evidence[5]!, evidence[6]!, evidence[8]!],
    discussion: [],
    limitations: [],
  },
  fieldEvidence: {
    core: evidence.slice(0, 5),
    outcomes: evidence.slice(5, 7),
    funding: [],
    registration: [evidence[7]!],
  },
  sourceQuotes: [],
};

const lowSignals: Rob2SignalResponse[] = [
  { questionId: '1.1', response: 'Y', rationale: 'Random sequence reported.', evidence: [evidence[0]!], source: 'human' },
  { questionId: '1.2', response: 'Y', rationale: 'Concealment reported.', evidence: [evidence[1]!], source: 'human' },
  { questionId: '1.3', response: 'N', rationale: 'No baseline concern.', evidence: [evidence[2]!], source: 'human' },
  { questionId: '2.1', response: 'N', rationale: 'Participants blinded.', evidence: [evidence[3]!], source: 'human' },
  { questionId: '2.2', response: 'N', rationale: 'Carers blinded.', evidence: [evidence[3]!], source: 'human' },
  { questionId: '2.6', response: 'Y', rationale: 'ITT analysis.', evidence: [evidence[4]!], source: 'human' },
  { questionId: '3.1', response: 'Y', rationale: 'Nearly all outcome data available.', evidence: [evidence[5]!], source: 'human' },
  { questionId: '4.1', response: 'N', rationale: 'Appropriate outcome measurement.', evidence: [evidence[6]!], source: 'human' },
  { questionId: '4.2', response: 'N', rationale: 'Measurement same in both groups.', evidence: [evidence[6]!], source: 'human' },
  { questionId: '4.3', response: 'N', rationale: 'Assessors blinded.', evidence: [evidence[6]!], source: 'human' },
  { questionId: '5.1', response: 'Y', rationale: 'Prespecified plan available.', evidence: [evidence[7]!], source: 'human' },
  { questionId: '5.2', response: 'N', rationale: 'No outcome-measure selection signal.', evidence: [evidence[8]!], source: 'human' },
  { questionId: '5.3', response: 'N', rationale: 'No analysis-selection signal.', evidence: [evidence[8]!], source: 'human' },
];

function stateWithStudy() {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  });
  state.artifacts.extractedStudies = [study];
  return state;
}

function humanSubmission(): Rob2SignalSubmission {
  return {
    studyId: study.studyId,
    resultId: rob2ResultId(study.studyId, 'mortality'),
    outcome: 'mortality',
    responses: lowSignals,
  };
}

class FixedModel implements ModelInferencePort {
  calls: ModelInferenceRequest[] = [];
  constructor(private readonly output: string) {}
  async complete(request: ModelInferenceRequest): Promise<ModelInferenceResult> {
    this.calls.push(request);
    return {
      text: this.output,
      requestHash: modelInferenceRequestHash(request),
      outputHash: modelInferenceOutputHash(this.output),
      receipt: { gateway: 'test', requestedModel: request.model, actualModel: 'test-model', actualProvider: 'test-provider' },
    };
  }
}

function modelJson(signals: Rob2SignalResponse[]) {
  return JSON.stringify({
    answers: signals.map((signal) => ({
      questionId: signal.questionId,
      response: signal.response,
      rationale: signal.rationale,
      evidenceIds: signal.evidence.map((item) => item.id),
      confidence: 0.95,
    })),
  });
}

test('complete human signalling submission produces result-level deterministic RoB 2 and compatibility artifact', async () => {
  const state = stateWithStudy();
  state.artifacts.rob2SignalSubmissions = [humanSubmission()];
  const agent = new Rob2AppraisalAgent();
  const result = await agent.execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  assert.equal(result.awaitingHuman, undefined);
  const assessments = result.artifacts.rob2Assessments as Array<{ algorithmOverall: string; finalOverall: string; complete: boolean }>;
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0]?.algorithmOverall, 'low');
  assert.equal(assessments[0]?.finalOverall, 'low');
  assert.equal(assessments[0]?.complete, true);
  const compatibility = result.artifacts.riskOfBias as Array<{ overall: string; domains: Array<{ judgement: string }> }>;
  assert.equal(compatibility[0]?.overall, 'low');
  assert.ok(compatibility[0]?.domains.every((domain) => domain.judgement === 'low'));
});

test('no human/model signals creates an evidence-review package and no fabricated risk label', async () => {
  const state = stateWithStudy();
  const result = await new Rob2AppraisalAgent().execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  assert.deepEqual(result.artifacts.riskOfBias, []);
  const review = result.artifacts.rob2EvidenceReviewPackage as { items: Array<{ reason?: string; evidenceCatalog: unknown[] }> };
  assert.equal(review.items.length, 1);
  assert.match(review.items[0]?.reason ?? '', /No attributable human signalling responses/);
  assert.ok((review.items[0]?.evidenceCatalog.length ?? 0) > 0);
});

test('validated model proposal can supply signals but software still computes judgement', async () => {
  const state = stateWithStudy();
  const model = new FixedModel(modelJson(lowSignals));
  const result = await new Rob2AppraisalAgent({ port: model, model: 'auto/reasoning' }).execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  assert.equal(result.awaitingHuman, undefined);
  assert.equal(model.calls.length, 1);
  assert.match(model.calls[0]?.messages[0]?.content ?? '', /deterministic application.*determines RoB 2 judgements/i);
  const assessment = (result.artifacts.rob2Assessments as Array<{ algorithmOverall: string }>)[0];
  assert.equal(assessment?.algorithmOverall, 'low');
  const receipts = result.artifacts.rob2ModelReceipts as Array<{ routing: { actualModel?: string } }>;
  assert.equal(receipts[0]?.routing.actualModel, 'test-model');
});

test('fabricated model evidence ID is rejected into human review rather than accepted', async () => {
  const state = stateWithStudy();
  const payload = JSON.stringify({
    answers: [{ questionId: '1.1', response: 'Y', rationale: 'Invented support.', evidenceIds: ['e-does-not-exist'] }],
  });
  const result = await new Rob2AppraisalAgent({ port: new FixedModel(payload), model: 'test' }).execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.awaitingHuman);
  assert.deepEqual(result.artifacts.riskOfBias, []);
  const review = result.artifacts.rob2EvidenceReviewPackage as { items: Array<{ reason?: string }> };
  assert.match(review.items[0]?.reason ?? '', /fabricated evidence id/i);
});

test('invalid JSON and unsupported non-NI answer do not leak a risk label', async () => {
  const invalidJson = await new Rob2AppraisalAgent({ port: new FixedModel('not-json'), model: 'test' })
    .execute({ state: stateWithStudy(), now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(invalidJson.awaitingHuman);
  assert.deepEqual(invalidJson.artifacts.riskOfBias, []);

  const unsupported = JSON.stringify({
    answers: [{ questionId: '1.1', response: 'Y', rationale: 'No citation.', evidenceIds: [] }],
  });
  const noEvidence = await new Rob2AppraisalAgent({ port: new FixedModel(unsupported), model: 'test' })
    .execute({ state: stateWithStudy(), now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(noEvidence.awaitingHuman);
  assert.deepEqual(noEvidence.artifacts.riskOfBias, []);
});

test('NI is allowed without fabricated evidence but substantive inactive conditional answers make assessment incomplete', () => {
  const parsed = parseRob2ModelAnswers(JSON.stringify({
    answers: [{ questionId: '1.1', response: 'NI', rationale: 'No information found.', evidenceIds: [] }],
  }), evidence);
  assert.equal(parsed[0]?.response, 'NI');
  assert.equal(parsed[0]?.evidence.length, 0);

  const state = stateWithStudy();
  state.artifacts.rob2SignalSubmissions = [{
    ...humanSubmission(),
    responses: [...lowSignals, {
      questionId: '2.3',
      response: 'N',
      rationale: 'This conditional question was answered despite both awareness questions being negative.',
      evidence: [evidence[3]!],
      source: 'human',
    }],
  }];
  return new Rob2AppraisalAgent().execute({ state, now: () => '2026-08-11T05:00:00.000Z' }).then((result) => {
    assert.ok(result.awaitingHuman);
    const assessment = (result.artifacts.rob2Assessments as Array<{ domains: Array<{ inactiveResponseQuestionIds: string[] }> }>)[0];
    assert.ok(assessment?.domains.some((domain) => domain.inactiveResponseQuestionIds.includes('2.3')));
  });
});
