import { resolve } from 'node:path';
import { ExternalActionCoordinator } from './external-action-coordinator.js';
import { FileCheckpointStore } from './file-checkpoint-store.js';
import { FileExternalActionLedger } from './file-external-action-ledger.js';
import { prepareRecoveredPipelineState } from './recovery.js';
import type { PipelineState } from '../core/types.js';

export interface ReviewDurabilityRuntime {
  rootDir: string;
  checkpoints: FileCheckpointStore;
  externalActions: ExternalActionCoordinator;
  recover(state: PipelineState): Promise<PipelineState>;
}

export function createReviewDurabilityRuntime(rootDir: string): ReviewDurabilityRuntime {
  const resolved = resolve(rootDir);
  const checkpoints = new FileCheckpointStore({ rootDir: resolved });
  const ledger = new FileExternalActionLedger({ rootDir: resolved });
  const externalActions = new ExternalActionCoordinator(ledger);
  return {
    rootDir: resolved,
    checkpoints,
    externalActions,
    async recover(state) {
      const durable = await checkpoints.recover(state.runId);
      if (!durable) return structuredClone(state);
      return prepareRecoveredPipelineState(durable).state;
    },
  };
}
