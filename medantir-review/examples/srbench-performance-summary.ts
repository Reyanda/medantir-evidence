import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';
import { createSrTournamentPerformanceSummary } from '../src/benchmark/sr-performance-summary.js';

const tournamentPath = resolve(process.env.SRBENCH_TOURNAMENT_FILE ?? 'artifacts/srbench/srbench-tournament.json');
const outputDir = resolve(process.env.SRBENCH_OUTPUT_DIR ?? 'artifacts/srbench');
const tournament = JSON.parse(await readFile(tournamentPath, 'utf8')) as SrBenchmarkTournamentResult;
const summary = createSrTournamentPerformanceSummary(tournament);
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, 'srbench-performance-summary.json');
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  suiteHash: summary.suiteHash,
  tournamentHash: summary.tournamentHash,
  summaryHash: summary.summaryHash,
  models: summary.models.map((model) => ({
    requestedModel: model.requestedModel,
    validationReproduction: model.validation.meanReproductionScore,
    validationEffective: model.validation.meanEffectiveScore,
    validationSr100Rate: model.validation.sr100Rate,
    screeningSafety: {
      assessedTaskRuns: model.screeningSafety.assessedTaskRuns,
      passRate: model.screeningSafety.passRate,
      taskRunsWithFalseNegatives: model.screeningSafety.taskRunsWithFalseNegatives,
      worstObservedSensitivity: model.screeningSafety.worstObservedSensitivity ?? null,
      worstSensitivityLower95: model.screeningSafety.worstSensitivityLower95 ?? null,
      worstObservedFalseNegativeRate: model.screeningSafety.worstObservedFalseNegativeRate ?? null,
      worstConservativeMissedPer1000: model.screeningSafety.worstConservativeMissedPer1000 ?? null,
    },
    modelCapability: {
      allRequiredStagesPassed: model.modelCapability.allRequiredStagesPassed,
      stages: model.modelCapability.stages.map((stage) => ({
        stage: stage.stage,
        distinctReviewCount: stage.distinctReviewCount,
        domainCount: stage.domainCount,
        reviewBreadthPassed: stage.reviewBreadthPassed,
        domainBreadthPassed: stage.domainBreadthPassed,
      })),
    },
    counterfactualCanarySr100Rate: model.counterfactualCanary.sr100Rate,
    contaminationConcern: model.contaminationConcern,
    promotionTier: model.qualificationPromotionTier,
  })),
  outputPath,
}, null, 2));
