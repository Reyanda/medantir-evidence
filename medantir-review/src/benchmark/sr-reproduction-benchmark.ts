import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_BENCHMARK_SCHEMA_VERSION = 'medantir-srbench/1' as const;

export type SrBenchmarkStage =
  | 'question'
  | 'protocol'
  | 'search'
  | 'deduplication'
  | 'tiab-screening'
  | 'fulltext-screening'
  | 'extraction'
  | 'appraisal'
  | 'synthesis'
  | 'report';

export type SrGoldStatus = 'complete' | 'partial' | 'missing';

export interface SrStageGoldCoverage {
  status: SrGoldStatus;
  receiptHash?: string;
  reason?: string;
}

export type SrTaskScorer =
  | { kind: 'exact-json' }
  | { kind: 'set-exact'; path?: string }
  | {
      kind: 'classification-ledger';
      path?: string;
      idKey: string;
      labelKey: string;
      positiveLabel: string;
      negativeLabel: string;
      uncertainLabel?: string;
      falseNegativeFatal?: boolean;
    }
  | {
      kind: 'numeric-fields';
      fields: Array<{ path: string; absoluteTolerance: number }>;
    };

/** Internal benchmark definition. Gold/scorer/critical fields never cross the model port. */
export interface SrBenchmarkTask {
  id: string;
  stage: SrBenchmarkStage;
  instruction: string;
  input: unknown;
  outputSchema?: unknown;
  /** Earlier task IDs whose ACTUAL outputs are supplied to this task. */
  dependsOn?: string[];
  gold: unknown;
  scorer: SrTaskScorer;
  critical: boolean;
}

export interface SrBenchmarkCase {
  schemaVersion: typeof SR_BENCHMARK_SCHEMA_VERSION;
  caseId: string;
  title: string;
  domain: string;
  reviewType: 'systematic';
  sourceReview?: { doi?: string; pmid?: string; pmcid?: string; citation?: string };
  stageGold: Record<SrBenchmarkStage, SrStageGoldCoverage>;
  tasks: SrBenchmarkTask[];
  caseHash?: string;
}

export interface SrModelVisibleUpstreamArtifact {
  taskId: string;
  stage: SrBenchmarkStage;
  output: unknown;
  outputHash: string;
}

/** Exact task surface visible to a model adapter. It has no gold/scorer/critical fields. */
export interface SrModelVisibleTask {
  id: string;
  stage: SrBenchmarkStage;
  instruction: string;
  input: unknown;
  outputSchema?: unknown;
  upstream: SrModelVisibleUpstreamArtifact[];
}

