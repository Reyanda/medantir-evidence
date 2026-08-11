import { scientificContentHash } from '../core/canonical-hash.js';

export const MODEL_GOVERNANCE_SCHEMA_VERSION = 'medantir-model-governance/1';

export type GovernedModelTask = 'tiab-screening';
export type ModelGovernanceRecommendation = 'blocked' | 'eligible-for-human-review';
export type ModelGovernanceApprovalStatus = 'approved-decision-support' | 'rejected' | 'deferred';

export interface ScreeningBenchmarkSuggestion {
  recordId: string;
  authoritativeDecision?: 'include' | 'exclude' | 'uncertain';
  suggestedDecision?: 'include' | 'exclude' | 'uncertain';
  status?: 'completed' | 'invalid-output' | 'inference-error';
  requestHash?: string;
  outputHash?: string;
  routingReceipt?: {
    actualProvider?: string;
    actualModel?: string;
    gatewayVersion?: string;
    responseCostUsd?: number;
  };
}

export interface ScreeningBenchmarkCandidate {
  model: string;
  quality: {
    sampledRecords: number;
    completed: number;
    invalidOutputs: number;
    inferenceErrors: number;
    authoritativeDecisionsChanged?: boolean;
  };
  metrics: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    uncertain: number;
    sensitivity: number | null;
    specificity: number | null;
    precision: number | null;
    f1: number | null;
    accuracy: number | null;
  };
  resources?: {
    totalCostUsd?: number;
    totalTokensIn?: number;
    totalTokensOut?: number;
    meanLatencyMs?: number | null;
  };
  routedProviders?: string[];
  actualModels?: string[];
  suggestions: ScreeningBenchmarkSuggestion[];
}

export interface FrozenModelBenchmarkContext {
  task: GovernedModelTask;
  evidenceSetHash: string;
  authoritativeDecisionHash: string;
  sampleDefinitionHash: string;
  promptVersion: string;
}

export type BenchmarkReferenceBasis = 'dual-human-adjudicated' | 'independent-gold-standard' | 'externally-adjudicated';

export interface ModelBenchmarkReferenceReceipt {
  schemaVersion: typeof MODEL_GOVERNANCE_SCHEMA_VERSION;
  task: GovernedModelTask;
  evidenceSetHash: string;
  authoritativeDecisionHash: string;
  sampleDefinitionHash: string;
  promptVersion: string;
  independentlyVerified: boolean;
  basis: BenchmarkReferenceBasis;
  verificationReceiptId: string;
  verifierId?: string;
  verifiedAt?: string;
}

export interface ScreeningModelPromotionPolicy {
  schemaVersion: typeof MODEL_GOVERNANCE_SCHEMA_VERSION;
  policyId: string;
  policyVersion: string;
  task: 'tiab-screening';
  minSampledRecords: number;
  minReferenceIncludes: number;
  minCompletedRate: number;
  minSensitivity: number;
  minSpecificity: number;
  minF1: number;
  maxFalseNegatives: number;
  maxUncertainRate: number;
  maxInvalidOutputRate: number;
  maxInferenceErrorRate: number;
  maxTotalCostUsd?: number;
  requireFixedRequestedModel: boolean;
  requireSingleActualModel: boolean;
  requireSingleProvider: boolean;
  requireIndependentReferenceVerification: boolean;
}

export interface ModelGovernanceCheck {
  code: string;
  passed: boolean;
  observed: string | number | boolean | null;
  required: string | number | boolean;
  rationale: string;
}

export interface ScreeningModelGovernanceDossier {
  schemaVersion: typeof MODEL_GOVERNANCE_SCHEMA_VERSION;
  task: 'tiab-screening';
  requestedModel: string;
  actualModels: string[];
  routedProviders: string[];
  benchmarkContext: FrozenModelBenchmarkContext;
  benchmarkContextHash: string;
  referenceReceiptHash: string;
  policyHash: string;
  candidateHash: string;
  sample: {
    sampledRecords: number;
    referenceIncludes: number;
    referenceExcludes: number;
    completed: number;
  };
  observed: {
    completedRate: number;
    sensitivity: number | null;
    specificity: number | null;
    f1: number | null;
    falseNegatives: number;
    uncertainRate: number;
    invalidOutputRate: number;
    inferenceErrorRate: number;
    totalCostUsd: number;
  };
  checks: ModelGovernanceCheck[];
  recommendation: ModelGovernanceRecommendation;
  authorityCeiling: 'decision-support-only';
  mayAlterAuthoritativeDecisions: false;
  automaticPromotion: false;
  dossierHash: string;
}

