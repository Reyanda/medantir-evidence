import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, PipelineState } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { RegistryResidualDebtAgent } from '../src/certainty/registry-residual-debt-agent.js';
import {
  parseRegistryUniverseAdjudication,
  submitRegistryUniverseAdjudicationAndResume,
} from '../src/certainty/registry-universe-controller.js';
import type { RegistryUniverseAdjudication } from '../src/certainty/registry-result-universe-agent.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(_context: AgentContext): Promise<AgentResult> { return { artifacts: {} }; }
}

function initial(): PipelineState {
  const state = createPipelineState(fixtureRequest);
  state.stages.grade.status = 'awaiting-human';
  state.artifacts.registryUniverseReviewPackage = {
    version: 1,
    createdAt: '2026-08-11T11:00:00.000Z',
    items: [{
      registryId: 'NCT01234567', outcome: 'mortality', reason: 'three fields unresolved',
      requiredFields: ['resultsAvailable', 'targetOutcomeReported', 'publicationStatus'],
      evidenceIds: ['registry-source', 'publication-search-source'],
      sourceDerived: {
        eligibilityStatus: 'eligible', eligibilityExactMatches: 5,
        eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
        registryResultsPosted: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: 'unknown', publicationStatus: 'unknown',
        exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: [],
      },
    }],
  };
  return state;
}

async function rebuildAfterReplay(state: PipelineState): Promise<PipelineState> {
  const current = (state.artifacts.registryUniverseAdjudications as RegistryUniverseAdjudication[] | undefined)?.[0];
  assert.ok(current);
  state.artifacts.registeredStudyResultUniverse = [{
    version: 2,
    studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
    eligibilityStatus: current.eligibilityStatus, contributesToSynthesis: false,
    registrySearched: true, registrationFound: true,
    resultsAvailable: current.resultsAvailable,
    prespecifiedPrimaryOutcomeFound: current.prespecifiedPrimaryOutcomeFound,
    targetOutcomeReported: current.targetOutcomeReported,
    publicationStatus: current.publicationStatus,
    evidenceIds: [...new Set(['registry-source', 'publication-search-source', ...current.evidenceIds])],
    sourceHash: current.adjudicationHash,
  }];
  state.artifacts.registryUniverseReviewPackage = { version: 1, items: [], createdAt: '2026-08-11T11:00:00.000Z' };
  await new RegistryResidualDebtAgent(new Capture()).execute({ state, now: () => '2026-08-11T11:01:00.000Z' });
  state.stages.grade.status = 'awaiting-human';
  return state;
}

test('one-field answer replays into a smaller still-active question set', async () => {
  const state = initial();
  const first = parseRegistryUniverseAdjudication({
    registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['publication-search-source'], rationale: 'Exact NCT-linked journal publication located.',
  });
  const afterFirst = await submitRegistryUniverseAdjudicationAndResume({
    state, submission: first, actor: { sub: 'reviewer' }, now: '2026-08-11T11:05:00.000Z', resume: rebuildAfterReplay,
  });
  const review1 = afterFirst.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review1.items[0]?.requiredFields, ['resultsAvailable', 'targetOutcomeReported']);
  const history1 = afterFirst.artifacts.registryUniverseResolutionHistory as Array<{ resolvedFields: string[] }>;
  assert.deepEqual(history1[0]?.resolvedFields, ['publicationStatus']);

  const second = parseRegistryUniverseAdjudication({
    registryId: 'NCT01234567', outcome: 'mortality', resultsAvailable: true,
    evidenceIds: ['publication-search-source'], rationale: 'The exact linked publication contains trial results.',
  });
  const afterSecond = await submitRegistryUniverseAdjudicationAndResume({
    state: afterFirst, submission: second, actor: { sub: 'reviewer' }, now: '2026-08-11T11:10:00.000Z', resume: rebuildAfterReplay,
  });
  const review2 = afterSecond.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review2.items[0]?.requiredFields, ['targetOutcomeReported']);
  const history2 = afterSecond.artifacts.registryUniverseResolutionHistory as Array<{ resolvedFields: string[] }>;
  assert.equal(history2.length, 2);
});

test('already-resolved field cannot be silently changed on a later partial submission', async () => {
  const state = initial();
  const first = parseRegistryUniverseAdjudication({
    registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['publication-search-source'], rationale: 'Exact publication located.',
  });
  const next = await submitRegistryUniverseAdjudicationAndResume({
    state, submission: first, actor: { sub: 'reviewer' }, resume: rebuildAfterReplay,
  });
  const conflicting = parseRegistryUniverseAdjudication({
    registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'preprint',
    evidenceIds: ['publication-search-source'], rationale: 'Attempted replacement.',
  });
  await assert.rejects(() => submitRegistryUniverseAdjudicationAndResume({
    state: next, submission: conflicting, actor: { sub: 'reviewer' }, resume: rebuildAfterReplay,
  }), /not currently unresolved/);
});

test('lost-response retry of the same field resolution is idempotent', async () => {
  const state = initial();
  let resumes = 0;
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['publication-search-source'], rationale: 'Exact publication located.',
  });
  const first = await submitRegistryUniverseAdjudicationAndResume({
    state, submission, actor: { sub: 'reviewer' }, resume: async (pending) => { resumes += 1; return rebuildAfterReplay(pending); },
  });
  const second = await submitRegistryUniverseAdjudicationAndResume({
    state: first, submission, actor: { sub: 'reviewer' }, resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(second, first);
  assert.equal(resumes, 1);
  assert.equal((first.artifacts.registryUniverseResolutionHistory as unknown[]).length, 1);
});
