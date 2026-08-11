import type { AgentResult, PipelineState, StageName, ValidationResult } from '../core/types.js';

export type CognitiveAction =
  | 'CONTINUE'
  | 'REFOCUS'
  | 'VERIFY'
  | 'REPLAN'
  | 'ROLLBACK'
  | 'SPAWN_SPECIALIST'
  | 'ESCALATE_HUMAN'
  | 'STOP';

export interface CognitiveMetrics {
  goalAlignment: number;
  protocolAlignment: number;
  stageAlignment: number;
  evidenceCoverage: number;
  contradictionBurden: number;
  semanticDrift: number;
  sourceCoverageDrift: number;
  methodDrift: number;
  downstreamContaminationRisk: number;
  budgetDeviation: number;
  temporalStaleness: number;
  agentDisagreement: number;
}

export interface CognitiveStageDecision {
  stage: StageName;
  action: CognitiveAction;
  score: number;
  reasons: string[];
  metrics: CognitiveMetrics;
  rollbackFrom?: StageName;
  observedAt: string;
}

export interface CognitiveStageInput {
  state: PipelineState;
  stage: StageName;
  attempt: number;
  result: AgentResult;
  validation: ValidationResult;
  warnings: string[];
  requiredArtifacts: string[];
  producedArtifacts: string[];
}

export interface CognitiveStageObserver {
  assess(input: CognitiveStageInput): CognitiveStageDecision | Promise<CognitiveStageDecision>;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ratio = (numerator: number, denominator: number) => denominator <= 0 ? 1 : clamp(numerator / denominator);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const lower = (value: unknown) => String(value ?? '').toLowerCase();

function tokenTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9-]+/).filter((term) => term.length >= 4))];
}

function goalAlignment(state: PipelineState, stage: StageName): number {
  const question = state.request.question;
  const goal = `${question.title ?? ''} ${question.objective ?? ''} ${question.population ?? ''} ${question.interventionOrExposure ?? ''}`;
  const terms = tokenTerms(goal);
  if (terms.length === 0) return 1;

  let observable = '';
  if (stage === 'search-build') observable = JSON.stringify(state.artifacts.searchStrategies ?? '');
  else if (stage === 'search-execute') observable = JSON.stringify(state.artifacts.searchProvenance ?? '');
  else if (stage === 'report' || stage === 'human-verify') observable = JSON.stringify(state.artifacts.draftReport ?? state.artifacts.finalReport ?? '');
  else observable = `${goal} ${JSON.stringify(state.artifacts.reviewPlan ?? '')}`;

  const haystack = observable.toLowerCase();
  return ratio(terms.filter((term) => haystack.includes(term)).length, terms.length);
}

function producedCoverage(state: PipelineState, producedArtifacts: string[]): number {
  if (producedArtifacts.length === 0) return 1;
  return ratio(producedArtifacts.filter((key) => key in state.artifacts).length, producedArtifacts.length);
}

function stageEvidenceCoverage(state: PipelineState, stage: StageName): number {
  switch (stage) {
    case 'search-execute': {
      const provenance = asArray(state.artifacts.searchProvenance);
      return ratio(provenance.length, state.request.databases.length);
    }
    case 'deduplicate': {
      const report = state.artifacts.deduplicationReport as { imported?: number; unique?: number; duplicatesRemoved?: number } | undefined;
      if (!report || report.imported === undefined || report.unique === undefined || report.duplicatesRemoved === undefined) return 0;
      return report.imported === report.unique + report.duplicatesRemoved ? 1 : 0;
    }
    case 'tiab-screen':
      return ratio(asArray(state.artifacts.tiabDecisions).length, asArray(state.artifacts.uniqueRecords).length);
    case 'fulltext-retrieve': {
      const report = state.artifacts.retrievalReport as { requested?: number; retrieved?: number } | undefined;
      return ratio(report?.retrieved ?? asArray(state.artifacts.fullTexts).length, report?.requested ?? asArray(state.artifacts.tiabIncluded).length);
    }
    case 'pdf-to-text':
      return ratio(asArray(state.artifacts.parsedDocuments).length, asArray(state.artifacts.fullTexts).length);
    case 'fulltext-screen':
      return ratio(asArray(state.artifacts.fullTextDecisions).length, asArray(state.artifacts.parsedDocuments).length);
    case 'extract':
      return ratio(asArray(state.artifacts.extractedStudies).length, asArray(state.artifacts.includedDocuments).length);
    case 'risk-of-bias':
      return ratio(asArray(state.artifacts.riskOfBias).length, asArray(state.artifacts.extractedStudies).length);
    case 'grade':
      return state.artifacts.grade ? 1 : 0;
    case 'synthesise':
      return state.artifacts.synthesis ? 1 : 0;
    case 'report':
      return state.artifacts.draftReport ? 1 : 0;
    case 'human-verify':
      return state.artifacts.finalReport ? 1 : 0;
    default:
      return 1;
  }
}

interface SearchConceptBlockLike {
  terms?: string[];
  required?: boolean;
}