export interface SrModelRoutingReceipt {
  requestedModel: string;
  actualModel?: string;
  provider?: string;
  requestId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface SrModelTaskResponse {
  output: unknown;
  requestHash?: string;
  /** Adapter-reported hash is checked against the harness-computed canonical hash. */
  outputHash?: string;
  routing: SrModelRoutingReceipt;
}

export interface SrReviewModelPort {
  completeJson(input: {
    model: string;
    caseId: string;
    task: SrModelVisibleTask;
    system: string;
  }): Promise<SrModelTaskResponse>;
}

export interface SrTaskScore {
  taskId: string;
  stage: SrBenchmarkStage;
  critical: boolean;
  score: number;
  exact: boolean;
  errors: string[];
  fatalViolations: string[];
  diagnostics?: Record<string, unknown>;
  routing: SrModelRoutingReceipt;
  outputHash: string;
  upstreamOutputHashes: Array<{ taskId: string; outputHash: string }>;
}

export interface SrBenchmarkRunResult {
  schemaVersion: typeof SR_BENCHMARK_SCHEMA_VERSION;
  caseId: string;
  caseHash: string;
  requestedModel: string;
  actualModels: string[];
  providers: string[];
  taskScores: SrTaskScore[];
  stageScores: Partial<Record<SrBenchmarkStage, number>>;
  reproductionScore: number;
  pipelineCoverage: number;
  effectiveScore: number;
  criticalFailures: string[];
  sr100: boolean;
  runHash: string;
}

export const SR_STAGE_WEIGHTS: Record<SrBenchmarkStage, number> = {
  question: 5,
  protocol: 5,
  search: 15,
  deduplication: 5,
  'tiab-screening': 15,
  'fulltext-screening': 10,
  extraction: 15,
  appraisal: 10,
  synthesis: 15,
  report: 5,
};

const SR_STAGE_ORDER = Object.keys(SR_STAGE_WEIGHTS) as SrBenchmarkStage[];
const SR_STAGE_RANK = new Map(SR_STAGE_ORDER.map((stage, index) => [stage, index]));

function assertHash(value: string | undefined, label: string): void {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
}

function getPath(value: unknown, path?: string): unknown {
  if (!path?.trim()) return value;
  let current: unknown = value;
  for (const part of path.split('.').filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === 'object') current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

function normalizedStringSet(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.map((item) => typeof item === 'string' ? item.trim().toLowerCase() : '').filter(Boolean);
  return [...new Set(strings)].sort();
}

function scoreExactJson(actual: unknown, gold: unknown): Omit<SrTaskScore, 'taskId' | 'stage' | 'critical' | 'routing' | 'outputHash' | 'upstreamOutputHashes'> {
  const exact = scientificContentHash(actual) === scientificContentHash(gold);
  return {
    score: exact ? 1 : 0,
    exact,
    errors: exact ? [] : ['Structured JSON artifact does not exactly match the frozen gold artifact.'],
    fatalViolations: [],
  };
}

function scoreSet(actual: unknown, gold: unknown, path?: string): Omit<SrTaskScore, 'taskId' | 'stage' | 'critical' | 'routing' | 'outputHash' | 'upstreamOutputHashes'> {
  const observed = normalizedStringSet(getPath(actual, path));
  const expected = normalizedStringSet(getPath(gold, path));
  if (!observed || !expected) return { score: 0, exact: false, errors: ['Set scorer requires arrays of strings.'], fatalViolations: [] };
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const tp = observed.filter((item) => expectedSet.has(item)).length;
  const fp = observed.filter((item) => !expectedSet.has(item)).length;
  const fn = expected.filter((item) => !observedSet.has(item)).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : expected.length === 0 && observed.length === 0 ? 1 : 0;
  const exact = fp === 0 && fn === 0;
  return {
    score: exact ? 1 : f1,
    exact,
    errors: exact ? [] : [`Set mismatch: ${fp} unexpected and ${fn} missing values.`],
    fatalViolations: [],
    diagnostics: { truePositive: tp, falsePositive: fp, falseNegative: fn, precision, recall, f1 },
  };
}

function ledgerRows(value: unknown, path?: string): Array<Record<string, unknown>> | null {
  const selected = getPath(value, path);
  if (!Array.isArray(selected) || selected.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) return null;
  return selected as Array<Record<string, unknown>>;
}

function scoreClassification(
  actual: unknown,
  gold: unknown,
  scorer: Extract<SrTaskScorer, { kind: 'classification-ledger' }>,
): Omit<SrTaskScore, 'taskId' | 'stage' | 'critical' | 'routing' | 'outputHash' | 'upstreamOutputHashes'> {
  const observedRows = ledgerRows(actual, scorer.path);
  const goldRows = ledgerRows(gold, scorer.path);
  if (!observedRows || !goldRows) return { score: 0, exact: false, errors: ['Classification scorer requires arrays of row objects.'], fatalViolations: [] };
  const expected = new Map<string, string>();
  const observed = new Map<string, string>();
  for (const row of goldRows) expected.set(String(row[scorer.idKey] ?? ''), String(row[scorer.labelKey] ?? ''));
  for (const row of observedRows) observed.set(String(row[scorer.idKey] ?? ''), String(row[scorer.labelKey] ?? ''));
  let tp = 0; let fp = 0; let tn = 0; let fn = 0; let uncertain = 0; let otherMismatch = 0;
  for (const [id, expectedLabel] of expected) {
    const actualLabel = observed.get(id);
    if (actualLabel === scorer.uncertainLabel) { uncertain += 1; continue; }
    if (expectedLabel === scorer.positiveLabel && actualLabel === scorer.positiveLabel) tp += 1;
    else if (expectedLabel === scorer.positiveLabel && actualLabel === scorer.negativeLabel) fn += 1;
    else if (expectedLabel === scorer.negativeLabel && actualLabel === scorer.positiveLabel) fp += 1;
    else if (expectedLabel === scorer.negativeLabel && actualLabel === scorer.negativeLabel) tn += 1;
    else otherMismatch += 1;
  }
  const unexpectedIds = [...observed.keys()].filter((id) => !expected.has(id)).length;
  const missingIds = [...expected.keys()].filter((id) => !observed.has(id)).length;
  const correct = tp + tn;
  const denominator = expected.size;
  const accuracy = denominator > 0 ? correct / denominator : observed.size === 0 ? 1 : 0;
  const exact = fn === 0 && fp === 0 && uncertain === 0 && otherMismatch === 0 && unexpectedIds === 0 && missingIds === 0 && observed.size === expected.size;
  const fatalViolations: string[] = [];
  if (scorer.falseNegativeFatal && fn > 0) fatalViolations.push(`${fn} false-negative inclusion decision(s) would wrongly exclude gold-standard eligible evidence.`);
  if (unexpectedIds > 0) fatalViolations.push(`${unexpectedIds} decision(s) reference evidence IDs absent from the frozen benchmark corpus.`);
  return {
    score: exact ? 1 : accuracy,
    exact,
    errors: exact ? [] : [`Classification mismatch: TP=${tp}, FP=${fp}, TN=${tn}, FN=${fn}, uncertain=${uncertain}, missing=${missingIds}, unexpected=${unexpectedIds}.`],
    fatalViolations,
    diagnostics: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, uncertain, otherMismatch, missingIds, unexpectedIds, accuracy },
  };
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scoreNumeric(
  actual: unknown,
  gold: unknown,
  scorer: Extract<SrTaskScorer, { kind: 'numeric-fields' }>,
): Omit<SrTaskScore, 'taskId' | 'stage' | 'critical' | 'routing' | 'outputHash' | 'upstreamOutputHashes'> {
  let matched = 0;
  const errors: string[] = [];
  for (const field of scorer.fields) {
    const observed = numeric(getPath(actual, field.path));
    const expected = numeric(getPath(gold, field.path));
    if (observed === null || expected === null) {
      errors.push(`${field.path}: expected and observed values must both be finite numbers.`);
      continue;
    }
    const delta = Math.abs(observed - expected);
    if (delta <= field.absoluteTolerance) matched += 1;
    else errors.push(`${field.path}: |${observed} - ${expected}| = ${delta} exceeds tolerance ${field.absoluteTolerance}.`);
  }
  const score = scorer.fields.length > 0 ? matched / scorer.fields.length : 0;
  return { score, exact: matched === scorer.fields.length, errors, fatalViolations: [] };
}

function scoreTask(actual: unknown, task: SrBenchmarkTask): Omit<SrTaskScore, 'taskId' | 'stage' | 'critical' | 'routing' | 'outputHash' | 'upstreamOutputHashes'> {
  if (task.scorer.kind === 'exact-json') return scoreExactJson(actual, task.gold);
  if (task.scorer.kind === 'set-exact') return scoreSet(actual, task.gold, task.scorer.path);
  if (task.scorer.kind === 'classification-ledger') return scoreClassification(actual, task.gold, task.scorer);
  return scoreNumeric(actual, task.gold, task.scorer);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))].sort();
}

