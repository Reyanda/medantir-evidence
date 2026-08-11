import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SR_QUALIFICATION_CORPUS_SCHEMA_VERSION,
  type SrQualificationCandidateInput,
  type SrQualificationCandidateVerificationReceipt,
} from '../src/benchmark/sr-qualification-corpus.js';
import type { SrQualificationAssetReceipt } from '../src/benchmark/sr-qualification-receipt.js';
import {
  createSrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from '../src/benchmark/sr-qualification-source-capture.js';
import {
  createSrQualificationFinalization,
  defaultSrQualificationPromotionPolicy,
  type SrQualificationPromotionPolicy,
} from '../src/benchmark/sr-qualification-finalization.js';

interface CorpusFile {
  schemaVersion: string;
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}

interface CaptureSetFile {
  schemaVersion: 'medantir-sr-qualification-source-capture-set/1';
  captures: Array<Omit<SrQualificationSourceCapture, 'schemaVersion' | 'captureHash'>>;
}

interface AssetReceiptSetFile {
  schemaVersion: 'medantir-sr-qualification-asset-receipt-set/1';
  receipts: SrQualificationAssetReceipt[];
}

interface CandidateVerificationSetFile {
  schemaVersion: 'medantir-sr-qualification-candidate-verification-set/1';
  receipts: SrQualificationCandidateVerificationReceipt[];
}

function requireSchema(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label} uses unsupported schema '${actual}', expected '${expected}'.`);
}

const corpusPath = resolve(process.env.SRBENCH_QUALIFICATION_FILE ?? 'benchmarks/srbench-v1/qualification-candidates.json');
const capturesPath = resolve(process.env.SRBENCH_QUALIFICATION_CAPTURES_FILE ?? 'benchmarks/srbench-v1/qualification-source-captures.json');
const assetReceiptsPath = resolve(process.env.SRBENCH_QUALIFICATION_ASSET_RECEIPTS_FILE ?? 'benchmarks/srbench-v1/qualification-asset-receipts.json');
const candidateVerificationsPath = resolve(process.env.SRBENCH_QUALIFICATION_CANDIDATE_VERIFICATIONS_FILE ?? 'benchmarks/srbench-v1/qualification-candidate-verifications.json');
const policyPath = process.env.SRBENCH_QUALIFICATION_POLICY_FILE?.trim();
const outputDir = resolve(process.env.SRBENCH_QUALIFICATION_OUTPUT_DIR ?? 'artifacts/srbench-qualification');

const corpusRaw = JSON.parse(await readFile(corpusPath, 'utf8')) as CorpusFile;
const captureRaw = JSON.parse(await readFile(capturesPath, 'utf8')) as CaptureSetFile;
const assetReceiptRaw = JSON.parse(await readFile(assetReceiptsPath, 'utf8')) as AssetReceiptSetFile;
const candidateVerificationRaw = JSON.parse(await readFile(candidateVerificationsPath, 'utf8')) as CandidateVerificationSetFile;

requireSchema(corpusRaw.schemaVersion, SR_QUALIFICATION_CORPUS_SCHEMA_VERSION, 'Qualification corpus');
requireSchema(captureRaw.schemaVersion, 'medantir-sr-qualification-source-capture-set/1', 'Qualification source-capture set');
requireSchema(assetReceiptRaw.schemaVersion, 'medantir-sr-qualification-asset-receipt-set/1', 'Qualification asset-receipt set');
requireSchema(candidateVerificationRaw.schemaVersion, 'medantir-sr-qualification-candidate-verification-set/1', 'Qualification candidate-verification set');

const promotionPolicy = policyPath
  ? JSON.parse(await readFile(resolve(policyPath), 'utf8')) as SrQualificationPromotionPolicy
  : defaultSrQualificationPromotionPolicy();
const sourceCaptures = captureRaw.captures.map(createSrQualificationSourceCapture);
const finalization = createSrQualificationFinalization({
  corpusId: corpusRaw.corpusId,
  corpusVersion: corpusRaw.corpusVersion,
  candidates: corpusRaw.candidates,
  sourceCaptures,
  assetReceipts: assetReceiptRaw.receipts,
  candidateVerifications: candidateVerificationRaw.receipts,
  promotionPolicy,
});

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'qualification-finalization.json'), `${JSON.stringify(finalization, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDir, 'qualification-final-corpus.json'), `${JSON.stringify(finalization.corpus, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDir, 'qualification-promotion-gate.json'), `${JSON.stringify(finalization.promotionGate, null, 2)}\n`, 'utf8');

const summary = {
  finalizationHash: finalization.finalizationHash,
  corpusHash: finalization.corpus.corpusHash,
  sourceCaptures: finalization.sourceCaptureHashes.length,
  assetReceipts: finalization.assetReceiptHashes.length,
  candidateVerifications: finalization.candidateVerificationReceiptHashes.length,
  validationReadyCandidates: finalization.corpus.validationReadyCandidates,
  validationReadyDomains: finalization.corpus.validationReadyDomains,
  promotionGatePassed: finalization.promotionGate.passed,
  checks: finalization.promotionGate.checks,
  outputDir,
};
console.log(JSON.stringify(summary, null, 2));

if ((process.env.SRBENCH_REQUIRE_QUALIFICATION_GATE ?? '').trim().toLowerCase() === 'true' && !finalization.promotionGate.passed) {
  process.exitCode = 2;
}
