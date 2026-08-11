import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReviewRequest, SearchStrategy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { scientificModuleContractHash, scientificModuleContractsFor } from '../src/core/scientific-module-contracts.js';
import { ProtocolAgent, ReviewLandscapeAgent, SearchBuildAgent, DeduplicationAgent } from '../src/agents/pipeline-agents.js';
import { RecallFirstSearchBuildAgent, type SearchConceptPlan } from '../src/agents/live-pipeline-agents.js';
import { officialEvidenceAdapterFor } from '../src/adapters/official-search.js';
import { RetryingEvidenceSourceAdapter } from '../src/adapters/retry.js';
import { SourceCompilingAdapter, type HistoricalDateRange } from '../src/adapters/source-query-compiler.js';
import {
  createHistoricalReplayCapsule,
  verifyHistoricalReplayCapsule,
  type HistoricalPublicationSearchClaim,
} from '../src/historical/replay-capsule.js';
import { captureHistoricalEvidenceSources, replayHistoricalEvidenceSources } from '../src/historical/replay-runner.js';
import { buildHistoricalReplayCertificate, historicalCheckpointsFromState } from '../src/historical/replay-certificate.js';
import {
  createHistoricalReviewReproductionEnvelope,
  type HistoricalReviewMethodsContract,
} from '../src/historical/review-reproduction.js';
import { revMan54AlgorithmContractHash, revMan54RuntimeFingerprint } from '../src/historical/revman-5.4-compat.js';
import { FilesystemHistoricalObjectStore } from '../src/historical/filesystem-object-store.js';
import { captureHistoricalHttpObject } from '../src/historical/http-object-capture.js';
import { extractHistoricalJatsTables } from '../src/historical/jats-table-extractor.js';
import { bindHistoricalAppraisalToJats } from '../src/historical/appraisal-jats-reconciliation.js';
import { createHistoricalAppraisalLedger, type HistoricalAppraisalRowInput } from '../src/historical/appraisal-ledger.js';
import { verifierHistoricalObjectReceipt } from '../src/historical/evidence-plane-archive.js';
import { createHistoricalScreeningDecisionLedger } from '../src/historical/screening-decision-ledger.js';
import { createHistoricalManualSearchLedger } from '../src/historical/manual-search-ledger.js';
import { createHistoricalExecutionEnvironmentFingerprint, historicalLockfileReceipt } from '../src/historical/execution-environment.js';
import { createHistoricalReviewBundleManifest, verifyHistoricalReviewBundleManifest } from '../src/historical/bundle-manifest.js';

interface BenchmarkDefinition {
  benchmarkId: string;
  historicalCutoff: string;
  searchStart: string;
  principalSources: string[];
  publicationReproduction?: { sourceReference?: string; claims?: HistoricalPublicationSearchClaim[] };
}
interface GoldLineage { lineageId: string }
interface PublishedHumanProcess {
  screening: Parameters<typeof createHistoricalScreeningDecisionLedger>[0];
  manualSearch: Parameters<typeof createHistoricalManualSearchLedger>[0];
}
type HistoricalRequest = ReviewRequest & { searchConcepts: SearchConceptPlan };
type HistoricalStrategy = SearchStrategy & { dateRange: HistoricalDateRange };

async function executeAgent(agent: { execute(input: any): Promise<any> }, state: ReturnType<typeof createPipelineState>): Promise<void> {
  const result = await agent.execute({ state, now: () => new Date().toISOString() });
  Object.assign(state.artifacts, result.artifacts);
}

