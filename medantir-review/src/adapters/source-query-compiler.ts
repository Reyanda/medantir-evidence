import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { SearchStrategy } from '../core/types.js';

export type OfficialSearchDialect = 'pubmed' | 'europepmc' | 'clinicaltrials.gov';

export interface HistoricalDateRange {
  start: string;
  end: string;
}

type SearchStrategyWithDateRange = SearchStrategy & {
  dateRange?: HistoricalDateRange;
};

function fieldQuotedTerms(query: string, render: (term: string) => string): string {
  return query.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_match, raw: string) => render(raw.replace(/\\"/g, '"')));
}

function toPubMedDate(value: string): string {
  return value.replaceAll('-', '/');
}

function toClinicalTrialsDate(value: string): string {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) throw new Error(`Invalid ISO historical search date: ${value}`);
  return `${month}/${day}/${year}`;
}

function addHistoricalDateRange(database: string, query: string, dateRange?: HistoricalDateRange): string {
  if (!dateRange) return query;
  const key = database.trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === 'pubmed' || key === 'ncbi pubmed') {
    return `(${query}) AND ${toPubMedDate(dateRange.start)}:${toPubMedDate(dateRange.end)}[dp]`;
  }
  if (key === 'europepmc' || key === 'europe pmc') {
    return `(${query}) AND FIRST_PDATE:[${dateRange.start} TO ${dateRange.end}]`;
  }
  if (['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(key)) {
    return `(${query}) AND AREA[StudyFirstPostDate]RANGE[${toClinicalTrialsDate(dateRange.start)}, ${toClinicalTrialsDate(dateRange.end)}]`;
  }
  return query;
}

/**
 * Compile a source-neutral PRISM Boolean expression into the minimum safe
 * source-native syntax needed by the official public retrieval adapters.
 * Already-fielded semantic clauses are preserved, but historical date limits
 * are still appended source-natively when supplied.
 */
export function compileOfficialSearchQuery(database: string, query: string, dateRange?: HistoricalDateRange): string {
  const key = database.trim().toLowerCase().replace(/\s+/g, ' ');
  let compiled = query;
  if (key === 'pubmed' || key === 'ncbi pubmed') {
    compiled = /\[[^\]]+\]/.test(query)
      ? query
      : fieldQuotedTerms(query, (term) => `"${term}"[Title/Abstract]`);
    return addHistoricalDateRange(database, compiled, dateRange);
  }
  if (key === 'europepmc' || key === 'europe pmc') {
    compiled = /\b(?:TITLE_ABS|TITLE|ABSTRACT|AUTH|MESH|EXT_ID|DOI|PMCID|SRC):/i.test(query)
      ? query
      : fieldQuotedTerms(query, (term) => `TITLE_ABS:"${term}"`);
    return addHistoricalDateRange(database, compiled, dateRange);
  }
  // ClinicalTrials.gov API v2 query.term accepts its own Essie expression.
  if (['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(key)) {
    return addHistoricalDateRange(database, query, dateRange);
  }
  return query;
}

/**
 * Execution wrapper used by the real pipeline. It ensures that even if the
 * semantic search-builder emits source-neutral PRISM blocks, the actual source
 * receives a source-native executable query. The wrapped adapter's provenance
 * therefore records the exact compiled query that was run.
 */
export class SourceCompilingAdapter implements EvidenceSourceAdapter {
  readonly database: string;
  constructor(private readonly inner: EvidenceSourceAdapter) {
    this.database = inner.database;
  }

  execute(strategy: SearchStrategy) {
    const dated = strategy as SearchStrategyWithDateRange;
    const compiled = compileOfficialSearchQuery(this.database, strategy.query, dated.dateRange);
    return this.inner.execute({ ...strategy, query: compiled });
  }
}
