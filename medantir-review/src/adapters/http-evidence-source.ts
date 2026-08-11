import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';

export interface HttpEvidenceSourceConfig {
  database: string;
  endpoint: string;
  headers?: Record<string, string>;
  mapResponse(payload: unknown): { records: EvidenceRecord[]; resultCount: number; warnings?: string[] };
}

export class HttpEvidenceSourceAdapter implements EvidenceSourceAdapter {
  readonly database: string;
  constructor(private readonly config: HttpEvidenceSourceConfig) {
    this.database = config.database;
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.config.headers ?? {}) },
      body: JSON.stringify({ database: strategy.database, query: strategy.query }),
    });
    if (!response.ok) throw new Error(`${this.database} HTTP adapter failed with ${response.status}`);
    const mapped = this.config.mapResponse(await response.json());
    return {
      records: mapped.records,
      provenance: {
        database: this.database,
        platform: strategy.platform,
        executedQuery: strategy.query,
        executedAt: new Date().toISOString(),
        resultCount: mapped.resultCount,
        exportFormat: 'JSON',
        warnings: mapped.warnings ?? [],
      },
    };
  }
}
