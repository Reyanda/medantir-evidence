import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../core/types.js';
import type { QuantitativeAnalysisScale, QuantitativeEffectMeasure } from '../agents/provenance-first-extraction.js';
import type { AnalysisEstimate } from './inverse-variance.js';
import {
  analyseRandomEffectsSensitivity,
  type RandomEffectsSensitivitySet,
} from './random-effects.js';

interface TypedOutcome extends ExtractedStudy['outcomes'][number] {
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
}

export interface InterventionOutcomeRandomEffectsAnalysis {
  outcome: string;
  status: 'computed' | 'insufficient-estimates' | 'incompatible-measures' | 'dependent-estimates';
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale: QuantitativeAnalysisScale;
  displayTransform: 'identity' | 'exp';
  studyCount: number;
  estimateCount: number;
  sensitivity?: RandomEffectsSensitivitySet;
  warning?: string;
}

function display(value: number, scale: QuantitativeAnalysisScale): number {
  return scale === 'log' ? Math.exp(value) : value;
}

function effectLabel(measure: QuantitativeEffectMeasure | undefined): string {
  const labels: Partial<Record<QuantitativeEffectMeasure, string>> = {
    RR: 'risk ratio', OR: 'odds ratio', HR: 'hazard ratio',
    MD: 'mean difference', SMD: 'standardised mean difference', RD: 'risk difference',
  };
  return measure ? labels[measure] ?? measure : 'effect estimate';
}

function groups(studies: ExtractedStudy[]): Map<string, Array<AnalysisEstimate & { effectMeasure?: QuantitativeEffectMeasure; analysisScale?: QuantitativeAnalysisScale }>> {
  const output = new Map<string, Array<AnalysisEstimate & { effectMeasure?: QuantitativeEffectMeasure; analysisScale?: QuantitativeAnalysisScale }>>();
  for (const study of studies) {
    for (const raw of study.outcomes) {
      const outcome = raw as TypedOutcome;
      if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !(outcome.standardError > 0)) continue;
      const current = output.get(outcome.name) ?? [];
      current.push({
        studyId: study.studyId,
        label: study.reportIds[0] ?? study.studyId,
        outcome: outcome.name,
        effect: outcome.effect,
        standardError: outcome.standardError,
        provenanceIds: [study.studyId, ...study.reportIds, ...(study.fieldEvidence.outcomes ?? []).map((excerpt) => excerpt.id)],
        ...(outcome.effectMeasure ? { effectMeasure: outcome.effectMeasure } : {}),
        ...(outcome.analysisScale ? { analysisScale: outcome.analysisScale } : {}),
      });
      output.set(outcome.name, current);
    }
  }
  return output;
}

function semantics(estimates: Array<AnalysisEstimate & { effectMeasure?: QuantitativeEffectMeasure; analysisScale?: QuantitativeAnalysisScale }>) {
  const measures = [...new Set(estimates.map((estimate) => estimate.effectMeasure).filter((value): value is QuantitativeEffectMeasure => Boolean(value)))];
  const scales = [...new Set(estimates.map((estimate) => estimate.analysisScale ?? 'identity'))];
  const typed = estimates.filter((estimate) => Boolean(estimate.effectMeasure)).length;
  return {
    compatible: (typed === 0 || typed === estimates.length) && measures.length <= 1 && scales.length === 1,
    ...(measures.length === 1 ? { effectMeasure: measures[0]! } : {}),
    analysisScale: scales.length === 1 ? scales[0]! : 'identity' as QuantitativeAnalysisScale,
  };
}

/**
 * Production intervention synthesis layer.
 *
 * The inner synthesis/estimand guards run first. Only semantically compatible,
 * provenance-bearing independent study estimates are then promoted to a random-
 * effects analysis. REML + Wald is the primary calculation; REML/PM/DL ×
 * Wald/HKSJ are all retained as sensitivity analyses.
 */
export class InterventionRandomEffectsSynthesisAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    const plan = (result.artifacts.reviewPlan ?? context.state.artifacts.reviewPlan) as { synthesisMode?: string } | undefined;
    if (plan?.synthesisMode !== 'meta-analysis') return result;

    const conflicts = (result.artifacts.estimandSynthesisConflicts ?? context.state.artifacts.estimandSynthesisConflicts) as unknown[] | undefined;
    if ((conflicts?.length ?? 0) > 0) {
      return {
        ...result,
        warnings: [...(result.warnings ?? []), 'Random-effects synthesis withheld because unresolved estimand compatibility conflicts remain.'],
      };
    }

    const studies = context.state.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    if (!studies) return result;
    const analyses: InterventionOutcomeRandomEffectsAnalysis[] = [];

    for (const [outcome, estimates] of groups(studies)) {
      const semantic = semantics(estimates);
      if (!semantic.compatible) {
        analyses.push({
          outcome,
          status: 'incompatible-measures',
          studyCount: new Set(estimates.map((estimate) => estimate.studyId)).size,
          estimateCount: estimates.length,
          analysisScale: semantic.analysisScale,
          displayTransform: semantic.analysisScale === 'log' ? 'exp' : 'identity',
          ...(semantic.effectMeasure ? { effectMeasure: semantic.effectMeasure } : {}),
          warning: 'Effect measures/scales are incompatible or only partly typed; pooling withheld.',
        });
        continue;
      }
      if (estimates.length < 2) {
        analyses.push({
          outcome,
          status: 'insufficient-estimates',
          studyCount: new Set(estimates.map((estimate) => estimate.studyId)).size,
          estimateCount: estimates.length,
          analysisScale: semantic.analysisScale,
          displayTransform: semantic.analysisScale === 'log' ? 'exp' : 'identity',
          ...(semantic.effectMeasure ? { effectMeasure: semantic.effectMeasure } : {}),
          warning: 'At least two independent estimates are required for pooling.',
        });
        continue;
      }
      try {
        const sensitivity = analyseRandomEffectsSensitivity(estimates);
        analyses.push({
          outcome,
          status: 'computed',
          studyCount: new Set(estimates.map((estimate) => estimate.studyId)).size,
          estimateCount: estimates.length,
          analysisScale: semantic.analysisScale,
          displayTransform: semantic.analysisScale === 'log' ? 'exp' : 'identity',
          ...(semantic.effectMeasure ? { effectMeasure: semantic.effectMeasure } : {}),
          sensitivity,
        });
      } catch (error) {
        analyses.push({
          outcome,
          status: 'dependent-estimates',
          studyCount: new Set(estimates.map((estimate) => estimate.studyId)).size,
          estimateCount: estimates.length,
          analysisScale: semantic.analysisScale,
          displayTransform: semantic.analysisScale === 'log' ? 'exp' : 'identity',
          ...(semantic.effectMeasure ? { effectMeasure: semantic.effectMeasure } : {}),
          warning: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const requestedPrimary = context.state.request.question.outcomes?.[0];
    const primary = analyses.find((analysis) => analysis.outcome === requestedPrimary && analysis.status === 'computed')
      ?? analyses.find((analysis) => analysis.status === 'computed')
      ?? null;
    const warnings = [
      ...(result.warnings ?? []),
      ...analyses.filter((analysis) => analysis.warning).map((analysis) => `${analysis.outcome}: ${analysis.warning}`),
    ];
    if (!primary?.sensitivity) {
      const base = result.artifacts.synthesis as SynthesisResult | undefined;
      const synthesis: SynthesisResult = {
        mode: 'meta-analysis',
        status: 'narrative',
        includedStudies: studies.length,
        narrative: 'Random-effects pooling was withheld because no outcome had at least two independent, semantically compatible quantitative estimates.',
        capabilityWarnings: [...(base?.capabilityWarnings ?? []), ...warnings],
        ...(base?.evidence ? { evidence: base.evidence } : {}),
      };
      return {
        ...result,
        artifacts: { ...result.artifacts, synthesis, interventionRandomEffectsAnalyses: analyses },
        warnings,
      };
    }

    const model = primary.sensitivity.primary;
    const label = effectLabel(primary.effectMeasure);
    const displayEffect = display(model.pooledEffect, primary.analysisScale);
    const displayCi: [number, number] = [
      display(model.confidenceInterval[0], primary.analysisScale),
      display(model.confidenceInterval[1], primary.analysisScale),
    ];
    const displayPi = model.predictionInterval
      ? [display(model.predictionInterval[0], primary.analysisScale), display(model.predictionInterval[1], primary.analysisScale)] as [number, number]
      : undefined;
    const methodWarning = primary.sensitivity.methodAgreement.confidenceIntervalsCrossNullDifferently
      ? 'Method sensitivity changes whether the 95% confidence interval crosses the null; interpretation requires explicit method-sensitivity discussion.'
      : null;
    if (methodWarning) warnings.push(methodWarning);

    const synthesis = {
      ...(result.artifacts.synthesis as SynthesisResult | undefined),
      mode: 'meta-analysis',
      status: 'computed',
      modelSpecification: 'outcome-specific random-effects inverse-variance model; REML tau² primary; Wald 95% CI primary; PM/DL and HKSJ sensitivity analyses; no cross-outcome/cross-scale/dependent-study pooling',
      includedStudies: model.k,
      pooledEffect: model.pooledEffect,
      standardError: model.pooledStandardError,
      heterogeneity: model.qBasedI2,
      narrative: `Random-effects synthesis for ${primary.outcome}: ${model.k} independent studies, pooled ${label}=${displayEffect.toPrecision(4)} [95% CI ${displayCi[0].toPrecision(4)}, ${displayCi[1].toPrecision(4)}], tau²=${model.tauSquared.toPrecision(4)}, I²=${model.qBasedI2.toFixed(1)}%${displayPi ? `, 95% prediction interval ${displayPi[0].toPrecision(4)} to ${displayPi[1].toPrecision(4)}` : ''}.`,
      ...(primary.effectMeasure ? { effectMeasure: primary.effectMeasure } : {}),
      analysisScale: primary.analysisScale,
      displayPooledEffect: displayEffect,
      displayConfidenceInterval: displayCi,
      ...(displayPi ? { displayPredictionInterval: displayPi } : {}),
      tauSquared: model.tauSquared,
      tauEstimator: model.tauEstimator,
      confidenceMethod: model.confidenceMethod,
      predictionInterval: model.predictionInterval,
      sensitivityAgreement: primary.sensitivity.methodAgreement,
    } as SynthesisResult & Record<string, unknown>;

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        synthesis,
        interventionRandomEffectsAnalyses: analyses,
      },
      warnings,
    };
  }
}
