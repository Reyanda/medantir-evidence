import type { Agent, AgentContext, AgentResult, EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import type { EvidenceSourceAdapter } from '../core/ports.js';
import { ExternalActionCoordinator } from './external-action-coordinator.js';

function artifact<T>(context: AgentContext, key: string): T {
  if (!(key in context.state.artifacts)) throw new Error(`Artifact '${key}' not found`);
  return context.state.artifacts[key] as T;
}

export interface DurableSearchReceipt {
  database: string;
  actionId: string;
  reusedExternalReceipt: boolean;
  query: string;
  resultCount: number;
}

/**
 * Search/export execution with one durable action identity per database strategy.
 * Search is treated as repeatable read work: if a process dies after a database
 * returns but before MEDANTIR commits the response, the same exact search may be
 * repeated without mutating the external evidence source.
 */
export class DurableSearchExecuteAgent implements Agent {
  readonly stage = 'search-execute' as const;
  private readonly adapters: Map<string, EvidenceSourceAdapter>;

  constructor(
    adapters: EvidenceSourceAdapter[],
    private readonly externalActions: ExternalActionCoordinator,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.database.toLowerCase(), adapter]));
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const strategies = artifact<SearchStrategy[]>(context, 'searchStrategies');
    const allRecords: EvidenceRecord[] = [];
    const provenance: SearchProvenance[] = [];
    const receipts: DurableSearchReceipt[] = [];
    const warnings: string[] = [];

    for (const strategy of strategies) {
      const adapter = this.adapters.get(strategy.database.toLowerCase());
      if (!adapter) throw new Error(`No approved search adapter configured for ${strategy.database}`);
      const execution = await this.externalActions.execute<{ records: EvidenceRecord[]; provenance: SearchProvenance }>({
        runId: context.state.runId,
        stage: 'search-execute',
        kind: 'evidence-search-export',
        operationKey: `${strategy.database.toLowerCase()}:${strategy.platform}:${strategy.purpose ?? 'primary-studies'}`,
        request: {
          database: strategy.database,
          platform: strategy.platform,
          purpose: strategy.purpose ?? 'primary-studies',
          query: strategy.query,
        },
        replayPolicy: 'safe-repeat',
        perform: () => adapter.execute(strategy),
        now: context.now,
      });
      const result = execution.response;
      if (result.provenance.resultCount !== result.records.length) {
        throw new Error(`Export reconciliation failed for ${strategy.database}: count=${result.provenance.resultCount}, exported=${result.records.length}`);
      }
      allRecords.push(...result.records);
      provenance.push(result.provenance);
      warnings.push(...result.provenance.warnings);
      receipts.push({
        database: strategy.database,
        actionId: execution.actionId,
        reusedExternalReceipt: execution.reusedReceipt,
        query: strategy.query,
        resultCount: result.records.length,
      });
    }

    return {
      artifacts: {
        searchResults: allRecords,
        searchProvenance: provenance,
        externalSearchReceipts: receipts,
      },
      warnings,
    };
  }
}
