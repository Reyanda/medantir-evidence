import type { PipelineState, ReviewRequest, StageName, StageState } from './types.js';
import { id, nowIso } from './utils.js';

export const pipelineStages: StageName[] = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen',
  'fulltext-retrieve', 'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias',
  'synthesise', 'grade', 'report', 'human-verify',
];

export function createPipelineState(request: ReviewRequest): PipelineState {
  const timestamp = nowIso();
  const stageStates = pipelineStages.reduce<Record<StageName, StageState>>((accumulator, name) => {
    accumulator[name] = { name, status: 'pending', attempts: 0, errors: [] };
    return accumulator;
  }, {} as Record<StageName, StageState>);

  return {
    runId: id(),
    request,
    stages: stageStates,
    artifacts: {},
    audit: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
