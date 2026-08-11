import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSrBenchmarkSuite } from '../src/benchmark/sr-benchmark-suite.js';
import { srPipelineCoverage } from '../src/benchmark/sr-reproduction-benchmark.js';
import {
  createSrAnalysisReproductionPreflight,
  type SrAnalysisReproductionPreflightInput,
  type SrAnalysisReproductionPreflightReport,
} from '../src/benchmark/sr-analysis-reproduction-preflight.js';

function listEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

const suitePath = resolve(process.env.SRBENCH_SUITE ?? 'benchmarks/srbench-v1/suite.json');
const runtimePreflightPaths = listEnv('SRBENCH_RUNTIME_PREFLIGHT_FILES', [
  'benchmarks/srbench-v1/covid-rat-2024/runtime-preflight.json',
]).map((path) => resolve(path));
const outputDir = resolve(process.env.SRBENCH_OUTPUT_DIR ?? 'artifacts/srbench');

const loaded = await loadSrBenchmarkSuite(suitePath);
const cases = loaded.cases.map((item) => ({
  caseId: item.definition.caseId,
  caseHash: item.definition.caseHash,
  benchmarkClass: item.benchmarkClass,
  role: item.role,
  qualificationCandidateId: item.qualificationCandidateId ?? null,
  domain: item.definition.domain,
  pipelineCoverage: srPipelineCoverage(item.definition),
  stageGold: item.definition.stageGold,
  tasks: item.definition.tasks.map((task) => ({
    id: task.id,
    stage: task.stage,
    dependsOn: task.dependsOn ?? [],
    critical: task.critical,
    scorer: task.scorer,
  })),
}));

const analysisPreflights: Array<{ path: string; report: SrAnalysisReproductionPreflightReport }> = [];
for (const path of runtimePreflightPaths) {
  const input = JSON.parse(await readFile(path, 'utf8')) as SrAnalysisReproductionPreflightInput;
  analysisPreflights.push({ path, report: createSrAnalysisReproductionPreflight(input) });
}

const qualification = loaded.qualificationCorpus;
const finalization = loaded.qualificationFinalization;
const receipt = {
  schemaVersion: 'medantir-srbench-validation/4',
  suiteId: loaded.suite.suiteId,
  suiteVersion: loaded.suite.suiteVersion,
  suiteHash: loaded.suiteHash,
  valid: true,
  cases,
  qualificationAdmissions: loaded.qualificationAdmissions,
  qualification: qualification ? {
    corpusId: qualification.corpusId,
    corpusVersion: qualification.corpusVersion,
    corpusHash: qualification.corpusHash,
    validationReadyCandidates: qualification.validationReadyCandidates,
    validationReadyDomains: qualification.validationReadyDomains,
    candidates: qualification.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      domain: candidate.domain,
      methodologicalClass: candidate.methodologicalClass,
      readiness: candidate.readiness,
      completeComponents: candidate.completeComponents,
      buildableComponents: candidate.buildableComponents,
      missingOrWeakComponents: candidate.missingOrWeakComponents,
      promotionEligible: candidate.promotionEligible,
      candidateHash: candidate.candidateHash,
    })),
  } : null,
  qualificationFinalization: finalization ? {
    finalizationHash: finalization.finalizationHash,
    sourceCaptureHashes: finalization.sourceCaptureHashes,
    assetReceiptHashes: finalization.assetReceiptHashes,
    candidateVerificationReceiptHashes: finalization.candidateVerificationReceiptHashes,
    promotionPolicy: finalization.promotionPolicy,
    promotionGate: finalization.promotionGate,
  } : null,
  analysisPreflights: analysisPreflights.map(({ path, report }) => ({
    path,
    candidateId: report.candidateId,
    sourceCommit: report.sourceCommit,
    blockerCount: report.blockerCount,
    warningCount: report.warningCount,
    unresolvedRuntimeIdentity: report.unresolvedRuntimeIdentity,
    exactReproductionReady: report.exactReproductionReady,
    reportHash: report.reportHash,
  })),
  generatedAt: new Date().toISOString(),
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'srbench-validation.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
