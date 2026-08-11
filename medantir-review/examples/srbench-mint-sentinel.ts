import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSrDriftSentinelReceipt } from '../src/benchmark/sr-drift-sentinel.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';

function listEnv(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

const tournamentPath = resolve(process.env.SRBENCH_TOURNAMENT_FILE ?? 'artifacts/srbench/srbench-tournament.json');
const model = process.env.SRBENCH_SENTINEL_MODEL?.trim();
if (!model) throw new Error('SRBENCH_SENTINEL_MODEL is required.');
const canaryCaseIds = listEnv('SRBENCH_CANARY_CASE_IDS');
if (canaryCaseIds.length === 0) throw new Error('SRBENCH_CANARY_CASE_IDS is required and must name one or more held-out complete canary base cases.');
const ttlHours = Number.parseInt(process.env.SRBENCH_SENTINEL_TTL_HOURS ?? '168', 10);
if (!Number.isInteger(ttlHours) || ttlHours <= 0) throw new Error('SRBENCH_SENTINEL_TTL_HOURS must be a positive integer.');

const tournament = JSON.parse(await readFile(tournamentPath, 'utf8')) as SrBenchmarkTournamentResult;
const selected = tournament.runs.filter((run) => run.requestedModel === model && canaryCaseIds.includes(run.baseCaseId));
const representedCases = new Set(selected.map((run) => run.baseCaseId));
const missingCases = canaryCaseIds.filter((caseId) => !representedCases.has(caseId));
if (missingCases.length > 0) throw new Error(`Canary cases are missing from the tournament for model '${model}': ${missingCases.join(', ')}`);
const selectedMetadata = tournament.cases.filter((item) => canaryCaseIds.includes(item.caseId));
if (selectedMetadata.length !== canaryCaseIds.length) throw new Error('One or more requested canary base cases are absent from tournament metadata.');
if (selectedMetadata.some((item) => item.role !== 'canary')) throw new Error('Drift sentinel inputs must be explicit role=canary cases; validation cases cannot double as operational canaries.');
if (selectedMetadata.some((item) => item.pipelineCoverage !== 100)) throw new Error('Every selected drift canary case must have 100% pipeline coverage.');
if (selectedMetadata.some((item) => !item.counterfactualPlanHash)) throw new Error('Living-review drift sentinel requires every selected canary to have a counterfactual challenge plan.');
const knownChallengeReceipts = new Set(tournament.counterfactualChallenges.map((receipt) => receipt.receiptHash));
if (selected.some((run) => !run.challengeReceiptHash || !knownChallengeReceipts.has(run.challengeReceiptHash))) {
  throw new Error('One or more selected canary runs lack a challenge receipt that reconciles to the tournament counterfactual ledger.');
}

const issuedAt = process.env.SRBENCH_SENTINEL_ISSUED_AT ?? new Date().toISOString();
const expiresAt = new Date(Date.parse(issuedAt) + ttlHours * 60 * 60 * 1000).toISOString();
const sentinelId = process.env.SRBENCH_SENTINEL_ID?.trim()
  || `${tournament.suiteId}:${model}:${issuedAt}`;
const receipt = createSrDriftSentinelReceipt({
  sentinelId,
  suiteHash: tournament.suiteHash,
  requestedModel: model,
  canaryRuns: selected,
  issuedAt,
  expiresAt,
});

const outputPath = resolve(process.env.SRBENCH_SENTINEL_OUTPUT ?? `artifacts/srbench/drift-sentinel-${model.replace(/[^a-z0-9._-]+/gi, '_')}.json`);
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  sentinelId: receipt.sentinelId,
  requestedModel: receipt.requestedModel,
  actualModel: receipt.actualModel,
  provider: receipt.provider ?? null,
  canaryBaseCases: canaryCaseIds,
  canaryChallengeCases: receipt.canaryCaseHashes.length,
  canaryRuns: receipt.canaryRunHashes.length,
  challengeReceipts: receipt.challengeReceiptHashes.length,
  suiteHash: receipt.suiteHash,
  issuedAt: receipt.issuedAt,
  expiresAt: receipt.expiresAt,
  receiptHash: receipt.receiptHash,
  outputPath,
}, null, 2));
