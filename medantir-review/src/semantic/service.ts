import type { PipelineState } from '../core/types.js';
import { buildSemanticIndex, requestedSemanticEmbeddingProfileMatches, semanticEmbeddingProfileHash, semanticSourceStateHash, verifySemanticIndexSnapshot } from './index-builder.js';
import { searchSemanticIndex } from './search.js';
import type {
  ResolvedSemanticEmbeddingProfile,
  SemanticEmbeddingPort,
  SemanticIndexRepository,
  SemanticIndexServicePort,
  SemanticIndexSnapshot,
  SemanticSearchRequest,
  SemanticSearchResponse,
} from './types.js';

export class SemanticIndexService implements SemanticIndexServicePort {
  private readonly repository: SemanticIndexRepository;
  private readonly embeddingPort: SemanticEmbeddingPort;
  private readonly now: () => string;
  private readonly builds = new Map<string, Promise<SemanticIndexSnapshot>>();

  constructor(options: { repository: SemanticIndexRepository; embeddingPort: SemanticEmbeddingPort; now?: () => string }) {
    this.repository = options.repository;
    this.embeddingPort = options.embeddingPort;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private assertRun(runId: string, state: PipelineState): void {
    if (!runId.trim() || state.runId !== runId) throw new Error('Semantic index run ID does not match the pipeline state.');
  }

  private async buildLocked(runId: string, state: PipelineState, force: boolean): Promise<SemanticIndexSnapshot> {
    this.assertRun(runId, state);
    const current = this.builds.get(runId);
    if (current) return current;
    const build = (async () => {
      const existing = await this.repository.getLatest(runId);
      const profileMatches = Boolean(existing)
        && requestedSemanticEmbeddingProfileMatches(this.embeddingPort.profile, existing!.manifest.embedding);
      if (!force && existing
        && existing.sourceStateHash === semanticSourceStateHash(state)
        && profileMatches) {
        verifySemanticIndexSnapshot(existing);
        return existing;
      }
      // A forced rebuild must re-project units, clusters, and the manifest, but it
      // should not discard scientifically identical vectors. Re-embedding the whole
      // corpus is required only when the frozen embedding space changes.
      const previous = existing && profileMatches ? existing : undefined;
      const snapshot = await buildSemanticIndex(state, this.embeddingPort, this.now(), previous);
      await this.repository.put(snapshot);
      const persisted = await this.repository.getLatest(runId);
      if (!persisted) throw new Error('Semantic index repository did not return the persisted snapshot.');
      return persisted;
    })();
    this.builds.set(runId, build);
    try { return await build; } finally { if (this.builds.get(runId) === build) this.builds.delete(runId); }
  }

  getOrBuild(runId: string, state: PipelineState): Promise<SemanticIndexSnapshot> {
    return this.buildLocked(runId, state, false);
  }

  rebuild(runId: string, state: PipelineState): Promise<SemanticIndexSnapshot> {
    return this.buildLocked(runId, state, true);
  }

  async search(runId: string, state: PipelineState, request: SemanticSearchRequest): Promise<SemanticSearchResponse> {
    let snapshot = await this.getOrBuild(runId, state);
    try {
      return await searchSemanticIndex(snapshot, this.embeddingPort, request);
    } catch (error) {
      if (!(error instanceof Error) || !/profile drifted/.test(error.message)) throw error;
      snapshot = await this.rebuild(runId, state);
      return searchSemanticIndex(snapshot, this.embeddingPort, request);
    }
  }

  profileHash(): string {
    return semanticEmbeddingProfileHash(this.embeddingPort.profile);
  }
}
