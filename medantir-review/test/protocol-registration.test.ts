import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResearcherIdentity, ReviewRequest, ReviewType, SearchStrategy } from '../src/core/types.js';
import { supportedReviewTypes, buildMethodologyPlan } from '../src/protocols/methodology.js';
import { createProtocolDraft, renderProtocolMarkdown } from '../src/protocols/protocol-template-library.js';
import { DeterministicSearchStrategyTester } from '../src/registration/search-testing.js';
import { buildRegistrationPlan } from '../src/registration/registry-profiles.js';
import { fixtureRequest, fixtureRecords } from '../src/fixtures.js';
import { runMockPipeline } from '../src/engine.js';

const identity: ResearcherIdentity = {
  displayName: 'Geoffrey Manda',
  orcid: '0000-0002-1825-0097',
  authenticated: true,
  authenticationProvider: 'orcid',
  verifiedAt: '2026-07-13T00:00:00.000Z',
  scopes: ['/authenticate'],
};

test('every supported review family produces a cited, registration-ready protocol template', () => {
  for (const reviewType of supportedReviewTypes) {
    const request = { ...fixtureRequest, reviewType };
    const draft = createProtocolDraft(request, buildMethodologyPlan(request), identity, '2026-07-13T00:00:00.000Z');
    assert.equal(draft.reviewType, reviewType);
    assert.ok(draft.sections.length >= 19, `${reviewType} has insufficient protocol sections`);
    assert.ok(draft.sections.some((section) => section.id.endsWith('specifics')));
    assert.ok(draft.citations.some((citation) => citation.id === 'PRISMA-P'));
    assert.ok(draft.citations.some((citation) => citation.id === 'ORCID'));
    assert.ok(draft.sections.every((section) => section.validationRules.length > 0));
  }
});

test('protocol rendering includes database strategies, testing evidence, and references', () => {
  const plan = buildMethodologyPlan(fixtureRequest);
  const draft = createProtocolDraft(fixtureRequest, plan, identity, '2026-07-13T00:00:00.000Z');
  const strategies: SearchStrategy[] = [{
    database: 'PubMed',
    platform: 'NCBI PubMed',
    query: '"malnutrition"[Title/Abstract]',
    generatedAt: '2026-07-13T00:00:00.000Z',
  }];
  const markdown = renderProtocolMarkdown(draft, strategies, {
    status: 'passed',
    results: [{
      database: 'PubMed',
      platform: 'NCBI PubMed',
      syntaxValid: true,
      conceptsCovered: ['malnutrition'],
      conceptsMissing: [],
      warnings: [],
      errors: [],
      testedAt: '2026-07-13T00:00:00.000Z',
      testedQuery: strategies[0]!.query,
    }],
    peerReviewRequired: true,
    peerReviewStatus: 'completed',
    completedAt: '2026-07-13T00:00:00.000Z',
  });
  assert.match(markdown, /Appendix A\. Database-specific search strategies/);
  assert.match(markdown, /Search testing report/);
  assert.match(markdown, /\[PRISMA-P\]/);
  assert.match(markdown, /ORCID/);
});

test('search testing catches invalid syntax and reports possible concept omissions', async () => {
  const tester = new DeterministicSearchStrategyTester();
  const result = await tester.test({
    database: 'PubMed',
    platform: 'NCBI PubMed',
    query: '("malnutrition"[Title/Abstract] AND AND',
    generatedAt: '2026-07-13T00:00:00.000Z',
  }, fixtureRequest);
  assert.equal(result.syntaxValid, false);
  assert.ok(result.errors.some((error) => error.includes('Parentheses')));
  assert.ok(result.errors.some((error) => error.includes('Repeated Boolean')));
  assert.ok(result.conceptsMissing.length > 0);
});

test('registry planning uses PROSPERO selectively and OSF as a cross-review fallback', () => {
  const intervention: ReviewRequest = {
    ...fixtureRequest,
    reviewType: 'intervention' as ReviewType,
    registration: { enabled: true, targets: ['prospero', 'osf'], submissionMode: 'prepare-only' as const },
  };
  const interventionPlan = buildRegistrationPlan(intervention, identity, '2026-07-13T00:00:00.000Z');
  assert.equal(interventionPlan.eligibility.find((item) => item.target === 'prospero')?.eligible, true);
  assert.equal(interventionPlan.eligibility.find((item) => item.target === 'osf')?.eligible, true);

  const scoping: ReviewRequest = {
    ...fixtureRequest,
    reviewType: 'scoping' as ReviewType,
    registration: { enabled: true, targets: ['prospero', 'osf'], submissionMode: 'prepare-only' as const },
  };
  const scopingPlan = buildRegistrationPlan(scoping, identity, '2026-07-13T00:00:00.000Z');
  assert.equal(scopingPlan.eligibility.find((item) => item.target === 'prospero')?.eligible, false);
  assert.equal(scopingPlan.eligibility.find((item) => item.target === 'osf')?.eligible, true);
});

