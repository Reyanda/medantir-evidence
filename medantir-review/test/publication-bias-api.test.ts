import test from 'node:test';
import assert from 'node:assert/strict';
import type { PipelineState } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { compileReviewSpec } from '../src/question/review-spec.js';
import { handlePublicationBiasApi } from '../src/certainty/publication-bias-api.js';

function request() {
  return {
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  };
}

function run() {
  const req = request();
  const state = createPipelineState(req);
  state.runId = 'pb-api-run';
  const compilation = compileReviewSpec(req, { now: '2026-08-11T08:00:00.000Z' });
  assert.equal(compilation.status, 'complete');
  state.artifacts.reviewSpec = compilation.spec;
  state.artifacts.reviewSpecCompilation = { status: compilation.status, reviewSpecHash: compilation.spec.hash, safeDefaults: compilation.safeDefaults, unresolvedMaterialFields: [] };
  state.artifacts.protocolPackage = { checksum: 'protocol-api' };
  state.stages['protocol-finalise'].status = 'awaiting-human';
  state.artifacts.publicationBiasUniversePolicyRequirement = {
    version: 1, status: 'search-plan-incompatible', protocolHash: 'protocol-api',
    endpoint: '/runs/:runId/grade/publication-bias-policy', searchAmendmentEndpoint: '/runs/:runId/grade/publication-bias-search',
    requiredParameters: [], reason: 'registry required', searchPlanCompatible: false, plannedRegistrySources: [], supportedAutomaticRegistrySources: ['clinicaltrials.gov'],
  };
  return state;
}

const policyBody = {
  version: '1', rationale: 'Prospective full-universe audit.',
  minimumEligibleUniverseRegistryCoverage: 1,
  requireEligibilityResolvedForAssessmentBasis: true,
  requireResultAvailabilityKnownForAssessmentBasis: true,
  requireTargetOutcomeStatusKnownForAssessmentBasis: true,
};

function context(input: {
  state?: ReturnType<typeof run>;
  method: string;
  path: string;
  body?: unknown;
  executing?: boolean;
  resume?: (state: PipelineState) => Promise<PipelineState>;
}) {
  let scheduled = 0;
  let resumed = 0;
  const ctx = {
    method: input.method,
    pathname: input.path,
    identitySub: 'real-user',
    stateFor: (id: string) => id === input.state?.runId ? input.state : undefined,
    isExecuting: () => Boolean(input.executing),
    readBody: async () => input.body ?? {},
    resume: async (state: PipelineState) => {
      resumed += 1;
      return input.resume ? input.resume(state) : state;
    },
    schedule: () => { scheduled += 1; return true; },
    now: () => '2026-08-11T09:00:00.000Z',
  };
  return { ctx, counts: () => ({ scheduled, resumed }) };
}

test('publication-bias policy POST injects authenticated actor and schedules replay', async () => {
  const state = run();
  const { ctx, counts } = context({ state, method: 'POST', path: `/runs/${state.runId}/grade/publication-bias-policy`, body: policyBody });
  const response = await handlePublicationBiasApi(ctx);
  assert.equal(response?.status, 202);
  assert.equal(counts().scheduled, 1);
  const amendments = state.artifacts.publicationBiasUniversePolicyAmendments as Array<{ actorId: string }>;
  assert.equal(amendments[0]?.actorId, 'user:real-user');
  const policy = state.artifacts.publicationBiasUniversePolicy as { requirePublicationStatusKnownForAssessmentBasis: boolean };
  assert.equal(policy.requirePublicationStatusKnownForAssessmentBasis, true);
});

test('publication-bias methodology mutation is rejected while run executes', async () => {
  const state = run();
  const { ctx, counts } = context({ state, method: 'POST', path: `/runs/${state.runId}/grade/publication-bias-policy`, body: policyBody, executing: true });
  const response = await handlePublicationBiasApi(ctx);
  assert.equal(response?.status, 409);
  assert.equal(counts().scheduled, 0);
  assert.equal(state.artifacts.publicationBiasUniversePolicy, undefined);
});

test('registry-search route delegates to source-bound amendment controller', async () => {
  const state = run();
  const { ctx, counts } = context({
    state, method: 'POST', path: `/runs/${state.runId}/grade/publication-bias-search`,
    body: { source: 'ClinicalTrials.gov', rationale: 'Required by prospective completeness policy.' },
  });
  const response = await handlePublicationBiasApi(ctx);
  assert.equal(response?.status, 202);
  assert.equal(counts().resumed, 1);
  assert.ok(state.request.databases.includes('ClinicalTrials.gov'));
  const amendments = state.artifacts.registrySearchSourceAmendments as Array<{ actorId: string }>;
  assert.equal(amendments[0]?.actorId, 'user:real-user');
});

