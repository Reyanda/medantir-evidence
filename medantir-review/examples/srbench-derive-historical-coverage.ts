import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveHistoricalSrbenchCoverage } from '../src/benchmark/historical-srbench-coverage.js';
import type { HistoricalReviewReproductionEnvelope } from '../src/historical/review-reproduction.js';

async function optionalJson(path: string | undefined): Promise<unknown | undefined> {
  if (!path?.trim()) return undefined;
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const envelopePath = process.env.SRBENCH_HISTORICAL_ENVELOPE?.trim();
if (!envelopePath) throw new Error('SRBENCH_HISTORICAL_ENVELOPE is required.');
const envelope = JSON.parse(await readFile(resolve(envelopePath), 'utf8')) as HistoricalReviewReproductionEnvelope;
const questionGoldReceipt = await optionalJson(process.env.SRBENCH_QUESTION_GOLD_RECEIPT);
const protocolGoldReceipt = await optionalJson(process.env.SRBENCH_PROTOCOL_GOLD_RECEIPT);
const coverage = deriveHistoricalSrbenchCoverage({
  envelope,
  ...(questionGoldReceipt !== undefined ? { questionGoldReceipt } : {}),
  ...(protocolGoldReceipt !== undefined ? { protocolGoldReceipt } : {}),
});

const outputDir = resolve(process.env.SRBENCH_COVERAGE_OUTPUT_DIR ?? 'artifacts/srbench/historical-coverage');
await mkdir(outputDir, { recursive: true });
const stageReceiptFiles: Record<string, string> = {};
for (const [stage, receipt] of Object.entries(coverage.scientificReceiptObjects)) {
  if (!receipt) continue;
  const filename = `stage-receipt-${stage}.json`;
  await writeFile(resolve(outputDir, filename), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  stageReceiptFiles[stage] = filename;
}
const summary = {
  schemaVersion: 'medantir-srbench-historical-coverage/1',
  envelopeId: envelope.envelopeId,
  reviewId: envelope.reviewId,
  scientificCoverage: coverage.scientificCoverage,
  historicalProcessCoverage: coverage.historicalProcessCoverage,
  scientificStageGold: coverage.scientificStageGold,
  historicalProcessStatus: coverage.historicalProcessStatus,
  stageReceiptFiles,
  coverageHash: coverage.coverageHash,
};
await writeFile(resolve(outputDir, 'historical-srbench-coverage.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
