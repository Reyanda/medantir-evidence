import type { PipelineState, StageName } from '../core/types.js';
import { createReviewProtocol } from './review-protocol.js';

interface LineageReceiptLike {
  key?: string;
  producerStage?: StageName;
}

export interface ReplayInvalidationReceipt {
  version: 1;
  fromStage: StageName;
  resetStages: StageName[];
  removedArtifacts: string[];
  preservedArtifacts: string[];
}

const SCIENTIFIC_CONTROL_ARTIFACTS = [
  'scientificRunManifest',
  'scientificRunSeal',
  'scientificArtifactLineage',
] as const;

/**
 * Invalidates authoritative state from a scientific replay boundary.
 *
 * The protocol owns the stage ordering and declared stage outputs. Extended
 * wrapper artifacts are additionally removed when the current scientific
 * lineage identifies their producer stage at or downstream of the replay
 * boundary. The append-only scientificRunLedger is deliberately retained as
 * historical truth about prior attempts.
 */
export function invalidatePipelineFromStage(
  state: PipelineState,
  fromStage: StageName,
  options: {
    extraArtifacts?: string[];
    preserveArtifacts?: string[];
  } = {},
): ReplayInvalidationReceipt {
  const protocol = createReviewProtocol(state.request.reviewType);
  const start = protocol.stages.findIndex((stage) => stage.stage === fromStage);
  if (start < 0) throw new Error(`Replay boundary ${fromStage} is not active for review type ${state.request.reviewType}`);

  const downstream = protocol.stages.slice(start);
  const resetStages = downstream.map((stage) => stage.stage);
  const stageIndex = new Map(protocol.stages.map((stage, index) => [stage.stage, index]));
  const preserve = new Set<string>([
    'scientificRunLedger',
    ...(options.preserveArtifacts ?? []),
  ]);
  const remove = new Set<string>();

  for (const stage of downstream) {
    for (const key of stage.producedArtifacts) remove.add(key);
  }

  const lineage = Array.isArray(state.artifacts.scientificArtifactLineage)
    ? state.artifacts.scientificArtifactLineage as LineageReceiptLike[]
    : [];
  for (const receipt of lineage) {
    if (!receipt.key || !receipt.producerStage) continue;
    const producer = stageIndex.get(receipt.producerStage);
    if (producer !== undefined && producer >= start) remove.add(receipt.key);
  }

  for (const key of options.extraArtifacts ?? []) remove.add(key);
  for (const key of SCIENTIFIC_CONTROL_ARTIFACTS) remove.add(key);
  for (const key of preserve) remove.delete(key);

  for (const key of remove) delete state.artifacts[key];
  for (const stage of downstream) {
    state.stages[stage.stage] = {
      name: stage.stage,
      status: 'pending',
      attempts: 0,
      errors: [],
    };
  }

  const receipt: ReplayInvalidationReceipt = {
    version: 1,
    fromStage,
    resetStages,
    removedArtifacts: [...remove].sort(),
    preservedArtifacts: [...preserve].sort(),
  };
  state.artifacts.lastReplayInvalidation = receipt;
  state.updatedAt = new Date().toISOString();
  return receipt;
}
