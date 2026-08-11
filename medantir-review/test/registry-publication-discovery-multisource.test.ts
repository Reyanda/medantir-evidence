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

class Ledger implements ExternalActionLedgerPort {
  private readonly values = new Map<string, ExternalActionRecord<unknown>>();
  async get<T = unknown>(id: string): Promise<ExternalActionRecord<T> | null> { return this.values.get(id) as ExternalActionRecord<T> | undefined ?? null; }
  async prepare(record: ExternalActionRecord): Promise<ExternalActionRecord> { this.values.set(record.actionId, structuredClone(record)); return record; }
  async succeed<T>(id: string, response: T, updatedAt: string): Promise<ExternalActionRecord<T>> {
    const before = this.values.get(id); if (!before) throw new Error('missing');
    const next = { ...before, status: 'succeeded' as const, updatedAt, response } as ExternalActionRecord<T>;
    this.values.set(id, next as ExternalActionRecord<unknown>); return next;
  }
  async fail(id: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    const before = this.values.get(id); if (!before) throw new Error('missing');
    const next = { ...before, status: 'failed' as const, error, updatedAt }; this.values.set(id, next); return next;
  }
  async markUncertain(id: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    const before = this.values.get(id); if (!before) throw new Error('missing');
    const next = { ...before, status: 'uncertain' as const, error, updatedAt }; this.values.set(id, next); return next;
  }
}

class Source implements EvidenceSourceAdapter {
  constructor(readonly database: string) {}
  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    return {
      records: [{
        id: 'pmid:12345678', title: 'Randomized clinical trial results', abstract: 'Trial results included mortality.',
        authors: ['A'], year: 2024, journal: 'Trials', pmid: '12345678', doi: '10.1000/trial', sourceDatabases: [this.database],
      }],
      provenance: {
        database: this.database, platform: `${this.database} official`, executedQuery: strategy.query,
        executedAt: `2026-08-11T11:0${this.database === 'PubMed' ? '0' : '1'}:00.000Z`, resultCount: 1,
        exportFormat: this.database === 'PubMed' ? 'NBIB' : 'JSON', warnings: [],
      },
    };
  }
}

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(_context: AgentContext): Promise<AgentResult> { return { artifacts: {} }; }
}

function state() {
  const value = createPipelineState(fixtureRequest);
  value.artifacts.registeredStudyResultUniverse = [{
    version: 2, studyId: 'registry:NCT01234567', outcome: 'mortality', registryId: 'NCT01234567',
    eligibilityStatus: 'eligible', contributesToSynthesis: false, registrySearched: true, registrationFound: true,
    resultsAvailable: 'unknown', prespecifiedPrimaryOutcomeFound: true, targetOutcomeReported: 'unknown', publicationStatus: 'unknown',
    evidenceIds: ['registry-source'], sourceHash: 'source-hash',
  } satisfies RegistryResultUniverseRecord];
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
  return value;
}

test('same PMID from PubMed and Europe PMC retains both source-specific evidence paths', async () => {
  const value = state();
  const agent = new RegistryPublicationDiscoveryAgent(
    new RegistryPublicationLinkageAgent(new Capture()),
    [new Source('PubMed'), new Source('Europe PMC')],
    new ExternalActionCoordinator(new Ledger()),
  );
  const result = await agent.execute({ state: value, now: () => '2026-08-11T11:00:00.000Z' });
  const records = result.artifacts.registryPublicationDiscoveryRecords as EvidenceRecord[];
  assert.equal(records.length, 2, 'source-specific records are not silently collapsed by PMID');
  assert.ok(records.some((record) => record.keywords?.includes('registry-discovery-source:PubMed')));
  assert.ok(records.some((record) => record.keywords?.includes('registry-discovery-source:Europe PMC')));

  const discoveryReceipts = result.artifacts.registryPublicationDiscoveryReceipts as Array<{ database: string }>;
  assert.deepEqual(discoveryReceipts.map((receipt) => receipt.database).sort(), ['Europe PMC', 'PubMed']);
  const linkReceipts = result.artifacts.registryPublicationLinkReceipts as Array<{ linkageRoute: string; evidenceIds: string[] }>;
  assert.equal(linkReceipts.length, 2);
  assert.ok(linkReceipts.every((receipt) => receipt.linkageRoute === 'registry-discovery-exact-nct'));
  assert.equal(new Set(linkReceipts.flatMap((receipt) => receipt.evidenceIds.filter((id) => id.startsWith('registry-publication-discovery:')))).size, 2);

  const row = (result.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])[0]!;
  assert.equal(row.publicationStatus, 'published');
  assert.equal(row.resultsAvailable, true);
  const quality = result.artifacts.registryPublicationDiscoveryQuality as { sourceSpecificRecordsPreserved: boolean };
  assert.equal(quality.sourceSpecificRecordsPreserved, true);
});
