import { createHash, createHmac } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';
import {
  validateSrBenchmarkCase,
  type SrBenchmarkCase,
  type SrBenchmarkStage,
  type SrBenchmarkTask,
} from './sr-reproduction-benchmark.js';

export const SR_COUNTERFACTUAL_CHALLENGE_SCHEMA_VERSION = 'medantir-sr-counterfactual-challenge/1' as const;

export interface SrCounterfactualJsonPatch {
  taskId: string;
  surface: 'input' | 'gold';
  path: string;
  value: unknown;
}

export interface SrCounterfactualVariant {
  variantId: string;
  patches: SrCounterfactualJsonPatch[];
  rationale: string;
}

export interface SrCounterfactualMutation {
  mutationId: string;
  variants: SrCounterfactualVariant[];
}

export interface SrCounterfactualChallengePlan {
  schemaVersion: typeof SR_COUNTERFACTUAL_CHALLENGE_SCHEMA_VERSION;
  planId: string;
  planVersion: string;
  mutations: SrCounterfactualMutation[];
}

export interface SrCounterfactualSelectionReceipt {
  schemaVersion: typeof SR_COUNTERFACTUAL_CHALLENGE_SCHEMA_VERSION;
  planId: string;
  planVersion: string;
  baseCaseId: string;
  baseCaseHash: string;
  challengeCaseId: string;
  challengeCaseHash: string;
  challengeRound: number;
  seedHash: string;
  selections: Array<{
    mutationId: string;
    variantId: string;
    affectedTaskIds: string[];
  }>;
  receiptHash: string;
}

export interface SrCounterfactualChallengeResult {
  caseDefinition: SrBenchmarkCase;
  receipt: SrCounterfactualSelectionReceipt;
}

function seedHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function normalizedPath(path: string): string[] {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('Counterfactual patch path cannot be empty.');
  if (parts.some((part) => part === '__proto__' || part === 'prototype' || part === 'constructor')) {
    throw new Error('Counterfactual patch path contains a forbidden prototype key.');
  }
  return parts;
}

function patchExisting(root: unknown, patch: SrCounterfactualJsonPatch, label: string): void {
  const parts = normalizedPath(patch.path);
  let current: unknown = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      const position = Number(part);
      if (position < 0 || position >= current.length) throw new Error(`${label} patch path '${patch.path}' does not exist.`);
      current = current[position];
    } else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      throw new Error(`${label} patch path '${patch.path}' does not exist.`);
    }
  }
  const leaf = parts[parts.length - 1]!;
  if (Array.isArray(current) && /^\d+$/.test(leaf)) {
    const position = Number(leaf);
    if (position < 0 || position >= current.length) throw new Error(`${label} patch path '${patch.path}' does not exist.`);
    current[position] = structuredClone(patch.value);
    return;
  }
  if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, leaf)) {
    throw new Error(`${label} patch path '${patch.path}' does not exist; counterfactual challenges may replace existing values only.`);
  }
  (current as Record<string, unknown>)[leaf] = structuredClone(patch.value);
}

