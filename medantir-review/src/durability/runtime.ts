import { resolve } from 'node:path';
import { ExternalActionCoordinator } from './external-action-coordinator.js';
import { EvidenceOsFileCheckpointStore } from './evidence-os-checkpoint-store.js';
import { FileExternalActionLedger } from './file-external-action-ledger.js';
import { prepareRecoveredPipelineState } from './recovery.js';
import { FileEvidenceGraphRepository } from '../evidence-os/file-repository.js';
import type { PipelineState } from '../core/types.js';

export interface ReviewDurabilityRuntime {
  rootDir: string;
  checkpoints: EvidenceOsFileCheckpointStore;
  evidenceGraphs: FileEvidenceGraphRepository;
  externalActions: ExternalActionCoordinator;
  recover(state: PipelineState): Promise<PipelineState>;
}

export function createReviewDurabilityRuntime(rootDir: string): ReviewDurabilityRuntime {
  const resolved = resolve(rootDir);
  const evidenceGraphs = new FileEvidenceGraphRepository({ rootDir: resolved });
  const checkpoints = new EvidenceOsFileCheckpointStore({
    rootDir: resolved,
    evidenceGraphRepository: evidenceGraphs,
  });
  const ledger = new FileExternalActionLedger({ rootDir: resolved });
  const externalActions = new ExternalActionCoordinator(ledger);
  return {
    rootDir: resolved,
    checkpoints,
    evidenceGraphs,
    externalActions,
    async recover(state) {
      const durable = await checkpoints.recover(state.runId);
      if (!durable) return structuredClone(state);
      return prepareRecoveredPipelineState(durable).state;
    },
  };
}
