import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkRunWithContext } from './sr100-promotion.js';

export const SR_DRIFT_SENTINEL_SCHEMA_VERSION = 'medantir-sr-drift-sentinel/1' as const;

export interface SrDriftCanaryRun extends SrBenchmarkRunWithContext {
  challengeReceiptHash?: string;
}

export interface SrDriftSentinelReceipt {
  schemaVersion: typeof SR_DRIFT_SENTINEL_SCHEMA_VERSION;
  sentinelId: string;
  suiteHash: string;
  requestedModel: string;
  actualModel: string;
  provider?: string;
  canaryCaseHashes: string[];
  canaryRunHashes: string[];
  challengeReceiptHashes: string[];
  allCanariesSr100: boolean;
  criticalFailures: number;
  issuedAt: string;
  expiresAt: string;
  receiptHash: string;
}

export interface SrDriftSentinelVerification {
  valid: boolean;
  errors: string[];
}

function assertSha(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function identity(receipt: Omit<SrDriftSentinelReceipt, 'receiptHash'>): unknown {
  return receipt;
}

export function createSrDriftSentinelReceipt(input: {
  sentinelId: string;
  suiteHash: string;
  requestedModel: string;
  canaryRuns: SrDriftCanaryRun[];
  issuedAt: string;
  expiresAt: string;
}): SrDriftSentinelReceipt {
  if (!input.sentinelId.trim() || !input.requestedModel.trim()) throw new Error('Drift sentinel requires stable ID and requested model.');
  assertSha(input.suiteHash, 'Drift-sentinel suiteHash');
  if (Number.isNaN(Date.parse(input.issuedAt)) || Number.isNaN(Date.parse(input.expiresAt))) throw new Error('Drift sentinel issuedAt/expiresAt must be valid date-times.');
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) throw new Error('Drift sentinel expiry must be later than issuance.');
  const runs = input.canaryRuns.filter((run) => run.requestedModel === input.requestedModel);
  if (runs.length === 0) throw new Error('Drift sentinel requires at least one canary run for the requested model.');
  if (runs.some((run) => run.pipelineCoverage !== 100)) throw new Error('Drift sentinel canaries must themselves have 100% pipeline coverage.');
  const actualModels = unique(runs.flatMap((run) => run.actualModels));
  if (actualModels.length !== 1) throw new Error('Drift sentinel requires one pinned actual model identity.');
  const providers = unique(runs.flatMap((run) => run.providers));
  const canaryCaseHashes = unique(runs.map((run) => run.caseHash));
  const canaryRunHashes = unique(runs.map((run) => run.runHash));
  const challengeReceiptHashes = unique(runs.map((run) => run.challengeReceiptHash ?? ''));
  if (canaryCaseHashes.length === 0 || canaryRunHashes.length === 0) throw new Error('Drift sentinel requires frozen canary case/run hashes.');
  if (canaryRunHashes.length !== runs.length) throw new Error('Drift sentinel cannot reuse the same canary run receipt more than once.');
  if (runs.some((run) => !run.challengeReceiptHash || !/^[a-f0-9]{64}$/i.test(run.challengeReceiptHash))) {
    throw new Error('Living-review drift sentinel requires every canary run to bind a counterfactual challenge receipt hash.');
  }
  if (challengeReceiptHashes.length === 0) throw new Error('Drift sentinel requires counterfactual challenge receipts.');
  const criticalFailures = runs.reduce((sum, run) => sum + run.criticalFailures.length, 0);
  const allCanariesSr100 = runs.every((run) => run.sr100);
  if (!allCanariesSr100) throw new Error('Drift sentinel cannot be minted because one or more canary runs were not SR100.');
  if (criticalFailures !== 0) throw new Error('Drift sentinel cannot be minted from canary runs with critical scientific failures.');
  const base: Omit<SrDriftSentinelReceipt, 'receiptHash'> = {
    schemaVersion: SR_DRIFT_SENTINEL_SCHEMA_VERSION,
    sentinelId: input.sentinelId.trim(),
    suiteHash: input.suiteHash.toLowerCase(),
    requestedModel: input.requestedModel.trim(),
    actualModel: actualModels[0]!,
    ...(providers.length === 1 ? { provider: providers[0] } : {}),
    canaryCaseHashes,
    canaryRunHashes,
    challengeReceiptHashes,
    allCanariesSr100,
    criticalFailures,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return { ...base, receiptHash: scientificContentHash(identity(base)) };
}

export function verifySrDriftSentinelReceipt(input: {
  receipt: SrDriftSentinelReceipt;
  expectedSuiteHash: string;
  requestedModel: string;
  now?: string;
}): SrDriftSentinelVerification {
  const errors: string[] = [];
  const { receipt } = input;
  const { receiptHash: _receiptHash, ...base } = receipt;
  if (receipt.schemaVersion !== SR_DRIFT_SENTINEL_SCHEMA_VERSION) errors.push('Unsupported drift-sentinel schema.');
  if (receipt.receiptHash !== scientificContentHash(identity(base))) errors.push('Drift-sentinel receipt hash mismatch.');
  if (receipt.suiteHash !== input.expectedSuiteHash.toLowerCase()) errors.push('Drift sentinel is bound to a different benchmark suite hash.');
  if (receipt.requestedModel !== input.requestedModel.trim()) errors.push('Drift sentinel is bound to a different requested model.');
  if (!receipt.actualModel.trim()) errors.push('Drift sentinel has no pinned actual model identity.');
  if (!receipt.allCanariesSr100) errors.push('One or more drift canaries were not SR100.');
  if (receipt.criticalFailures !== 0) errors.push('Drift sentinel contains critical scientific failures.');
  if (receipt.canaryCaseHashes.length === 0 || receipt.canaryRunHashes.length === 0) errors.push('Drift sentinel has no frozen canary receipts.');
  if (receipt.challengeReceiptHashes.length === 0 || receipt.challengeReceiptHashes.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))) {
    errors.push('Drift sentinel has no valid counterfactual challenge receipts.');
  }
  const now = Date.parse(input.now ?? new Date().toISOString());
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (Number.isNaN(now) || Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) errors.push('Drift sentinel has invalid temporal bounds.');
  else {
    if (now < issuedAt) errors.push('Drift sentinel is not valid yet.');
    if (now >= expiresAt) errors.push('Drift sentinel is expired.');
  }
  return { valid: errors.length === 0, errors };
}
