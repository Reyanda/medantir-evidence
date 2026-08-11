import type { PipelineState, StageName, ValidationIssue } from './types.js';
import type { ReviewProtocol } from '../protocols/review-protocol.js';
import {
  canonicalScientificValue,
  containsRawSecretField,
  scientificContentHash,
} from './canonical-hash.js';
import {
  scientificModuleContractHash,
  scientificModuleContractsFor,
  scientificModuleIdsForStage,
  type ScientificModuleId,
} from './scientific-module-contracts.js';

export const SCIENTIFIC_RUN_SCHEMA_VERSION = 'medantir-scientific-run/1';

export type ScientificArtifactPlane = 'scientific' | 'operational' | 'experimental';
export type ScientificAttemptStatus = 'awaiting-human' | 'rework' | 'passed' | 'failed' | 'rolled-back' | 'stopped';

export interface ScientificStageAttemptReceipt {
  stage: StageName;
  attempt: number;
  status: ScientificAttemptStatus;
  moduleIds: ScientificModuleId[];
  declaredInputs: Record<string, string>;
  changedOutputs: Record<string, string | null>;
  warningHashes: string[];
  validationIssues: Array<Pick<ValidationIssue, 'code' | 'severity'>>;
  cognitiveAction?: string;
  reworkFrom?: StageName;
  recordedAt: string;
}

export interface ScientificRunLedger {
  schemaVersion: typeof SCIENTIFIC_RUN_SCHEMA_VERSION;
  attempts: ScientificStageAttemptReceipt[];
}

export interface ScientificArtifactReceipt {
  key: string;
  hash: string;
  plane: ScientificArtifactPlane;
  producerStage?: StageName;
  moduleIds: ScientificModuleId[];
}

export interface ScientificRunSealedContent {
  schemaVersion: typeof SCIENTIFIC_RUN_SCHEMA_VERSION;
  reviewType: PipelineState['request']['reviewType'];
  codeIdentity?: string | undefined;
  requestHash: string;
  protocolContractHash: string;
  moduleContracts: Array<{
    id: ScientificModuleId;
    version: string;
    authority: string;
    contractHash: string;
  }>;
  scientificArtifacts: ScientificArtifactReceipt[];
}

export interface ScientificRunManifest {
  schemaVersion: typeof SCIENTIFIC_RUN_SCHEMA_VERSION;
  sealedContent: ScientificRunSealedContent;
  operationalArtifacts: ScientificArtifactReceipt[];
  experimentalArtifacts: ScientificArtifactReceipt[];
  stageStatuses: Record<string, string>;
  attemptCount: number;
  sealScope: 'scientific-content-only';
}

export interface ScientificRunSeal {
  schemaVersion: typeof SCIENTIFIC_RUN_SCHEMA_VERSION;
  algorithm: 'sha256';
  digest: string;
  scope: 'scientific-content-only';
  digitalSignature: false;
}

const CONTROL_ARTIFACTS = new Set([
  'scientificRunLedger',
  'scientificRunManifest',
  'scientificRunSeal',
  'scientificArtifactLineage',
]);

const OPERATIONAL_ARTIFACT_PATTERNS = [
  /^researcherIdentity$/i,
  /registration/i,
  /verificationPackage/i,
  /verificationOutcome/i,
  /verificationAcknowledg/i,
  /verificationIndex/i,
  /^cognitiveControl$/i,
];

const EXPERIMENTAL_ARTIFACT_PATTERNS = [
  /^model/i,
  /omniroute/i,
  /inference.*receipt/i,
  /benchmark.*model/i,
];

function artifactPlane(key: string): ScientificArtifactPlane {
  if (EXPERIMENTAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(key))) return 'experimental';
  if (OPERATIONAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(key))) return 'operational';
  return 'scientific';
}

export function isScientificRunControlArtifact(key: string): boolean {
  return CONTROL_ARTIFACTS.has(key);
}

