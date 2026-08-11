import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  createProductionInterventionExtractionAgent,
  createProductionInterventionSynthesisAgent,
} from '../src/synthesis/intervention-production-agents.js';

class BaseExtraction implements Agent {
  readonly stage = 'extract' as const;
  async execute(): Promise<AgentResult> {
    const study: ExtractedStudy = {
      studyId: 's1', reportIds: ['r1'], design: 'randomised controlled trial', population: 'adults',
      interventionOrExposure: 'treatment', comparator: 'control',
      outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1 }],
      mechanisms: [], funding: 'none', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
      sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] }, fieldEvidence: { outcomes: [] }, sourceQuotes: [],
    };
    return { artifacts: { extractedStudies: [study] } };
  }
}

class BaseSynthesis implements Agent {
  readonly stage = 'synthesise' as const;
  async execute(): Promise<AgentResult> {
    return {
      artifacts: {
        synthesis: { mode: 'meta-analysis', status: 'computed', includedStudies: 2, pooledEffect: 10, standardError: 1, heterogeneity: 0, narrative: 'base' },
      },
    };
  }
}

test('production extraction adds adjustment identity after inner extraction', async () => {
  const state = createPipelineState(fixtureRequest);
  const result = await createProductionInterventionExtractionAgent(new BaseExtraction()).execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
  assert.ok(result.artifacts.adjustmentIdentityLedger);
  const studies = result.artifacts.extractedStudies as ExtractedStudy[];
  const outcome = studies[0]?.outcomes[0] as unknown as { adjustmentIdentity?: { status: string } };
  assert.equal(outcome.adjustmentIdentity?.status, 'unknown');
});

test('production synthesis keeps adjustment compatibility as outermost authority gate', async () => {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, outcomes: ['mortality'] },
  });
  state.artifacts.reviewPlan = { synthesisMode: 'meta-analysis' };
  state.artifacts.estimandSynthesisConflicts = [];
  state.artifacts.extractedStudies = [
    {
      studyId: 's1', reportIds: ['r1'], design: 'randomised controlled trial', population: 'adults', interventionOrExposure: 'treatment', comparator: 'control',
      outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1 }], mechanisms: [], funding: 'none', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
      sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] }, fieldEvidence: { outcomes: [] }, sourceQuotes: [],
    },
    {
      studyId: 's2', reportIds: ['r2'], design: 'randomised controlled trial', population: 'adults', interventionOrExposure: 'treatment', comparator: 'control',
      outcomes: [{ name: 'mortality', effect: -0.1, standardError: 0.1 }], mechanisms: [], funding: 'none', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
      sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] }, fieldEvidence: { outcomes: [] }, sourceQuotes: [],
    },
  ] as ExtractedStudy[];
  const result = await createProductionInterventionSynthesisAgent(new BaseSynthesis()).execute({ state, now: () => '2026-08-11T05:00:00.000Z' } as AgentContext);
  assert.equal((result.artifacts.synthesis as { status: string }).status, 'narrative');
  assert.equal(result.artifacts.interventionRandomEffectsAnalyses, undefined);
  assert.ok(Array.isArray(result.artifacts.adjustmentSynthesisConflicts));
});

test('composition factories refuse agents from the wrong stage', () => {
  assert.throws(() => createProductionInterventionExtractionAgent(new BaseSynthesis()), /extract-stage/);
  assert.throws(() => createProductionInterventionSynthesisAgent(new BaseExtraction()), /synthesise-stage/);
});