test('one-field registry resolution replays into a smaller requiredFields set', async () => {
  const state = run();
  state.stages.grade.status = 'awaiting-human';
  state.artifacts.registryUniverseReviewPackage = {
    version: 1, createdAt: '2026-08-11T08:30:00.000Z',
    items: [{
      registryId: 'NCT01234567', outcome: 'mortality', reason: 'three fields unresolved',
      requiredFields: ['resultsAvailable', 'targetOutcomeReported', 'publicationStatus'],
      evidenceIds: ['registry-source', 'publication-source'],
      sourceDerived: {
        eligibilityStatus: 'eligible', eligibilityExactMatches: 5, eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
        registryResultsPosted: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: 'unknown', publicationStatus: 'unknown', exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: [],
      },
    }],
  };
  const { ctx, counts } = context({
    state,
    method: 'POST',
    path: `/runs/${state.runId}/grade/registry-universe`,
    body: {
      registryId: 'NCT01234567', outcome: 'mortality', publicationStatus: 'published',
      evidenceIds: ['publication-source'], rationale: 'Exact NCT-linked journal publication located.',
    },
    resume: async (pending) => {
      const current = (pending.artifacts.registryUniverseAdjudications as Array<{
        registryId: string; outcome: string; resultsAvailable: boolean | string;
        prespecifiedPrimaryOutcomeFound: boolean | string; targetOutcomeReported: boolean | string; publicationStatus: string;
        eligibilityStatus: string; evidenceIds: string[]; adjudicationHash: string;
      }>)[0]!;
      pending.artifacts.registeredStudyResultUniverse = [{
        version: 2, studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
        eligibilityStatus: current.eligibilityStatus, contributesToSynthesis: false, registrySearched: true, registrationFound: true,
        resultsAvailable: current.resultsAvailable, prespecifiedPrimaryOutcomeFound: current.prespecifiedPrimaryOutcomeFound,
        targetOutcomeReported: current.targetOutcomeReported, publicationStatus: current.publicationStatus,
        evidenceIds: ['registry-source', 'publication-source', ...current.evidenceIds], sourceHash: current.adjudicationHash,
      }];
      pending.artifacts.registryUniverseReviewPackage = {
        version: 1, createdAt: '2026-08-11T08:30:00.000Z',
        items: [{
          registryId: 'NCT01234567', outcome: 'mortality', reason: 'two fields unresolved',
          requiredFields: ['resultsAvailable', 'targetOutcomeReported'], evidenceIds: ['registry-source', 'publication-source'],
          sourceDerived: {
            eligibilityStatus: 'eligible', eligibilityExactMatches: 5, eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
            registryResultsPosted: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true,
            targetOutcomeReported: 'unknown', publicationStatus: 'unknown', exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: [],
          },
        }],
      };
      pending.stages.grade.status = 'awaiting-human';
      return pending;
    },
  });
  const response = await handlePublicationBiasApi(ctx);
  assert.equal(response?.status, 202);
  assert.equal(counts().resumed, 1);
  const payload = response?.payload as PipelineState;
  const review = payload.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['resultsAvailable', 'targetOutcomeReported']);
  const history = payload.artifacts.registryUniverseResolutionHistory as Array<{ actorId: string; resolvedFields: string[] }>;
  assert.equal(history[0]?.actorId, 'user:real-user');
  assert.deepEqual(history[0]?.resolvedFields, ['publicationStatus']);
});

test('registry-universe GET projects resolution and publication-link audit state without mutation', async () => {
  const state = run();
  state.artifacts.registryUniverseReviewPackage = { version: 1, items: [], createdAt: 'x' };
  state.artifacts.registeredStudyResultUniverse = [{ studyId: 's1' }];
  state.artifacts.publicationBiasUniverseAudits = [{ outcome: 'mortality' }];
  state.artifacts.registryUniverseResolutionHistory = [{ receiptId: 'r1' }];
  state.artifacts.registryPublicationLinkReceipts = [{ receiptHash: 'p1' }];
  const { ctx, counts } = context({ state, method: 'GET', path: `/runs/${state.runId}/grade/registry-universe` });
  const response = await handlePublicationBiasApi(ctx);
  assert.equal(response?.status, 200);
  const payload = response?.payload as { universe: unknown[]; audits: unknown[]; resolutionHistory: unknown[]; publicationLinks: unknown[] };
  assert.equal(payload.universe.length, 1);
  assert.equal(payload.audits.length, 1);
  assert.equal(payload.resolutionHistory.length, 1);
  assert.equal(payload.publicationLinks.length, 1);
  assert.deepEqual(counts(), { scheduled: 0, resumed: 0 });
});

test('unknown run is returned as 404 and unrelated routes are ignored', async () => {
  const { ctx } = context({ method: 'GET', path: '/runs/missing/grade/registry-universe' });
  const missing = await handlePublicationBiasApi(ctx);
  assert.equal(missing?.status, 404);
  const other = await handlePublicationBiasApi({ ...ctx, pathname: '/health' });
  assert.equal(other, null);
});
