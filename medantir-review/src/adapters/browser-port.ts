import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import type { EvidenceSourceAdapter } from '../core/ports.js';

export interface BrowserAutomationPort {
  runDatabaseSearch(input: {
    database: string;
    platform: string;
    query: string;
    allowedExportFormats: string[];
  }): Promise<{
    executedQuery: string;
    resultCount: number;
    records: EvidenceRecord[];
    exportFormat: 'RIS' | 'NBIB' | 'BIBTEX' | 'JSON';
    warnings: string[];
  }>;
}

export class BrowserEvidenceSourceAdapter implements EvidenceSourceAdapter {
  constructor(
    public readonly database: string,
    private readonly browser: BrowserAutomationPort,
  ) {}

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const result = await this.browser.runDatabaseSearch({
      database: this.database,
      platform: strategy.platform,
      query: strategy.query,
      allowedExportFormats: ['RIS', 'NBIB', 'BIBTEX', 'JSON'],
    });
    return {
      records: result.records,
      provenance: {
        database: this.database,
        platform: strategy.platform,
        executedQuery: result.executedQuery,
        executedAt: new Date().toISOString(),
        resultCount: result.resultCount,
        exportFormat: result.exportFormat,
        warnings: result.warnings,
      },
    };
  }
}
