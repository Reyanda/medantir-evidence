import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, EvidenceRecord, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { RegistryPublicationLinkageAgent } from '../src/certainty/registry-publication-linkage-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return {
      artifacts: {
        capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse),
        capturedReview: structuredClone(context.state.artifacts.registryUniverseReviewPackage),
      },
    };
  }
}

function extracted(reportId: string, outcome = 'mortality'): ExtractedStudy {
  return {
    studyId: 'linked-study', reportIds: [reportId], design: 'randomised controlled trial',
    population: 'children', interventionOrExposure: 'treatment', comparator: 'control',
    outcomes: [{ name: outcome, effect: -0.1, standardError: 0.05 }], mechanisms: [], funding: 'unknown',
    rationale: 'r', objectives: ['o'], resultsSummary: 'results', discussionSummary: 'discussion', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {}, sourceQuotes: [],
  };
}

function state(publicationRecord: EvidenceRecord) {
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
      requiredFields: ['resultsAvailable', 'targetOutcomeReported', 'publicationStatus'],
      evidenceIds: ['registry-source'],
      sourceDerived: {
        eligibilityStatus: 'eligible', eligibilityExactMatches: 5, eligibilityContradictedFacets: [], eligibilityUnresolvedFacets: [],
        registryResultsPosted: false, resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true,
        targetOutcomeReported: 'unknown', publicationStatus: 'unknown', exactPrimaryOutcomeMatches: ['mortality'], exactReportedOutcomeMatches: [],
      },
    }],
  };
  value.artifacts.uniqueRecords = [publicationRecord];
  value.artifacts.studyFamilyLinks = [{
    recordId: publicationRecord.id, familyId: 'family-registry-nct01234567', registryIds: ['NCT01234567'],
    linkageBasis: 'single-registry-id', role: 'primary-results', confidence: 0.99, requiresHumanReview: false, reasons: [],
  }];
  value.artifacts.extractedStudies = [extracted(publicationRecord.id)];
  return value;
}

test('exact unique NCT results publication resolves publication, results and exact extracted outcome', async () => {
  const record: EvidenceRecord = {
    id: 'pubmed-123', title: 'Trial results', abstract: 'Registered as NCT01234567.', authors: ['A'], year: 2024,
    journal: 'Clinical Trials', doi: '10.1000/example', pmid: '12345678', sourceDatabases: ['PubMed'], keywords: ['NCT01234567'],
  };
  const value = state(record);
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.resultsAvailable, true);
  assert.equal(row.targetOutcomeReported, true);
  const review = result.artifacts.registryUniverseReviewPackage as { items: unknown[] };
  assert.equal(review.items.length, 0);
  const receipts = result.artifacts.registryPublicationLinkReceipts as Array<{ registryId: string; exactRegistryIdentity: boolean }>;
  assert.equal(receipts[0]?.registryId, 'NCT01234567');
  assert.equal(receipts[0]?.exactRegistryIdentity, true);
});

test('preprint primary-results linkage resolves result availability but remains distinct from peer-reviewed publication', async () => {
  const record: EvidenceRecord = {
    id: 'preprint-1', title: 'Trial results NCT01234567', abstract: '', authors: ['A'], year: 2024,
    journal: 'medRxiv', doi: '10.1101/example', sourceDatabases: ['medRxiv'], keywords: ['NCT01234567'],
  };
  const value = state(record);
  value.artifacts.extractedStudies = [];
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'preprint');
  assert.equal(row.resultsAvailable, true, 'study-family role primary-results independently establishes result-bearing report');
  assert.equal(row.targetOutcomeReported, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['targetOutcomeReported']);
});

test('exact NCT-linked protocol paper resolves publication existence but not results availability', async () => {
  const record: EvidenceRecord = {
    id: 'protocol-paper', title: 'Protocol for NCT01234567', abstract: 'Protocol only.', authors: ['A'], year: 2020,
    journal: 'Trials', doi: '10.1000/protocol', sourceDatabases: ['PubMed'], keywords: ['NCT01234567'],
  };
  const value = state(record);
  value.artifacts.studyFamilyLinks = [{
    recordId: record.id, familyId: 'family-registry-nct01234567', registryIds: ['NCT01234567'],
    linkageBasis: 'single-registry-id', role: 'protocol', confidence: 0.99, requiresHumanReview: false, reasons: [],
  }];
  value.artifacts.extractedStudies = [];
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.resultsAvailable, 'unknown');
  assert.equal(row.targetOutcomeReported, 'unknown');
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['resultsAvailable', 'targetOutcomeReported']);
  const receipt = (result.artifacts.registryPublicationLinkReceipts as Array<{ resultsAvailable: boolean | string }>)[0]!;
  assert.equal(receipt.resultsAvailable, 'unknown');
});

test('one unique bibliographic NCT can resolve publication status before study-family linkage without semantic matching', async () => {
  const record: EvidenceRecord = {
    id: 'bibliographic-only', title: 'Primary trial publication NCT01234567', abstract: '', authors: ['A'], year: 2024,
    journal: 'Lancet', doi: '10.1000/trial', sourceDatabases: ['PubMed'], keywords: [],
  };
  const value = state(record);
  value.artifacts.studyFamilyLinks = [];
  value.artifacts.extractedStudies = [];
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.resultsAvailable, 'unknown', 'publication title alone does not prove results-bearing content');
  const receipt = (result.artifacts.registryPublicationLinkReceipts as Array<{ linkageRoute: string }>)[0]!;
  assert.equal(receipt.linkageRoute, 'bibliographic-unique-nct');
});

test('multi-NCT bibliographic record remains ambiguous and is never auto-linked', async () => {
  const record: EvidenceRecord = {
    id: 'multi-nct', title: 'Pooled protocol NCT01234567 and NCT87654321', abstract: '', authors: ['A'], year: 2024,
    journal: 'Trials', doi: '10.1000/multi', sourceDatabases: ['PubMed'], keywords: [],
  };
  const value = state(record);
  value.artifacts.studyFamilyLinks = [];
  value.artifacts.extractedStudies = [];
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'unknown');
  assert.equal((result.artifacts.registryPublicationLinkReceipts as unknown[]).length, 0);
  const quality = result.artifacts.registryPublicationLinkageQuality as { ambiguousBibliographicMultiNct: number; semanticLinkingUsed: boolean };
  assert.equal(quality.ambiguousBibliographicMultiNct, 1);
  assert.equal(quality.semanticLinkingUsed, false);
});

test('registry records themselves are never mistaken for linked publications', async () => {
  const record: EvidenceRecord = {
    id: 'nct:nct01234567', title: 'NCT01234567', abstract: '', authors: [], year: 2024,
    journal: 'ClinicalTrials.gov', sourceDatabases: ['clinicaltrials.gov'], keywords: ['NCT01234567'],
  };
  const value = state(record);
  const result = await new RegistryPublicationLinkageAgent(new Capture()).execute({ state: value, now: () => '2026-08-11T10:30:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'unknown');
  assert.equal(row.resultsAvailable, 'unknown');
  assert.equal((result.artifacts.registryPublicationLinkReceipts as unknown[]).length, 0);
});