export function ensureScientificRunLedger(state: PipelineState): ScientificRunLedger {
  const existing = state.artifacts.scientificRunLedger as ScientificRunLedger | undefined;
  if (existing) return existing;
  const ledger: ScientificRunLedger = {
    schemaVersion: SCIENTIFIC_RUN_SCHEMA_VERSION,
    attempts: [],
  };
  state.artifacts.scientificRunLedger = ledger;
  return ledger;
}

export function snapshotScientificArtifactHashes(artifacts: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(artifacts)
      .filter((key) => !CONTROL_ARTIFACTS.has(key))
      .sort()
      .map((key) => [key, scientificContentHash(artifacts[key])]),
  );
}

function changedHashes(
  before: Record<string, string>,
  after: Record<string, string>,
): Record<string, string | null> {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return Object.fromEntries(keys.flatMap((key) => {
    const left = before[key];
    const right = after[key];
    if (left === right) return [];
    return [[key, right ?? null]];
  }));
}

export function recordScientificStageAttempt(
  state: PipelineState,
  input: {
    stage: StageName;
    attempt: number;
    status: ScientificAttemptStatus;
    requiredArtifacts: string[];
    before: Record<string, string>;
    warnings?: string[] | undefined;
    validationIssues?: ValidationIssue[] | undefined;
    cognitiveAction?: string | undefined;
    reworkFrom?: StageName | undefined;
    recordedAt: string;
  },
): ScientificStageAttemptReceipt {
  const after = snapshotScientificArtifactHashes(state.artifacts);
  const declaredInputs = Object.fromEntries(
    input.requiredArtifacts
      .filter((key) => input.before[key])
      .sort()
      .map((key) => [key, input.before[key]!]),
  );
  const receipt: ScientificStageAttemptReceipt = {
    stage: input.stage,
    attempt: input.attempt,
    status: input.status,
    moduleIds: scientificModuleIdsForStage(state.request.reviewType, input.stage),
    declaredInputs,
    changedOutputs: changedHashes(input.before, after),
    warningHashes: [...new Set((input.warnings ?? []).map((warning) => scientificContentHash(warning)))].sort(),
    validationIssues: (input.validationIssues ?? []).map((issue) => ({ code: issue.code, severity: issue.severity })),
    ...(input.cognitiveAction ? { cognitiveAction: input.cognitiveAction } : {}),
    ...(input.reworkFrom ? { reworkFrom: input.reworkFrom } : {}),
    recordedAt: input.recordedAt,
  };
  const ledger = ensureScientificRunLedger(state);
  ledger.attempts.push(receipt);
  return receipt;
}

function producerFor(
  key: string,
  hash: string,
  ledger: ScientificRunLedger,
): ScientificStageAttemptReceipt | undefined {
  return [...ledger.attempts]
    .reverse()
    .find((attempt) => attempt.changedOutputs[key] === hash);
}

function currentArtifactReceipts(state: PipelineState): ScientificArtifactReceipt[] {
  const ledger = ensureScientificRunLedger(state);
  return Object.keys(state.artifacts)
    .filter((key) => !CONTROL_ARTIFACTS.has(key))
    .sort()
    .map((key) => {
      const hash = scientificContentHash(state.artifacts[key]);
      const producer = producerFor(key, hash, ledger);
      return {
        key,
        hash,
        plane: artifactPlane(key),
        ...(producer ? { producerStage: producer.stage } : {}),
        moduleIds: producer?.moduleIds ?? [],
      };
    });
}

function protocolContract(protocol: ReviewProtocol): unknown {
  return {
    reviewType: protocol.reviewType,
    stages: protocol.stages.map((stage) => ({
      stage: stage.stage,
      requiredArtifacts: stage.requiredArtifacts,
      producedArtifacts: stage.producedArtifacts,
      maxRetries: stage.maxRetries,
      humanGate: stage.humanGate,
    })),
  };
}

function codeIdentity(): string | undefined {
  const value = process.env.MEDANTIR_COMMIT_SHA ?? process.env.GITHUB_SHA;
  return value?.trim() || undefined;
}