test('the pipeline freezes and registers a checksummed protocol before the definitive search', async () => {
  const request: ReviewRequest = {
    ...fixtureRequest,
    protocolDevelopment: {
      authors: [{
        givenName: 'Geoffrey',
        familyName: 'Manda',
        orcid: '0000-0002-1825-0097',
        corresponding: true,
        roles: ['Guarantor', 'Methodology'],
      }],
      searchPeerReviewRequired: false,
      protocolVersion: '1.0.0',
    },
    registration: {
      enabled: true,
      targets: ['prospero', 'osf', 'zenodo', 'github'],
      submissionMode: 'submit' as const,
      requireAuthenticatedOrcid: true,
      github: { owner: 'example', repository: 'review-protocol', createRelease: true },
    },
  };
  const state = await runMockPipeline(request, {
    PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
    MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
  });
  assert.equal(state.stages['register-protocol'].status, 'passed');
  const protocol = state.artifacts.protocolPackage as { checksum: string; files: Array<{ path: string }> };
  assert.ok(protocol.checksum.length >= 32);
  assert.ok(protocol.files.some((file) => file.path === 'CITATION.cff'));
  assert.ok(protocol.files.some((file) => file.path === '.zenodo.json'));
  assert.ok(protocol.files.some((file) => file.path === 'registration/prospero-field-map.json'));
  assert.ok(protocol.files.some((file) => file.path === 'registration/osf-field-map.json'));
  assert.ok(protocol.files.some((file) => file.path === 'registration/registry-submission-documents.json'));
  const receipts = state.artifacts.registrationReceipts as Array<{ target: string; status: string; protocolChecksum: string }>;
  assert.equal(receipts.length, 4);
  assert.ok(receipts.every((receipt) => receipt.protocolChecksum === protocol.checksum));
  const ledger = state.artifacts.protocolRegistrationLedger as { noSecretsPersisted: boolean };
  assert.equal(ledger.noSecretsPersisted, true);
  const registrationEventIndex = state.audit.findIndex((event) => event.stage === 'register-protocol' && event.event === 'passed');
  const searchEventIndex = state.audit.findIndex((event) => event.stage === 'search-execute' && event.event === 'started');
  assert.ok(registrationEventIndex >= 0 && searchEventIndex > registrationEventIndex);
});

test('definitive registration is blocked until required search peer review is documented', async () => {
  const request: ReviewRequest = {
    ...fixtureRequest,
    autoApproveHumanGates: true,
    protocolDevelopment: {
      authors: [{
        givenName: 'Geoffrey',
        familyName: 'Manda',
        orcid: '0000-0002-1825-0097',
        corresponding: true,
      }],
      searchPeerReviewRequired: true,
      searchPeerReviewCompleted: false,
    },
    registration: {
      enabled: true,
      targets: ['osf', 'zenodo'],
      submissionMode: 'submit',
      requireAuthenticatedOrcid: true,
    },
  };
  const state = await runMockPipeline(request, {
    PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
    MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
  });
  assert.equal(state.stages['register-protocol'].status, 'awaiting-human');
  assert.equal(state.stages['search-execute'].status, 'pending');
  const receipts = state.artifacts.registrationReceipts as Array<{ status: string; metadata: { peerReviewStatus?: string } }>;
  assert.ok(receipts.every((receipt) => receipt.status === 'awaiting-human'));
  assert.ok(receipts.every((receipt) => receipt.metadata.peerReviewStatus === 'pending'));
});

test('completed search peer review permits definitive registration', async () => {
  const request: ReviewRequest = {
    ...fixtureRequest,
    protocolDevelopment: {
      authors: [{
        givenName: 'Geoffrey',
        familyName: 'Manda',
        orcid: '0000-0002-1825-0097',
        corresponding: true,
      }],
      searchPeerReviewRequired: true,
      searchPeerReviewCompleted: true,
    },
    registration: {
      enabled: true,
      targets: ['osf'],
      submissionMode: 'submit',
      requireAuthenticatedOrcid: true,
    },
  };
  const state = await runMockPipeline(request, {
    PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
    MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
  });
  assert.equal(state.stages['register-protocol'].status, 'passed');
  const report = state.artifacts.searchTestReport as { peerReviewStatus: string };
  assert.equal(report.peerReviewStatus, 'completed');
});
