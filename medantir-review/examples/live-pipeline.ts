import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runRealPipeline } from '../src/real-engine.js';
import { containsRawSecretField, scientificContentHash } from '../src/core/canonical-hash.js';
import {
  verifyScientificRunSeal,
  type ScientificArtifactReceipt,
  type ScientificRunLedger,
  type ScientificRunManifest,
  type ScientificRunSeal,
} from '../src/core/scientific-run-manifest.js';
import type { ReviewRequest, SearchProvenance } from '../src/core/types.js';
import type { SearchConceptPlan } from '../src/agents/live-pipeline-agents.js';
import type { DocumentIntelligenceMetadata } from '../src/document/document-intelligence.js';

type LiveReviewRequest = ReviewRequest & { searchConcepts: SearchConceptPlan };

type LiveStudyFamilyLink = {
  recordId?: string;
  familyId?: string;
  role?: string;
  registryIds?: string[];
  linkageBasis?: string;
  requiresHumanReview?: boolean;
};

type LiveStudyFamilyEvidenceReceipt = {
  recordId?: string;
  familyId?: string;
  linkageBasis?: string;
  evidence?: Array<{ id?: string; quote?: string; page?: number; source?: string }>;
  reasons?: string[];
  requiresHumanReview?: boolean;
};

type LiveQuantitativeRow = {
  studyId?: string;
  recordId?: string;
  outcome?: string;
  status?: string;
  tableId?: string;
  page?: number;
};

type LiveEstimandRow = {
  studyId?: string;
  recordId?: string;
  studyFamilyId?: string;
  outcome?: string;
  status?: string;
  estimand?: {
    estimandId?: string;
    unresolvedDimensions?: string[];
    source?: {
      recordId?: string;
      studyId?: string;
      studyFamilyId?: string;
      tableId?: string;
      page?: number;
    };
  };
};

const request: LiveReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed', 'EuropePMC'],
  autoApproveHumanGates: true,
  dualScreening: true,
  registration: { enabled: false },
  humanVerification: { enabled: false },
  protocolDevelopment: {
    searchPeerReviewRequired: false,
    protocolVersion: 'live-pipeline-smoke-1',
  },
  question: {
    title: 'Baricitinib plus remdesivir for hospitalized adults with COVID-19',
    objective: 'Identify and synthesize reports evaluating baricitinib plus remdesivir in hospitalized adults with COVID-19.',
    population: 'hospitalized adults with COVID-19',
    interventionOrExposure: 'baricitinib plus remdesivir',
    comparator: 'placebo plus remdesivir',
    outcomes: ['time to recovery'],
    studyDesigns: ['randomised controlled trial'],
    concepts: ['ACTT-2'],
  },
  searchConcepts: {
    blocks: [
      {
        code: 'P',
        role: 'population',
        terms: ['COVID-19', 'SARS-CoV-2', 'coronavirus disease 2019'],
      },
      {
        code: 'I1',
        role: 'intervention',
        terms: ['baricitinib'],
      },
      {
        code: 'I2',
        role: 'intervention',
        terms: ['remdesivir'],
      },
    ],
  },
};

const knownTargetRecordId = '10.1056/nejmoa2031994';
const knownTargetRegistryId = 'NCT04401579';
const state = await runRealPipeline(request);
const statuses = Object.fromEntries(Object.entries(state.stages).map(([name, stage]) => [name, stage.status]));
const failed = Object.entries(state.stages).filter(([, stage]) => stage.status === 'failed');
const provenance = (state.artifacts.searchProvenance ?? []) as SearchProvenance[];
const searchResults = Array.isArray(state.artifacts.searchResults) ? state.artifacts.searchResults : [];
const uniqueRecords = Array.isArray(state.artifacts.uniqueRecords) ? state.artifacts.uniqueRecords : [];
const included = Array.isArray(state.artifacts.tiabIncluded) ? state.artifacts.tiabIncluded : [];
const modelScreeningSuggestions = Array.isArray(state.artifacts.modelScreeningSuggestions)
  ? state.artifacts.modelScreeningSuggestions
  : [];