function buildRequest(benchmark: BenchmarkDefinition): HistoricalRequest {
  return {
    reviewType: 'systematic',
    databases: [...benchmark.principalSources],
    autoApproveHumanGates: true,
    registration: { enabled: false },
    humanVerification: { enabled: false },
    protocolDevelopment: { searchPeerReviewRequired: false, protocolVersion: `${benchmark.benchmarkId}-time-capsule` },
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
}

async function buildHistoricalStrategies(
  request: HistoricalRequest,
  benchmark: BenchmarkDefinition,
): Promise<{ state: ReturnType<typeof createPipelineState>; strategies: HistoricalStrategy[] }> {
  const state = createPipelineState(request);
  await executeAgent(new ProtocolAgent(), state);
  await executeAgent(new ReviewLandscapeAgent(), state);
  await executeAgent(new RecallFirstSearchBuildAgent(new SearchBuildAgent()), state);
  const range: HistoricalDateRange = { start: benchmark.searchStart, end: benchmark.historicalCutoff };
  const generated = state.artifacts.searchStrategies as SearchStrategy[];
  const strategies = generated.map((strategy) => ({ ...strategy, dateRange: range }));
  state.artifacts.searchStrategies = strategies;
  return { state, strategies };
}

const root = process.cwd();
const benchmarkDir = resolve(root, 'benchmarks/jak-covid-2021');
const artifactDir = resolve(process.env.HISTORICAL_CAPSULE_ARTIFACT_DIR ?? 'artifacts/historical-replay');
await mkdir(artifactDir, { recursive: true });
const objectStore = new FilesystemHistoricalObjectStore(resolve(artifactDir, 'object-store'));

const benchmark = JSON.parse(await readFile(resolve(benchmarkDir, 'benchmark.json'), 'utf8')) as BenchmarkDefinition;
const methods = JSON.parse(await readFile(resolve(benchmarkDir, 'published-methods.json'), 'utf8')) as HistoricalReviewMethodsContract;
const gold = JSON.parse(await readFile(resolve(benchmarkDir, 'gold-set.json'), 'utf8')) as GoldLineage[];
const publishedAppraisal = JSON.parse(await readFile(resolve(benchmarkDir, 'published-appraisal.json'), 'utf8')) as HistoricalAppraisalRowInput[];
const publishedHumanProcess = JSON.parse(await readFile(resolve(benchmarkDir, 'published-human-process.json'), 'utf8')) as PublishedHumanProcess;
const request = buildRequest(benchmark);
const live = await buildHistoricalStrategies(request, benchmark);

const adapters = benchmark.principalSources.map((database) => {
  const official = officialEvidenceAdapterFor(database);
  if (!official) throw new Error(`Historical time capsule requires an official adapter for ${database}.`);
  return new SourceCompilingAdapter(new RetryingEvidenceSourceAdapter(official));
});
const capture = await captureHistoricalEvidenceSources(adapters, live.strategies);
live.state.artifacts.searchResults = capture.records;
live.state.artifacts.searchProvenance = capture.provenance;
await executeAgent(new DeduplicationAgent(), live.state);

const checkpointSpec = [
  { stage: 'search-execute', artifactKey: 'searchResults' },
  { stage: 'search-execute', artifactKey: 'searchProvenance' },
  { stage: 'deduplicate', artifactKey: 'uniqueRecords' },
  { stage: 'deduplicate', artifactKey: 'deduplicationReport' },
];
const capturedCheckpoints = historicalCheckpointsFromState(live.state, checkpointSpec);
const capsule = createHistoricalReplayCapsule({
  benchmarkId: benchmark.benchmarkId,
  historicalCutoff: benchmark.historicalCutoff,
  searchStart: benchmark.searchStart,
  publicationClaims: benchmark.publicationReproduction?.claims ?? [],
  sources: capture.sources,
  checkpoints: capturedCheckpoints,
});
const capsuleVerification = verifyHistoricalReplayCapsule(capsule);
if (!capsuleVerification.valid) throw new Error(`New historical capsule failed its own integrity verification: ${JSON.stringify(capsuleVerification.sourceErrors)}`);

const offline = await buildHistoricalStrategies(request, benchmark);
const replay = await replayHistoricalEvidenceSources(capsule, offline.strategies);
offline.state.artifacts.searchResults = replay.records;
offline.state.artifacts.searchProvenance = replay.provenance;
await executeAgent(new DeduplicationAgent(), offline.state);
const replayedCheckpoints = historicalCheckpointsFromState(offline.state, checkpointSpec);
const certificate = buildHistoricalReplayCertificate({ capsule, actualSources: replay.sources, actualCheckpoints: replayedCheckpoints });
if (!certificate.exactMachineReplay) throw new Error(`Historical time-capsule replay diverged: ${JSON.stringify(certificate.firstDivergence ?? certificate.divergences)}`);

const publicationCapture = await captureHistoricalHttpObject({
  store: objectStore,
  url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8500309/fullTextXML',
  metadata: {
    role: 'fulltext-source', mediaType: 'application/xml', recordId: 'PMC8500309',
    legalAccessRoute: 'Europe PMC open access', accessClass: 'public',
  },
});
const publicationXml = new TextDecoder().decode(await objectStore.get(publicationCapture.object));
const publicationTables = extractHistoricalJatsTables(publicationXml);
const boundAppraisalRows = bindHistoricalAppraisalToJats({ rows: publishedAppraisal, tables: publicationTables, publicationObject: publicationCapture.object });
const appraisalLedger = createHistoricalAppraisalLedger(boundAppraisalRows, new Set(gold.map((lineage) => lineage.lineageId)));
if (appraisalLedger.rows.length !== gold.length || appraisalLedger.exactSourceBoundRows !== gold.length) {
  throw new Error(`Historical appraisal plane is not exact: ${appraisalLedger.exactSourceBoundRows}/${gold.length} rows are source-bound.`);
}

const screeningLedger = createHistoricalScreeningDecisionLedger(publishedHumanProcess.screening);
const manualSearchLedger = createHistoricalManualSearchLedger(publishedHumanProcess.manualSearch);
if (screeningLedger.status !== 'aggregate-only') throw new Error(`Published JAK/COVID screening history unexpectedly classified as ${screeningLedger.status}.`);
if (manualSearchLedger.status !== 'unavailable') throw new Error(`Published JAK/COVID manual-search history unexpectedly classified as ${manualSearchLedger.status}.`);

const statisticalRuntime = revMan54RuntimeFingerprint();
const executionEnvironment = createHistoricalExecutionEnvironmentFingerprint({
  codeIdentity: process.env.GITHUB_SHA ?? process.env.MEDANTIR_COMMIT_SHA ?? 'working-tree-unpinned',
  lockfiles: [await historicalLockfileReceipt('medantir-review/package-lock.json', resolve(root, 'package-lock.json'))],
  moduleContractHashes: scientificModuleContractsFor(request.reviewType).map(scientificModuleContractHash),
  algorithmContractHashes: [revMan54AlgorithmContractHash()],
  randomness: { policy: 'deterministic-no-rng' },
});

const reviewEnvelope = createHistoricalReviewReproductionEnvelope({
  methods,
  searchCapsule: capsule,
  frozenPlanes: [
    {
      plane: 'search-import-dedup',
      hash: scientificContentHash({ capsuleId: capsule.capsuleId, checkpoints: capsule.checkpoints }),
      artifactKeys: ['searchResults', 'searchProvenance', 'uniqueRecords', 'deduplicationReport'],
      replayFidelity: 'exact',
      historicalProvenance: 'source-reconstructed',
      sourceReferences: ['Current public source snapshots executed under the bound historical query/date contract; original 2021 database exports unavailable.'],
    },
    {
      plane: 'appraisal-ledger',
      hash: appraisalLedger.ledgerHash,
      artifactKeys: ['historicalAppraisalLedger'],
      replayFidelity: 'exact',
      historicalProvenance: 'source-reconstructed',
      sourceReferences: ['PMC8500309 Tables 3-4, cell-reconciled against archived OA JATS row fragments.'],
    },
  ],
  statisticalRuntime,
  executionEnvironment,
});
if (reviewEnvelope.claim !== 'partial-replay') {
  throw new Error(`JAK/COVID historical review should remain partial until downstream evidence planes are frozen; received ${reviewEnvelope.claim}.`);
}

const verifierPublicationCapture = {
  requestedUrl: publicationCapture.requestedUrl,
  finalUrl: publicationCapture.finalUrl,
  status: publicationCapture.status,
  contentType: publicationCapture.contentType,
  etag: publicationCapture.etag,
  lastModified: publicationCapture.lastModified,
  responseContractHash: publicationCapture.responseContractHash,
  capturedAt: publicationCapture.capturedAt,
  object: verifierHistoricalObjectReceipt(publicationCapture.object),
};
const publicationTableManifest = publicationTables.map((table) => ({
  label: table.label,
  caption: table.caption,
  rowCount: table.rows.length,
  tableFragmentSha256: table.tableFragmentSha256,
  structureHash: table.structureHash,
}));

const bundleManifest = createHistoricalReviewBundleManifest({
  reviewId: methods.reviewId,
  benchmarkId: benchmark.benchmarkId,
  entries: [
    { logicalPath: 'search/capsule', kind: 'capsule', scientificHash: scientificContentHash(capsule), accessClass: 'verifier-receipt-only', requiredForClaim: true, description: 'Historical source/search/import/dedup capsule.' },
    { logicalPath: 'search/replay-certificate', kind: 'certificate', scientificHash: scientificContentHash(certificate), accessClass: 'verifier-receipt-only', requiredForClaim: true },
    {
      logicalPath: 'publication/pmc8500309.xml', kind: 'source-object', scientificHash: scientificContentHash(verifierPublicationCapture),
      byteHash: publicationCapture.object.sha256, byteLength: publicationCapture.object.byteLength, accessClass: 'public', requiredForClaim: true,
      description: 'Exact OA JATS bytes used to reconcile published appraisal tables/results.',
    },
    { logicalPath: 'publication/table-manifest', kind: 'other-receipt', scientificHash: scientificContentHash(publicationTableManifest), accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'ledgers/appraisal', kind: 'ledger', scientificHash: appraisalLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'ledgers/screening-history', kind: 'ledger', scientificHash: screeningLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'ledgers/manual-search-history', kind: 'ledger', scientificHash: manualSearchLedger.ledgerHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'contracts/revman-5.4', kind: 'algorithm-contract', scientificHash: statisticalRuntime.algorithmContractHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'environment/reproducer', kind: 'environment', scientificHash: executionEnvironment.environmentHash, accessClass: 'verifier-receipt-only', requiredForClaim: true },
    { logicalPath: 'review/reproduction-envelope', kind: 'review-envelope', scientificHash: scientificContentHash(reviewEnvelope), accessClass: 'verifier-receipt-only', requiredForClaim: true },
  ],
});
const bundleVerification = verifyHistoricalReviewBundleManifest(bundleManifest);
if (!bundleVerification.valid) throw new Error(`Historical review bundle manifest failed verification: ${JSON.stringify(bundleVerification)}`);

await writeFile(resolve(artifactDir, 'jak-covid-2021-capsule.json'), `${JSON.stringify(capsule, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-certificate.json'), `${JSON.stringify(certificate, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-publication-capture.json'), `${JSON.stringify(verifierPublicationCapture, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-publication-tables.json'), `${JSON.stringify(publicationTableManifest, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-appraisal-ledger.json'), `${JSON.stringify(appraisalLedger, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-screening-ledger.json'), `${JSON.stringify(screeningLedger, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-manual-search-ledger.json'), `${JSON.stringify(manualSearchLedger, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-execution-environment.json'), `${JSON.stringify(executionEnvironment, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-review-envelope.json'), `${JSON.stringify(reviewEnvelope, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-bundle-manifest.json'), `${JSON.stringify(bundleManifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  benchmarkId: benchmark.benchmarkId,
  capsuleId: capsule.capsuleId,
  searchReproductionClaim: capsule.reproductionClaim,
  sourceSnapshots: capsule.sources.map((source) => ({ database: source.database, resultCount: source.resultCount, snapshotHash: source.snapshotHash })),
  exactMachineReplay: certificate.exactMachineReplay,
  publicationSearchExact: certificate.publicationExact,
  publicationObjectId: publicationCapture.object.objectId,
  appraisalRowsExact: appraisalLedger.exactSourceBoundRows,
  screeningHistoryStatus: screeningLedger.status,
  manualSearchHistoryStatus: manualSearchLedger.status,
  executionEnvironmentHash: executionEnvironment.environmentHash,
  reviewEnvelopeId: reviewEnvelope.envelopeId,
  reviewReproductionClaim: reviewEnvelope.claim,
  bundleManifestId: bundleManifest.manifestId,
  bundleMerkleRoot: bundleManifest.merkleRoot,
  reviewBlockingGaps: reviewEnvelope.blockingGaps,
  artifactDir,
}, null, 2));
