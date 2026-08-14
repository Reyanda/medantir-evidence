import type { PipelineState, StageName } from '../core/types.js';
import {
  FileCheckpointStore,
  type FileCheckpointStoreOptions,
} from './file-checkpoint-store.js';
import { FileEvidenceGraphRepository } from '../evidence-os/file-repository.js';
import { projectPipelineToEvidenceGraph } from '../evidence-os/projector.js';

export interface EvidenceOsCheckpointStoreOptions extends FileCheckpointStoreOptions {
  evidenceGraphRepository?: FileEvidenceGraphRepository;
}

/**
 * Adds immutable, cumulative Evidence OS graph snapshots to each durable pipeline
 * checkpoint while retaining the original hash-chained state journal as the
 * authoritative recovery source.
 */
export class EvidenceOsFileCheckpointStore extends FileCheckpointStore {
  readonly evidenceGraphs: FileEvidenceGraphRepository;

  constructor(options: EvidenceOsCheckpointStoreOptions) {
    super(options);
    this.evidenceGraphs = options.evidenceGraphRepository
      ?? new FileEvidenceGraphRepository({ rootDir: options.rootDir });
  }

  override async checkpoint(input: {
    state: PipelineState;
    stage: StageName;
    event: string;
    attempt: number;
    recordedAt: string;
  }): Promise<void> {
    const previous = await this.evidenceGraphs.getGraph(input.state.runId);
    const graph = projectPipelineToEvidenceGraph(input.state, input.recordedAt, previous ?? undefined);

    // Immutable objects and the graph body are written first. If the authoritative
    // checkpoint fails, these are harmless unreferenced content-addressed objects.
    await this.evidenceGraphs.putGraph(input.state.runId, graph);
    await super.checkpoint(input);

    const events = await this.listEvents(input.state.runId);
    const latest = events.at(-1);
    if (!latest
      || latest.stage !== input.stage
      || latest.event !== input.event
      || latest.attempt !== input.attempt) {
      throw new Error(`Evidence OS could not reconcile ${input.stage}/${input.event} to the latest durable checkpoint.`);
    }
    await this.evidenceGraphs.recordCheckpoint({
      runId: latest.runId,
      sequence: latest.sequence,
      stage: latest.stage,
      event: latest.event,
      attempt: latest.attempt,
      recordedAt: latest.recordedAt,
      eventHash: latest.eventHash,
      stateHash: latest.stateHash,
      graph,
    });
  }

  override async recover(runId: string): Promise<PipelineState | null> {
    const state = await super.recover(runId);
    if (!state) return null;
    const events = await this.listEvents(runId);
    const latest = events.at(-1);
    if (!latest) return state;

    const receipt = await this.evidenceGraphs.latestReceipt(runId);
    const persistedGraph = receipt ? await this.evidenceGraphs.getGraph(runId, receipt.graphHash) : null;
    if (receipt
      && persistedGraph
      && receipt.sequence === latest.sequence
      && receipt.eventHash === latest.eventHash
      && receipt.stateHash === latest.stateHash) {
      return state;
    }

    const previous = await this.evidenceGraphs.getGraph(runId);
    const repaired = projectPipelineToEvidenceGraph(state, latest.recordedAt, previous ?? undefined);
    await this.evidenceGraphs.putGraph(runId, repaired);
    await this.evidenceGraphs.recordCheckpoint({
      runId,
      sequence: latest.sequence,
      stage: latest.stage,
      event: latest.event,
      attempt: latest.attempt,
      recordedAt: latest.recordedAt,
      eventHash: latest.eventHash,
      stateHash: latest.stateHash,
      graph: repaired,
    });
    return state;
  }
}