const modelScreeningQuality = state.artifacts.modelScreeningQuality as {
  model?: string;
  sampledRecords?: number;
  completed?: number;
  invalidOutputs?: number;
  inferenceErrors?: number;
  agreementWithAuthoritative?: number | null;
  authoritativeDecisionsChanged?: boolean;
} | undefined;
const fullTexts = Array.isArray(state.artifacts.fullTexts) ? state.artifacts.fullTexts as Array<{ recordId?: string; uri?: string; mimeType?: string; retrievedAt?: string; legalAccessRoute?: string; content?: string }> : [];
const parsedDocuments = Array.isArray(state.artifacts.parsedDocuments) ? state.artifacts.parsedDocuments as Array<{
  recordId?: string;
  text?: string;
  extractionMethod?: string;
  sections?: unknown[];
  documentIntelligence?: DocumentIntelligenceMetadata;
  tables?: unknown[];
  figures?: unknown[];
}> : [];
const documentParseFailures = Array.isArray(state.artifacts.documentParseFailures) ? state.artifacts.documentParseFailures : [];
const fullTextDecisions = Array.isArray(state.artifacts.fullTextDecisions)
  ? state.artifacts.fullTextDecisions as Array<{ recordId?: string; decision?: string; reason?: string }>
  : [];
const studyFamilyLinks = Array.isArray(state.artifacts.studyFamilyLinks)
  ? state.artifacts.studyFamilyLinks as LiveStudyFamilyLink[]
  : [];
const studyFamilyEvidenceLedger = Array.isArray(state.artifacts.studyFamilyEvidenceLedger)
  ? state.artifacts.studyFamilyEvidenceLedger as LiveStudyFamilyEvidenceReceipt[]
  : [];
const studyFamilies = Array.isArray(state.artifacts.studyFamilies) ? state.artifacts.studyFamilies : [];
const studyFamilySynthesisConflicts = Array.isArray(state.artifacts.studyFamilySynthesisConflicts)
  ? state.artifacts.studyFamilySynthesisConflicts
  : [];
const quantitativeExtractionLedger = Array.isArray(state.artifacts.quantitativeExtractionLedger)
  ? state.artifacts.quantitativeExtractionLedger as LiveQuantitativeRow[]
  : [];
const estimandLedger = Array.isArray(state.artifacts.estimandLedger)
  ? state.artifacts.estimandLedger as LiveEstimandRow[]
  : [];
const estimandSynthesisConflicts = Array.isArray(state.artifacts.estimandSynthesisConflicts)
  ? state.artifacts.estimandSynthesisConflicts
  : [];
const estimandVerificationDebt = Array.isArray(state.artifacts.estimandVerificationDebt)
  ? state.artifacts.estimandVerificationDebt
  : [];
const studies = Array.isArray(state.artifacts.extractedStudies) ? state.artifacts.extractedStudies : [];
const cognitiveControl = state.artifacts.cognitiveControl as { records?: Array<{ action?: string }> } | undefined;
const scientificRunManifest = state.artifacts.scientificRunManifest as ScientificRunManifest | undefined;
const scientificRunSeal = state.artifacts.scientificRunSeal as ScientificRunSeal | undefined;
const scientificArtifactLineage = Array.isArray(state.artifacts.scientificArtifactLineage)
  ? state.artifacts.scientificArtifactLineage as ScientificArtifactReceipt[]
  : [];
