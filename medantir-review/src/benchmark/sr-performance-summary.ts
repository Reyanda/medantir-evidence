import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkTournamentResult } from './sr-benchmark-suite.js';
import type { SrBenchmarkStage } from './sr-reproduction-benchmark.js';
import {
  createSrScreeningSafetyReport,
  type SrScreeningConfusionMatrix,
  type SrScreeningSafetyReport,
} from './sr-screening-safety.js';

export const SR_PERFORMANCE_SUMMARY_SCHEMA_VERSION = 'medantir-srbench-performance-summary/1' as const;

export interface SrModelPerformanceSummary {
  requestedModel: string;
  actualModels: string[];
  providers: string[];
  validation: {
    runs: number;
    meanReproductionScore: number;
    meanPipelineCoverage: number;
    meanEffectiveScore: number;
    sr100Runs: number;
    sr100Rate: number;
    criticalFailures: number;
  };
  screeningSafety: {
    assessedTaskRuns: number;
    passingTaskRuns: number;
    passRate: number;
    failingTaskRuns: number;
    taskRunsWithFalseNegatives: number;
    uniqueCasesAssessed: number;
    worstObservedSensitivity?: number;
    worstSensitivityLower95?: number;
    worstObservedFalseNegativeRate?: number;
    worstConservativeMissedPer1000?: number;
  };
  modelCapability: {
    requiredStages: SrBenchmarkStage[];
    stages: Array<{
      stage: SrBenchmarkStage;
      distinctReviewCount: number;
      domainCount: number;
      distinctReviewHashes: string[];
      domains: string[];
      reviewBreadthPassed: boolean;
      domainBreadthPassed: boolean;
    }>;
    allRequiredStagesPassed: boolean;
  };
  counterfactualCanary: {
    runs: number;
    challengedRuns: number;
    sr100Runs: number;
    sr100Rate: number;
    criticalFailures: number;
    uniqueChallengeReceipts: number;
    uniqueChallengeCases: number;
  };
  qualificationPromotionTier: string;
  contaminationConcern: boolean;
  contaminationConcernReason?: string;
  summaryHash: string;
}

export interface SrTournamentPerformanceSummary {
  schemaVersion: typeof SR_PERFORMANCE_SUMMARY_SCHEMA_VERSION;
  suiteHash: string;
  tournamentHash: string;
  models: SrModelPerformanceSummary[];
  summaryHash: string;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function confusionFromDiagnostics(value: unknown): SrScreeningConfusionMatrix | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const truePositive = finiteNumber(row.truePositive);
  const falseNegative = finiteNumber(row.falseNegative);
  const trueNegative = finiteNumber(row.trueNegative);
  const falsePositive = finiteNumber(row.falsePositive);
  if ([truePositive, falseNegative, trueNegative, falsePositive].some((item) => item === undefined)) return undefined;
  if (![truePositive, falseNegative, trueNegative, falsePositive].every((item) => Number.isInteger(item) && item! >= 0)) return undefined;
  return { truePositive: truePositive!, falseNegative: falseNegative!, trueNegative: trueNegative!, falsePositive: falsePositive! };
}

function screeningSafetyForModel(
  runs: SrBenchmarkTournamentResult['runs'],
): SrModelPerformanceSummary['screeningSafety'] {
  const assessed: Array<{ baseCaseId: string; report: SrScreeningSafetyReport }> = [];
  for (const run of runs) {
    for (const task of run.taskScores) {
      if (task.stage !== 'tiab-screening' && task.stage !== 'fulltext-screening') continue;
      const confusion = confusionFromDiagnostics(task.diagnostics);
      if (!confusion) continue;
      try {
        assessed.push({ baseCaseId: run.baseCaseId, report: createSrScreeningSafetyReport({ confusion }) });
      } catch {
        // A task containing only one gold class cannot estimate both sensitivity and specificity.
      }
    }
  }
  const reports = assessed.map((item) => item.report);
  const passingTaskRuns = reports.filter((report) => report.gatePassed).length;
  const min = (values: number[]) => values.length > 0 ? Math.min(...values) : undefined;
  const max = (values: number[]) => values.length > 0 ? Math.max(...values) : undefined;
  return {
    assessedTaskRuns: reports.length,
    passingTaskRuns,
    passRate: reports.length > 0 ? passingTaskRuns / reports.length : 0,
    failingTaskRuns: reports.length - passingTaskRuns,
    taskRunsWithFalseNegatives: reports.filter((report) => report.confusion.falseNegative > 0).length,
    uniqueCasesAssessed: new Set(assessed.map((item) => item.baseCaseId)).size,
    ...(min(reports.map((report) => report.observedSensitivity)) !== undefined
      ? { worstObservedSensitivity: min(reports.map((report) => report.observedSensitivity))! }
      : {}),
    ...(min(reports.map((report) => report.sensitivityWilson95.lower)) !== undefined
      ? { worstSensitivityLower95: min(reports.map((report) => report.sensitivityWilson95.lower))! }
      : {}),
    ...(max(reports.map((report) => report.observedFalseNegativeRate)) !== undefined
      ? { worstObservedFalseNegativeRate: max(reports.map((report) => report.observedFalseNegativeRate))! }
      : {}),
    ...(max(reports.map((report) => report.conservativeMissedPer1000Candidates)) !== undefined
      ? { worstConservativeMissedPer1000: max(reports.map((report) => report.conservativeMissedPer1000Candidates))! }
      : {}),
  };
}

