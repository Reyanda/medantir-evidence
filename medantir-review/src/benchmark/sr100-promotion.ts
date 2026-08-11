import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkRunResult, SrBenchmarkStage } from './sr-reproduction-benchmark.js';

export const SR100_PROMOTION_SCHEMA_VERSION = 'medantir-sr100-promotion/1' as const;

export const DEFAULT_REQUIRED_MODEL_STAGES: SrBenchmarkStage[] = [
  'question',
  'protocol',
  'search',
  'tiab-screening',
  'fulltext-screening',
  'extraction',
  'appraisal',
  'report',
];

export interface Sr100PromotionPolicy {
  schemaVersion: typeof SR100_PROMOTION_SCHEMA_VERSION;
  policyId: string;
  policyVersion: string;
  minCompleteReviewCases: number;
  minDistinctDomains: number;
  minRepeatsPerCase: number;
  requireEveryRunSr100: boolean;
  requirePinnedActualModel: boolean;
  requirePinnedProvider: boolean;
  requireZeroCriticalFailures: boolean;
  livingReviewRequiresDriftSentinel: boolean;
  /** Model-dependent scientific stages that must be directly exercised rather than supplied only by deterministic engine receipts. */
  requiredModelStages?: SrBenchmarkStage[];
  /** Distinct complete review hashes in which each required model stage must be directly tested. Defaults to minCompleteReviewCases. */
  minModelEvaluatedReviewCasesPerStage?: number;
  /** Distinct scientific domains in which each required model stage must be directly tested. Defaults to minDistinctDomains. */
  minModelEvaluatedDomainsPerStage?: number;
}

export interface SrBenchmarkRunWithContext extends SrBenchmarkRunResult {
  domain: string;
  repeat: number;
}

export type Sr100PromotionTier =
  | 'blocked'
  | 'shadow-eligible'
  | 'supervised-future-review-eligible'
  | 'supervised-living-review-eligible';

export interface Sr100PromotionCheck {
  code: string;
  passed: boolean;
  observed: string | number | boolean;
  required: string | number | boolean;
  rationale: string;
}

export interface SrModelCapabilityCoverage {
  stage: SrBenchmarkStage;
  distinctReviewHashes: string[];
  domains: string[];
}

