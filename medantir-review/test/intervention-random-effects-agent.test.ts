import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { InterventionRandomEffectsSynthesisAgent } from '../src/synthesis/intervention-random-effects-agent.js';

class BaseSynthesis implements Agent {
  readonly stage = 'synthesise' as const;
  async execute(): Promise<AgentResult> {
    return {
      artifacts: {
        synthesis: {
          mode: 'meta-analysis',
          status: 'computed',
          includedStudies: 3,
          pooledEffect: 99,
          standardError: 99,
          heterogeneity: 99,
          narrative: 'Legacy result that must be replaced by production random-effects analysis.',
        },
      },
    };
  }
}

function study(id: string, effect: number, standardError: number, measure = 'RR', scale = 'log'): ExtractedStudy {
  return {
    studyId: id,
    reportIds: [`report-${id}`],
    design: 'randomised controlled trial',
    population: 'adults',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    outcomes: [{ name: 'mortality', effect, standardError, effectMeasure: measure, analysisScale: scale } as never],
    mechanisms: [], funding: 'Not reported', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [] },
    sourceQuotes: [],
  };
}

function context(studies: ExtractedStudy[]): AgentContext {
  const state = createPipelineState({
    ...fixtureRequest,
    question: { ...fixtureRequest.question, outcomes: ['mortality'], studyDesigns: ['randomised controlled trial'] },
  });
  state.artifacts.reviewPlan = { synthesisMode: 'meta-analysis' };
  state.artifacts.extractedStudies = studies;
  state.artifacts.estimandSynthesisConflicts = [];
  return { state, now: () => '2026-08-11T05:00:00.000Z' };
}

test('production wrapper replaces legacy pooled number with REML random-effects primary analysis', async () => {
  const agent = new InterventionRandomEffectsSynthesisAgent(new BaseSynthesis());
  const result = await agent.execute(context([
    study('s1', Math.log(0.8), 0.12),
    study('s2', Math.log(0.9), 0.15),
    study('s3', Math.log(0.7), 0.10),
    study('s4', Math.log(1.0), 0.20),
  ]));
  const synthesis = result.artifacts.synthesis as Record<string, unknown>;
  assert.equal(synthesis.status, 'computed');
  assert.equal(synthesis.tauEstimator, 'REML');
  assert.equal(synthesis.confidenceMethod, 'wald');
  assert.notEqual(synthesis.pooledEffect, 99);
  assert.match(String(synthesis.modelSpecification), /REML tau² primary/i);
  const analyses = result.artifacts.interventionRandomEffectsAnalyses as Array<{ sensitivity?: { sensitivity: unknown[] } }>;
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]?.sensitivity?.sensitivity.length, 5);
  assert.ok(Number(synthesis.displayPooledEffect) > 0);
});

test('mixed effect measures/scales are withheld rather than pooled', async () => {
  const result = await new InterventionRandomEffectsSynthesisAgent(new BaseSynthesis()).execute(context([
    study('s1', Math.log(0.8), 0.12, 'RR', 'log'),
    study('s2', -0.2, 0.10, 'RD', 'identity'),
  ]));
  const synthesis = result.artifacts.synthesis as { status: string; narrative: string };
  assert.equal(synthesis.status, 'narrative');
  assert.match(synthesis.narrative, /pooling was withheld/i);
  const analyses = result.artifacts.interventionRandomEffectsAnalyses as Array<{ status: string }>;
  assert.equal(analyses[0]?.status, 'incompatible-measures');
});

test('duplicate study identity is converted to dependence debt rather than double-counting', async () => {
  const one = study('same-study', Math.log(0.8), 0.12);
  const two = study('same-study', Math.log(0.9), 0.15);
  two.reportIds = ['another-report-same-participants'];
  const result = await new InterventionRandomEffectsSynthesisAgent(new BaseSynthesis()).execute(context([one, two]));
  const synthesis = result.artifacts.synthesis as { status: string };
  assert.equal(synthesis.status, 'narrative');
  const analyses = result.artifacts.interventionRandomEffectsAnalyses as Array<{ status: string; warning?: string }>;
  assert.equal(analyses[0]?.status, 'dependent-estimates');
  assert.match(analyses[0]?.warning ?? '', /Dependent\/duplicate study estimate/);
});

test('unresolved estimand conflict prevents random-effects promotion', async () => {
  const ctx = context([
    study('s1', Math.log(0.8), 0.12),
    study('s2', Math.log(0.9), 0.15),
  ]);
  ctx.state.artifacts.estimandSynthesisConflicts = [{ reason: 'timepoint mismatch' }];
  const result = await new InterventionRandomEffectsSynthesisAgent(new BaseSynthesis()).execute(ctx);
  assert.equal(result.artifacts.interventionRandomEffectsAnalyses, undefined);
  assert.ok(result.warnings?.some((warning) => /estimand compatibility conflicts/i.test(warning)));
});

test('method disagreement crossing the null is surfaced as an interpretation warning', async () => {
  const agent = new InterventionRandomEffectsSynthesisAgent(new BaseSynthesis());
  const result = await agent.execute(context([
    study('s1', 0.10, 0.10, 'MD', 'identity'),
    study('s2', 0.30, 0.15, 'MD', 'identity'),
    study('s3', -0.05, 0.08, 'MD', 'identity'),
    study('s4', 0.50, 0.20, 'MD', 'identity'),
    study('s5', 0.20, 0.12, 'MD', 'identity'),
  ]));
  const synthesis = result.artifacts.synthesis as { sensitivityAgreement: { confidenceIntervalsCrossNullDifferently: boolean } };
  assert.equal(typeof synthesis.sensitivityAgreement.confidenceIntervalsCrossNullDifferently, 'boolean');
  if (synthesis.sensitivityAgreement.confidenceIntervalsCrossNullDifferently) {
    assert.ok(result.warnings?.some((warning) => /method sensitivity changes/i.test(warning)));
  }
});
