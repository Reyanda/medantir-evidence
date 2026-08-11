import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPipelineState } from '../src/core/state.js';
import type { Agent, EvidenceRecord, ReviewRequest, SearchProvenance, SearchStrategy } from '../src/core/types.js';
import { ProtocolAgent, ReviewLandscapeAgent, SearchBuildAgent, DeduplicationAgent } from '../src/agents/pipeline-agents.js';
import { RecallFirstSearchBuildAgent, type SearchConceptPlan } from '../src/agents/live-pipeline-agents.js';
import { officialEvidenceAdapterFor } from '../src/adapters/official-search.js';
import {
  RetryingEvidenceSourceAdapter,
  isRetryableSourceError,
  retryTransientOperation,
} from '../src/adapters/retry.js';
import { SourceCompilingAdapter, type HistoricalDateRange } from '../src/adapters/source-query-compiler.js';

interface BenchmarkDefinition {
  benchmarkId: string;
  historicalCutoff: string;
  searchStart: string;
  reportedFlow: Record<string, number>;
  principalSources: string[];
}

interface GoldLineage {
  lineageId: string;
  firstAuthor: string;
  year: number;
  title: string;
  recordTypeAtCutoff: 'journal_article' | 'preprint' | 'registry_results';
  drug: string;
  pmidAtCutoff?: string;
  pmcidAtCutoff?: string;
  doiAtCutoff?: string;
  registryId?: string;
  laterPmid?: string;
  laterDoi?: string;
  cutoffSourceIdentity: string;
}

interface SourceFailureReceipt {
  database: string;
  retryable: boolean;
  error: string;
}

interface RegistryResultCheck {
  status: 'verified' | 'unavailable';
  valid: boolean;
  retryable?: boolean;
  resultsFirstPosted?: string;
  error?: string;
}

type HistoricalRequest = ReviewRequest & { searchConcepts: SearchConceptPlan };
type HistoricalStrategy = SearchStrategy & { dateRange: HistoricalDateRange };

