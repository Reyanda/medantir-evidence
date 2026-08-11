import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { OutcomeAwareSynthesisAgent, type OutcomeSynthesisAnalysis } from '../src/synthesis/outcome-aware-agent.js';
import { ForestPlotReportAgent } from '../src/visualization/forest-plot-agent.js';
import type { Agent, AgentContext, ExtractedStudy, FinalReport, ReviewRequest, SynthesisResult } from '../src/core/types.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  autoApproveHumanGates: true,
  question: {
    title: 'Intervention review',
    objective: 'Test outcome-specific synthesis',
    population: 'adult patients',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    outcomes: ['Mortality', 'Recovery'],
  },
};

function study(id: string, mortality: number, recovery: number, se = 0.1): ExtractedStudy {
  return {
    studyId: id,
    reportIds: [`report-${id}`],
    design: 'randomised controlled trial',
    population: 'adult patients',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    outcomes: [
      { name: 'Mortality', effect: mortality, standardError: se },
      { name: 'Recovery', effect: recovery, standardError: se },
    ],
    mechanisms: [],
    funding: 'Not reported',
    rationale: 'rationale',
    objectives: ['objective'],
    resultsSummary: 'results',
    discussionSummary: 'discussion',
    limitations: ['limitations'],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [] },
    sourceQuotes: [],
  };
}

function ratioStudy(id: string, rr: number, lower: number, upper: number): ExtractedStudy {
  const value = study(id, Math.log(rr), 0);
  const standardError = (Math.log(upper) - Math.log(lower)) / (2 * 1.96);
  value.outcomes = [{
    name: 'Mortality',
    effect: Math.log(rr),
    standardError,
    effectMeasure: 'RR',
    analysisScale: 'log',
    reportedEffect: rr,
    reportedConfidenceInterval: [lower, upper],
  } as ExtractedStudy['outcomes'][number]];
  return value;
}

function context(studies: ExtractedStudy[]): AgentContext {
  const state = createPipelineState(request);
  state.artifacts.reviewPlan = { synthesisMode: 'meta-analysis' };
  state.artifacts.extractedStudies = studies;
  state.artifacts.riskOfBias = studies.map((item) => ({ studyId: item.studyId, tool: 'RoB 2', domains: [], overall: 'low' }));
  return { state, now: () => new Date().toISOString() };
}

function reportBase(): Agent {
  return {
    stage: 'report',
    async execute() {
      const finalReport: FinalReport = {
        title: 'Review', abstract: 'Abstract',
        prisma: { identified: 2, afterDeduplication: 2, tiabIncluded: 2, fullTextIncluded: 2 },
        sections: {}, appendices: {},
      };
      return { artifacts: { finalReport } };
    },
  };
}

test('outcome-aware synthesis never pools different outcome names into one summary', async () => {
  const ctx = context([
    study('a', -0.20, 0.40),
    study('b', -0.10, 0.30),
  ]);
  const base: Agent = {
    stage: 'synthesise',
    async execute() {
      const badMixedPool: SynthesisResult = {
        mode: 'meta-analysis', status: 'computed', includedStudies: 2,
        pooledEffect: 0.10, standardError: 0.05, heterogeneity: 0,
        narrative: 'generic mixed pool',
      };
      return { artifacts: { synthesis: badMixedPool } };
    },
  };

  const result = await new OutcomeAwareSynthesisAgent(base).execute(ctx);
  const analyses = result.artifacts.synthesisOutcomeAnalyses as OutcomeSynthesisAnalysis[];
  const synthesis = result.artifacts.synthesis as SynthesisResult;

  assert.equal(analyses.length, 2);
  assert.equal(analyses.find((analysis) => analysis.outcome === 'Mortality')?.summary?.k, 2);
  assert.equal(analyses.find((analysis) => analysis.outcome === 'Recovery')?.summary?.k, 2);
  assert.ok((synthesis.pooledEffect ?? 0) < 0, 'top-level primary outcome should be Mortality, not the mixed positive/negative pool');
  assert.match(synthesis.modelSpecification ?? '', /outcome-specific/i);
  assert.ok(result.warnings?.some((warning) => /cross-outcome pooling is prohibited/i.test(warning)));
});

