import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import {
  adjudicateModelPromotion,
  buildScreeningModelGovernanceDossier,
  type HumanModelPromotionDecision,
  type ModelBenchmarkReferenceReceipt,
  type ScreeningBenchmarkCandidate,
  type ScreeningModelPromotionPolicy,
} from '../src/inference/model-governance.js';
import type { EvidenceRecord, ScreeningDecision } from '../src/core/types.js';

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const artifactDir = resolve(process.env.MODEL_GOVERNANCE_ARTIFACT_DIR ?? 'artifacts/live-pipeline');
const benchmarkFile = process.env.MODEL_GOVERNANCE_BENCHMARK_FILE;
const policyFile = process.env.MODEL_GOVERNANCE_POLICY_FILE;
const referenceFile = process.env.MODEL_GOVERNANCE_REFERENCE_FILE;
const promptVersion = process.env.MODEL_GOVERNANCE_PROMPT_VERSION;
if (!benchmarkFile) throw new Error('MODEL_GOVERNANCE_BENCHMARK_FILE is required. Point it at one frozen model benchmark JSON file.');
if (!policyFile) throw new Error('MODEL_GOVERNANCE_POLICY_FILE is required. Promotion thresholds must be prespecified in a versioned policy file.');
if (!referenceFile) throw new Error('MODEL_GOVERNANCE_REFERENCE_FILE is required. Promotion cannot proceed without an independent benchmark-reference receipt.');
if (!promptVersion?.trim()) throw new Error('MODEL_GOVERNANCE_PROMPT_VERSION is required and must match the frozen benchmark prompt.');

const candidate = await readJson<ScreeningBenchmarkCandidate>(resolve(benchmarkFile));
const policy = await readJson<ScreeningModelPromotionPolicy>(resolve(policyFile));
const reference = await readJson<ModelBenchmarkReferenceReceipt>(resolve(referenceFile));
const records = await readJson<EvidenceRecord[]>(resolve(artifactDir, 'unique-records.json'));
const decisions = await readJson<ScreeningDecision[]>(resolve(artifactDir, 'tiab-decisions.json'));
const sampledRecordIds = candidate.suggestions.map((item) => item.recordId).sort();

const context = {
  task: 'tiab-screening' as const,
  evidenceSetHash: scientificContentHash(records),
  authoritativeDecisionHash: scientificContentHash(decisions),
  sampleDefinitionHash: scientificContentHash({ sampledRecordIds }),
  promptVersion: promptVersion.trim(),
};

const dossier = buildScreeningModelGovernanceDossier({ candidate, context, reference, policy });
const outputDir = resolve(process.env.MODEL_GOVERNANCE_OUTPUT_DIR ?? `${artifactDir}/model-governance`);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'benchmark-context.json'), `${JSON.stringify(context, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDir, 'promotion-dossier.json'), `${JSON.stringify(dossier, null, 2)}\n`, 'utf8');

const humanDecisionFile = process.env.MODEL_GOVERNANCE_HUMAN_DECISION_FILE;
let receipt = null;
if (humanDecisionFile) {
  const decision = await readJson<HumanModelPromotionDecision>(resolve(humanDecisionFile));
  receipt = adjudicateModelPromotion(dossier, decision);
  await writeFile(resolve(outputDir, 'promotion-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  outputDir,
  requestedModel: dossier.requestedModel,
  actualModels: dossier.actualModels,
  providers: dossier.routedProviders,
  recommendation: dossier.recommendation,
  dossierHash: dossier.dossierHash,
  failedChecks: dossier.checks.filter((item) => !item.passed).map((item) => item.code),
  promotionStatus: receipt?.status ?? 'awaiting-human-review',
}, null, 2));