const scientificRunLedger = state.artifacts.scientificRunLedger as ScientificRunLedger | undefined;
const documentTierCounts = Object.fromEntries(
  [...new Set(parsedDocuments.map((document) => document.documentIntelligence?.selectedTier ?? 'unclassified'))]
    .map((tier) => [tier, parsedDocuments.filter((document) => (document.documentIntelligence?.selectedTier ?? 'unclassified') === tier).length]),
);
const knownTargetDecision = fullTextDecisions.find((decision) => decision.recordId?.toLowerCase() === knownTargetRecordId);
const knownTargetFamilyLink = studyFamilyLinks.find((link) => link.recordId?.toLowerCase() === knownTargetRecordId);
const knownTargetFamilyEvidence = studyFamilyEvidenceLedger.find((entry) => entry.recordId?.toLowerCase() === knownTargetRecordId);
const knownTargetReachedExtraction = studies.some((study) => {
  const reportIds = (study as { reportIds?: unknown }).reportIds;
  return Array.isArray(reportIds) && reportIds.some((value) => String(value).toLowerCase() === knownTargetRecordId);
});
const knownTargetExtraction = studies.find((study) => {
  const reportIds = (study as { reportIds?: unknown }).reportIds;
  return Array.isArray(reportIds) && reportIds.some((value) => String(value).toLowerCase() === knownTargetRecordId);
}) as { studyFamilyId?: string; reportRole?: string } | undefined;
const provenanceEligibleQuantitativeRows = quantitativeExtractionLedger.filter((entry) => entry.status === 'extracted');
const identifiedEstimands = estimandLedger.filter((entry) => entry.status === 'identified');

const summary = {
  runId: state.runId,
  stages: statuses,
  search: provenance.map((entry) => ({
    database: entry.database,
    platform: entry.platform,
    executedQuery: entry.executedQuery,
    resultCount: entry.resultCount,
    warnings: entry.warnings,
  })),
  importedRecords: searchResults.length,
  uniqueRecords: uniqueRecords.length,
  tiabIncluded: included.length,
  tiabScreeningQuality: state.artifacts.tiabScreeningQuality ?? null,
  shadowModelScreening: modelScreeningQuality ?? null,
  fullTextsRequested: (state.artifacts.retrievalReport as { requested?: number } | undefined)?.requested ?? included.length,
  fullTextsRetrieved: fullTexts.length,
  documentTierCounts,
  documentParsingQuality: state.artifacts.documentParsingQuality ?? null,
  unresolvedDocumentParses: documentParseFailures.length,
  fullTextScreeningQuality: state.artifacts.fullTextScreeningQuality ?? null,
  studyFamilyQuality: state.artifacts.studyFamilyQuality ?? null,
  studyFamilies: studyFamilies.length,
  studyFamilyEvidenceReceipts: studyFamilyEvidenceLedger.length,
  studyFamilySynthesisConflicts: studyFamilySynthesisConflicts.length,
  estimandIdentityQuality: state.artifacts.estimandIdentityQuality ?? null,
  identifiedEstimands: identifiedEstimands.length,
  estimandSynthesisConflicts: estimandSynthesisConflicts.length,
  estimandVerificationDebt: estimandVerificationDebt.length,
  scientificRun: {
    seal: scientificRunSeal?.digest ?? null,
    scientificArtifacts: scientificRunManifest?.sealedContent.scientificArtifacts.length ?? 0,
    operationalArtifacts: scientificRunManifest?.operationalArtifacts.length ?? 0,
    experimentalArtifacts: scientificRunManifest?.experimentalArtifacts.length ?? 0,
    attempts: scientificRunLedger?.attempts.length ?? 0,
  },
  knownTarget: {
    recordId: knownTargetRecordId,
    decision: knownTargetDecision ?? null,
    reachedExtraction: knownTargetReachedExtraction,
    familyLink: knownTargetFamilyLink ?? null,
    familyEvidence: knownTargetFamilyEvidence ?? null,
    extractionFamilyId: knownTargetExtraction?.studyFamilyId ?? null,
    reportRole: knownTargetExtraction?.reportRole ?? null,
  },
  extractedStudies: studies.length,
  quantitativeExtractionQuality: state.artifacts.quantitativeExtractionQuality ?? null,
  synthesis: state.artifacts.synthesis ?? null,
  finalReportProduced: Boolean(state.artifacts.finalReport),
  cognitiveActions: Object.fromEntries(
    [...new Set((cognitiveControl?.records ?? []).map((record) => record.action ?? 'UNKNOWN'))]
      .map((action) => [action, (cognitiveControl?.records ?? []).filter((record) => (record.action ?? 'UNKNOWN') === action).length]),
  ),
  auditEvents: state.audit.length,
  failures: failed.map(([name, stage]) => ({ stage: name, errors: stage.errors })),
};