function benchmarkCaseIdentity(value: SrBenchmarkCase): unknown {
  const { caseHash: _caseHash, ...rest } = value;
  return rest;
}

function normalizeDependencies(task: SrBenchmarkTask): string[] {
  return [...new Set((task.dependsOn ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function validateSrBenchmarkCase(value: SrBenchmarkCase): SrBenchmarkCase {
  if (value.schemaVersion !== SR_BENCHMARK_SCHEMA_VERSION) throw new Error(`Unsupported SRBench schema '${value.schemaVersion}'.`);
  if (!value.caseId.trim() || !value.title.trim() || !value.domain.trim()) throw new Error('SRBench case requires stable ID, title and domain.');
  for (const stage of SR_STAGE_ORDER) {
    const coverage = value.stageGold[stage];
    if (!coverage) throw new Error(`SRBench case '${value.caseId}' is missing stage-gold declaration for '${stage}'.`);
    if (coverage.status === 'complete') assertHash(coverage.receiptHash, `${value.caseId}:${stage} complete-gold receiptHash`);
  }

  const ids = new Set<string>();
  let previousStageRank = -1;
  for (let index = 0; index < value.tasks.length; index += 1) {
    const task = value.tasks[index]!;
    if (!task.id.trim()) throw new Error('SRBench tasks require stable IDs.');
    if (ids.has(task.id)) throw new Error(`SRBench case '${value.caseId}' duplicates task ID '${task.id}'.`);
    const stageRank = SR_STAGE_RANK.get(task.stage);
    if (stageRank === undefined) throw new Error(`SRBench task '${task.id}' has unsupported stage '${task.stage}'.`);
    if (stageRank < previousStageRank) throw new Error(`SRBench task '${task.id}' moves backward in pipeline stage order.`);
    previousStageRank = stageRank;
    if (value.stageGold[task.stage].status === 'missing') throw new Error(`Task '${task.id}' cannot be scored because stage '${task.stage}' is declared missing gold.`);

    const rawDependencies = (task.dependsOn ?? []).map((dependency) => dependency.trim()).filter(Boolean);
    const dependencies = normalizeDependencies(task);
    if (dependencies.length !== rawDependencies.length) throw new Error(`SRBench task '${task.id}' contains duplicate dependency IDs.`);
    for (const dependency of dependencies) {
      if (dependency === task.id) throw new Error(`SRBench task '${task.id}' cannot depend on itself.`);
      if (!ids.has(dependency)) {
        throw new Error(`SRBench task '${task.id}' dependency '${dependency}' must reference an earlier declared task; missing/future dependencies and cycles fail closed.`);
      }
    }
    ids.add(task.id);
  }

  const normalizedTasks = value.tasks.map((task) => ({
    ...task,
    ...(normalizeDependencies(task).length > 0 ? { dependsOn: normalizeDependencies(task) } : {}),
  }));
  const normalized = { ...value, tasks: normalizedTasks };
  const caseHash = scientificContentHash(benchmarkCaseIdentity(normalized));
  if (value.caseHash && value.caseHash !== caseHash) throw new Error(`SRBench case '${value.caseId}' hash does not match its content.`);
  return { ...normalized, caseHash };
}

export function srPipelineCoverage(caseDefinition: SrBenchmarkCase): number {
  const validated = validateSrBenchmarkCase(caseDefinition);
  let points = 0;
  for (const [stage, weight] of Object.entries(SR_STAGE_WEIGHTS) as Array<[SrBenchmarkStage, number]>) {
    const status = validated.stageGold[stage].status;
    points += weight * (status === 'complete' ? 1 : status === 'partial' ? 0.5 : 0);
  }
  return points;
}

function visibleTask(task: SrBenchmarkTask, outputs: Map<string, SrModelVisibleUpstreamArtifact>): SrModelVisibleTask {
  const upstream = normalizeDependencies(task).map((dependency) => {
    const artifact = outputs.get(dependency);
    if (!artifact) throw new Error(`SRBench internal dependency '${dependency}' is unavailable before task '${task.id}'.`);
    return {
      taskId: artifact.taskId,
      stage: artifact.stage,
      output: structuredClone(artifact.output),
      outputHash: artifact.outputHash,
    };
  });
  return {
    id: task.id,
    stage: task.stage,
    instruction: task.instruction,
    input: structuredClone(task.input),
    ...(task.outputSchema !== undefined ? { outputSchema: structuredClone(task.outputSchema) } : {}),
    upstream,
  };
}

export async function runSrBenchmarkCase(input: {
  caseDefinition: SrBenchmarkCase;
  model: string;
  port: SrReviewModelPort;
}): Promise<SrBenchmarkRunResult> {
  const benchmark = validateSrBenchmarkCase(input.caseDefinition);
  const system = [
    'You are reproducing a frozen systematic-review pipeline artifact for scientific benchmarking.',
    'Use only the evidence supplied in the current task input and the ACTUAL upstream pipeline outputs supplied with it.',
    'Upstream outputs are prior model outputs, not gold answers; if they contain an error, do not silently replace them with knowledge you were not given.',
    'Never invent records, identifiers, numerical values, citations, decisions or provenance.',
    'Return one JSON value matching the requested output schema. Do not wrap it in Markdown.',
    'If the supplied evidence is insufficient, preserve uncertainty exactly as instructed rather than guessing.',
  ].join(' ');
  const taskScores: SrTaskScore[] = [];
  const outputs = new Map<string, SrModelVisibleUpstreamArtifact>();

  for (const task of benchmark.tasks) {
    const modelTask = visibleTask(task, outputs);
    const response = await input.port.completeJson({ model: input.model, caseId: benchmark.caseId, task: modelTask, system });
    const harnessOutputHash = scientificContentHash(response.output);
    const scored = scoreTask(response.output, task);
    if (response.outputHash && response.outputHash !== harnessOutputHash) {
      scored.fatalViolations.push('Model adapter reported an output hash that does not match the canonical JSON actually returned.');
      scored.errors.push('Adapter output-hash integrity mismatch.');
    }
    if (response.routing.requestedModel !== input.model) {
      scored.fatalViolations.push(`Model adapter routing receipt names requested model '${response.routing.requestedModel}' instead of '${input.model}'.`);
    }
    const upstreamOutputHashes = modelTask.upstream.map((item) => ({ taskId: item.taskId, outputHash: item.outputHash }));
    taskScores.push({
      taskId: task.id,
      stage: task.stage,
      critical: task.critical,
      ...scored,
      routing: response.routing,
      outputHash: harnessOutputHash,
      upstreamOutputHashes,
    });
    outputs.set(task.id, {
      taskId: task.id,
      stage: task.stage,
      output: structuredClone(response.output),
      outputHash: harnessOutputHash,
    });
  }

  const stageScores: Partial<Record<SrBenchmarkStage, number>> = {};
  for (const stage of SR_STAGE_ORDER) {
    const scores = taskScores.filter((item) => item.stage === stage);
    if (scores.length > 0) stageScores[stage] = scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
  }
  let weighted = 0;
  let scoredWeight = 0;
  for (const [stage, weight] of Object.entries(SR_STAGE_WEIGHTS) as Array<[SrBenchmarkStage, number]>) {
    const value = stageScores[stage];
    if (value === undefined) continue;
    weighted += value * weight;
    scoredWeight += weight;
  }
  const reproductionScore = scoredWeight > 0 ? 100 * weighted / scoredWeight : 0;
  const pipelineCoverage = srPipelineCoverage(benchmark);
  const effectiveScore = reproductionScore * pipelineCoverage / 100;
  const criticalFailures = taskScores.flatMap((item) => [
    ...(item.critical && !item.exact ? [`${item.taskId}: critical task was not reproduced exactly.`] : []),
    ...item.fatalViolations.map((message) => `${item.taskId}: ${message}`),
  ]);
  const sr100 = pipelineCoverage === 100
    && Math.abs(reproductionScore - 100) < 1e-12
    && criticalFailures.length === 0
    && taskScores.length > 0
    && taskScores.every((item) => item.exact);
  const actualModels = unique(taskScores.map((item) => item.routing.actualModel));
  const providers = unique(taskScores.map((item) => item.routing.provider));
  const base: Omit<SrBenchmarkRunResult, 'runHash'> = {
    schemaVersion: SR_BENCHMARK_SCHEMA_VERSION,
    caseId: benchmark.caseId,
    caseHash: benchmark.caseHash!,
    requestedModel: input.model,
    actualModels,
    providers,
    taskScores,
    stageScores,
    reproductionScore,
    pipelineCoverage,
    effectiveScore,
    criticalFailures,
    sr100,
  };
  return { ...base, runHash: scientificContentHash(base) };
}
