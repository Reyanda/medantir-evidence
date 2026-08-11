import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { RegistryReferenceEvidenceAgent } from '../src/certainty/registry-reference-evidence-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';
import type { TrialRegistryReference } from '../src/core/trial-registry-metadata.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse) } };
  }
}

function state(references: TrialRegistryReference[]) {
  const value = createPipelineState(fixtureRequest);
  const row: RegistryResultUniverseRecord = {
    version: 2, studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
    eligibilityStatus: 'eligible', contributesToSynthesis: false, registrySearched: true, registrationFound: true,
    resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: 'unknown', publicationStatus: 'unknown',
    evidenceIds: ['registry-source'], sourceHash: 'source-hash',
  };
  value.artifacts.registeredStudyResultUniverse = [row];
  value.artifacts.registryUniverseReviewPackage = {
    version: 1, createdAt: '2026-08-11T11:00:00.000Z',
    items: [{
      registryId: 'NCT01234567', outcome: 'mortality', reason: 'unresolved',
      requiredFields: ['resultsAvailable', 'targetOutcomeReported', 'publicationStatus'], evidenceIds: ['registry-source'],
      sourceDerived: {
        eligibilityStatus: 'eligible', eligibilityExactMatches: 5, eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
        registryResultsPosted: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: 'unknown', publicationStatus: 'unknown', exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: [],
      },
    }],
  };
  value.artifacts.searchResults = [{
    id: 'nct:nct01234567', title: 'Trial', abstract: '', authors: [], year: 2024, sourceDatabases: ['clinicaltrials.gov'],
    trialRegistry: {
      source: 'clinicaltrials.gov', registryId: 'NCT01234567', hasPostedResults: false,
      conditions: [], keywords: [], design: { phases: [] }, eligibility: { standardAges: [] }, arms: [], interventions: [],
      primaryOutcomes: [{ measure: 'mortality' }], secondaryOutcomes: [], reportedOutcomes: [], references,
      sourceSchema: 'clinicaltrials.gov-api-v2',
    },
  }];
  return value;
}

test('PMID-bearing RESULT reference establishes a published result exists', async () => {
  const result = await new RegistryReferenceEvidenceAgent(new Capture()).execute({
    state: state([{ type: 'RESULT', pmid: '12345678', citation: 'Trial results publication.' }]),
    now: () => '2026-08-11T11:10:00.000Z',
  });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.resultsAvailable, true);
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.targetOutcomeReported, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['targetOutcomeReported']);
  const receipt = (result.artifacts.registryResultReferenceReceipts as Array<{ pmid?: string; establishesPublishedStatus: boolean }>)[0]!;
  assert.equal(receipt.pmid, '12345678');
  assert.equal(receipt.establishesPublishedStatus, true);
});

test('citation-only RESULT reference establishes results but not indexed publication status', async () => {
  const result = await new RegistryReferenceEvidenceAgent(new Capture()).execute({
    state: state([{ type: 'RESULT', citation: 'Conference or publication result reference without PMID.' }]),
    now: () => '2026-08-11T11:10:00.000Z',
  });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.resultsAvailable, true);
  assert.equal(row.publicationStatus, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['targetOutcomeReported', 'publicationStatus']);
});

test('BACKGROUND reference has no publication-bias completeness authority', async () => {
  const result = await new RegistryReferenceEvidenceAgent(new Capture()).execute({
    state: state([{ type: 'BACKGROUND', pmid: '99999999', citation: 'Background science.' }]),
    now: () => '2026-08-11T11:10:00.000Z',
  });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.resultsAvailable, 'unknown');
  assert.equal(row.publicationStatus, 'unknown');
  assert.equal((result.artifacts.registryResultReferenceReceipts as unknown[]).length, 0);
  const quality = result.artifacts.registryResultReferenceQuality as { backgroundReferencesUsedAsResultsEvidence: boolean };
  assert.equal(quality.backgroundReferencesUsedAsResultsEvidence, false);
});
