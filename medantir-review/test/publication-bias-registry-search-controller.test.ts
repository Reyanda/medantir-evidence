import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { compileReviewSpec } from '../src/question/review-spec.js';
import {
  parseRegistrySearchSourceSubmission,
  submitRegistrySearchSourceAndResume,
} from '../src/certainty/publication-bias-registry-search-controller.js';

function state() {
  const request = {
    ...fixtureRequest,
    question: { ...fixtureRequest.question, studyDesigns: ['randomised controlled trial'] },
  };
  const value = createPipelineState(request);
  const compilation = compileReviewSpec(request, { now: '2026-08-11T08:00:00.000Z' });
  assert.equal(compilation.status, 'complete');
  value.artifacts.reviewSpec = compilation.spec;
  value.artifacts.reviewSpecCompilation = {
    status: compilation.status,
    reviewSpecHash: compilation.spec.hash,
    safeDefaults: compilation.safeDefaults,
    unresolvedMaterialFields: compilation.unresolvedMaterialFields,
  };
  value.artifacts.protocolPackage = { checksum: 'old-protocol' };
  value.artifacts.searchStrategies = [{ database: 'PubMed', platform: 'NCBI PubMed', query: 'q', generatedAt: '2026-08-11T08:00:00.000Z' }];
  value.artifacts.gradePolicySet = { marker: 'grade-policy' };
  value.artifacts.publicationBiasUniversePolicy = { marker: 'pb-policy' };
  value.artifacts.publicationBiasUniversePolicyRequirement = {
    version: 1,
    status: 'search-plan-incompatible',
    protocolHash: 'old-protocol',
    endpoint: '/runs/:runId/grade/publication-bias-policy',
    searchAmendmentEndpoint: '/runs/:runId/grade/publication-bias-search',
    requiredParameters: [],
    reason: 'registry required',
    searchPlanCompatible: false,
    plannedRegistrySources: [],
    supportedAutomaticRegistrySources: ['clinicaltrials.gov'],
  };
  value.stages['search-build'].status = 'passed';
  value.stages['search-test'].status = 'passed';
  value.stages['protocol-finalise'].status = 'awaiting-human';
  value.stages['protocol-finalise'].attempts = 1;
  return value;
}

test('registry search amendment updates ReviewSpec and replays from search-build without losing policies', async () => {
  const value = state();
  let resumes = 0;
  const submission = parseRegistrySearchSourceSubmission({
    source: 'ClinicalTrials.gov',
    rationale: 'The prospective completeness policy requires a trial-registry search.',
    actorId: 'spoofed-client',
  });
  const result = await submitRegistrySearchSourceAndResume({
    state: value,
    submission,
    actor: { sub: 'methodologist' },
    now: '2026-08-11T08:10:00.000Z',
    resume: async (pending) => { resumes += 1; return pending; },
  });

  assert.equal(resumes, 1);
  assert.ok(result.request.databases.includes('ClinicalTrials.gov'));
  const spec = result.artifacts.reviewSpec as { fields: { databases: { value?: string[] } }; hash: string };
  assert.ok(spec.fields.databases.value?.includes('ClinicalTrials.gov'));
  assert.equal(result.artifacts.protocolPackage, undefined);
  assert.equal(result.artifacts.searchStrategies, undefined);
  assert.equal(result.stages['search-build'].status, 'pending');
  assert.equal(result.stages['protocol-finalise'].status, 'pending');
  assert.deepEqual(result.artifacts.gradePolicySet, { marker: 'grade-policy' });
  assert.deepEqual(result.artifacts.publicationBiasUniversePolicy, { marker: 'pb-policy' });
  const ledger = result.artifacts.registrySearchSourceAmendments as Array<{ actorId: string; source: string }>;
  assert.equal(ledger[0]?.actorId, 'user:methodologist');
  assert.equal(ledger[0]?.source, 'clinicaltrials.gov');
  const amendments = result.artifacts.protocolAmendments as Array<{ field: string; earliestReplayStage: string }>;
  assert.ok(amendments.some((item) => item.field === 'databases' && item.earliestReplayStage === 'search-build'));
});

test('identical lost-response retry does not replay search-build twice', async () => {
  const value = state();
  let resumes = 0;
  const submission = parseRegistrySearchSourceSubmission({
    source: 'clinicaltrials.gov',
    rationale: 'Registry search required prospectively.',
  });
  const first = await submitRegistrySearchSourceAndResume({
    state: value,
    submission,
    actor: { sub: 'm' },
    now: '2026-08-11T08:10:00.000Z',
    resume: async (pending) => { resumes += 1; pending.stages['protocol-finalise'].status = 'awaiting-human'; return pending; },
  });
  await submitRegistrySearchSourceAndResume({
    state: first,
    submission,
    actor: { sub: 'm' },
    now: '2026-08-11T08:11:00.000Z',
    resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(resumes, 1);
  assert.equal((first.artifacts.registrySearchSourceAmendments as unknown[]).length, 1);
  assert.equal(first.request.databases.filter((item) => /clinicaltrials/i.test(item)).length, 1);
});

test('unsupported registry source is rejected before state mutation', () => {
  const value = state();
  assert.throws(
    () => parseRegistrySearchSourceSubmission({ source: 'Some unknown registry', rationale: 'Try it.' }),
    /Only ClinicalTrials\.gov is currently supported/,
  );
  assert.equal(value.request.databases.includes('ClinicalTrials.gov'), false);
});
