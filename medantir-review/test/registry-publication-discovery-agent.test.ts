import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, EvidenceRecord, SearchProvenance, SearchStrategy } from '../src/core/types.js';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  ExternalActionCoordinator,
  type ExternalActionLedgerPort,
  type ExternalActionRecord,
} from '../src/durability/external-action-coordinator.js';
import { RegistryPublicationDiscoveryAgent } from '../src/certainty/registry-publication-discovery-agent.js';
import { RegistryPublicationLinkageAgent } from '../src/certainty/registry-publication-linkage-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class MemoryLedger implements ExternalActionLedgerPort {
  private readonly records = new Map<string, ExternalActionRecord<unknown>>();

  async get<T = unknown>(actionId: string): Promise<ExternalActionRecord<T> | null> {
    const value = this.records.get(actionId);
    return value ? structuredClone(value) as ExternalActionRecord<T> : null;
  }

  async prepare(record: ExternalActionRecord): Promise<ExternalActionRecord> {
    const existing = this.records.get(record.actionId);
    if (existing) return structuredClone(existing);
    this.records.set(record.actionId, structuredClone(record));
    return structuredClone(record);
  }

  async succeed<T>(actionId: string, response: T, updatedAt: string): Promise<ExternalActionRecord<T>> {
    const current = this.records.get(actionId);
    if (!current) throw new Error('missing prepared action');
    const next: ExternalActionRecord<T> = {
      ...current,
      status: 'succeeded',
      updatedAt,
      response: structuredClone(response),
    } as ExternalActionRecord<T>;
    this.records.set(actionId, structuredClone(next) as ExternalActionRecord<unknown>);
    return structuredClone(next);
  }

  async fail(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    const current = this.records.get(actionId);
    if (!current) throw new Error('missing prepared action');
    const next: ExternalActionRecord = { ...current, status: 'failed', error, updatedAt };
    this.records.set(actionId, next);
    return structuredClone(next);
  }

  async markUncertain(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    const current = this.records.get(actionId);
    if (!current) throw new Error('missing prepared action');
    const next: ExternalActionRecord = { ...current, status: 'uncertain', error, updatedAt };
    this.records.set(actionId, next);
    return structuredClone(next);
  }
}

class FakePubMed implements EvidenceSourceAdapter {
  readonly database = 'PubMed';
  calls = 0;

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    this.calls += 1;
    assert.equal(strategy.query, 'NCT01234567');
    return {
      records: [{
        id: 'pubmed-123', title: 'Randomized clinical trial results',
        abstract: 'Results of the randomized clinical trial included mortality outcomes.',
        authors: ['A'], year: 2024, journal: 'Clinical Trials', pmid: '12345678', doi: '10.1000/results',
        sourceDatabases: ['PubMed'], keywords: [],
      }],
      provenance: {
        database: 'PubMed', platform: 'NCBI PubMed', executedQuery: strategy.query,
        executedAt: '2026-08-11T11:00:00.000Z', resultCount: 1, exportFormat: 'NBIB', warnings: [],
      },
    };
  }
}

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return { artifacts: { capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse) } };
  }
}

function state() {
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
  value.artifacts.searchResults = [{
    id: 'primary-search-record', title: 'Primary review search record', abstract: '', authors: ['P'], year: 2024,
    sourceDatabases: ['PubMed'],
  }];
  return value;
}

test('durable exact-NCT discovery executes once and replay preserves scientific receipt identity', async () => {
  const adapter = new FakePubMed();
  const coordinator = new ExternalActionCoordinator(new MemoryLedger());
  const value = state();
  const agent = new RegistryPublicationDiscoveryAgent(new Capture(), [adapter], coordinator);

  const first = await agent.execute({ state: value, now: () => '2026-08-11T11:00:00.000Z' });
  assert.equal(adapter.calls, 1);
  const firstReceipts = first.artifacts.registryPublicationDiscoveryReceipts as Array<{ receiptHash: string; actionId: string }>;
  assert.equal(firstReceipts.length, 1);
  const firstHash = firstReceipts[0]!.receiptHash;
  const discoveryRecords = first.artifacts.registryPublicationDiscoveryRecords as EvidenceRecord[];
  assert.equal(discoveryRecords.length, 1);
  assert.ok(discoveryRecords[0]?.keywords?.some((value) => value === 'registry-discovery-query:NCT01234567'));
  assert.doesNotMatch(`${discoveryRecords[0]?.title} ${discoveryRecords[0]?.abstract}`, /NCT01234567/i, 'citation itself does not contain the identifier');
  assert.equal((value.artifacts.searchResults as EvidenceRecord[]).length, 1, 'primary search universe is unchanged');

  const second = await agent.execute({ state: value, now: () => '2026-08-11T11:05:00.000Z' });
  assert.equal(adapter.calls, 1, 'durable safe-repeat receipt prevents another remote request');
  const secondReceipts = second.artifacts.registryPublicationDiscoveryReceipts as Array<{ receiptHash: string }>;
  assert.equal(secondReceipts.length, 1);
  assert.equal(secondReceipts[0]?.receiptHash, firstHash, 'replay metadata cannot alter scientific receipt identity');
});

test('discovery-query association can resolve a result publication without pretending NCT appears in the citation', async () => {
  const adapter = new FakePubMed();
  const coordinator = new ExternalActionCoordinator(new MemoryLedger());
  const value = state();
  const agent = new RegistryPublicationDiscoveryAgent(
    new RegistryPublicationLinkageAgent(new Capture()),
    [adapter],
    coordinator,
  );
  const result = await agent.execute({ state: value, now: () => '2026-08-11T11:00:00.000Z' });
  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.resultsAvailable, true, 'explicit trial-results report role establishes a result-bearing publication');
  assert.equal(row.targetOutcomeReported, 'unknown', 'target outcome still requires exact extracted/posted outcome evidence');
  const linkReceipt = (result.artifacts.registryPublicationLinkReceipts as Array<{ linkageRoute: string; evidenceIds: string[] }>)[0]!;
  assert.equal(linkReceipt.linkageRoute, 'registry-discovery-exact-nct');
  assert.ok(linkReceipt.evidenceIds.some((id) => id.startsWith('registry-publication-discovery:')));
  const review = result.artifacts.registryUniverseReviewPackage as { items: Array<{ requiredFields: string[] }> };
  assert.deepEqual(review.items[0]?.requiredFields, ['targetOutcomeReported']);
  assert.equal((value.artifacts.searchResults as EvidenceRecord[]).length, 1);
});

test('publication discovery defers rather than performing undurable external work', async () => {
  const adapter = new FakePubMed();
  const value = state();
  const result = await new RegistryPublicationDiscoveryAgent(new Capture(), [adapter]).execute({
    state: value, now: () => '2026-08-11T11:00:00.000Z',
  });
  assert.equal(adapter.calls, 0);
  const quality = result.artifacts.registryPublicationDiscoveryQuality as { durableCoordinatorUsed: boolean; deferredReason?: string };
  assert.equal(quality.durableCoordinatorUsed, false);
  assert.match(quality.deferredReason ?? '', /Durable external-action coordinator/);
});
