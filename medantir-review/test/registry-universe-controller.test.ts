import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  parseRegistryUniverseAdjudication,
  submitRegistryUniverseAdjudicationAndResume,
} from '../src/certainty/registry-universe-controller.js';

function state(input: {
  sourceEligibility?: 'eligible' | 'ineligible' | 'unresolved';
  requiredFields?: string[];
} = {}) {
  const sourceEligibility = input.sourceEligibility ?? 'unresolved';
  const requiredFields = input.requiredFields ?? ['eligibilityStatus', 'resultsAvailable', 'targetOutcomeReported', 'publicationStatus'];
  const value = createPipelineState(fixtureRequest);
  value.stages.grade.status = 'awaiting-human';
  value.stages.grade.attempts = 1;
  value.artifacts.registryUniverseReviewPackage = {
    version: 1,
    createdAt: '2026-08-11T09:00:00.000Z',
    items: [{
      registryId: 'NCT00000002',
      outcome: 'mortality',
      title: 'Registry candidate',
      reason: 'Material registry fields unresolved.',
      requiredFields,
      evidenceIds: ['registry-search-record:abc', 'publication-link:abc'],
      sourceDerived: {
        eligibilityStatus: sourceEligibility,
        eligibilityAssessmentHash: 'eligibility-hash',
        eligibilityExactMatches: sourceEligibility === 'eligible' ? 5 : 3,
        eligibilityContradictedFacets: sourceEligibility === 'ineligible' ? ['design'] : [],
        eligibilityUnresolvedFacets: sourceEligibility === 'unresolved' ? ['population'] : [],
        registryResultsPosted: false,
        resultsAvailable: 'unknown',
        prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: 'unknown',
        publicationStatus: 'unknown',
        exactPrimaryOutcomeMatches: ['mortality'],
        exactReportedOutcomeMatches: [],
      },
    }],
  };
  value.artifacts.grade = [{ outcome: 'mortality', certainty: 'high' }];
  value.artifacts.finalReport = { title: 'stale' };
  value.artifacts.scientificRunManifest = { stale: true };
  value.artifacts.scientificRunSeal = { stale: true };
  value.stages.report.status = 'passed';
  value.stages['human-verify'].status = 'passed';
  return value;
}

test('one required field is attributable and invalidates stale downstream science', async () => {
  const value = state({ sourceEligibility: 'eligible', requiredFields: ['publicationStatus'] });
  let resumes = 0;
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['publication-link:abc'], rationale: 'Exact NCT-linked peer-reviewed publication located.',
    actorId: 'spoofed',
  });
  const result = await submitRegistryUniverseAdjudicationAndResume({
    state: value, submission, actor: { sub: 'real-reviewer' }, now: '2026-08-11T09:30:00.000Z',
    resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(resumes, 1);
  const ledger = result.artifacts.registryUniverseAdjudications as Array<{ actorId: string; publicationStatus: string }>;
  assert.equal(ledger[0]?.actorId, 'user:real-reviewer');
  assert.equal(ledger[0]?.publicationStatus, 'published');
  const history = result.artifacts.registryUniverseResolutionHistory as Array<{ actorId: string; resolvedFields: string[] }>;
  assert.equal(history[0]?.actorId, 'user:real-reviewer');
  assert.deepEqual(history[0]?.resolvedFields, ['publicationStatus']);
  assert.equal(result.stages.grade.status, 'pending');
  assert.equal(result.stages.report.status, 'pending');
  assert.equal(result.stages['human-verify'].status, 'pending');
  assert.equal(result.artifacts.grade, undefined);
  assert.equal(result.artifacts.finalReport, undefined);
  assert.equal(result.artifacts.scientificRunManifest, undefined);
  assert.equal(result.artifacts.scientificRunSeal, undefined);
});

