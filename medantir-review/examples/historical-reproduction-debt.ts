import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGoldSetHistoricalSourceDebt } from '../src/historical/gold-source-debt.js';
import { createHistoricalForestCandidateLedger } from '../src/historical/forest-row-candidate.js';
import { createHistoricalOutcomeRowLedger } from '../src/historical/outcome-row-ledger.js';
import { createHistoricalOutcomeReconciliationQueue } from '../src/historical/outcome-reconciliation-queue.js';
import { scientificContentHash } from '../src/core/canonical-hash.js';

interface GoldLineage {
  lineageId: string;
  [key: string]: unknown;
}

const root = process.cwd();
const benchmarkDir = resolve(root, 'benchmarks/jak-covid-2021');
const artifactDir = resolve(process.env.HISTORICAL_CAPSULE_ARTIFACT_DIR ?? 'artifacts/historical-replay');
await mkdir(artifactDir, { recursive: true });

const gold = JSON.parse(await readFile(resolve(benchmarkDir, 'gold-set.json'), 'utf8')) as GoldLineage[];
const allowed = new Set(gold.map((item) => item.lineageId));
const sourceDebt = createGoldSetHistoricalSourceDebt({
  historicalCutoff: '2021-06-02',
  goldSet: gold as Array<Record<string, unknown>>,
});

// Figure 2 candidate transcription is intentionally empty until the archived
// publication figure rows are explicitly captured. Expected study counts come
// from the published meta-analysis and therefore quantify the exact remaining
// candidate-row debt without inventing any row values.
const forestCandidates = createHistoricalForestCandidateLedger({ candidates: [], allowedLineageIds: allowed });
const primaryRows = createHistoricalOutcomeRowLedger([], allowed);
const reconciliationQueue = createHistoricalOutcomeReconciliationQueue({
  candidateLedger: forestCandidates,
  primaryLedger: primaryRows,
  sourceManifest: sourceDebt.sourceManifest,
  expectedStudyRowsByOutcome: {
    'recovery rate': 7,
    'time to recovery': 7,
    'clinical deterioration': 12,
    mortality: 13,
  },
});

if (sourceDebt.sourceManifest.requiredLineageIds.length !== 14) {
  throw new Error(`JAK/COVID debt compiler expected 14 canonical lineages, found ${sourceDebt.sourceManifest.requiredLineageIds.length}.`);
}
if (sourceDebt.sourceManifest.lineagesWithoutArchivedResultSource.length !== 14) {
  throw new Error('JAK/COVID source debt should remain 14/14 until exact primary/registry result-bearing objects are archived.');
}
if (reconciliationQueue.expectedCandidateRows !== 39 || reconciliationQueue.missingCandidateRows !== 39) {
  throw new Error(`JAK/COVID outcome-row debt should begin at 39/39 missing published contribution rows; observed ${reconciliationQueue.missingCandidateRows}/${reconciliationQueue.expectedCandidateRows}.`);
}
if (!reconciliationQueue.extractionBlocked || !reconciliationQueue.synthesisBlocked) {
  throw new Error('JAK/COVID extraction/synthesis must remain blocked while the 39-row outcome debt is unresolved.');
}

const debtSummary = {
  schemaVersion: 'medantir-historical-reproduction-debt/1',
  benchmarkId: 'JAK-COVID-2021',
  historicalCutoff: '2021-06-02',
  sourceDebt: {
    requiredLineages: sourceDebt.sourceManifest.requiredLineageIds.length,
    exactArchivedResultLineages: 0,
    missingExactArchivedResultLineages: sourceDebt.sourceManifest.lineagesWithoutArchivedResultSource.length,
    requiredReports: sourceDebt.sourceManifest.requiredReportCount,
    archivedRequiredReports: sourceDebt.sourceManifest.archivedRequiredReportCount,
    sourceManifestHash: sourceDebt.sourceManifest.manifestHash,
    reportInventoryVerificationHash: sourceDebt.inventoryVerification.verificationHash,
  },
  outcomeRowDebt: {
    expectedPublishedContributionRows: reconciliationQueue.expectedCandidateRows,
    observedForestCandidateRows: reconciliationQueue.observedCandidateRows,
    missingForestCandidateRows: reconciliationQueue.missingCandidateRows,
    reconciledRows: reconciliationQueue.reconciledWorkItems,
    extractionBlocked: reconciliationQueue.extractionBlocked,
    synthesisBlocked: reconciliationQueue.synthesisBlocked,
    candidateCoverage: reconciliationQueue.candidateCoverage,
    queueHash: reconciliationQueue.queueHash,
  },
  nextUnlocks: [
    'Archive the exact result-bearing report/registry snapshot for each canonical lineage and attest its historical version.',
    'Capture the published Figure 2 source object and transcribe all 39 contribution rows as non-authoritative forest candidates.',
    'Reconstruct each candidate from the exact primary report/registry with estimand and numeric provenance.',
    'Reconcile each primary row to the published forest witness, then replay the four RevMan 5.4 analyses.',
  ],
};
const artifact = { ...debtSummary, debtHash: scientificContentHash(debtSummary) };

await writeFile(resolve(artifactDir, 'jak-covid-2021-source-debt.json'), `${JSON.stringify(sourceDebt.sourceManifest, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-report-inventory-verification.json'), `${JSON.stringify(sourceDebt.inventoryVerification, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-forest-candidate-ledger.json'), `${JSON.stringify(forestCandidates, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-outcome-row-ledger.json'), `${JSON.stringify(primaryRows, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-outcome-reconciliation-queue.json'), `${JSON.stringify(reconciliationQueue, null, 2)}\n`, 'utf8');
await writeFile(resolve(artifactDir, 'jak-covid-2021-reproduction-debt.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  sourceLineageDebt: artifact.sourceDebt.missingExactArchivedResultLineages,
  expectedOutcomeRows: artifact.outcomeRowDebt.expectedPublishedContributionRows,
  missingOutcomeRows: artifact.outcomeRowDebt.missingForestCandidateRows,
  extractionBlocked: artifact.outcomeRowDebt.extractionBlocked,
  synthesisBlocked: artifact.outcomeRowDebt.synthesisBlocked,
  debtHash: artifact.debtHash,
  artifactDir,
}, null, 2));