export interface HumanModelPromotionDecision {
  dossierHash: string;
  verdict: 'approve-decision-support' | 'reject' | 'defer';
  rationale: string;
  reviewerId: string;
  decidedAt: string;
}

export interface ModelPromotionReceipt {
  schemaVersion: typeof MODEL_GOVERNANCE_SCHEMA_VERSION;
  task: GovernedModelTask;
  dossierHash: string;
  status: ModelGovernanceApprovalStatus;
  requestedModel: string;
  actualModel?: string;
  provider?: string;
  authority: 'decision-support-only';
  mayAlterAuthoritativeDecisions: false;
  automaticExclusionAllowed: false;
  reviewerId: string;
  rationale: string;
  decidedAt: string;
  receiptHash: string;
}

function boundedRate(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`);
}

export function validateScreeningPromotionPolicy(policy: ScreeningModelPromotionPolicy): void {
  if (policy.schemaVersion !== MODEL_GOVERNANCE_SCHEMA_VERSION) throw new Error(`Unsupported model-governance schema ${policy.schemaVersion}.`);
  if (policy.task !== 'tiab-screening') throw new Error(`Unsupported model-governance task ${policy.task}.`);
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('Model promotion policy requires stable ID and version.');
  if (!Number.isInteger(policy.minSampledRecords) || policy.minSampledRecords <= 0) throw new Error('minSampledRecords must be a positive integer.');
  if (!Number.isInteger(policy.minReferenceIncludes) || policy.minReferenceIncludes <= 0) throw new Error('minReferenceIncludes must be a positive integer.');
  if (!Number.isInteger(policy.maxFalseNegatives) || policy.maxFalseNegatives < 0) throw new Error('maxFalseNegatives must be a non-negative integer.');
  boundedRate(policy.minCompletedRate, 'minCompletedRate');
  boundedRate(policy.minSensitivity, 'minSensitivity');
  boundedRate(policy.minSpecificity, 'minSpecificity');
  boundedRate(policy.minF1, 'minF1');
  boundedRate(policy.maxUncertainRate, 'maxUncertainRate');
  boundedRate(policy.maxInvalidOutputRate, 'maxInvalidOutputRate');
  boundedRate(policy.maxInferenceErrorRate, 'maxInferenceErrorRate');
  if (policy.maxTotalCostUsd !== undefined && (!Number.isFinite(policy.maxTotalCostUsd) || policy.maxTotalCostUsd < 0)) {
    throw new Error('maxTotalCostUsd must be a finite non-negative number when specified.');
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function isDynamicRoute(model: string): boolean {
  return /^auto(?:\/|$)/i.test(model.trim());
}

function check(
  code: string,
  passed: boolean,
  observed: ModelGovernanceCheck['observed'],
  required: ModelGovernanceCheck['required'],
  rationale: string,
): ModelGovernanceCheck {
  return { code, passed, observed, required, rationale };
}

function referenceCounts(candidate: ScreeningBenchmarkCandidate): { includes: number; excludes: number } {
  let includes = 0;
  let excludes = 0;
  for (const suggestion of candidate.suggestions) {
    if (suggestion.authoritativeDecision === 'include') includes += 1;
    if (suggestion.authoritativeDecision === 'exclude') excludes += 1;
  }
  return { includes, excludes };
}

function contextMatchesReference(context: FrozenModelBenchmarkContext, reference: ModelBenchmarkReferenceReceipt): boolean {
  return reference.task === context.task
    && reference.evidenceSetHash === context.evidenceSetHash
    && reference.authoritativeDecisionHash === context.authoritativeDecisionHash
    && reference.sampleDefinitionHash === context.sampleDefinitionHash
    && reference.promptVersion === context.promptVersion;
}

export function buildScreeningModelGovernanceDossier(input: {
  candidate: ScreeningBenchmarkCandidate;
  context: FrozenModelBenchmarkContext;
  reference: ModelBenchmarkReferenceReceipt;
  policy: ScreeningModelPromotionPolicy;
}): ScreeningModelGovernanceDossier {
  const { candidate, context, reference, policy } = input;
  validateScreeningPromotionPolicy(policy);
  if (context.task !== 'tiab-screening' || reference.task !== 'tiab-screening') throw new Error('Screening governance received a non-screening benchmark context.');
  if (!context.evidenceSetHash || !context.authoritativeDecisionHash || !context.sampleDefinitionHash || !context.promptVersion) {
    throw new Error('Frozen model benchmark context must identify evidence, authoritative decisions, sample definition and prompt version.');
  }

  const actualModels = unique([
    ...(candidate.actualModels ?? []),
    ...candidate.suggestions.map((item) => item.routingReceipt?.actualModel),
  ]);
  const providers = unique([
    ...(candidate.routedProviders ?? []),
    ...candidate.suggestions.map((item) => item.routingReceipt?.actualProvider),
  ]);
  const counts = referenceCounts(candidate);
  const sampled = Math.max(0, Number(candidate.quality.sampledRecords) || 0);
  const completed = Math.max(0, Number(candidate.quality.completed) || 0);
  const completedRate = rate(completed, sampled);
  const uncertainRate = rate(Math.max(0, candidate.metrics.uncertain || 0), completed);
  const invalidOutputRate = rate(Math.max(0, candidate.quality.invalidOutputs || 0), sampled);
  const inferenceErrorRate = rate(Math.max(0, candidate.quality.inferenceErrors || 0), sampled);
  const totalCostUsd = Number(candidate.resources?.totalCostUsd) || 0;
  const referenceMatches = contextMatchesReference(context, reference);
  const completeSuggestions = candidate.suggestions.length === sampled
    && candidate.suggestions.every((item) => item.recordId && item.status);

  const checks: ModelGovernanceCheck[] = [
    check('reference-context-match', referenceMatches, referenceMatches, true, 'The independently reviewed reference receipt must bind the exact frozen evidence, decisions, sample and prompt.'),
    check('independent-reference-verification', !policy.requireIndependentReferenceVerification || reference.independentlyVerified, reference.independentlyVerified, true, 'Promotion requires an independently verified benchmark reference when the policy says so.'),
    check('complete-suggestion-ledger', completeSuggestions, candidate.suggestions.length, sampled, 'Every sampled evidence object must have an auditable model-attempt ledger row.'),
    check('sample-size', sampled >= policy.minSampledRecords, sampled, policy.minSampledRecords, 'Promotion thresholds are invalid on an underpowered convenience sample.'),
    check('reference-includes', counts.includes >= policy.minReferenceIncludes, counts.includes, policy.minReferenceIncludes, 'The frozen benchmark needs enough true include records to estimate exclusion safety.'),
    check('completed-rate', completedRate >= policy.minCompletedRate, completedRate, policy.minCompletedRate, 'Model/provider/schema failures cannot be ignored when judging operational performance.'),
    check('sensitivity', candidate.metrics.sensitivity !== null && candidate.metrics.sensitivity >= policy.minSensitivity, candidate.metrics.sensitivity, policy.minSensitivity, 'Screening decision support must meet the prespecified include sensitivity threshold.'),
    check('specificity', candidate.metrics.specificity !== null && candidate.metrics.specificity >= policy.minSpecificity, candidate.metrics.specificity, policy.minSpecificity, 'Screening decision support must meet the prespecified specificity threshold.'),
    check('f1', candidate.metrics.f1 !== null && candidate.metrics.f1 >= policy.minF1, candidate.metrics.f1, policy.minF1, 'Overall classification balance must meet the prespecified benchmark floor.'),
    check('false-negatives', candidate.metrics.falseNegative <= policy.maxFalseNegatives, candidate.metrics.falseNegative, policy.maxFalseNegatives, 'False exclusions are bounded explicitly rather than hidden inside aggregate accuracy.'),
    check('uncertain-rate', uncertainRate <= policy.maxUncertainRate, uncertainRate, policy.maxUncertainRate, 'Excessive uncertainty can make a nominally accurate model operationally unusable.'),
    check('invalid-output-rate', invalidOutputRate <= policy.maxInvalidOutputRate, invalidOutputRate, policy.maxInvalidOutputRate, 'Schema failures are part of model performance.'),
    check('inference-error-rate', inferenceErrorRate <= policy.maxInferenceErrorRate, inferenceErrorRate, policy.maxInferenceErrorRate, 'Provider/model call failures are part of model performance.'),
    check('authoritative-decisions-unchanged', candidate.quality.authoritativeDecisionsChanged !== true, candidate.quality.authoritativeDecisionsChanged ?? false, false, 'Benchmark execution must remain shadow-only and may not rewrite the reference decisions.'),
    check('fixed-requested-model', !policy.requireFixedRequestedModel || !isDynamicRoute(candidate.model), candidate.model, 'non-auto fixed model', 'Dynamic router aliases can change the underlying model after validation and remain shadow-only in v1.'),
    check('single-actual-model', !policy.requireSingleActualModel || actualModels.length === 1, actualModels.length, 1, 'A promoted fixed model needs one observed actual model identity.'),
    check('single-provider', !policy.requireSingleProvider || providers.length === 1, providers.length, 1, 'A promoted model can be pinned to one provider when required by policy.'),
  ];
  if (policy.maxTotalCostUsd !== undefined) {
    checks.push(check('cost-ceiling', totalCostUsd <= policy.maxTotalCostUsd, totalCostUsd, policy.maxTotalCostUsd, 'Benchmark resource use must satisfy the prespecified budget ceiling.'));
  }

  const recommendation: ModelGovernanceRecommendation = checks.every((item) => item.passed)
    ? 'eligible-for-human-review'
    : 'blocked';
  const base: Omit<ScreeningModelGovernanceDossier, 'dossierHash'> = {
    schemaVersion: MODEL_GOVERNANCE_SCHEMA_VERSION,
    task: 'tiab-screening',
    requestedModel: candidate.model,
    actualModels,
    routedProviders: providers,
    benchmarkContext: context,
    benchmarkContextHash: scientificContentHash(context),
    referenceReceiptHash: scientificContentHash(reference),
    policyHash: scientificContentHash(policy),
    candidateHash: scientificContentHash(candidate),
    sample: {
      sampledRecords: sampled,
      referenceIncludes: counts.includes,
      referenceExcludes: counts.excludes,
      completed,
    },
    observed: {
      completedRate,
      sensitivity: candidate.metrics.sensitivity,
      specificity: candidate.metrics.specificity,
      f1: candidate.metrics.f1,
      falseNegatives: candidate.metrics.falseNegative,
      uncertainRate,
      invalidOutputRate,
      inferenceErrorRate,
      totalCostUsd,
    },
    checks,
    recommendation,
    authorityCeiling: 'decision-support-only',
    mayAlterAuthoritativeDecisions: false,
    automaticPromotion: false,
  };
  return { ...base, dossierHash: scientificContentHash(base) };
}

export function adjudicateModelPromotion(
  dossier: ScreeningModelGovernanceDossier,
  decision: HumanModelPromotionDecision,
): ModelPromotionReceipt {
  if (decision.dossierHash !== dossier.dossierHash) throw new Error('Human model-promotion decision does not bind the current dossier hash.');
  if (!decision.reviewerId.trim() || !decision.rationale.trim() || !decision.decidedAt.trim()) {
    throw new Error('Model promotion adjudication requires reviewer identity, rationale and decision timestamp.');
  }
  if (decision.verdict === 'approve-decision-support' && dossier.recommendation !== 'eligible-for-human-review') {
    throw new Error('A blocked model dossier cannot be promoted by overriding failed benchmark checks. Re-benchmark under a new prespecified policy instead.');
  }
  const status: ModelGovernanceApprovalStatus = decision.verdict === 'approve-decision-support'
    ? 'approved-decision-support'
    : decision.verdict === 'reject' ? 'rejected' : 'deferred';
  const base: Omit<ModelPromotionReceipt, 'receiptHash'> = {
    schemaVersion: MODEL_GOVERNANCE_SCHEMA_VERSION,
    task: dossier.task,
    dossierHash: dossier.dossierHash,
    status,
    requestedModel: dossier.requestedModel,
    ...(dossier.actualModels.length === 1 ? { actualModel: dossier.actualModels[0]! } : {}),
    ...(dossier.routedProviders.length === 1 ? { provider: dossier.routedProviders[0]! } : {}),
    authority: 'decision-support-only',
    mayAlterAuthoritativeDecisions: false,
    automaticExclusionAllowed: false,
    reviewerId: decision.reviewerId,
    rationale: decision.rationale,
    decidedAt: decision.decidedAt,
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}
