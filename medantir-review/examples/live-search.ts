import { PubMedAdapter, EuropePmcOfficialAdapter, ClinicalTrialsGovAdapter } from '../src/adapters/official-search.js';
import { RetryingEvidenceSourceAdapter } from '../src/adapters/retry.js';
import type { EvidenceSourceAdapter } from '../src/core/ports.js';
import type { SearchStrategy } from '../src/core/types.js';

const generatedAt = new Date().toISOString();
const smokeLimit = 2000;
const strategies: Array<{ name: string; adapter: EvidenceSourceAdapter; strategy: SearchStrategy }> = [
  {
    name: 'PubMed',
    adapter: new RetryingEvidenceSourceAdapter(new PubMedAdapter({ maxRecords: smokeLimit })),
    strategy: {
      database: 'pubmed',
      platform: 'NCBI PubMed',
      query: 'baricitinib[Title/Abstract] AND (COVID-19[Title/Abstract] OR SARS-CoV-2[Title/Abstract])',
      generatedAt,
    },
  },
  {
    name: 'Europe PMC',
    adapter: new RetryingEvidenceSourceAdapter(new EuropePmcOfficialAdapter({ maxRecords: smokeLimit })),
    strategy: {
      database: 'europepmc',
      platform: 'Europe PMC',
      query: 'TITLE_ABS:"baricitinib" AND (TITLE_ABS:"COVID-19" OR TITLE_ABS:"SARS-CoV-2")',
      generatedAt,
    },
  },
  {
    name: 'ClinicalTrials.gov',
    adapter: new RetryingEvidenceSourceAdapter(new ClinicalTrialsGovAdapter({ maxRecords: smokeLimit })),
    strategy: {
      database: 'clinicaltrials.gov',
      platform: 'ClinicalTrials.gov',
      query: 'baricitinib AND COVID-19',
      generatedAt,
    },
  },
];

const summary: Array<{ source: string; count: number; firstRecord: string; warnings: string[] }> = [];
for (const item of strategies) {
  const result = await item.adapter.execute(item.strategy);
  if (result.records.length === 0) throw new Error(`${item.name} live smoke returned zero records.`);
  summary.push({
    source: item.name,
    count: result.records.length,
    firstRecord: result.records[0]?.title ?? '',
    warnings: result.provenance.warnings,
  });
}

console.log(JSON.stringify({ executedAt: new Date().toISOString(), queryFamily: 'baricitinib + COVID-19', smokeLimit, sources: summary }, null, 2));