interface SearchConceptPlanLike {
  population?: string[];
  intervention?: string[];
  interventionGroups?: string[][];
  design?: string[];
  geography?: string[];
  blocks?: SearchConceptBlockLike[];
}

function groupsFromGeneratedStrategy(state: PipelineState): string[][] {
  const strategies = asArray(state.artifacts.searchStrategies) as Array<{
    searchRationale?: { searchedConcepts?: Record<string, string[]> };
  }>;
  for (const strategy of strategies) {
    const searched = strategy.searchRationale?.searchedConcepts;
    if (!searched) continue;
    const groups = Object.values(searched)
      .map((terms) => terms.filter(Boolean))
      .filter((terms) => terms.length > 0);
    if (groups.length > 0) return groups;
  }
  return [];
}

function requiredSearchGroups(state: PipelineState): string[][] {
  // Prefer the planner's persisted search rationale: this is the exact semantic
  // contract that was compiled for every database and therefore the strongest
  // target for drift detection.
  const generated = groupsFromGeneratedStrategy(state);
  if (generated.length > 0) return generated;

  const request = state.request as typeof state.request & { searchConcepts?: SearchConceptPlanLike };
  const plan = request.searchConcepts;
  if (!plan) return [];

  const explicit = (plan.blocks ?? [])
    .filter((block) => block.required !== false)
    .map((block) => block.terms ?? [])
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0);
  if (explicit.length > 0) return explicit;

  const groups: string[][] = [];
  if (plan.population?.length) groups.push(plan.population);
  if (plan.interventionGroups?.length) groups.push(...plan.interventionGroups);
  else if (plan.intervention?.length) groups.push(plan.intervention);
  if (plan.design?.length) groups.push(plan.design);
  if (plan.geography?.length) groups.push(plan.geography);
  return groups.map((group) => group.filter(Boolean)).filter((group) => group.length > 0);
}

function searchSemanticDrift(state: PipelineState): { drift: number; reasons: string[] } {
  const provenance = asArray(state.artifacts.searchProvenance) as Array<{ database?: string; executedQuery?: string; resultCount?: number }>;
  if (provenance.length === 0) return { drift: 1, reasons: ['no search execution provenance'] };
  const groups = requiredSearchGroups(state);
  if (groups.length === 0) return { drift: 0, reasons: [] };

  const reasons: string[] = [];
  let checks = 0;
  let missing = 0;
  for (const source of provenance) {
    const query = lower(source.executedQuery);
    for (const group of groups) {
      checks += 1;
      const present = group.some((term) => query.includes(lower(term)));
      if (!present) {
        missing += 1;
        reasons.push(`${source.database ?? 'source'} omitted required concept group: ${group.join(' OR ')}`);
      }
    }
  }
  return { drift: ratio(missing, checks), reasons };
}

function sourceCoverageDrift(state: PipelineState): number {
  const provenance = asArray(state.artifacts.searchProvenance) as Array<{ database?: string }>;
  if (state.request.databases.length === 0) return 0;
  const observed = new Set(provenance.map((entry) => lower(entry.database)));
  const covered = state.request.databases.filter((database) => observed.has(lower(database))).length;
  return 1 - ratio(covered, state.request.databases.length);
}

function protocolAlignment(state: PipelineState, stage: StageName): number {
  if (!['search-build', 'search-test', 'protocol-finalise', 'search-execute'].includes(stage)) return 1;
  const strategies = asArray(state.artifacts.searchStrategies) as Array<{ searchRationale?: { mode?: string; omittedMandatoryConcepts?: string[]; protocolOutcomesRetainedForEligibility?: string[] } }>;
  if (strategies.length === 0) return stage === 'search-build' ? 0.5 : 0;
  const interventionLike = ['systematic', 'intervention', 'rapid', 'living'].includes(String(state.request.reviewType));
  const outcomes = state.request.question.outcomes ?? [];
  if (!interventionLike || outcomes.length === 0) return 1;
  const recallFirst = strategies.every((strategy) => strategy.searchRationale?.mode === 'recall-first-intervention');
  const outcomesRetained = strategies.every((strategy) => {
    const retained = strategy.searchRationale?.protocolOutcomesRetainedForEligibility ?? [];
    return outcomes.every((outcome) => retained.includes(outcome));
  });
  return recallFirst && outcomesRetained ? 1 : 0.7;
}

function contradictionBurden(state: PipelineState): number {
  const warnings = asArray(state.artifacts.verificationCoverageWarnings);
  const overrides = (state.artifacts.humanOverrides as { entries?: unknown[] } | undefined)?.entries ?? [];
  return clamp((warnings.length + overrides.length) / Math.max(1, asArray(state.artifacts.extractedStudies).length * 5));
}

function disagreement(state: PipelineState): number {
  const outcome = state.artifacts.verificationOutcome as { rejected?: number; amended?: number; accepted?: number } | undefined;
  if (!outcome) return 0;
  const total = (outcome.accepted ?? 0) + (outcome.rejected ?? 0) + (outcome.amended ?? 0);
  return ratio((outcome.rejected ?? 0) + (outcome.amended ?? 0), total);
}

