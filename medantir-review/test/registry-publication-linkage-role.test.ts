import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, EvidenceRecord } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { RegistryPublicationLinkageAgent } from '../src/certainty/registry-publication-linkage-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(_context: AgentContext): Promise<AgentResult> { return { artifacts: {} }; }
}

function state(record: EvidenceRecord) {
  const value = createPipelineState(fixtureRequest);
  const row: RegistryResultUniverseRecord = {
    version: 2, studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
    eligibilityStatus: 'eligible', contributesToSynthesis: false, registrySearched: true, registrationFound: true,
    resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: 'unknown', publicationStatus: 'unknown',
    evidenceIds: ['registry-source'], sourceHash: 'source-hash',
  };
  value.artifacts.registeredStudyResultUniverse = [row];
  value.artifacts.registryUniverseReviewPackage = {
    version: 1, createdAt: '2026-08-11T10:00:00.000Z',
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
  value.artifacts.uniqueRecords = [record];
  value.artifacts.studyFamilyLinks = [];
  value.artifacts.extractedStudies = [];
  return value;
}

test('single-NCT commentary is not accepted as the trial publication', async () => {
  const record: EvidenceRecord = {
    id: 'commentary-1',
    title: 'Commentary on NCT01234567',
    abstract: 'This commentary discusses implications of the trial for clinical practice.',
    authors: ['A Commentator'], year: 2025, journal: 'Commentary Journal', doi: '10.1000/commentary',
    sourceDatabases: ['PubMed'], keywords: ['NCT01234567', 'commentary'],
  };
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({
    state: state(record), now: () => '2026-08-11T10:30:00.000Z',
  });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'unknown');
  assert.equal(row.resultsAvailable, 'unknown');
  assert.equal((result.artifacts.registryPublicationLinkReceipts as unknown[]).length, 0);
  const quality = result.artifacts.registryPublicationLinkageQuality as {
    rejectedBibliographicInsufficientReportRole: number;
    semanticLinkingUsed: boolean;
  };
  assert.equal(quality.rejectedBibliographicInsufficientReportRole, 1);
  assert.equal(quality.semanticLinkingUsed, false);
});

test('single-NCT systematic review is not accepted as a trial publication', async () => {
  const record: EvidenceRecord = {
    id: 'review-1',
    title: 'Systematic review including NCT01234567',
    abstract: 'We reviewed randomized trials and report pooled mortality results.',
    authors: ['A Reviewer'], year: 2025, journal: 'Review Journal', doi: '10.1000/review',
    sourceDatabases: ['PubMed'], keywords: ['NCT01234567', 'systematic review'],
  };
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({
    state: state(record), now: () => '2026-08-11T10:30:00.000Z',
  });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'unknown');
  assert.equal((result.artifacts.registryPublicationLinkReceipts as unknown[]).length, 0);
});