function modelGoldReceiptHash(stage: SrBenchmarkStage, tasks: SrBenchmarkTask[]): string | undefined {
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

function validatePlan(plan: SrCounterfactualChallengePlan): void {
  if (plan.schemaVersion !== SR_COUNTERFACTUAL_CHALLENGE_SCHEMA_VERSION) throw new Error(`Unsupported counterfactual challenge schema '${plan.schemaVersion}'.`);
  if (!plan.planId.trim() || !plan.planVersion.trim()) throw new Error('Counterfactual challenge plan requires stable ID/version.');
  if (plan.mutations.length === 0) throw new Error('Counterfactual challenge plan requires at least one mutation.');
  const mutationIds = new Set<string>();
  for (const mutation of plan.mutations) {
    if (!mutation.mutationId.trim()) throw new Error('Counterfactual mutation requires a stable mutation ID.');
    if (mutationIds.has(mutation.mutationId)) throw new Error(`Counterfactual challenge duplicates mutation ID '${mutation.mutationId}'.`);
    mutationIds.add(mutation.mutationId);
    if (mutation.variants.length < 2) throw new Error(`Counterfactual mutation '${mutation.mutationId}' requires at least two variants.`);
    const variantIds = new Set<string>();
    for (const variant of mutation.variants) {
      if (!variant.variantId.trim() || !variant.rationale.trim()) throw new Error(`Counterfactual mutation '${mutation.mutationId}' has an invalid variant.`);
      if (variantIds.has(variant.variantId)) throw new Error(`Counterfactual mutation '${mutation.mutationId}' duplicates variant '${variant.variantId}'.`);
      variantIds.add(variant.variantId);
      if (variant.patches.length === 0) throw new Error(`Counterfactual variant '${variant.variantId}' is a no-op.`);
      const patchKeys = new Set<string>();
      for (const patch of variant.patches) {
        if (!patch.taskId.trim()) throw new Error(`Counterfactual variant '${variant.variantId}' has a patch without task ID.`);
        normalizedPath(patch.path);
        const key = `${patch.taskId}\u0000${patch.surface}\u0000${patch.path}`;
        if (patchKeys.has(key)) throw new Error(`Counterfactual variant '${variant.variantId}' patches '${patch.taskId}:${patch.surface}:${patch.path}' more than once.`);
        patchKeys.add(key);
      }
    }
  }
}

function selectedVariant(input: {
  seed: string;
  baseCaseHash: string;
  planId: string;
  mutation: SrCounterfactualMutation;
  challengeRound: number;
}): SrCounterfactualVariant {
  const key = `${input.baseCaseHash}\u0000${input.planId}\u0000${input.mutation.mutationId}\u0000${input.challengeRound}`;
  const digest = createHmac('sha256', input.seed).update(key, 'utf8').digest();
  const value = digest.readUInt32BE(0);
  return input.mutation.variants[value % input.mutation.variants.length]!;
}

export function createSrCounterfactualChallenge(input: {
  baseCase: SrBenchmarkCase;
  plan: SrCounterfactualChallengePlan;
  secretSeed: string;
  challengeRound: number;
}): SrCounterfactualChallengeResult {
  const baseCase = validateSrBenchmarkCase(input.baseCase);
  validatePlan(input.plan);
  if (input.secretSeed.length < 32) throw new Error('Counterfactual challenge secret seed must contain at least 32 characters.');
  if (!Number.isInteger(input.challengeRound) || input.challengeRound <= 0) throw new Error('Counterfactual challengeRound must be a positive integer.');
  const taskIds = new Set(baseCase.tasks.map((task) => task.id));
  const caseDefinition = structuredClone(baseCase);
  delete caseDefinition.caseHash;
  const selections: SrCounterfactualSelectionReceipt['selections'] = [];
  const goldMutatedStages = new Set<SrBenchmarkStage>();

  for (const mutation of input.plan.mutations) {
    const variant = selectedVariant({
      seed: input.secretSeed,
      baseCaseHash: baseCase.caseHash!,
      planId: input.plan.planId,
      mutation,
      challengeRound: input.challengeRound,
    });
    const affectedTaskIds = [...new Set(variant.patches.map((patch) => patch.taskId))].sort();
    for (const patch of variant.patches) {
      if (!taskIds.has(patch.taskId)) throw new Error(`Counterfactual mutation '${mutation.mutationId}' references unknown task '${patch.taskId}'.`);
      const baseTask = baseCase.tasks.find((item) => item.id === patch.taskId)!;
      const task = caseDefinition.tasks.find((item) => item.id === patch.taskId)!;
      if (patch.surface === 'gold') {
        const coverage = baseCase.stageGold[baseTask.stage];
        const baseModelGoldHash = modelGoldReceiptHash(baseTask.stage, baseCase.tasks);
        if (coverage.status !== 'complete' || !baseModelGoldHash || coverage.receiptHash !== baseModelGoldHash) {
          throw new Error(`Counterfactual mutation '${mutation.mutationId}' changes hidden gold for stage '${baseTask.stage}', but that stage is not model-gold-only. Engine-bound/partial stages require a dedicated challenge adapter.`);
        }
        goldMutatedStages.add(baseTask.stage);
        patchExisting(task.gold, patch, `${mutation.mutationId}:${variant.variantId}:${patch.taskId}:gold`);
      } else {
        patchExisting(task.input, patch, `${mutation.mutationId}:${variant.variantId}:${patch.taskId}:input`);
      }
    }
    selections.push({ mutationId: mutation.mutationId, variantId: variant.variantId, affectedTaskIds });
  }

  for (const stage of goldMutatedStages) {
    const challengedGoldHash = modelGoldReceiptHash(stage, caseDefinition.tasks);
    if (!challengedGoldHash) throw new Error(`Counterfactual challenge lost model gold for mutated stage '${stage}'.`);
    caseDefinition.stageGold[stage] = { status: 'complete', receiptHash: challengedGoldHash };
  }

  const challenged = validateSrBenchmarkCase(caseDefinition);
  if (challenged.caseHash === baseCase.caseHash) throw new Error('Counterfactual challenge did not change the benchmark case hash.');
  const challengeCaseId = `${baseCase.caseId}::CF${input.challengeRound}`;
  const { caseHash: _challengeHash, ...challengedWithoutHash } = challenged;
  const challengedWithId = validateSrBenchmarkCase({ ...challengedWithoutHash, caseId: challengeCaseId });
  const receiptBase = {
    schemaVersion: SR_COUNTERFACTUAL_CHALLENGE_SCHEMA_VERSION,
    planId: input.plan.planId.trim(),
    planVersion: input.plan.planVersion.trim(),
    baseCaseId: baseCase.caseId,
    baseCaseHash: baseCase.caseHash!,
    challengeCaseId,
    challengeCaseHash: challengedWithId.caseHash!,
    challengeRound: input.challengeRound,
    seedHash: seedHash(input.secretSeed),
    selections: selections.sort((a, b) => a.mutationId.localeCompare(b.mutationId)),
  };
  return {
    caseDefinition: challengedWithId,
    receipt: { ...receiptBase, receiptHash: scientificContentHash(receiptBase) },
  };
}
