import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceRecord,
  PipelineState,
  ReviewRequest,
  ScreeningDecision,
} from '../src/core/types.js';
import { OmniRouteInferencePort } from '../src/inference/omniroute-inference.js';
import { ShadowModelTiabScreeningAgent } from '../src/inference/shadow-screening-agent.js';

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function safeModelName(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
}

function binaryMetrics(suggestions: Array<{
  authoritativeDecision?: string;
  suggestedDecision?: string;
  status?: string;
}>) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let uncertain = 0;
  for (const item of suggestions) {
    if (item.status !== 'completed') continue;
    if (!['include', 'exclude'].includes(String(item.authoritativeDecision))) continue;
    if (item.suggestedDecision === 'uncertain') {
      uncertain += 1;
      continue;
    }
    if (!['include', 'exclude'].includes(String(item.suggestedDecision))) continue;
    if (item.authoritativeDecision === 'include' && item.suggestedDecision === 'include') tp += 1;
    if (item.authoritativeDecision === 'exclude' && item.suggestedDecision === 'include') fp += 1;
    if (item.authoritativeDecision === 'exclude' && item.suggestedDecision === 'exclude') tn += 1;
    if (item.authoritativeDecision === 'include' && item.suggestedDecision === 'exclude') fn += 1;
  }
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? 2 * precision * recall / (precision + recall)
    : null;
  return {
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    falseNegative: fn,
    uncertain,
    sensitivity: recall,
    specificity: ratio(tn, tn + fp),
    precision,
    f1,
    accuracy: ratio(tp + tn, tp + fp + tn + fn),
  };
}

function costSummary(suggestions: Array<{ routingReceipt?: { responseCostUsd?: number; tokensIn?: number; tokensOut?: number; latencyMs?: number } }>) {
  const receipts = suggestions.map((item) => item.routingReceipt).filter(Boolean);
  const sum = (key: 'responseCostUsd' | 'tokensIn' | 'tokensOut' | 'latencyMs') => receipts
    .reduce((total, receipt) => total + (Number(receipt?.[key]) || 0), 0);
  return {
    totalCostUsd: sum('responseCostUsd'),
    totalTokensIn: sum('tokensIn'),
    totalTokensOut: sum('tokensOut'),
    meanLatencyMs: receipts.length > 0 ? sum('latencyMs') / receipts.length : null,
  };
}

const artifactDir = resolve(process.env.OMNIROUTE_BENCHMARK_DIR ?? 'artifacts/live-pipeline');
const outputDir = resolve(process.env.OMNIROUTE_BENCHMARK_OUTPUT_DIR ?? `${artifactDir}/model-benchmarks`);
const models = (process.env.OMNIROUTE_BENCHMARK_MODELS ?? 'auto,auto/cheap,auto/smart')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (models.length === 0) throw new Error('OMNIROUTE_BENCHMARK_MODELS did not contain any models/routes.');

const request = await json<ReviewRequest>(resolve(artifactDir, 'request.json'));
const records = await json<EvidenceRecord[]>(resolve(artifactDir, 'unique-records.json'));
const decisions = await json<ScreeningDecision[]>(resolve(artifactDir, 'tiab-decisions.json'));
const decisionById = new Map(decisions.map((decision) => [decision.recordId, decision]));
const includedIds = new Set(decisions.filter((decision) => decision.decision !== 'exclude').map((decision) => decision.recordId));
const authoritativeIncluded = records.filter((record) => includedIds.has(record.id));

const base: Agent = {
  stage: 'tiab-screen',
  async execute(): Promise<AgentResult> {
    return { artifacts: { tiabDecisions: decisions, tiabIncluded: authoritativeIncluded } };
  },
};

const context: AgentContext = {
  state: {
    runId: `model-benchmark-${Date.now()}`,
    request,
    stages: {} as PipelineState['stages'],
    artifacts: { uniqueRecords: records },
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  now: () => new Date().toISOString(),
};

const inference = new OmniRouteInferencePort();
const maxRecords = Number(process.env.OMNIROUTE_SHADOW_MAX_RECORDS ?? 50);
const concurrency = Number(process.env.OMNIROUTE_SHADOW_CONCURRENCY ?? 4);
await mkdir(outputDir, { recursive: true });

const results = [];
for (const model of models) {
  const agent = new ShadowModelTiabScreeningAgent(base, inference, {
    model,
    maxRecords,
    concurrency,
    promptVersion: 'tiab-shadow-v1',
  });
  const result = await agent.execute(context);
  const suggestions = result.artifacts.modelScreeningSuggestions as Array<{
    recordId: string;
    authoritativeDecision?: string;
    suggestedDecision?: string;
    status?: string;
    routingReceipt?: { responseCostUsd?: number; tokensIn?: number; tokensOut?: number; latencyMs?: number; actualProvider?: string; actualModel?: string };
  }>;
  const quality = result.artifacts.modelScreeningQuality;
  const metrics = binaryMetrics(suggestions);
  const resources = costSummary(suggestions);
  const providers = [...new Set(suggestions.map((item) => item.routingReceipt?.actualProvider).filter(Boolean))].sort();
  const actualModels = [...new Set(suggestions.map((item) => item.routingReceipt?.actualModel).filter(Boolean))].sort();
  const modelResult = {
    model,
    quality,
    metrics,
    resources,
    routedProviders: providers,
    actualModels,
    suggestions,
  };
  results.push(modelResult);
  await writeFile(
    resolve(outputDir, `${safeModelName(model)}.json`),
    `${JSON.stringify(modelResult, null, 2)}\n`,
    'utf8',
  );
}

const ranked = [...results].sort((left, right) => {
  const lf1 = left.metrics.f1 ?? -1;
  const rf1 = right.metrics.f1 ?? -1;
  if (rf1 !== lf1) return rf1 - lf1;
  const ls = left.metrics.sensitivity ?? -1;
  const rs = right.metrics.sensitivity ?? -1;
  if (rs !== ls) return rs - ls;
  return left.resources.totalCostUsd - right.resources.totalCostUsd;
});

const summary = {
  generatedAt: new Date().toISOString(),
  artifactDir,
  authoritativeRecords: records.length,
  authoritativeDecisions: decisions.length,
  requestedModels: models,
  sampleCap: maxRecords,
  rankingRule: 'F1 desc, sensitivity desc, total cost asc; descriptive only until benchmark reference decisions are independently verified.',
  ranking: ranked.map((entry, index) => ({
    rank: index + 1,
    model: entry.model,
    metrics: entry.metrics,
    resources: entry.resources,
    routedProviders: entry.routedProviders,
    actualModels: entry.actualModels,
  })),
};
await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));

// Sanity invariant: frozen decisions must cover the evidence objects we compare.
if (records.some((record) => !decisionById.has(record.id))) {
  throw new Error('Frozen benchmark directory contains unique records without authoritative TIAB decisions.');
}