test('duplicate numeric rows copied across outcome names are detected and forest plots are withheld', async () => {
  const duplicated = [
    study('a', -0.20, -0.20),
    study('b', -0.10, -0.10),
  ];
  const ctx = context(duplicated);
  const synthBase: Agent = {
    stage: 'synthesise',
    async execute() {
      return {
        artifacts: {
          synthesis: {
            mode: 'meta-analysis', status: 'computed', includedStudies: 2,
            pooledEffect: -0.15, standardError: 0.07, heterogeneity: 0, narrative: 'base',
          } satisfies SynthesisResult,
        },
      };
    },
  };
  const synthesisResult = await new OutcomeAwareSynthesisAgent(synthBase).execute(ctx);
  Object.assign(ctx.state.artifacts, synthesisResult.artifacts);

  const reportResult = await new ForestPlotReportAgent(reportBase()).execute(ctx);

  assert.deepEqual(reportResult.artifacts.forestPlots, []);
  assert.ok(reportResult.warnings?.some((warning) => /withheld/i.test(warning)));
});

test('valid distinct outcome rows generate auditable forest plots and report manifest entries', async () => {
  const ctx = context([
    study('a', -0.20, 0.40),
    study('b', -0.10, 0.30),
  ]);
  const synthBase: Agent = {
    stage: 'synthesise',
    async execute() {
      return {
        artifacts: {
          synthesis: {
            mode: 'meta-analysis', status: 'computed', includedStudies: 2,
            pooledEffect: -0.15, standardError: 0.07, heterogeneity: 0, narrative: 'base',
          } satisfies SynthesisResult,
        },
      };
    },
  };
  const synthesisResult = await new OutcomeAwareSynthesisAgent(synthBase).execute(ctx);
  Object.assign(ctx.state.artifacts, synthesisResult.artifacts);

  const reportResult = await new ForestPlotReportAgent(reportBase()).execute(ctx);
  const plots = reportResult.artifacts.forestPlots as Array<{ outcome: string; svg: string; analysisTable: unknown[] }>;
  const report = reportResult.artifacts.finalReport as FinalReport;

  assert.equal(plots.length, 2);
  assert.deepEqual(plots.map((plot) => plot.outcome), ['Mortality', 'Recovery']);
  assert.ok(plots.every((plot) => plot.svg.startsWith('<svg')));
  assert.ok(plots.every((plot) => plot.analysisTable.length === 2));
  assert.ok((report.appendices.visualizations as { forestPlots?: unknown[] }).forestPlots?.length === 2);
});

test('risk ratios pool on log scale and forest plots back-transform to ratio scale', async () => {
  const ctx = context([
    ratioStudy('a', 0.80, 0.64, 1.00),
    ratioStudy('b', 1.20, 0.90, 1.60),
  ]);
  const synthBase: Agent = {
    stage: 'synthesise',
    async execute() {
      return {
        artifacts: {
          synthesis: {
            mode: 'meta-analysis', status: 'computed', includedStudies: 2,
            pooledEffect: 0, standardError: 0.1, heterogeneity: 0, narrative: 'base',
          } satisfies SynthesisResult,
        },
      };
    },
  };

  const synthesisResult = await new OutcomeAwareSynthesisAgent(synthBase).execute(ctx);
  Object.assign(ctx.state.artifacts, synthesisResult.artifacts);
  const analyses = synthesisResult.artifacts.synthesisOutcomeAnalyses as OutcomeSynthesisAnalysis[];
  const primary = analyses.find((analysis) => analysis.outcome === 'Mortality');
  const synthesis = synthesisResult.artifacts.synthesis as SynthesisResult & {
    effectMeasure?: string;
    analysisScale?: string;
    displayPooledEffect?: number;
    displayConfidenceInterval?: [number, number];
  };

  assert.equal(primary?.effectMeasure, 'RR');
  assert.equal(primary?.analysisScale, 'log');
  assert.equal(primary?.displayTransform, 'exp');
  assert.equal(synthesis.effectMeasure, 'RR');
  assert.equal(synthesis.analysisScale, 'log');
  assert.ok((synthesis.displayPooledEffect ?? 0) > 0);
  assert.ok((synthesis.displayConfidenceInterval?.[0] ?? 0) > 0);
  assert.match(synthesis.modelSpecification ?? '', /risk ratio analysed on log scale/i);

  const reportResult = await new ForestPlotReportAgent(reportBase()).execute(ctx);
  const plots = reportResult.artifacts.forestPlots as Array<{
    outcome: string;
    transform: string;
    analysisNull: number;
    displayNull: number;
    measureLabel: string;
    summary: { effect: number; displayEffect: number };
  }>;
  assert.equal(plots.length, 1);
  assert.equal(plots[0]?.transform, 'exp');
  assert.equal(plots[0]?.analysisNull, 0);
  assert.equal(plots[0]?.displayNull, 1);
  assert.equal(plots[0]?.measureLabel, 'Risk ratio');
  assert.ok(Math.abs((plots[0]?.summary.displayEffect ?? 0) - Math.exp(plots[0]?.summary.effect ?? 0)) < 1e-12);
});