test('source-proven eligibility is inherited when resolving a different field', async () => {
  const value = state({ sourceEligibility: 'eligible', requiredFields: ['resultsAvailable'] });
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', resultsAvailable: true,
    evidenceIds: ['publication-link:abc'], rationale: 'Exact linked results publication is available.',
  });
  const result = await submitRegistryUniverseAdjudicationAndResume({
    state: value, submission, actor: { sub: 'r' }, resume: async (pending) => pending,
  });
  const adjudication = (result.artifacts.registryUniverseAdjudications as Array<{
    eligibilityStatus: string; resultsAvailable: boolean | string; prespecifiedPrimaryOutcomeFound: boolean | string;
    targetOutcomeReported: boolean | string; publicationStatus: string;
  }>)[0]!;
  assert.equal(adjudication.eligibilityStatus, 'eligible');
  assert.equal(adjudication.resultsAvailable, true);
  assert.equal(adjudication.prespecifiedPrimaryOutcomeFound, true);
  assert.equal(adjudication.targetOutcomeReported, 'unknown');
  assert.equal(adjudication.publicationStatus, 'unknown');
});

test('submission may resolve only fields that are currently required', async () => {
  const value = state({ sourceEligibility: 'eligible', requiredFields: ['publicationStatus'] });
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', resultsAvailable: true,
    evidenceIds: ['publication-link:abc'], rationale: 'Attempt to mutate a non-requested field.',
  });
  await assert.rejects(() => submitRegistryUniverseAdjudicationAndResume({
    state: value, submission, actor: { sub: 'r' }, resume: async (pending) => pending,
  }), /not currently unresolved/);
});

test('unknown or unresolved values do not count as scientific progress', async () => {
  const value = state({ sourceEligibility: 'unresolved', requiredFields: ['eligibilityStatus', 'publicationStatus'] });
  const unresolvedEligibility = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', eligibilityStatus: 'unresolved',
    evidenceIds: ['registry-search-record:abc'], rationale: 'Still uncertain.',
  });
  await assert.rejects(() => submitRegistryUniverseAdjudicationAndResume({
    state: value, submission: unresolvedEligibility, actor: { sub: 'r' }, resume: async (pending) => pending,
  }), /does not resolve/);
  const unknownPublication = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', publicationStatus: 'unknown',
    evidenceIds: ['publication-link:abc'], rationale: 'Still uncertain.',
  });
  await assert.rejects(() => submitRegistryUniverseAdjudicationAndResume({
    state: value, submission: unknownPublication, actor: { sub: 'r' }, resume: async (pending) => pending,
  }), /does not resolve/);
});

test('resolution cannot cite evidence outside active candidate evidence catalog', async () => {
  const value = state({ sourceEligibility: 'eligible', requiredFields: ['publicationStatus'] });
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['fabricated-source'], rationale: 'Attempt to inject evidence.',
  });
  await assert.rejects(() => submitRegistryUniverseAdjudicationAndResume({
    state: value, submission, actor: { sub: 'r' }, resume: async (pending) => pending,
  }), /unknown evidence id/);
});

test('identical lost-response retry is idempotent', async () => {
  const value = state({ sourceEligibility: 'eligible', requiredFields: ['publicationStatus'] });
  let resumes = 0;
  const submission = parseRegistryUniverseAdjudication({
    registryId: 'NCT00000002', outcome: 'mortality', publicationStatus: 'published',
    evidenceIds: ['publication-link:abc'], rationale: 'Exact publication located.',
  });
  const first = await submitRegistryUniverseAdjudicationAndResume({
    state: value, submission, actor: { sub: 'r' },
    resume: async (pending) => { resumes += 1; pending.stages.grade.status = 'awaiting-human'; return pending; },
  });
  const second = await submitRegistryUniverseAdjudicationAndResume({
    state: first, submission, actor: { sub: 'r' }, resume: async (pending) => { resumes += 1; return pending; },
  });
  assert.equal(second, first);
  assert.equal(resumes, 1);
  assert.equal((first.artifacts.registryUniverseResolutionHistory as unknown[]).length, 1);
});
