import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { refreshScientificRunArtifacts } from '../src/core/scientific-run-manifest.js';
import { verifierArtifact, VERIFIER_READABLE_ARTIFACTS } from '../src/core/verifier-view.js';

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

function sealed() {
  const state = createPipelineState({
    reviewType: 'systematic', databases: ['PubMed', 'ClinicalTrials.gov'],
    question: { title: 'Publication bias audit', objective: 'Audit the eligible evidence universe.', population: 'children', interventionOrExposure: 'treatment', comparator: 'control', outcomes: ['mortality'] },
  });
  state.artifacts.publicationBiasUniversePolicy = {
    id: 'pb-policy-1', version: '1', protocolHash: 'protocol-1', frozenAt: '2026-08-11T10:00:00.000Z', rationale: 'Prospective.',
    minimumEligibleUniverseRegistryCoverage: 1,
    requireEligibilityResolvedForAssessmentBasis: true,
    requireResultAvailabilityKnownForAssessmentBasis: true,
    requirePrimaryOutcomeSpecificationKnownForAssessmentBasis: true,
    requireTargetOutcomeStatusKnownForAssessmentBasis: true,
    requirePublicationStatusKnownForAssessmentBasis: true,
  };
  state.artifacts.registeredStudyResultUniverse = [{
    version: 2, studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
    eligibilityStatus: 'eligible', contributesToSynthesis: false, registrySearched: true, registrationFound: true,
    resultsAvailable: true, prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: true, publicationStatus: 'published',
    evidenceIds: ['registry-source:1', 'publication-link:1'], sourceHash: 'source-hash-1',
  }];
  state.artifacts.registryUniverseResolutionHistory = [{
    version: 1, receiptId: 'registry-resolution-1', registryId: 'NCT01234567', outcome: 'mortality', actorId: 'user:reviewer',
    decidedAt: '2026-08-11T10:15:00.000Z', resolvedFields: ['publicationStatus'], submittedValues: { publicationStatus: 'published' },
    evidenceIds: ['publication-link:1'], rationale: 'Exact NCT publication.', beforeAdjudicationHash: null, afterAdjudicationHash: 'after-1', semanticHash: 'semantic-1',
  }];
  state.artifacts.registryResultReferenceReceipts = [{
    version: 1, registryId: 'NCT01234567', outcome: 'mortality', pmid: '12345678', citation: 'Primary trial results.',
    referenceType: 'RESULT', establishesResultsAvailable: true, establishesPublishedStatus: true,
    evidenceIds: ['registry-result-reference:1', 'registry-source:1'], receiptHash: 'result-reference-receipt-1',
  }];
  state.artifacts.registryResultReferenceQuality = {
    resultReferences: 1, pmidResultReferences: 1, backgroundReferencesUsedAsResultsEvidence: false,
  };
  state.artifacts.registryPublicationDiscoveryRecords = [{
    id: 'pubmed-1', title: 'Randomized trial results NCT01234567', abstract: 'Results.', authors: ['A'], year: 2024,
    journal: 'Clinical Trials', pmid: '12345678', doi: '10.1000/results', sourceDatabases: ['PubMed'],
    keywords: ['registry-discovery-query:NCT01234567'],
  }];
  state.artifacts.registryPublicationDiscoveryReceipts = [{
    version: 1, registryId: 'NCT01234567', database: 'PubMed', query: 'NCT01234567', actionId: 'extact-1',
    resultCount: 1, provenanceHash: 'provenance-hash-1', recordHashes: ['record-hash-1'], receiptHash: 'discovery-receipt-1',
  }];
  state.artifacts.registryPublicationDiscoveryProvenance = [{
    database: 'PubMed', platform: 'NCBI PubMed', executedQuery: 'NCT01234567', executedAt: '2026-08-11T10:05:00.000Z',
    resultCount: 1, exportFormat: 'NBIB', warnings: [],
  }];
  state.artifacts.registryPublicationDiscoveryQuality = {
    version: 1, targetRegistryIds: ['NCT01234567'], databases: ['PubMed'], searchesAttempted: 1, searchesCompleted: 1,
    discoveredRecords: 1, durableCoordinatorUsed: true,
  };
  state.artifacts.registryPublicationLinkReceipts = [{
    version: 1, registryId: 'NCT01234567', recordId: 'pubmed-1', linkageRoute: 'bibliographic-unique-nct', reportRole: 'results-bearing',
    publicationStatus: 'published', resultsAvailable: true, exactRegistryIdentity: true, targetOutcomeReported: true,
    evidenceIds: ['bibliographic-unique-nct:1', 'publication-record:1'], receiptHash: 'publication-receipt-1',
  }];
  state.artifacts.publicationBiasUniverseAudits = [{
    version: 2, outcome: 'mortality', contributingStudyCount: 1, eligibleUniverseCount: 1, unresolvedEligibilityCount: 0,
    eligibleRegistrySearchCoverage: 1, knownResultAvailabilityCount: 1, knownPrimaryOutcomeSpecificationCount: 1,
    knownTargetOutcomeStatusCount: 1, knownPublicationStatusCount: 1, signals: [], auditDebt: [], assessmentBasisComplete: true,
    assessmentBasisEvidenceIds: ['registry-universe-record:source-hash-1'], unresolvedReasons: [], policyId: 'pb-policy-1', auditHash: 'audit-hash-1',
  }];
  state.artifacts.publicationBiasEvidenceCatalog = [{
    id: 'publication-bias-universe-audit:audit-hash-1', outcome: 'mortality', method: 'eligible-universe-registry-result-publication-audit',
    assessmentBasisComplete: true, evidenceIds: ['registry-universe-record:source-hash-1'],
  }];
  state.artifacts.fullTexts = [{ recordId: 'pubmed-1', content: 'licensed body must never be verifier-readable' }];
  refreshScientificRunArtifacts(state, createReviewProtocol('systematic'));
  return state;
}