const normalizeDoi = (value?: string) => value?.replace(/^https?:\/\/doi\.org\//i, '').trim().toLowerCase();
const normalizeId = (value?: string) => value?.trim().toLowerCase();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordIdentities(record: EvidenceRecord): Set<string> {
  const identities = new Set<string>();
  if (record.pmid) identities.add(`pmid:${normalizeId(record.pmid)}`);
  if (record.doi) identities.add(`doi:${normalizeDoi(record.doi)}`);
  identities.add(normalizeId(record.id) ?? '');
  for (const keyword of record.keywords ?? []) {
    const normalized = normalizeId(keyword);
    if (!normalized) continue;
    identities.add(normalized);
    if (/^nct\d+$/i.test(keyword)) identities.add(`nct:${normalized}`);
  }
  return identities;
}

function cutoffIdentityMatches(record: EvidenceRecord, lineage: GoldLineage): string[] {
  const ids = recordIdentities(record);
  const matches: string[] = [];
  if (lineage.pmidAtCutoff && ids.has(`pmid:${normalizeId(lineage.pmidAtCutoff)}`)) matches.push(`pmid:${lineage.pmidAtCutoff}`);
  if (lineage.doiAtCutoff && ids.has(`doi:${normalizeDoi(lineage.doiAtCutoff)}`)) matches.push(`doi:${normalizeDoi(lineage.doiAtCutoff)}`);
  if (lineage.registryId) {
    const nct = normalizeId(lineage.registryId);
    if (nct && (ids.has(nct) || ids.has(`nct:${nct}`))) matches.push(`registry:${lineage.registryId}`);
  }
  return matches;
}

function laterIdentityMatches(record: EvidenceRecord, lineage: GoldLineage): string[] {
  const ids = recordIdentities(record);
  const matches: string[] = [];
  if (lineage.laterPmid && ids.has(`pmid:${normalizeId(lineage.laterPmid)}`)) matches.push(`later-pmid:${lineage.laterPmid}`);
  if (lineage.laterDoi && ids.has(`doi:${normalizeDoi(lineage.laterDoi)}`)) matches.push(`later-doi:${normalizeDoi(lineage.laterDoi)}`);
  return matches;
}

async function registryResultsWerePublicByCutoff(registryId: string, cutoff: string): Promise<{ valid: boolean; resultsFirstPosted?: string }> {
  const recovered = await retryTransientOperation(async () => {
    const response = await fetch(`https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(registryId)}`);
    if (!response.ok) throw new Error(`ClinicalTrials.gov history verification failed for ${registryId}: HTTP ${response.status}`);
    return response;
  });
  const data: any = await recovered.value.json();
  const posted = data?.protocolSection?.statusModule?.resultsFirstPostDateStruct?.date as string | undefined;
  return { valid: Boolean(posted && posted <= cutoff), ...(posted ? { resultsFirstPosted: posted } : {}) };
}

async function executeAgent(agent: Agent, state: ReturnType<typeof createPipelineState>): Promise<void> {
  const result = await agent.execute({ state, now: () => new Date().toISOString() });
  Object.assign(state.artifacts, result.artifacts);
}

const root = process.cwd();
const benchmarkDir = resolve(root, 'benchmarks/jak-covid-2021');
const benchmark = JSON.parse(await readFile(resolve(benchmarkDir, 'benchmark.json'), 'utf8')) as BenchmarkDefinition;
const gold = JSON.parse(await readFile(resolve(benchmarkDir, 'gold-set.json'), 'utf8')) as GoldLineage[];

const request: HistoricalRequest = {
  reviewType: 'systematic',
  databases: ['pubmed', 'europepmc', 'clinicaltrials.gov'],
  autoApproveHumanGates: true,
  registration: { enabled: false },
  humanVerification: { enabled: false },
  protocolDevelopment: { searchPeerReviewRequired: false, protocolVersion: `${benchmark.benchmarkId}-replay` },
  question: {
    title: 'Janus kinase inhibitors for COVID-19 outcomes',
    objective: 'Identify studies of Janus kinase inhibitors in patients with COVID-19 available by the historical review cutoff.',
    population: 'patients with COVID-19',
    interventionOrExposure: 'Janus kinase inhibitors',
    outcomes: ['mortality', 'clinical improvement', 'mechanical ventilation', 'adverse events'],
  },
  searchConcepts: {
    blocks: [
      { code: 'P', role: 'population', terms: ['COVID-19', 'SARS-CoV-2', 'coronavirus disease 2019', '2019-nCoV'] },
      { code: 'I', role: 'intervention', terms: ['Janus kinase inhibitor', 'JAK inhibitor', 'baricitinib', 'ruxolitinib', 'tofacitinib', 'fedratinib', 'INCB018424'] },
    ],
  },
};

const state = createPipelineState(request);
await executeAgent(new ProtocolAgent(), state);
await executeAgent(new ReviewLandscapeAgent(), state);
await executeAgent(new RecallFirstSearchBuildAgent(new SearchBuildAgent()), state);

const range: HistoricalDateRange = { start: benchmark.searchStart, end: benchmark.historicalCutoff };
const generated = state.artifacts.searchStrategies as SearchStrategy[];
const datedStrategies: HistoricalStrategy[] = generated.map((strategy) => ({ ...strategy, dateRange: range }));
state.artifacts.searchStrategies = datedStrategies;

const sourceAdapters = request.databases.map((database) => {
  const official = officialEvidenceAdapterFor(database);
  if (!official) throw new Error(`Historical benchmark requires an official adapter for ${database}`);
  return {
    database,
    adapter: new SourceCompilingAdapter(new RetryingEvidenceSourceAdapter(official)),
  };
});

// A lineage benchmark must emit evidence even when one external source is
// temporarily unavailable. Execute sources independently, retain a failure
// receipt for each outage, and let the prespecified lineage-recall threshold
// decide whether the remaining evidence is still sufficient. Non-transient
// query/logic failures remain fatal after the audit artifact is written.
const searchResults: EvidenceRecord[] = [];
const provenance: SearchProvenance[] = [];
const sourceFailures: SourceFailureReceipt[] = [];
for (const { database, adapter } of sourceAdapters) {
  const strategy = datedStrategies.find((candidate) => candidate.database.toLowerCase() === database.toLowerCase());
  if (!strategy) {
    sourceFailures.push({ database, retryable: false, error: `No generated historical strategy for ${database}` });
    continue;
  }
  try {
    const result = await adapter.execute(strategy);
    searchResults.push(...result.records);
    provenance.push(result.provenance);
  } catch (error) {
    sourceFailures.push({
      database,
      retryable: isRetryableSourceError(error),
      error: errorMessage(error),
    });
  }
}
state.artifacts.searchResults = searchResults;
state.artifacts.searchProvenance = provenance;
state.artifacts.historicalSourceFailures = sourceFailures;
await executeAgent(new DeduplicationAgent(), state);

const records = state.artifacts.uniqueRecords as EvidenceRecord[];
const registryResultChecks = new Map<string, RegistryResultCheck>();
for (const lineage of gold.filter((entry) => entry.recordTypeAtCutoff === 'registry_results' && entry.registryId)) {
  try {
    const check = await registryResultsWerePublicByCutoff(lineage.registryId!, benchmark.historicalCutoff);
    registryResultChecks.set(lineage.lineageId, { status: 'verified', ...check });
  } catch (error) {
    registryResultChecks.set(lineage.lineageId, {
      status: 'unavailable',
      valid: false,
      retryable: isRetryableSourceError(error),
      error: errorMessage(error),
    });
  }
}

const recovered = [] as Array<{
  lineageId: string;
  matched: boolean;
  matches: Array<{ recordId: string; identities: string[]; sources: string[] }>;
  cutoffValidity: 'valid' | 'invalid-registry-results-date' | 'registry-verification-unavailable' | 'not-found';
}>;
const laterVersionLeaks: Array<{ lineageId: string; recordId: string; identities: string[]; sources: string[] }> = [];

for (const lineage of gold) {
  const matches = records.flatMap((record) => {
    const identities = cutoffIdentityMatches(record, lineage);
    return identities.length ? [{ recordId: record.id, identities, sources: record.sourceDatabases }] : [];
  });
  for (const record of records) {
    const identities = laterIdentityMatches(record, lineage);
    if (identities.length) laterVersionLeaks.push({ lineageId: lineage.lineageId, recordId: record.id, identities, sources: record.sourceDatabases });
  }

  let valid = matches.length > 0;
  let cutoffValidity: 'valid' | 'invalid-registry-results-date' | 'registry-verification-unavailable' | 'not-found' = valid ? 'valid' : 'not-found';
  if (valid && lineage.recordTypeAtCutoff === 'registry_results') {
    const resultCheck = registryResultChecks.get(lineage.lineageId);
    if (resultCheck?.status === 'unavailable') {
      valid = false;
      cutoffValidity = 'registry-verification-unavailable';
    } else if (!resultCheck?.valid) {
      valid = false;
      cutoffValidity = 'invalid-registry-results-date';
    }
  }
  recovered.push({ lineageId: lineage.lineageId, matched: valid, matches, cutoffValidity });
}

const recoveredIds = new Set(recovered.filter((entry) => entry.matched).map((entry) => entry.lineageId));
const recall = recoveredIds.size / gold.length;
const sourceMarginalRecall = Object.fromEntries(request.databases.map((source) => {
  const sourceRecords = records.filter((record) => record.sourceDatabases.map((value) => value.toLowerCase()).includes(source.toLowerCase()));
  const matched = gold.filter((lineage) => sourceRecords.some((record) => cutoffIdentityMatches(record, lineage).length > 0));
  return [source, { recoveredLineages: matched.map((entry) => entry.lineageId), recall: matched.length / gold.length }];
}));

const successfulPrincipalSources = benchmark.principalSources.filter((source) =>
  provenance.some((entry) => entry.database.toLowerCase() === source.toLowerCase()));
const result = {
  benchmarkId: benchmark.benchmarkId,
  executedAt: new Date().toISOString(),
  historicalCutoff: benchmark.historicalCutoff,
  generatedStrategies: datedStrategies,
  executedSources: provenance.map((entry) => ({
    database: entry.database,
    platform: entry.platform,
    query: entry.executedQuery,
    resultCount: entry.resultCount,
    warnings: entry.warnings,
  })),
  sourceFailures,
  successfulPrincipalSources,
  importedRecords: searchResults.length,
  uniqueRecords: records.length,
  goldLineages: gold.length,
  recoveredLineages: recoveredIds.size,
  lineageRecall: recall,
  missedLineages: gold.filter((entry) => !recoveredIds.has(entry.lineageId)).map((entry) => ({ lineageId: entry.lineageId, title: entry.title, cutoffSourceIdentity: entry.cutoffSourceIdentity })),
  lineageMatches: recovered,
  sourceMarginalRecall,
  laterVersionLeaks,
  registryResultChecks: Object.fromEntries(registryResultChecks),
  reportedHistoricalFlow: benchmark.reportedFlow,
  observedCurrentReplayFlow: Object.fromEntries(provenance.map((entry) => [entry.database, entry.resultCount])),
  interpretation: 'Current-index replay with source-native historical date constraints. Source availability incidents are retained separately from lineage-recall performance; exact historical corpus equality is not assumed because indexing, metadata, and search semantics can drift after the cutoff.',
};

const artifactDir = resolve(process.env.HISTORICAL_REPLAY_ARTIFACT_DIR ?? 'artifacts/historical-replay');
await mkdir(artifactDir, { recursive: true });
await writeFile(resolve(artifactDir, 'jak-covid-2021-replay.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  benchmarkId: result.benchmarkId,
  sourceCounts: Object.fromEntries(provenance.map((entry) => [entry.database, entry.resultCount])),
  sourceFailures: result.sourceFailures,
  importedRecords: result.importedRecords,
  uniqueRecords: result.uniqueRecords,
  recoveredLineages: result.recoveredLineages,
  goldLineages: result.goldLineages,
  lineageRecall: result.lineageRecall,
  missedLineages: result.missedLineages,
  laterVersionLeaks: result.laterVersionLeaks,
  registryResultChecks: result.registryResultChecks,
  artifactDir,
}, null, 2));

