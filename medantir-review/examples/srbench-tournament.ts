import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAiCompatibleSrModelPort } from '../src/benchmark/openai-compatible-sr-model.js';
import { runSrBenchmarkTournament } from '../src/benchmark/sr-benchmark-suite.js';
import type { SrDriftSentinelReceipt } from '../src/benchmark/sr-drift-sentinel.js';

function listEnv(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function driftReceipts(path: string | undefined): Promise<SrDriftSentinelReceipt[]> {
  if (!path?.trim()) return [];
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8')) as SrDriftSentinelReceipt | SrDriftSentinelReceipt[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const suitePath = resolve(process.env.SRBENCH_SUITE ?? 'benchmarks/srbench-v1/suite.json');
const models = listEnv('SRBENCH_MODELS');
if (models.length === 0) throw new Error('SRBENCH_MODELS is required, e.g. "auto/reasoning:free,qwen3,codex-model".');

const endpoint = process.env.SRBENCH_ENDPOINT
  ?? process.env.OMNIROUTE_BASE_URL
  ?? 'http://127.0.0.1:20128/v1';
const apiKey = process.env.SRBENCH_API_KEY ?? process.env.OMNIROUTE_API_KEY;
const repeats = Number.parseInt(process.env.SRBENCH_REPEATS ?? '1', 10);
const outputDir = resolve(process.env.SRBENCH_OUTPUT_DIR ?? 'artifacts/srbench');
const sentinels = await driftReceipts(process.env.SRBENCH_DRIFT_SENTINEL_FILE);

const extraHeaders: Record<string, string> = {};
if (process.env.SRBENCH_BUDGET_USD_PER_REQUEST) extraHeaders['x-omniroute-budget'] = process.env.SRBENCH_BUDGET_USD_PER_REQUEST;
if (process.env.SRBENCH_BUDGET_FALLBACK) extraHeaders['x-omniroute-budget-fallback'] = process.env.SRBENCH_BUDGET_FALLBACK;

const port = new OpenAiCompatibleSrModelPort({
  endpoint,
  ...(apiKey ? { apiKey } : {}),
  extraHeaders,
});
const tournament = await runSrBenchmarkTournament({
  suitePath,
  models,
  repeats,
  port,
  driftSentinels: sentinels,
  outputDir,
});

console.log(JSON.stringify({
  suiteId: tournament.suiteId,
  suiteVersion: tournament.suiteVersion,
  suiteHash: tournament.suiteHash,
  qualificationCorpusHash: tournament.qualificationCorpusHash ?? null,
  tournamentHash: tournament.tournamentHash,
  models: tournament.models,
  repeats: tournament.repeats,
  cases: tournament.cases,
  qualificationAdmissions: tournament.qualificationAdmissions.map((item) => ({
    caseId: item.caseId,
    qualificationCandidateId: item.qualificationCandidateId ?? null,
    status: item.status,
    promotionAdmitted: item.promotionAdmitted,
    reasons: item.reasons,
    admissionHash: item.admissionHash,
  })),
  leaderboard: tournament.leaderboard,
  driftSentinels: tournament.driftSentinels,
  promotion: tournament.promotion.map((item) => ({
    model: item.requestedModel,
    tier: item.tier,
    passedChecks: item.checks.filter((check) => check.passed).length,
    totalChecks: item.checks.length,
    dossierHash: item.dossierHash,
  })),
  outputDir,
}, null, 2));
