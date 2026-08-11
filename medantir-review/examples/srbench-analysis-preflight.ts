import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSrAnalysisReproductionPreflight,
  type SrAnalysisReproductionPreflightInput,
} from '../src/benchmark/sr-analysis-reproduction-preflight.js';

const inputPath = resolve(process.env.SRBENCH_ANALYSIS_PREFLIGHT_FILE ?? 'benchmarks/srbench-v1/covid-rat-2024/runtime-preflight.json');
const outputDir = resolve(process.env.SRBENCH_ANALYSIS_PREFLIGHT_OUTPUT_DIR ?? 'artifacts/srbench-qualification');
const input = JSON.parse(await readFile(inputPath, 'utf8')) as SrAnalysisReproductionPreflightInput;
const report = createSrAnalysisReproductionPreflight(input);
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${report.candidateId}-analysis-preflight.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  candidateId: report.candidateId,
  sourceRepository: report.sourceRepository,
  sourceCommit: report.sourceCommit,
  sourceObjects: report.sourceObjects?.length ?? 0,
  blockerCount: report.blockerCount,
  warningCount: report.warningCount,
  unresolvedSourceIdentity: report.unresolvedSourceIdentity,
  unresolvedEntrypoints: report.unresolvedEntrypoints,
  unresolvedRuntimeIdentity: report.unresolvedRuntimeIdentity,
  nonScientificRepairCount: report.nonScientificRepairCount,
  potentiallySemanticRepairCount: report.potentiallySemanticRepairCount,
  runnableWithoutSemanticRepair: report.runnableWithoutSemanticRepair,
  exactReproductionReady: report.exactReproductionReady,
  reportHash: report.reportHash,
  outputPath,
}, null, 2));