test('body-free publication-bias reference, discovery and universe receipts are independently verifier-readable', () => {
  const state = sealed();
  for (const key of [
    'publicationBiasUniversePolicy',
    'registeredStudyResultUniverse',
    'registryUniverseResolutionHistory',
    'registryResultReferenceReceipts',
    'registryResultReferenceQuality',
    'registryPublicationDiscoveryRecords',
    'registryPublicationDiscoveryReceipts',
    'registryPublicationDiscoveryProvenance',
    'registryPublicationDiscoveryQuality',
    'registryPublicationLinkReceipts',
    'publicationBiasUniverseAudits',
    'publicationBiasEvidenceCatalog',
  ]) {
    assert.equal(VERIFIER_READABLE_ARTIFACTS.has(key), true);
    const response = verifierArtifact(state, key) as { key: string; receipt: { hash: string }; value: unknown };
    assert.equal(response.key, key);
    assert.ok(response.receipt.hash.length > 40);
    assert.ok(response.value);
  }
});

test('raw full-text remains forbidden despite publication discovery and linkage verification', () => {
  const state = sealed();
  assert.throws(() => verifierArtifact(state, 'fullTexts'), (error) => statusOf(error) === 403);
});

test('mutating sealed universe, discovery, or resolution receipts fails closed', () => {
  const state = sealed();
  (state.artifacts.registeredStudyResultUniverse as Array<{ publicationStatus: string }>)[0]!.publicationStatus = 'unknown';
  assert.throws(
    () => verifierArtifact(state, 'registeredStudyResultUniverse'),
    (error) => statusOf(error) === 409 && /no longer matches/i.test((error as Error).message),
  );

  const discovery = sealed();
  (discovery.artifacts.registryPublicationDiscoveryReceipts as Array<{ resultCount: number }>)[0]!.resultCount = 999;
  assert.throws(
    () => verifierArtifact(discovery, 'registryPublicationDiscoveryReceipts'),
    (error) => statusOf(error) === 409 && /no longer matches/i.test((error as Error).message),
  );

  const resolution = sealed();
  (resolution.artifacts.registryUniverseResolutionHistory as Array<{ actorId: string }>)[0]!.actorId = 'user:tampered';
  assert.throws(
    () => verifierArtifact(resolution, 'registryUniverseResolutionHistory'),
    (error) => statusOf(error) === 409 && /no longer matches/i.test((error as Error).message),
  );
});