const artifactDir = resolve(process.env.LIVE_PIPELINE_ARTIFACT_DIR ?? 'artifacts/live-pipeline');
await mkdir(artifactDir, { recursive: true });
const persist = async (name: string, value: unknown) => {
  await writeFile(resolve(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

// Do not persist full-text bodies in CI artifacts. The scientific bundle keeps
// lawful-access receipts, parser hierarchy decisions and parsed-document
// manifests, while source text stays in its authorized retrieval context.
const fullTextManifest = fullTexts.map(({ content: _content, ...metadata }) => metadata);
const parsedDocumentManifest = parsedDocuments.map((document) => ({
  recordId: document.recordId,
  extractionMethod: document.extractionMethod,
  textLength: document.text?.length ?? 0,
  sections: document.sections,
  documentIntelligence: document.documentIntelligence ?? null,
  tableCount: document.tables?.length ?? document.documentIntelligence?.tableCount ?? 0,
  figureCount: document.figures?.length ?? document.documentIntelligence?.figureCount ?? 0,
}));

await Promise.all([
  persist('summary.json', summary),
  persist('request.json', request),
  persist('search-provenance.json', state.artifacts.searchProvenance ?? []),
  persist('normalized-search-records.json', searchResults),
  persist('deduplication-report.json', state.artifacts.deduplicationReport ?? null),
  persist('unique-records.json', uniqueRecords),
  persist('tiab-decisions.json', state.artifacts.tiabDecisions ?? []),
  persist('tiab-screening-quality.json', state.artifacts.tiabScreeningQuality ?? null),
  persist('model-screening-suggestions.json', modelScreeningSuggestions),
  persist('model-screening-quality.json', modelScreeningQuality ?? null),
  persist('retrieval-report.json', state.artifacts.retrievalReport ?? null),
  persist('fulltext-manifest.json', fullTextManifest),
  persist('parsed-document-manifest.json', parsedDocumentManifest),
  persist('document-parse-failures.json', documentParseFailures),
  persist('document-parsing-quality.json', state.artifacts.documentParsingQuality ?? null),
  persist('fulltext-decisions.json', state.artifacts.fullTextDecisions ?? []),
  persist('fulltext-screening-quality.json', state.artifacts.fullTextScreeningQuality ?? null),
  persist('study-family-links.json', state.artifacts.studyFamilyLinks ?? []),
  persist('study-family-evidence-ledger.json', state.artifacts.studyFamilyEvidenceLedger ?? []),
  persist('study-families.json', state.artifacts.studyFamilies ?? []),
  persist('study-family-quality.json', state.artifacts.studyFamilyQuality ?? null),
  persist('study-family-synthesis-conflicts.json', state.artifacts.studyFamilySynthesisConflicts ?? []),
  persist('extracted-studies.json', state.artifacts.extractedStudies ?? []),
  persist('quantitative-extraction-ledger.json', quantitativeExtractionLedger),
  persist('quantitative-extraction-quality.json', state.artifacts.quantitativeExtractionQuality ?? null),
  persist('estimand-ledger.json', estimandLedger),
  persist('estimand-identity-quality.json', state.artifacts.estimandIdentityQuality ?? null),
  persist('estimand-synthesis-conflicts.json', estimandSynthesisConflicts),
  persist('estimand-verification-debt.json', estimandVerificationDebt),
  persist('risk-of-bias.json', state.artifacts.riskOfBias ?? null),
  persist('synthesis.json', state.artifacts.synthesis ?? null),
  persist('grade.json', state.artifacts.grade ?? null),
  persist('cognitive-control.json', state.artifacts.cognitiveControl ?? null),
  persist('scientific-run-manifest.json', scientificRunManifest ?? null),
  persist('scientific-run-seal.json', scientificRunSeal ?? null),
  persist('scientific-artifact-lineage.json', scientificArtifactLineage),
  persist('scientific-run-ledger.json', scientificRunLedger ?? null),
  persist('audit.json', state.audit),
  persist('final-report.json', state.artifacts.finalReport ?? null),
]);

console.log(JSON.stringify({ ...summary, artifactDir }, null, 2));

if (failed.length > 0) {
  throw new Error(`Live review pipeline failed at ${failed.map(([name]) => name).join(', ')}`);
}
if (!scientificRunManifest || !scientificRunSeal || !scientificRunLedger || scientificArtifactLineage.length === 0) {
  throw new Error('Live review pipeline did not produce the complete scientific run-control bundle.');
}
if (!verifyScientificRunSeal(scientificRunManifest, scientificRunSeal)) {
  throw new Error('Live scientific run seal does not verify against the sealed manifest content.');
}
if (containsRawSecretField(scientificRunManifest)) {
  throw new Error('Live scientific run manifest contains a raw secret-bearing field.');
}
if (scientificArtifactLineage.some((entry) => ['scientificRunManifest', 'scientificRunSeal', 'scientificArtifactLineage', 'scientificRunLedger'].includes(entry.key))) {
  throw new Error('Scientific run controls recursively entered their own artifact lineage.');
}
for (const key of ['studyFamilyLinks', 'quantitativeExtractionLedger', 'estimandLedger']) {
  if (!(key in state.artifacts)) continue;
  const receipt = scientificArtifactLineage.find((entry) => entry.key === key);
  if (!receipt) throw new Error(`Scientific artifact lineage omitted ${key}.`);
  if (receipt.hash !== scientificContentHash(state.artifacts[key])) {
    throw new Error(`Scientific artifact lineage hash for ${key} does not match the current artifact.`);
  }
}
if (provenance.length !== request.databases.length) {
  throw new Error(`Expected ${request.databases.length} live source receipts, received ${provenance.length}`);
}
if (!provenance.every((entry) => entry.resultCount > 0)) {
  throw new Error('Every requested live source must return at least one record.');
}
if (!provenance.find((entry) => entry.database.toLowerCase() === 'pubmed')?.executedQuery.includes('[Title/Abstract]')) {
  throw new Error('PubMed live pipeline did not execute a source-native title/abstract query.');
}
if (!provenance.find((entry) => entry.database.toLowerCase() === 'europepmc')?.executedQuery.includes('TITLE_ABS:')) {
  throw new Error('Europe PMC live pipeline did not execute a source-native TITLE_ABS query.');
}
if (provenance.some((entry) => /time to recovery/i.test(entry.executedQuery))) {
  throw new Error('Recall-first intervention search incorrectly required the outcome term.');
}
if (!provenance.every((entry) => /baricitinib/i.test(entry.executedQuery) && /remdesivir/i.test(entry.executedQuery))) {
  throw new Error('Combination intervention components were not both required in the executed query.');
}
if (!state.artifacts.cognitiveControl) {
  throw new Error('Live review pipeline did not persist cognitive attention decisions.');
}
if (parsedDocuments.length > 0 && parsedDocuments.some((document) => !document.documentIntelligence)) {
  throw new Error('One or more live full texts bypassed the document-intelligence hierarchy.');
}
if (process.env.OMNIROUTE_SHADOW_MODEL) {
  if (!modelScreeningQuality || modelScreeningSuggestions.length === 0) {
    throw new Error('OmniRoute shadow model was enabled but no screening comparison ledger was produced.');
  }
  if (modelScreeningQuality.authoritativeDecisionsChanged !== false) {
    throw new Error('Shadow model screening altered or could not prove preservation of authoritative screening decisions.');
  }
}
if (documentParseFailures.length > 0 && !(state.artifacts.finalReport as { appendices?: { unresolvedFullTexts?: unknown } } | undefined)?.appendices?.unresolvedFullTexts) {
  throw new Error('Live review pipeline quarantined documents but did not disclose them in the final report.');
}
if (identifiedEstimands.length !== provenanceEligibleQuantitativeRows.length) {
  throw new Error(`Estimand reconciliation failed: ${provenanceEligibleQuantitativeRows.length} provenance-eligible quantitative row(s) but ${identifiedEstimands.length} identified estimand receipt(s).`);
}
for (const quantitative of provenanceEligibleQuantitativeRows) {
  const match = identifiedEstimands.find((entry) => entry.studyId === quantitative.studyId && entry.outcome === quantitative.outcome);
  if (!match?.estimand?.estimandId) {
    throw new Error(`Quantitative row ${quantitative.studyId}/${quantitative.outcome} has no deterministic estimand ID.`);
  }
  const source = match.estimand.source;
  if (source?.recordId !== quantitative.recordId || source?.tableId !== quantitative.tableId || source?.page !== quantitative.page) {
    throw new Error(`Estimand receipt ${match.estimand.estimandId} lost record/table/page provenance from its quantitative source row.`);
  }
}
if (!knownTargetDecision) {
  throw new Error(`Known target ${knownTargetRecordId} was not represented in full-text screening decisions.`);
}
if (knownTargetDecision.decision !== 'include') {
  throw new Error(`Known target ${knownTargetRecordId} failed full-text eligibility: ${knownTargetDecision.decision} — ${knownTargetDecision.reason ?? 'no reason recorded'}`);
}
if (!knownTargetReachedExtraction) {
  throw new Error(`Known target ${knownTargetRecordId} passed full-text screening but did not reach extraction.`);
}
if (!knownTargetFamilyLink?.familyId) {
  throw new Error(`Known target ${knownTargetRecordId} reached screening without a study-family identity receipt.`);
}
if (!knownTargetFamilyEvidence?.evidence?.length) {
  throw new Error(`Known target ${knownTargetRecordId} received a family ID without an evidence-bound family receipt.`);
}
if (!knownTargetFamilyEvidence.evidence.some((entry) => entry.id && /NCT04401579/i.test(entry.quote ?? ''))) {
  throw new Error(`Known target ${knownTargetRecordId} family receipt does not expose the ${knownTargetRegistryId} source evidence.`);
}
if (knownTargetExtraction?.studyFamilyId !== knownTargetFamilyLink.familyId) {
  throw new Error(`Known target ${knownTargetRecordId} lost or changed study-family identity between full-text linkage and extraction.`);
}
const finalAppendices = (state.artifacts.finalReport as { appendices?: Record<string, unknown> } | undefined)?.appendices;
if (!finalAppendices?.studyFamilyLinks) {
  throw new Error('Final report omitted the study-family linkage ledger.');
}
if (!finalAppendices?.studyFamilies) {
  throw new Error('Final report omitted the study-family registry.');
}
if (!finalAppendices?.studyFamilyEvidenceLedger) {
  throw new Error('Final report omitted the evidence-bound study-family ledger.');
}
if (!finalAppendices || !Object.prototype.hasOwnProperty.call(finalAppendices, 'estimandLedger')) {
  throw new Error('Final report omitted the canonical estimand ledger.');
}
if (!finalAppendices || !Object.prototype.hasOwnProperty.call(finalAppendices, 'estimandIdentityQuality')) {
  throw new Error('Final report omitted estimand identity quality metadata.');
}
if (!finalAppendices?.scientificRunManifest || !finalAppendices?.scientificRunSeal || !finalAppendices?.scientificArtifactLineage || !finalAppendices?.scientificRunLedger) {
  throw new Error('Final report omitted one or more scientific run-control appendices.');
}
if ((finalAppendices.scientificRunSeal as ScientificRunSeal).digest !== scientificRunSeal.digest) {
  throw new Error('Final report carries a scientific seal that differs from the top-level run seal.');
}
if (!state.artifacts.finalReport) {
  throw new Error('Live review pipeline did not produce a final report artifact.');
}