export interface Sr100PromotionDossier {
  schemaVersion: typeof SR100_PROMOTION_SCHEMA_VERSION;
  requestedModel: string;
  actualModels: string[];
  providers: string[];
  completeCases: string[];
  completeCaseHashes: string[];
  domains: string[];
  modelCapabilityCoverage: SrModelCapabilityCoverage[];
  runs: number;
  sr100Runs: number;
  checks: Sr100PromotionCheck[];
  tier: Sr100PromotionTier;
  autonomousAuthorityGranted: false;
  rationale: string;
  dossierHash: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function check(code: string, passed: boolean, observed: Sr100PromotionCheck['observed'], required: Sr100PromotionCheck['required'], rationale: string): Sr100PromotionCheck {
  return { code, passed, observed, required, rationale };
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
}

function normalizedRequiredModelStages(policy: Sr100PromotionPolicy): SrBenchmarkStage[] {
  const stages = policy.requiredModelStages ?? DEFAULT_REQUIRED_MODEL_STAGES;
  const allowed = new Set<SrBenchmarkStage>([
    'question', 'protocol', 'search', 'deduplication', 'tiab-screening', 'fulltext-screening', 'extraction', 'appraisal', 'synthesis', 'report',
  ]);
  const cleaned = [...new Set(stages)];
  if (cleaned.length === 0) throw new Error('SR100 promotion requires at least one directly evaluated model-capability stage.');
  if (cleaned.some((stage) => !allowed.has(stage))) throw new Error('SR100 promotion policy contains an unsupported model-capability stage.');
  return cleaned.sort((a, b) => a.localeCompare(b));
}

function capabilityCaseMinimum(policy: Sr100PromotionPolicy): number {
  return policy.minModelEvaluatedReviewCasesPerStage ?? policy.minCompleteReviewCases;
}

function capabilityDomainMinimum(policy: Sr100PromotionPolicy): number {
  return policy.minModelEvaluatedDomainsPerStage ?? policy.minDistinctDomains;
}

function validatePolicy(policy: Sr100PromotionPolicy): void {
  if (policy.schemaVersion !== SR100_PROMOTION_SCHEMA_VERSION) throw new Error(`Unsupported SR100 policy schema '${policy.schemaVersion}'.`);
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('SR100 promotion policy requires stable ID/version.');
  positiveInteger(policy.minCompleteReviewCases, 'minCompleteReviewCases');
  positiveInteger(policy.minDistinctDomains, 'minDistinctDomains');
  positiveInteger(policy.minRepeatsPerCase, 'minRepeatsPerCase');
  positiveInteger(capabilityCaseMinimum(policy), 'minModelEvaluatedReviewCasesPerStage');
  positiveInteger(capabilityDomainMinimum(policy), 'minModelEvaluatedDomainsPerStage');
  normalizedRequiredModelStages(policy);
}

export function defaultSr100PromotionPolicy(): Sr100PromotionPolicy {
  return {
    schemaVersion: SR100_PROMOTION_SCHEMA_VERSION,
    policyId: 'MEDANTIR-SR100',
    policyVersion: '1.1.0',
    minCompleteReviewCases: 3,
    minDistinctDomains: 3,
    minRepeatsPerCase: 3,
    requireEveryRunSr100: true,
    requirePinnedActualModel: true,
    requirePinnedProvider: false,
    requireZeroCriticalFailures: true,
    livingReviewRequiresDriftSentinel: true,
    requiredModelStages: [...DEFAULT_REQUIRED_MODEL_STAGES],
    minModelEvaluatedReviewCasesPerStage: 3,
    minModelEvaluatedDomainsPerStage: 3,
  };
}

function capabilityCoverage(input: {
  runs: SrBenchmarkRunWithContext[];
  stages: SrBenchmarkStage[];
}): SrModelCapabilityCoverage[] {
  return input.stages.map((stage) => {
    const stageRuns = input.runs.filter((run) => run.taskScores.some((task) => task.stage === stage));
    return {
      stage,
      distinctReviewHashes: unique(stageRuns.map((run) => run.caseHash)),
      domains: unique(stageRuns.map((run) => run.domain)),
    };
  });
}

function stageCode(stage: SrBenchmarkStage): string {
  return stage.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function buildSr100PromotionDossier(input: {
  requestedModel: string;
  runs: SrBenchmarkRunWithContext[];
  policy?: Sr100PromotionPolicy;
  driftSentinelConfigured?: boolean;
}): Sr100PromotionDossier {
  const policy = input.policy ?? defaultSr100PromotionPolicy();
  validatePolicy(policy);
  if (!input.requestedModel.trim()) throw new Error('SR100 promotion requires a requested model identity.');
  const runs = input.runs.filter((run) => run.requestedModel === input.requestedModel);
  const completeRuns = runs.filter((run) => run.pipelineCoverage === 100);
  const completeCases = unique(completeRuns.map((run) => run.caseId));
  const completeCaseHashes = unique(completeRuns.map((run) => run.caseHash));
  const domains = unique(completeRuns.map((run) => run.domain));
  const actualModels = unique(runs.flatMap((run) => run.actualModels));
  const providers = unique(runs.flatMap((run) => run.providers));
  const sr100Runs = runs.filter((run) => run.sr100).length;
  const repeatsByCase = new Map<string, Set<number>>();
  for (const run of completeRuns) {
    const current = repeatsByCase.get(run.caseHash) ?? new Set<number>();
    current.add(run.repeat);
    repeatsByCase.set(run.caseHash, current);
  }
  const everyCaseRepeated = completeCaseHashes.length > 0
    && completeCaseHashes.every((caseHash) => (repeatsByCase.get(caseHash)?.size ?? 0) >= policy.minRepeatsPerCase);
  const allSr100 = runs.length > 0 && runs.every((run) => run.sr100);
  const zeroCritical = runs.every((run) => run.criticalFailures.length === 0);
  const requiredStages = normalizedRequiredModelStages(policy);
  const modelCapabilityCoverage = capabilityCoverage({ runs: completeRuns, stages: requiredStages });
  const requiredCapabilityCases = capabilityCaseMinimum(policy);
  const requiredCapabilityDomains = capabilityDomainMinimum(policy);
  const checks: Sr100PromotionCheck[] = [
    check('complete-review-count', completeCaseHashes.length >= policy.minCompleteReviewCases, completeCaseHashes.length, policy.minCompleteReviewCases, 'Promotion counts distinct frozen review gold hashes, not case labels, so one review cannot be duplicated under multiple IDs.'),
    check('domain-count', domains.length >= policy.minDistinctDomains, domains.length, policy.minDistinctDomains, 'The complete benchmark set must span distinct scientific domains.'),
    check('repeat-stability', everyCaseRepeated, everyCaseRepeated, true, `Every distinct complete review hash must have at least ${policy.minRepeatsPerCase} distinct repeat indices.`),
    check('every-run-sr100', !policy.requireEveryRunSr100 || allSr100, allSr100, true, 'A promoted model cannot average away a failed reproduction run.'),
    check('zero-critical-failures', !policy.requireZeroCriticalFailures || zeroCritical, zeroCritical, true, 'Any critical scientific failure blocks promotion regardless of mean score.'),
    check('pinned-actual-model', !policy.requirePinnedActualModel || actualModels.length === 1, actualModels.length, 1, 'Dynamic routing cannot silently substitute a different model after validation.'),
    check('pinned-provider', !policy.requirePinnedProvider || providers.length === 1, providers.length, 1, 'Provider identity is pinned when the policy requires it.'),
    ...modelCapabilityCoverage.flatMap((coverage) => [
      check(
        `model-stage-${stageCode(coverage.stage)}-review-coverage`,
        coverage.distinctReviewHashes.length >= requiredCapabilityCases,
        coverage.distinctReviewHashes.length,
        requiredCapabilityCases,
        `The model itself, not only deterministic software, must be directly evaluated on '${coverage.stage}' across distinct complete review hashes.`,
      ),
      check(
        `model-stage-${stageCode(coverage.stage)}-domain-coverage`,
        coverage.domains.length >= requiredCapabilityDomains,
        coverage.domains.length,
        requiredCapabilityDomains,
        `The model's '${coverage.stage}' capability must generalize across distinct scientific domains rather than one review family.`,
      ),
    ]),
  ];
  const futureEligible = checks.every((item) => item.passed);
  const driftReady = !policy.livingReviewRequiresDriftSentinel || input.driftSentinelConfigured === true;
  const tier: Sr100PromotionTier = futureEligible
    ? driftReady ? 'supervised-living-review-eligible' : 'supervised-future-review-eligible'
    : runs.some((run) => run.reproductionScore >= 90 && run.criticalFailures.length === 0)
      ? 'shadow-eligible'
      : 'blocked';
  const rationale = tier === 'supervised-living-review-eligible'
    ? 'The model reproduced every complete benchmark review exactly across the prespecified multi-domain repeated-run policy, directly demonstrated every required model-dependent scientific capability across the required review/domain breadth, and has a drift sentinel. This supports supervised living-review use; it does not grant autonomous scientific authority.'
    : tier === 'supervised-future-review-eligible'
      ? 'The model satisfied the complete multi-review SR100 policy and directly demonstrated every required model-dependent scientific capability across the required review/domain breadth, but lacks the required living-review drift sentinel. It is eligible for supervised prospective review use only.'
      : tier === 'shadow-eligible'
        ? 'The model shows useful benchmark performance but does not satisfy the complete SR100 and model-capability promotion gate. Keep it shadow/decision-support only.'
        : 'The model failed one or more benchmark safety/performance/capability gates and is not eligible for review production.';
  const base: Omit<Sr100PromotionDossier, 'dossierHash'> = {
    schemaVersion: SR100_PROMOTION_SCHEMA_VERSION,
    requestedModel: input.requestedModel,
    actualModels,
    providers,
    completeCases,
    completeCaseHashes,
    domains,
    modelCapabilityCoverage,
    runs: runs.length,
    sr100Runs,
    checks,
    tier,
    autonomousAuthorityGranted: false,
    rationale,
  };
  return { ...base, dossierHash: scientificContentHash(base) };
}
