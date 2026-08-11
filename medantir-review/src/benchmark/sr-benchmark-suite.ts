import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { scientificContentHash } from '../core/canonical-hash.js';
import {
  runSrBenchmarkCase,
  srPipelineCoverage,
  validateSrBenchmarkCase,
  type SrBenchmarkCase,
  type SrBenchmarkRunResult,
  type SrBenchmarkStage,
  type SrBenchmarkTask,
  type SrReviewModelPort,
} from './sr-reproduction-benchmark.js';
import {
  buildSr100PromotionDossier,
  defaultSr100PromotionPolicy,
  type Sr100PromotionDossier,
  type Sr100PromotionPolicy,
  type SrBenchmarkRunWithContext,
} from './sr100-promotion.js';
import {
  verifySrDriftSentinelReceipt,
  type SrDriftSentinelReceipt,
} from './sr-drift-sentinel.js';
import { GoldSealedSrReviewModelPort } from './sealed-sr-model.js';
import {
  SR_QUALIFICATION_CORPUS_SCHEMA_VERSION,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
  type SrQualificationCandidateVerificationReceipt,
  type SrQualificationCorpus,
} from './sr-qualification-corpus.js';
import {
  createSrQualificationAdmissions,
  type SrQualificationAdmission,
} from './sr-qualification-admission.js';
import type { SrQualificationAssetReceipt } from './sr-qualification-receipt.js';
import {
  createSrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from './sr-qualification-source-capture.js';
import {
  createSrQualificationFinalization,
  defaultSrQualificationPromotionPolicy,
  type SrQualificationFinalization,
  type SrQualificationPromotionPolicy,
} from './sr-qualification-finalization.js';

export const SR_BENCHMARK_SUITE_SCHEMA_VERSION = 'medantir-srbench-suite/1' as const;
export type SrSuiteCaseRole = 'validation' | 'canary';

interface FileBackedTask extends Omit<SrBenchmarkTask, 'input' | 'gold'> {
  input?: unknown;
  gold?: unknown;
  inputFile?: string;
  goldFile?: string;
}

interface FileBackedCase extends Omit<SrBenchmarkCase, 'tasks'> {
  benchmarkClass?: 'published-review' | 'synthetic-fixture';
  /** Complete stages may be proven by deterministic MEDANTIR engine receipts instead of model tasks. */
  stageReceiptFiles?: Partial<Record<SrBenchmarkStage, string>>;
  tasks: FileBackedTask[];
}

interface QualificationCorpusFile {
  schemaVersion: string;
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}

interface QualificationCaptureSetFile {
  schemaVersion: 'medantir-sr-qualification-source-capture-set/1';
  captures: Array<Omit<SrQualificationSourceCapture, 'schemaVersion' | 'captureHash'>>;
}

interface QualificationAssetReceiptSetFile {
  schemaVersion: 'medantir-sr-qualification-asset-receipt-set/1';
  receipts: SrQualificationAssetReceipt[];
}

interface QualificationCandidateVerificationSetFile {
  schemaVersion: 'medantir-sr-qualification-candidate-verification-set/1';
  receipts: SrQualificationCandidateVerificationReceipt[];
}

export interface SrBenchmarkSuiteFile {
  schemaVersion: typeof SR_BENCHMARK_SUITE_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion: string;
  qualificationCorpus?: string;
  /** When one qualification ledger is configured, all three must be present; the suite then loads the finalized corpus rather than raw candidate declarations. */
  qualificationSourceCaptures?: string;
  qualificationAssetReceipts?: string;
  qualificationCandidateVerifications?: string;
  qualificationPromotionPolicy?: string;
  cases: Array<{
    path: string;
    enabled?: boolean;
    role?: SrSuiteCaseRole;
    qualificationCandidateId?: string;
  }>;
  promotionPolicy?: Sr100PromotionPolicy;
}

export interface LoadedSrBenchmarkCase {
  definition: SrBenchmarkCase;
  benchmarkClass: 'published-review' | 'synthetic-fixture';
  role: SrSuiteCaseRole;
  qualificationCandidateId?: string;
  sourcePath: string;
}

export interface SrDriftSentinelStatus {
  requestedModel: string;
  supplied: boolean;
  valid: boolean;
  sentinelId?: string;
  receiptHash?: string;
  errors: string[];
}

export interface SrBenchmarkTournamentResult {
  schemaVersion: typeof SR_BENCHMARK_SUITE_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion: string;
  suiteHash: string;
  qualificationCorpusHash?: string;
  qualificationFinalizationHash?: string;
  qualificationPromotionGateHash?: string;
  qualificationPromotionGatePassed?: boolean;
  models: string[];
  repeats: number;
  cases: Array<{
    caseId: string;
    benchmarkClass: 'published-review' | 'synthetic-fixture';
    role: SrSuiteCaseRole;
    qualificationCandidateId?: string;
    domain: string;
    pipelineCoverage: number;
    sourcePath: string;
  }>;
  qualificationAdmissions: SrQualificationAdmission[];
  runs: SrBenchmarkRunWithContext[];
  driftSentinels: SrDriftSentinelStatus[];
  promotion: Sr100PromotionDossier[];
  leaderboard: Array<{
    model: string;
    meanReproductionScore: number;
    meanPipelineCoverage: number;
    meanEffectiveScore: number;
    sr100Runs: number;
    criticalFailures: number;
    promotionTier: Sr100PromotionDossier['tier'];
  }>;
  tournamentHash: string;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

function exactlyOne(...values: unknown[]): boolean {
  return values.filter((value) => value !== undefined).length === 1;
}

function isSha256(value: string | undefined): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

async function hydrateTask(task: FileBackedTask, caseDir: string): Promise<SrBenchmarkTask> {
  if (!exactlyOne(task.input, task.inputFile)) throw new Error(`SRBench task '${task.id}' requires exactly one of input or inputFile.`);
  if (!exactlyOne(task.gold, task.goldFile)) throw new Error(`SRBench task '${task.id}' requires exactly one of gold or goldFile.`);
  const input = task.inputFile ? await readJson(resolve(caseDir, task.inputFile)) : task.input;
  const gold = task.goldFile ? await readJson(resolve(caseDir, task.goldFile)) : task.gold;
  const { inputFile: _inputFile, goldFile: _goldFile, ...rest } = task;
  return { ...rest, input, gold } as SrBenchmarkTask;
}

function stageModelGoldHash(stage: SrBenchmarkStage, tasks: SrBenchmarkTask[]): string | undefined {
  const selected = tasks.filter((task) => task.stage === stage);
  if (selected.length === 0) return undefined;
  return scientificContentHash(selected
    .map((task) => ({
      id: task.id,
      dependsOn: [...(task.dependsOn ?? [])],
      scorer: task.scorer,
      gold: task.gold,
      critical: task.critical,
    }))
    .sort((a, b) => a.id.localeCompare(b.id)));
}

async function bindStageGold(
  raw: FileBackedCase,
  tasks: SrBenchmarkTask[],
  caseDir: string,
): Promise<SrBenchmarkCase['stageGold']> {
  const stageGold = structuredClone(raw.stageGold) as SrBenchmarkCase['stageGold'];
  for (const [stage, coverage] of Object.entries(stageGold) as Array<[SrBenchmarkStage, SrBenchmarkCase['stageGold'][SrBenchmarkStage]]>) {
    if (coverage.status !== 'complete') continue;
    const modelGoldHash = stageModelGoldHash(stage, tasks);
    const receiptFile = raw.stageReceiptFiles?.[stage];
    const engineReceiptHash = receiptFile
      ? scientificContentHash(await readJson(resolve(caseDir, receiptFile)))
      : undefined;
    if (!modelGoldHash && !engineReceiptHash) {
      throw new Error(`SRBench stage '${stage}' is marked complete but has neither model gold nor a deterministic stage receipt file.`);
    }
    const expected = modelGoldHash && engineReceiptHash
      ? scientificContentHash({ modelGoldHash, engineReceiptHash })
      : (modelGoldHash ?? engineReceiptHash)!;
    if (coverage.receiptHash === 'AUTO') coverage.receiptHash = expected;
    else if (!isSha256(coverage.receiptHash) || coverage.receiptHash !== expected) {
      throw new Error(`SRBench complete-gold receipt for stage '${stage}' does not match its bound model/engine gold.`);
    }
  }
  return stageGold;
}

export async function loadSrBenchmarkCase(path: string): Promise<LoadedSrBenchmarkCase> {
  const absolute = resolve(path);
  const raw = await readJson(absolute) as FileBackedCase;
  const caseDir = dirname(absolute);
  const tasks: SrBenchmarkTask[] = [];
  for (const task of raw.tasks) tasks.push(await hydrateTask(task, caseDir));
  const stageGold = await bindStageGold(raw, tasks, caseDir);
  const {
    benchmarkClass = 'published-review',
    stageReceiptFiles: _stageReceiptFiles,
    ...definitionWithoutClass
  } = raw;
  const definition = validateSrBenchmarkCase({ ...definitionWithoutClass, stageGold, tasks } as SrBenchmarkCase);
  return { definition, benchmarkClass, role: 'validation', sourcePath: absolute };
}

async function loadQualificationEvidence(
  suite: SrBenchmarkSuiteFile,
  baseDir: string,
): Promise<{ qualificationCorpus?: SrQualificationCorpus; qualificationFinalization?: SrQualificationFinalization }> {
  if (!suite.qualificationCorpus?.trim()) {
    const configuredLedgers = [
      suite.qualificationSourceCaptures,
      suite.qualificationAssetReceipts,
      suite.qualificationCandidateVerifications,
      suite.qualificationPromotionPolicy,
    ].some((value) => Boolean(value?.trim()));
    if (configuredLedgers) throw new Error('SRBench qualification ledgers/policy cannot be configured without qualificationCorpus.');
    return {};
  }

  const raw = await readJson(resolve(baseDir, suite.qualificationCorpus)) as QualificationCorpusFile;
  if (raw.schemaVersion !== SR_QUALIFICATION_CORPUS_SCHEMA_VERSION) {
    throw new Error(`Unsupported SR qualification corpus schema '${raw.schemaVersion}'.`);
  }

  const ledgerPaths = [
    suite.qualificationSourceCaptures,
    suite.qualificationAssetReceipts,
    suite.qualificationCandidateVerifications,
  ];
  const configuredCount = ledgerPaths.filter((value) => Boolean(value?.trim())).length;
  if (configuredCount === 0) {
    return {
      qualificationCorpus: createSrQualificationCorpus({
        corpusId: raw.corpusId,
        corpusVersion: raw.corpusVersion,
        candidates: raw.candidates,
      }),
    };
  }
  if (configuredCount !== 3) {
    throw new Error('SRBench qualification finalization requires source-capture, asset-receipt and candidate-verification ledgers together.');
  }

  const capturesRaw = await readJson(resolve(baseDir, suite.qualificationSourceCaptures!)) as QualificationCaptureSetFile;
  const assetReceiptsRaw = await readJson(resolve(baseDir, suite.qualificationAssetReceipts!)) as QualificationAssetReceiptSetFile;
  const candidateVerificationsRaw = await readJson(resolve(baseDir, suite.qualificationCandidateVerifications!)) as QualificationCandidateVerificationSetFile;
  if (capturesRaw.schemaVersion !== 'medantir-sr-qualification-source-capture-set/1') throw new Error(`Unsupported qualification source-capture set schema '${capturesRaw.schemaVersion}'.`);
  if (assetReceiptsRaw.schemaVersion !== 'medantir-sr-qualification-asset-receipt-set/1') throw new Error(`Unsupported qualification asset-receipt set schema '${assetReceiptsRaw.schemaVersion}'.`);
  if (candidateVerificationsRaw.schemaVersion !== 'medantir-sr-qualification-candidate-verification-set/1') throw new Error(`Unsupported qualification candidate-verification set schema '${candidateVerificationsRaw.schemaVersion}'.`);
  const promotionPolicy = suite.qualificationPromotionPolicy?.trim()
    ? await readJson(resolve(baseDir, suite.qualificationPromotionPolicy)) as SrQualificationPromotionPolicy
    : defaultSrQualificationPromotionPolicy();
  const qualificationFinalization = createSrQualificationFinalization({
    corpusId: raw.corpusId,
    corpusVersion: raw.corpusVersion,
    candidates: raw.candidates,
    sourceCaptures: capturesRaw.captures.map(createSrQualificationSourceCapture),
    assetReceipts: assetReceiptsRaw.receipts,
    candidateVerifications: candidateVerificationsRaw.receipts,
    promotionPolicy,
  });
  return { qualificationCorpus: qualificationFinalization.corpus, qualificationFinalization };
}

export async function loadSrBenchmarkSuite(path: string): Promise<{
  suite: SrBenchmarkSuiteFile;
  cases: LoadedSrBenchmarkCase[];
  qualificationCorpus?: SrQualificationCorpus;
  qualificationFinalization?: SrQualificationFinalization;
  qualificationAdmissions: SrQualificationAdmission[];
  suiteHash: string;
}> {
  const absolute = resolve(path);
  const suite = await readJson(absolute) as SrBenchmarkSuiteFile;
  if (suite.schemaVersion !== SR_BENCHMARK_SUITE_SCHEMA_VERSION) throw new Error(`Unsupported SRBench suite schema '${suite.schemaVersion}'.`);
  if (!suite.suiteId?.trim() || !suite.suiteVersion?.trim()) throw new Error('SRBench suite requires stable ID and version.');
  const baseDir = dirname(absolute);
  const { qualificationCorpus, qualificationFinalization } = await loadQualificationEvidence(suite, baseDir);
  const cases: LoadedSrBenchmarkCase[] = [];
  for (const item of suite.cases.filter((item) => item.enabled !== false)) {
    const loaded = await loadSrBenchmarkCase(resolve(baseDir, item.path));
    cases.push({
      ...loaded,
      role: item.role ?? 'validation',
      ...(item.qualificationCandidateId?.trim() ? { qualificationCandidateId: item.qualificationCandidateId.trim() } : {}),
    });
  }
  if (cases.length === 0) throw new Error('SRBench suite has no enabled cases.');
  const qualificationAdmissions = createSrQualificationAdmissions({ cases, corpus: qualificationCorpus });
  const suiteHash = scientificContentHash({
    suite,
    cases: cases.map((item) => ({
      caseHash: item.definition.caseHash,
      role: item.role,
      qualificationCandidateId: item.qualificationCandidateId ?? null,
    })),
    qualificationCorpusHash: qualificationCorpus?.corpusHash ?? null,
    qualificationFinalizationHash: qualificationFinalization?.finalizationHash ?? null,
    qualificationPromotionGateHash: qualificationFinalization?.promotionGate.gateHash ?? null,
    qualificationAdmissionHashes: qualificationAdmissions.map((item) => item.admissionHash),
  });
  return {
    suite,
    cases,
    ...(qualificationCorpus ? { qualificationCorpus } : {}),
    ...(qualificationFinalization ? { qualificationFinalization } : {}),
    qualificationAdmissions,
    suiteHash,
  };
}

class NonThrowingModelPort implements SrReviewModelPort {
  constructor(private readonly inner: SrReviewModelPort) {}
  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]) {
    try {
      return await this.inner.completeJson(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const output = { __srbenchInferenceError: message };
      return {
        output,
        outputHash: scientificContentHash(output),
        routing: { requestedModel: input.model },
      };
    }
  }
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sentinelStatus(input: {
  model: string;
  suiteHash: string;
  receipts: SrDriftSentinelReceipt[];
  now?: string;
}): SrDriftSentinelStatus {
  const matches = input.receipts.filter((receipt) => receipt.requestedModel === input.model);
  if (matches.length === 0) return { requestedModel: input.model, supplied: false, valid: false, errors: ['No drift-sentinel receipt was supplied for this model.'] };
  if (matches.length > 1) return { requestedModel: input.model, supplied: true, valid: false, errors: ['Multiple drift-sentinel receipts were supplied for the same requested model. Supply one current receipt.'] };
  const receipt = matches[0]!;
  const verification = verifySrDriftSentinelReceipt({
    receipt,
    expectedSuiteHash: input.suiteHash,
    requestedModel: input.model,
    ...(input.now ? { now: input.now } : {}),
  });
  return {
    requestedModel: input.model,
    supplied: true,
    valid: verification.valid,
    sentinelId: receipt.sentinelId,
    receiptHash: receipt.receiptHash,
    errors: verification.errors,
  };
}

export function qualificationPromotionAdmittedCaseIds(input: {
  admissions: SrQualificationAdmission[];
  finalization?: SrQualificationFinalization;
}): string[] {
  if (input.finalization && !input.finalization.promotionGate.passed) return [];
  return input.admissions
    .filter((item) => item.promotionAdmitted)
    .map((item) => item.caseId)
    .sort();
}

export async function runSrBenchmarkTournament(input: {
  suitePath: string;
  models: string[];
  repeats?: number;
  port: SrReviewModelPort;
  driftSentinels?: SrDriftSentinelReceipt[];
  now?: string;
  outputDir?: string;
}): Promise<SrBenchmarkTournamentResult> {
  const { suite, cases, qualificationCorpus, qualificationFinalization, qualificationAdmissions, suiteHash } = await loadSrBenchmarkSuite(input.suitePath);
  const models = [...new Set(input.models.map((model) => model.trim()).filter(Boolean))];
  if (models.length === 0) throw new Error('SRBench tournament requires at least one model.');
  const repeats = input.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats <= 0) throw new Error('SRBench repeats must be a positive integer.');
  const safePort = new NonThrowingModelPort(new GoldSealedSrReviewModelPort(input.port));
  const runs: SrBenchmarkRunWithContext[] = [];
  for (const model of models) {
    for (const benchmark of cases) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const result: SrBenchmarkRunResult = await runSrBenchmarkCase({
          caseDefinition: benchmark.definition,
          model,
          port: safePort,
        });
        runs.push({ ...result, domain: benchmark.definition.domain, repeat });
      }
    }
  }

  const policy = suite.promotionPolicy ?? defaultSr100PromotionPolicy();
  const validationCaseIds = new Set(cases.filter((item) => item.role === 'validation').map((item) => item.definition.caseId));
  const admittedCaseIds = new Set(qualificationPromotionAdmittedCaseIds({
    admissions: qualificationAdmissions,
    ...(qualificationFinalization ? { finalization: qualificationFinalization } : {}),
  }));
  const promotionRuns = runs.filter((run) => admittedCaseIds.has(run.caseId));
  const driftSentinels = models.map((model) => sentinelStatus({
    model,
    suiteHash,
    receipts: input.driftSentinels ?? [],
    ...(input.now ? { now: input.now } : {}),
  }));
  const promotion = models.map((model) => buildSr100PromotionDossier({
    requestedModel: model,
    runs: promotionRuns,
    policy,
    driftSentinelConfigured: driftSentinels.find((item) => item.requestedModel === model)?.valid === true,
  }));
  const leaderboard = models.map((model) => {
    const modelRuns = runs.filter((run) => run.requestedModel === model && validationCaseIds.has(run.caseId));
    const dossier = promotion.find((item) => item.requestedModel === model)!;
    return {
      model,
      meanReproductionScore: mean(modelRuns.map((run) => run.reproductionScore)),
      meanPipelineCoverage: mean(modelRuns.map((run) => run.pipelineCoverage)),
      meanEffectiveScore: mean(modelRuns.map((run) => run.effectiveScore)),
      sr100Runs: modelRuns.filter((run) => run.sr100).length,
      criticalFailures: modelRuns.reduce((sum, run) => sum + run.criticalFailures.length, 0),
      promotionTier: dossier.tier,
    };
  }).sort((a, b) => b.meanEffectiveScore - a.meanEffectiveScore || b.meanReproductionScore - a.meanReproductionScore || a.model.localeCompare(b.model));

  const base: Omit<SrBenchmarkTournamentResult, 'tournamentHash'> = {
    schemaVersion: SR_BENCHMARK_SUITE_SCHEMA_VERSION,
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    suiteHash,
    ...(qualificationCorpus ? { qualificationCorpusHash: qualificationCorpus.corpusHash } : {}),
    ...(qualificationFinalization ? {
      qualificationFinalizationHash: qualificationFinalization.finalizationHash,
      qualificationPromotionGateHash: qualificationFinalization.promotionGate.gateHash,
      qualificationPromotionGatePassed: qualificationFinalization.promotionGate.passed,
    } : {}),
    models,
    repeats,
    cases: cases.map((item) => ({
      caseId: item.definition.caseId,
      benchmarkClass: item.benchmarkClass,
      role: item.role,
      ...(item.qualificationCandidateId ? { qualificationCandidateId: item.qualificationCandidateId } : {}),
      domain: item.definition.domain,
      pipelineCoverage: srPipelineCoverage(item.definition),
      sourcePath: item.sourcePath,
    })),
    qualificationAdmissions,
    runs,
    driftSentinels,
    promotion,
    leaderboard,
  };
  const tournament: SrBenchmarkTournamentResult = { ...base, tournamentHash: scientificContentHash(base) };
  if (input.outputDir) {
    const out = resolve(input.outputDir);
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, 'srbench-tournament.json'), `${JSON.stringify(tournament, null, 2)}\n`, 'utf8');
    await writeFile(resolve(out, 'srbench-leaderboard.json'), `${JSON.stringify(leaderboard, null, 2)}\n`, 'utf8');
    await writeFile(resolve(out, 'srbench-qualification-admissions.json'), `${JSON.stringify(qualificationAdmissions, null, 2)}\n`, 'utf8');
    if (qualificationFinalization) {
      await writeFile(resolve(out, 'srbench-qualification-finalization.json'), `${JSON.stringify(qualificationFinalization, null, 2)}\n`, 'utf8');
      await writeFile(resolve(out, 'srbench-qualification-promotion-gate.json'), `${JSON.stringify(qualificationFinalization.promotionGate, null, 2)}\n`, 'utf8');
    }
    await writeFile(resolve(out, 'srbench-promotion.json'), `${JSON.stringify(promotion, null, 2)}\n`, 'utf8');
    await writeFile(resolve(out, 'srbench-drift-sentinels.json'), `${JSON.stringify(driftSentinels, null, 2)}\n`, 'utf8');
  }
  return tournament;
}