function temporalStaleness(state: PipelineState): number {
  const provenance = asArray(state.artifacts.searchProvenance) as Array<{ executedAt?: string }>;
  if (provenance.length === 0) return 0;
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const ages = provenance
    .map((entry) => entry.executedAt ? Math.max(0, now - Date.parse(entry.executedAt)) : 0)
    .map((age) => clamp(age / maxAgeMs));
  return Math.max(0, ...ages);
}

export class ReviewAttentionObserver implements CognitiveStageObserver {
  assess(input: CognitiveStageInput): CognitiveStageDecision {
    const { state, stage, warnings, validation, producedArtifacts, attempt } = input;
    const semantic = stage === 'search-execute' ? searchSemanticDrift(state) : { drift: 0, reasons: [] as string[] };
    const sourceDrift = stage === 'search-execute' ? sourceCoverageDrift(state) : 0;
    const evidenceCoverage = stageEvidenceCoverage(state, stage);
    const stageAlignment = producedCoverage(state, producedArtifacts);
    const methodDrift = clamp((validation.issues.filter((issue) => issue.severity === 'error').length * 0.5) + Math.max(0, attempt - 1) * 0.15);
    const contaminationRisk = ['search-execute', 'deduplicate', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report']
      .includes(stage)
      ? clamp((1 - evidenceCoverage) * 0.8 + semantic.drift * 0.8 + sourceDrift)
      : clamp((1 - stageAlignment) * 0.5);

    const metrics: CognitiveMetrics = {
      goalAlignment: goalAlignment(state, stage),
      protocolAlignment: protocolAlignment(state, stage),
      stageAlignment,
      evidenceCoverage,
      contradictionBurden: contradictionBurden(state),
      semanticDrift: semantic.drift,
      sourceCoverageDrift: sourceDrift,
      methodDrift,
      downstreamContaminationRisk: contaminationRisk,
      budgetDeviation: clamp(state.audit.length / 10_000),
      temporalStaleness: temporalStaleness(state),
      agentDisagreement: disagreement(state),
    };

    const bad = [
      1 - metrics.goalAlignment,
      1 - metrics.protocolAlignment,
      1 - metrics.stageAlignment,
      1 - metrics.evidenceCoverage,
      metrics.contradictionBurden,
      metrics.semanticDrift,
      metrics.sourceCoverageDrift,
      metrics.methodDrift,
      metrics.downstreamContaminationRisk,
      metrics.budgetDeviation,
      metrics.temporalStaleness,
      metrics.agentDisagreement,
    ];
    const score = clamp(bad.reduce((sum, value) => sum + value, 0) / bad.length);
    const reasons = [...semantic.reasons];
    if (metrics.sourceCoverageDrift > 0) reasons.push('requested search-source coverage is incomplete');
    if (metrics.protocolAlignment < 0.9) reasons.push('retrieval strategy is not fully aligned with the locked protocol/search rationale');
    if (metrics.stageAlignment < 1) reasons.push('stage did not produce its full artifact contract');
    if (metrics.downstreamContaminationRisk > 0.4) reasons.push('downstream contamination risk is elevated');
    if (stage === 'fulltext-retrieve' && metrics.evidenceCoverage < 1) reasons.push('not all screened-in reports have lawful full text available automatically');
    if (metrics.agentDisagreement > 0.25) reasons.push('human/evaluator disagreement requires adjudication');
    for (const warning of warnings) {
      if (/reconciliation|truncat|partial export|source missing/i.test(warning)) reasons.push(`high-risk warning: ${warning}`);
    }

    let action: CognitiveAction = 'CONTINUE';
    let rollbackFrom: StageName | undefined;
    if (metrics.sourceCoverageDrift > 0 || metrics.semanticDrift >= 0.5) {
      action = 'ROLLBACK';
      rollbackFrom = 'search-build';
    } else if (metrics.methodDrift > 0.6 || metrics.downstreamContaminationRisk > 0.75) {
      action = 'STOP';
    } else if (stage === 'fulltext-retrieve' && metrics.evidenceCoverage < 0.5 && asArray(state.artifacts.tiabIncluded).length > 0) {
      action = 'ESCALATE_HUMAN';
    } else if (metrics.agentDisagreement > 0.25 || metrics.contradictionBurden > 0.4) {
      action = 'VERIFY';
    } else if (metrics.downstreamContaminationRisk > 0.35 || (stage === 'fulltext-retrieve' && metrics.evidenceCoverage < 1)) {
      action = 'VERIFY';
    } else if (score > 0.35) {
      action = 'REPLAN';
    }

    return {
      stage,
      action,
      score,
      reasons: [...new Set(reasons)],
      metrics,
      ...(rollbackFrom ? { rollbackFrom } : {}),
      observedAt: new Date().toISOString(),
    };
  }
}
