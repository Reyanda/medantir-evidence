import type { Agent, AgentContext, AgentResult, EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import type { EvidenceSourceAdapter } from '../core/ports.js';
import { stableHash } from '../core/utils.js';
import type { ExternalActionCoordinator } from '../durability/external-action-coordinator.js';
import type { RegistryResultUniverseRecord } from './publication-bias-universe.js';

export interface RegistryPublicationDiscoveryReceipt {
  version: 1;
  registryId: string;
  database: string;
  query: string;
  actionId: string;
  resultCount: number;
  provenanceHash: string;
  recordHashes: string[];
  receiptHash: string;
}

export interface RegistryPublicationDiscoveryQuality {
  version: 1;
  targetRegistryIds: string[];
  databases: string[];
  searchesAttempted: number;
  searchesCompleted: number;
  discoveredRecords: number;
  durableCoordinatorUsed: boolean;
  sourceSpecificRecordsPreserved: true;
  deferredReason?: string;
}

function targetRegistryIds(context: AgentContext): string[] {
  const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
    ? context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]
    : [];
  return [...new Set(universe.flatMap((row) => {
    const id = row.registryId?.trim().toUpperCase();
    if (!id || !/^NCT\d{8}$/.test(id) || row.eligibilityStatus === 'ineligible') return [];
    if (row.publicationStatus !== 'unknown' && row.resultsAvailable !== 'unknown' && row.targetOutcomeReported !== 'unknown') return [];
    return [id];
  }))].sort();
}

function queryFor(registryId: string): string {
  return registryId;
}

function identityKey(record: EvidenceRecord): string {
  if (record.pmid?.trim()) return `pmid:${record.pmid.trim()}`;
  if (record.doi?.trim()) return `doi:${record.doi.trim().toLowerCase()}`;
  return `record:${record.id}`;
}

function markerValues(record: EvidenceRecord, prefix: string): string[] {
  return (record.keywords ?? [])
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length))
    .sort();
}

function discoveryRecordKey(record: EvidenceRecord): string {
  return stableHash({
    identity: identityKey(record),
    queries: markerValues(record, 'registry-discovery-query:'),
    sources: markerValues(record, 'registry-discovery-source:'),
  });
}

function annotateDiscoveryRecord(record: EvidenceRecord, registryId: string, database: string): EvidenceRecord {
  const queryMarker = `registry-discovery-query:${registryId}`;
  const sourceMarker = `registry-discovery-source:${database}`;
  return {
    ...record,
    sourceDatabases: [...new Set([...record.sourceDatabases, database])],
    keywords: [...new Set([...(record.keywords ?? []), queryMarker, sourceMarker])],
  };
}

async function executeSearch(input: {
  context: AgentContext;
  adapter: EvidenceSourceAdapter;
  registryId: string;
  coordinator: ExternalActionCoordinator;
}): Promise<{
  records: EvidenceRecord[];
  provenance: SearchProvenance;
  actionId: string;
}> {
  const query = queryFor(input.registryId);
  const strategy: SearchStrategy = {
    database: input.adapter.database,
    platform: `Exact ${input.adapter.database} registry-publication lookup`,
    query,
    generatedAt: input.context.now(),
  };
  const execution = await input.coordinator.execute({
    runId: input.context.state.runId,
    stage: 'grade',
    kind: 'registry-publication-discovery',
    operationKey: `${input.adapter.database.toLowerCase()}:${input.registryId}`,
    request: { registryId: input.registryId, database: input.adapter.database, query },
    replayPolicy: 'safe-repeat',
    now: input.context.now,
    perform: async () => input.adapter.execute(strategy),
  });
  return {
    records: execution.response.records,
    provenance: execution.response.provenance,
    actionId: execution.actionId,
  };
}

/**
 * Performs durable exact-NCT secondary publication discovery for unresolved
 * eligible-universe subjects. These records live on a dedicated publication-bias
 * evidence plane and never alter the primary search/screening universe.
 *
 * Source-specific records are preserved even when PubMed and Europe PMC return
 * the same PMID/DOI. This avoids silently selecting one provider's metadata.
 * Whether a durable response was reused after restart is not part of scientific
 * receipt identity.
 */
export class RegistryPublicationDiscoveryAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(
    private readonly inner: Agent,
    private readonly adapters: EvidenceSourceAdapter[],
    private readonly coordinator?: ExternalActionCoordinator,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const targets = targetRegistryIds(context);
    const existingRecords = Array.isArray(context.state.artifacts.registryPublicationDiscoveryRecords)
      ? context.state.artifacts.registryPublicationDiscoveryRecords as EvidenceRecord[]
      : [];
    const existingReceipts = Array.isArray(context.state.artifacts.registryPublicationDiscoveryReceipts)
      ? context.state.artifacts.registryPublicationDiscoveryReceipts as RegistryPublicationDiscoveryReceipt[]
      : [];
    const existingProvenance = Array.isArray(context.state.artifacts.registryPublicationDiscoveryProvenance)
      ? context.state.artifacts.registryPublicationDiscoveryProvenance as SearchProvenance[]
      : [];

    if (targets.length === 0 || this.adapters.length === 0) {
      const quality: RegistryPublicationDiscoveryQuality = {
        version: 1,
        targetRegistryIds: targets,
        databases: this.adapters.map((adapter) => adapter.database),
        searchesAttempted: 0,
        searchesCompleted: 0,
        discoveredRecords: existingRecords.length,
        durableCoordinatorUsed: Boolean(this.coordinator),
        sourceSpecificRecordsPreserved: true,
        ...(this.adapters.length === 0 && targets.length > 0 ? { deferredReason: 'No exact publication-discovery adapter configured.' } : {}),
      };
      context.state.artifacts.registryPublicationDiscoveryQuality = quality;
      const result = await this.inner.execute(context);
      return { ...result, artifacts: { ...result.artifacts, registryPublicationDiscoveryQuality: quality } };
    }

    if (!this.coordinator) {
      const quality: RegistryPublicationDiscoveryQuality = {
        version: 1,
        targetRegistryIds: targets,
        databases: this.adapters.map((adapter) => adapter.database),
        searchesAttempted: 0,
        searchesCompleted: 0,
        discoveredRecords: existingRecords.length,
        durableCoordinatorUsed: false,
        sourceSpecificRecordsPreserved: true,
        deferredReason: 'Durable external-action coordinator is required before exact registry publication discovery can execute.',
      };
      context.state.artifacts.registryPublicationDiscoveryQuality = quality;
      const result = await this.inner.execute(context);
      return {
        ...result,
        artifacts: { ...result.artifacts, registryPublicationDiscoveryQuality: quality },
        warnings: [...(result.warnings ?? []), quality.deferredReason!],
      };
    }

    const recordsBySourceIdentity = new Map(existingRecords.map((record) => [discoveryRecordKey(record), record]));
    const receiptsByHash = new Map(existingReceipts.map((receipt) => [receipt.receiptHash, receipt]));
    const provenanceByHash = new Map(existingProvenance.map((entry) => [stableHash(entry), entry]));
    let searchesAttempted = 0;
    let searchesCompleted = 0;

    for (const registryId of targets) {
      for (const adapter of this.adapters) {
        searchesAttempted += 1;
        const execution = await executeSearch({ context, adapter, registryId, coordinator: this.coordinator });
        searchesCompleted += 1;
        const annotated = execution.records.map((record) => annotateDiscoveryRecord(record, registryId, adapter.database));
        for (const record of annotated) recordsBySourceIdentity.set(discoveryRecordKey(record), record);
        const provenanceHash = stableHash(execution.provenance);
        provenanceByHash.set(provenanceHash, execution.provenance);
        const hashable = {
          registryId,
          database: adapter.database,
          query: queryFor(registryId),
          actionId: execution.actionId,
          resultCount: annotated.length,
          provenanceHash,
          recordHashes: annotated.map((record) => stableHash(record)).sort(),
        };
        const receipt: RegistryPublicationDiscoveryReceipt = {
          version: 1,
          ...hashable,
          receiptHash: stableHash(hashable),
        };
        receiptsByHash.set(receipt.receiptHash, receipt);
      }
    }

    const records = [...recordsBySourceIdentity.values()];
    const receipts = [...receiptsByHash.values()];
    const provenance = [...provenanceByHash.values()];
    const quality: RegistryPublicationDiscoveryQuality = {
      version: 1,
      targetRegistryIds: targets,
      databases: this.adapters.map((adapter) => adapter.database),
      searchesAttempted,
      searchesCompleted,
      discoveredRecords: records.length,
      durableCoordinatorUsed: true,
      sourceSpecificRecordsPreserved: true,
    };
    context.state.artifacts.registryPublicationDiscoveryRecords = records;
    context.state.artifacts.registryPublicationDiscoveryReceipts = receipts;
    context.state.artifacts.registryPublicationDiscoveryProvenance = provenance;
    context.state.artifacts.registryPublicationDiscoveryQuality = quality;

    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registryPublicationDiscoveryRecords: records,
        registryPublicationDiscoveryReceipts: receipts,
        registryPublicationDiscoveryProvenance: provenance,
        registryPublicationDiscoveryQuality: quality,
      },
    };
  }
}