const minimumRecall = Number(process.env.MIN_HISTORICAL_LINEAGE_RECALL ?? 0.85);
const minimumPrincipalSources = Number(process.env.MIN_HISTORICAL_PRINCIPAL_SOURCES ?? 2);
const nonRetryableSourceFailures = sourceFailures.filter((failure) => !failure.retryable);
const nonRetryableRegistryFailures = [...registryResultChecks.values()].filter((check) => check.status === 'unavailable' && check.retryable === false);
if (nonRetryableSourceFailures.length > 0) {
  throw new Error(`Historical replay had non-transient source failure(s): ${nonRetryableSourceFailures.map((failure) => `${failure.database}: ${failure.error}`).join(' | ')}`);
}
if (nonRetryableRegistryFailures.length > 0) {
  throw new Error(`Historical replay had non-transient registry verification failure(s): ${nonRetryableRegistryFailures.map((failure) => failure.error).join(' | ')}`);
}
if (successfulPrincipalSources.length < minimumPrincipalSources) {
  throw new Error(`Historical replay executed only ${successfulPrincipalSources.length} principal source(s); at least ${minimumPrincipalSources} are required.`);
}
if (recall < minimumRecall) {
  throw new Error(`Historical JAK/COVID lineage recall ${(recall * 100).toFixed(1)}% is below required ${(minimumRecall * 100).toFixed(1)}%.`);
}
if (laterVersionLeaks.length > 0) {
  throw new Error(`Historical replay leaked ${laterVersionLeaks.length} post-cutoff PMID/DOI identity match(es).`);
}
