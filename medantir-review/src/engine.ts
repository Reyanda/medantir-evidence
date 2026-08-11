import type { EvidenceRecord, PipelineState, ReviewRequest } from './core/types.js';
import type { HumanVerificationPort } from './core/ports.js';
import { createPipelineAgents } from './agents/pipeline-agents.js';
import {
  MockEvidenceSourceAdapter,
  MockFullTextRetrieval,
  MockHumanVerificationPort,
  MockPdfTextExtractor,
  MockProtocolRegistryAdapter,
  MockResearcherIdentityPort,
} from './adapters/mock.js';
import { DeterministicSearchStrategyTester } from './registration/search-testing.js';
import { PipelineOrchestrator } from './core/orchestrator.js';
import { createPipelineState } from './core/state.js';
import { createReviewProtocol } from './protocols/review-protocol.js';

export interface MockPipelineOptions {
  humanVerificationPort?: HumanVerificationPort | null;
}

function buildOrchestrator(
  request: ReviewRequest,
  recordsByDatabase: Record<string, EvidenceRecord[]>,
  humanVerificationPort: HumanVerificationPort | null,
): PipelineOrchestrator {
  const adapters = request.databases.map(
    (database) => new MockEvidenceSourceAdapter(database, recordsByDatabase[database] ?? []),
  );
  const common = {
    searchAdapters: adapters,
    fullTextRetrieval: new MockFullTextRetrieval(),
    pdfExtractor: new MockPdfTextExtractor(),
    identity: new MockResearcherIdentityPort(),
    searchTester: new DeterministicSearchStrategyTester(),
    registryAdapters: ['prospero', 'osf', 'zenodo', 'github'].map((target) => new MockProtocolRegistryAdapter(target as 'prospero' | 'osf' | 'zenodo' | 'github')),
  };
  const agents = createPipelineAgents(
    humanVerificationPort
      ? { ...common, humanVerification: humanVerificationPort }
      : common,
  );
  return new PipelineOrchestrator(agents);
}

export async function runMockPipeline(
  request: ReviewRequest,
  recordsByDatabase: Record<string, EvidenceRecord[]>,
  options: MockPipelineOptions = {},
): Promise<PipelineState> {
  const humanVerificationPort = options.humanVerificationPort === undefined
    ? new MockHumanVerificationPort()
    : options.humanVerificationPort;
  const orchestrator = buildOrchestrator(request, recordsByDatabase, humanVerificationPort);
  return orchestrator.run(createPipelineState(request), createReviewProtocol(request.reviewType));
}

export async function resumeMockPipeline(
  state: PipelineState,
  recordsByDatabase: Record<string, EvidenceRecord[]>,
  humanVerificationPort: HumanVerificationPort | null,
): Promise<PipelineState> {
  const orchestrator = buildOrchestrator(state.request, recordsByDatabase, humanVerificationPort);
  return orchestrator.run(state, createReviewProtocol(state.request.reviewType));
}
