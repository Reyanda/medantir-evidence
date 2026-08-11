import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { SearchStrategy } from '../src/core/types.js';
import { createPipelineAgents } from '../src/agents/pipeline-agents.js';
import { MockEvidenceSourceAdapter, MockFullTextRetrieval, MockPdfTextExtractor, MockResearcherIdentityPort } from '../src/adapters/mock.js';
import { DeterministicSearchStrategyTester } from '../src/registration/search-testing.js';
import { PipelineOrchestrator } from '../src/core/orchestrator.js';
import { createPipelineState } from '../src/core/state.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';
import { runMockPipeline } from '../src/engine.js';

const recordsByDatabase = {
  PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
  MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
};

test('runs the complete systematic-review pipeline', async () => {
  const state = await runMockPipeline(fixtureRequest, recordsByDatabase);
  assert.equal(state.stages.report.status, 'passed');
  assert.equal(state.stages['risk-of-bias'].status, 'passed');
  assert.equal(state.stages.grade.status, 'passed');
  const report = state.artifacts.finalReport as { prisma: { identified: number; afterDeduplication: number; fullTextIncluded: number } };
  assert.equal(report.prisma.identified, 4);
  assert.equal(report.prisma.afterDeduplication, 3);
  assert.equal(report.prisma.fullTextIncluded, 2);
  assert.ok(state.audit.some((event) => event.event === 'passed' && event.stage === 'report'));
});

test('runs a scoping review without forcing appraisal or GRADE', async () => {
  const request = { ...fixtureRequest, reviewType: 'scoping' as const };
  const state = await runMockPipeline(request, recordsByDatabase);
  assert.equal(state.stages.report.status, 'passed');
  assert.equal(state.stages['risk-of-bias'].status, 'pending');
  assert.equal(state.stages.grade.status, 'pending');
});

test('stops at a human approval gate when approval is unavailable', async () => {
  const request = { ...fixtureRequest, autoApproveHumanGates: false };
  const adapters = [
    new MockEvidenceSourceAdapter('PubMed', recordsByDatabase.PubMed),
    new MockEvidenceSourceAdapter('MEDLINE', recordsByDatabase.MEDLINE),
  ];
  const orchestrator = new PipelineOrchestrator(createPipelineAgents({
    searchAdapters: adapters,
    fullTextRetrieval: new MockFullTextRetrieval(),
    pdfExtractor: new MockPdfTextExtractor(),
    identity: new MockResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
  }));
  const state = await orchestrator.run(createPipelineState(request), createReviewProtocol('systematic'));
  assert.equal(state.stages.protocol.status, 'awaiting-human');
  assert.equal(state.stages['search-build'].status, 'pending');
});

test('retries a transient search-adapter failure and preserves the audit trail', async () => {
  class FlakyAdapter implements EvidenceSourceAdapter {
    readonly database = 'PubMed';
    attempts = 0;
    async execute(strategy: SearchStrategy) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error('Transient database timeout');
      return new MockEvidenceSourceAdapter('PubMed', recordsByDatabase.PubMed).execute(strategy);
    }
  }
  const flaky = new FlakyAdapter();
  const request = { ...fixtureRequest, databases: ['PubMed'] };
  const orchestrator = new PipelineOrchestrator(createPipelineAgents({
    searchAdapters: [flaky],
    fullTextRetrieval: new MockFullTextRetrieval(),
    pdfExtractor: new MockPdfTextExtractor(),
    identity: new MockResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
  }));
  const state = await orchestrator.run(createPipelineState(request), createReviewProtocol('systematic'));
  assert.equal(state.stages['search-execute'].attempts, 2);
  assert.equal(state.stages.report.status, 'passed');
  assert.ok(state.audit.some((event) => event.stage === 'search-execute' && event.event === 'attempt-failed'));
});

for (const reviewType of ['rapid', 'mechanistic', 'animal'] as const) {
  test(`runs the ${reviewType} profile end to end`, async () => {
    const state = await runMockPipeline({ ...fixtureRequest, reviewType }, recordsByDatabase);
    assert.equal(state.stages.report.status, 'passed');
    assert.ok(state.artifacts.finalReport);
  });
}

test('fails closed after persistent search result-count mismatch', async () => {
  class BadCountAdapter implements EvidenceSourceAdapter {
    readonly database = 'PubMed';
    async execute(strategy: SearchStrategy) {
      const result = await new MockEvidenceSourceAdapter('PubMed', recordsByDatabase.PubMed).execute(strategy);
      return { ...result, provenance: { ...result.provenance, resultCount: result.provenance.resultCount + 1 } };
    }
  }
  const request = { ...fixtureRequest, databases: ['PubMed'] };
  const orchestrator = new PipelineOrchestrator(createPipelineAgents({
    searchAdapters: [new BadCountAdapter()],
    fullTextRetrieval: new MockFullTextRetrieval(),
    pdfExtractor: new MockPdfTextExtractor(),
    identity: new MockResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
  }));
  const state = await orchestrator.run(createPipelineState(request), createReviewProtocol('systematic'));
  assert.equal(state.stages['search-execute'].status, 'failed');
  assert.equal(state.stages['search-execute'].attempts, 3);
  assert.equal(state.stages.deduplicate.status, 'pending');
});

test('fails closed when a requested database is unauthenticated or exports zero records', async () => {
  class BlockedInstitutionalAdapter implements EvidenceSourceAdapter {
    readonly database = 'ovid-medline';
    async execute(strategy: SearchStrategy) {
      return {
        records: [],
        provenance: {
          database: this.database,
          platform: 'Ovid MEDLINE',
          executedQuery: strategy.query,
          executedAt: '2026-07-15T00:00:00.000Z',
          resultCount: 0,
          exportFormat: 'RIS' as const,
          warnings: ['AUTH REQUIRED: Ovid MEDLINE session missing or expired'],
        },
      };
    }
  }
  const request = { ...fixtureRequest, databases: ['ovid-medline'], autoApproveHumanGates: true };
  const orchestrator = new PipelineOrchestrator(createPipelineAgents({
    searchAdapters: [new BlockedInstitutionalAdapter()],
    fullTextRetrieval: new MockFullTextRetrieval(),
    pdfExtractor: new MockPdfTextExtractor(),
    identity: new MockResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
  }));
  const state = await orchestrator.run(createPipelineState(request), createReviewProtocol('systematic'));
  assert.equal(state.stages['search-execute'].status, 'failed');
  assert.match(state.stages['search-execute'].errors.join(' '), /zero exported records/i);
  assert.match(state.stages['search-execute'].errors.join(' '), /AUTH REQUIRED/i);
  assert.equal(state.stages.deduplicate.status, 'pending');
});
