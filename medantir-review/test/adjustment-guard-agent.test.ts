import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { createAdjustmentIdentity } from '../src/synthesis/adjustment-compatibility.js';
import { AdjustmentCompatibilityGuardAgent } from '../src/synthesis/adjustment-guard-agent.js';

class NumericInner implements Agent {
  readonly stage = 'synthesise' as const;
  async execute(): Promise<AgentResult> {
    return {
      artifacts: {
        synthesis: {
          mode: 'meta-analysis', status: 'computed', includedStudies: 2,
          pooledEffect: 123, standardError: 1, heterogeneity: 0,
          narrative: 'Transient numeric result.',
        },
        interventionRandomEffectsAnalyses: [{ outcome: 'mortality', status: 'computed' }],
      },
    };
  }
}

const evidence = (id: string) => [`source-${id}`];
const crude = createAdjustmentIdentity({
  status: 'unadjusted', estimand: 'marginal', sourceEvidenceIds: evidence('crude'), rationale: 'Unadjusted randomized contrast.',
});
const adjusted = createAdjustmentIdentity({
  status: 'adjusted', estimand: 'conditional', covariates: ['age', 'sex'], sourceEvidenceIds: evidence('adjusted'), rationale: 'Adjusted model.',
});

function study(id: string, adjustmentIdentity?: typeof crude): ExtractedStudy {
  return {
    studyId: id, reportIds: [`report-${id}`], design: 'randomised controlled trial', population: 'adults',
    interventionOrExposure: 'treatment', comparator: 'control',
    outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1, ...(adjustmentIdentity ? { adjustmentIdentity } : {}) } as never],
    mechanisms: [], funding: 'none', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] }, fieldEvidence: { outcomes: [] }, sourceQuotes: [],
  };
}

function context(studies: ExtractedStudy[]): AgentContext {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.extractedStudies = studies;
  return { state, now: () => '2026-08-11T05:00:00.000Z' };
}

test('missing adjustment metadata blocks authoritative pooling as unclassified debt', async () => {
  const result = await new AdjustmentCompatibilityGuardAgent(new NumericInner()).execute(context([study('s1'), study('s2')]));
  const synthesis = result.artifacts.synthesis as { status: string; narrative: string };
  assert.equal(synthesis.status, 'narrative');
  assert.match(synthesis.narrative, /adjustment-set\/estimand compatibility/i);
  assert.equal(result.artifacts.interventionRandomEffectsAnalyses, undefined);
  const conflicts = result.artifacts.adjustmentSynthesisConflicts as Array<{ status: string }>;
  assert.equal(conflicts[0]?.status, 'unclassified');
});

test('adjusted plus crude estimates block pooling and remove transient numeric artifacts', async () => {
  const result = await new AdjustmentCompatibilityGuardAgent(new NumericInner()).execute(context([study('s1', crude), study('s2', adjusted)]));
  assert.equal((result.artifacts.synthesis as { status: string }).status, 'narrative');
  assert.equal(result.artifacts.interventionRandomEffectsAnalyses, undefined);
  assert.ok(result.warnings?.some((warning) => /Adjusted and unadjusted/i.test(warning)));
});

test('homogeneous sourced adjustment identity allows inner synthesis artifact to survive', async () => {
  const result = await new AdjustmentCompatibilityGuardAgent(new NumericInner()).execute(context([study('s1', crude), study('s2', crude)]));
  assert.equal((result.artifacts.synthesis as { status: string }).status, 'computed');
  assert.ok(Array.isArray(result.artifacts.interventionRandomEffectsAnalyses));
  const receipts = result.artifacts.adjustmentCompatibilityReceipts as Array<{ status: string }>;
  assert.equal(receipts[0]?.status, 'compatible');
});