export function buildScientificRunManifest(
  state: PipelineState,
  protocol: ReviewProtocol,
): { manifest: ScientificRunManifest; seal: ScientificRunSeal; lineage: ScientificArtifactReceipt[] } {
  const ledger = ensureScientificRunLedger(state);
  const lineage = currentArtifactReceipts(state);
  const modules = scientificModuleContractsFor(state.request.reviewType);
  const commit = codeIdentity();
  const sealedContent: ScientificRunSealedContent = {
    schemaVersion: SCIENTIFIC_RUN_SCHEMA_VERSION,
    reviewType: state.request.reviewType,
    ...(commit ? { codeIdentity: commit } : {}),
    requestHash: scientificContentHash(state.request),
    protocolContractHash: scientificContentHash(protocolContract(protocol)),
    moduleContracts: modules.map((contract) => ({
      id: contract.id,
      version: contract.version,
      authority: contract.authority,
      contractHash: scientificModuleContractHash(contract),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    scientificArtifacts: lineage.filter((entry) => entry.plane === 'scientific'),
  };
  const manifest: ScientificRunManifest = {
    schemaVersion: SCIENTIFIC_RUN_SCHEMA_VERSION,
    sealedContent,
    operationalArtifacts: lineage.filter((entry) => entry.plane === 'operational'),
    experimentalArtifacts: lineage.filter((entry) => entry.plane === 'experimental'),
    stageStatuses: Object.fromEntries(Object.entries(state.stages).map(([stage, value]) => [stage, value.status])),
    attemptCount: ledger.attempts.length,
    sealScope: 'scientific-content-only',
  };
  const seal: ScientificRunSeal = {
    schemaVersion: SCIENTIFIC_RUN_SCHEMA_VERSION,
    algorithm: 'sha256',
    digest: scientificContentHash(sealedContent),
    scope: 'scientific-content-only',
    digitalSignature: false,
  };
  if (containsRawSecretField(canonicalScientificValue(manifest))) {
    throw new Error('Scientific run manifest unexpectedly contains a raw secret-bearing field.');
  }
  return { manifest, seal, lineage };
}

function embedRunControlsInReport(
  state: PipelineState,
  key: 'draftReport' | 'finalReport',
  manifest: ScientificRunManifest,
  seal: ScientificRunSeal,
  lineage: ScientificArtifactReceipt[],
): void {
  const report = state.artifacts[key] as { appendices?: Record<string, unknown> } | undefined;
  if (!report || typeof report !== 'object') return;
  const beforeHash = scientificContentHash(report);
  const ledger = ensureScientificRunLedger(state);
  const enriched = {
    ...report,
    appendices: {
      ...(report.appendices ?? {}),
      scientificRunManifest: manifest,
      scientificRunSeal: seal,
      scientificArtifactLineage: lineage,
      scientificRunLedger: ledger,
    },
  };
  const afterHash = scientificContentHash(enriched);
  if (beforeHash !== afterHash) {
    throw new Error(`${key} scientific hash changed after embedding run-control appendices; recursive sealing protection failed.`);
  }
  state.artifacts[key] = enriched;
}

export function refreshScientificRunArtifacts(state: PipelineState, protocol: ReviewProtocol): void {
  ensureScientificRunLedger(state);
  const { manifest, seal, lineage } = buildScientificRunManifest(state, protocol);
  state.artifacts.scientificRunManifest = manifest;
  state.artifacts.scientificRunSeal = seal;
  state.artifacts.scientificArtifactLineage = lineage;
  embedRunControlsInReport(state, 'draftReport', manifest, seal, lineage);
  embedRunControlsInReport(state, 'finalReport', manifest, seal, lineage);
}

export function verifyScientificRunSeal(manifest: ScientificRunManifest, seal: ScientificRunSeal): boolean {
  return seal.algorithm === 'sha256'
    && seal.scope === 'scientific-content-only'
    && seal.digest === scientificContentHash(manifest.sealedContent);
}