function capabilitySummary(
  promotion: SrBenchmarkTournamentResult['promotion'][number] | undefined,
): SrModelPerformanceSummary['modelCapability'] {
  const coverage = promotion?.modelCapabilityCoverage ?? [];
  const reviewChecks = new Map<string, boolean>();
  const domainChecks = new Map<string, boolean>();
  for (const item of promotion?.checks ?? []) {
    const reviewMatch = /^model-stage-(.+)-review-coverage$/.exec(item.code);
    if (reviewMatch) reviewChecks.set(reviewMatch[1]!, item.passed);
    const domainMatch = /^model-stage-(.+)-domain-coverage$/.exec(item.code);
    if (domainMatch) domainChecks.set(domainMatch[1]!, item.passed);
  }
  const codeForStage = (stage: SrBenchmarkStage) => stage.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const stages = coverage.map((item) => {
    const code = codeForStage(item.stage);
    return {
      stage: item.stage,
      distinctReviewCount: item.distinctReviewHashes.length,
      domainCount: item.domains.length,
      distinctReviewHashes: item.distinctReviewHashes,
      domains: item.domains,
      reviewBreadthPassed: reviewChecks.get(code) ?? false,
      domainBreadthPassed: domainChecks.get(code) ?? false,
    };
  });
  return {
    requiredStages: stages.map((item) => item.stage),
    stages,
    allRequiredStagesPassed: stages.length > 0 && stages.every((item) => item.reviewBreadthPassed && item.domainBreadthPassed),
  };
}

export function createSrTournamentPerformanceSummary(tournament: SrBenchmarkTournamentResult): SrTournamentPerformanceSummary {
  const validationIds = new Set(tournament.cases.filter((item) => item.role === 'validation').map((item) => item.caseId));
  const canaryIds = new Set(tournament.cases.filter((item) => item.role === 'canary').map((item) => item.caseId));
  const models: SrModelPerformanceSummary[] = tournament.models.map((model) => {
    const modelRuns = tournament.runs.filter((run) => run.requestedModel === model);
    const validationRuns = modelRuns.filter((run) => validationIds.has(run.baseCaseId));
    const canaryRuns = modelRuns.filter((run) => canaryIds.has(run.baseCaseId));
    const challengedRuns = canaryRuns.filter((run) => Boolean(run.challengeReceiptHash));
    const actualModels = unique(modelRuns.flatMap((run) => run.actualModels));
    const providers = unique(modelRuns.flatMap((run) => run.providers));
    const validationSr100 = validationRuns.filter((run) => run.sr100).length;
    const canarySr100 = challengedRuns.filter((run) => run.sr100).length;
    const validationMeanReproduction = mean(validationRuns.map((run) => run.reproductionScore));
    const canaryRate = challengedRuns.length > 0 ? canarySr100 / challengedRuns.length : 0;
    const screeningSafety = screeningSafetyForModel(validationRuns);
    const contaminationConcern = validationRuns.length > 0
      && validationMeanReproduction >= 90
      && challengedRuns.length > 0
      && canaryRate < 1;
    const contaminationConcernReason = contaminationConcern
      ? `Published-review reproduction is high (${validationMeanReproduction.toFixed(2)}%) but counterfactual canary SR100 rate is ${(canaryRate * 100).toFixed(2)}%; known-answer memorization or brittle evidence-following should be investigated.`
      : undefined;
    const promotion = tournament.promotion.find((item) => item.requestedModel === model);
    const modelCapability = capabilitySummary(promotion);
    const base = {
      requestedModel: model,
      actualModels,
      providers,
      validation: {
        runs: validationRuns.length,
        meanReproductionScore: validationMeanReproduction,
        meanPipelineCoverage: mean(validationRuns.map((run) => run.pipelineCoverage)),
        meanEffectiveScore: mean(validationRuns.map((run) => run.effectiveScore)),
        sr100Runs: validationSr100,
        sr100Rate: validationRuns.length > 0 ? validationSr100 / validationRuns.length : 0,
        criticalFailures: validationRuns.reduce((sum, run) => sum + run.criticalFailures.length, 0),
      },
      screeningSafety,
      modelCapability,
      counterfactualCanary: {
        runs: canaryRuns.length,
        challengedRuns: challengedRuns.length,
        sr100Runs: canarySr100,
        sr100Rate: canaryRate,
        criticalFailures: challengedRuns.reduce((sum, run) => sum + run.criticalFailures.length, 0),
        uniqueChallengeReceipts: new Set(challengedRuns.map((run) => run.challengeReceiptHash)).size,
        uniqueChallengeCases: new Set(challengedRuns.map((run) => run.caseHash)).size,
      },
      qualificationPromotionTier: promotion?.tier ?? 'blocked',
      contaminationConcern,
      ...(contaminationConcernReason ? { contaminationConcernReason } : {}),
    };
    return { ...base, summaryHash: scientificContentHash(base) };
  }).sort((a, b) => b.validation.meanEffectiveScore - a.validation.meanEffectiveScore
    || b.counterfactualCanary.sr100Rate - a.counterfactualCanary.sr100Rate
    || a.requestedModel.localeCompare(b.requestedModel));
  const base = {
    schemaVersion: SR_PERFORMANCE_SUMMARY_SCHEMA_VERSION,
    suiteHash: tournament.suiteHash,
    tournamentHash: tournament.tournamentHash,
    models,
  };
  return { ...base, summaryHash: scientificContentHash(base) };
}
