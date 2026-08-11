import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../core/types.js';
import type { QuantitativeAnalysisScale, QuantitativeEffectMeasure } from '../agents/provenance-first-extraction.js';
import {
  analyseInverseVariance,
  groupAnalysisEstimatesByOutcome,
  type AnalysisEstimate,
  type InverseVarianceSummary,
} from './inverse-variance.js';

type MeasureAwareOutcome = ExtractedStudy['outcomes'][number] & {
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
  reportedEffect?: number;
  reportedConfidenceInterval?: [number, number];
};

type MeasureAwareEstimate = AnalysisEstimate & {
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
};

export interface OutcomeSynthesisAnalysis {
  outcome: string;
  summary: InverseVarianceSummary | null;
  numericEstimateCount: number;
  studyCount: number;
  status: 'computed' | 'insufficient-estimates' | 'incompatible-measures';
  rowSignature: string;
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale: QuantitativeAnalysisScale;
  displayTransform: 'identity' | 'exp';
}

function normalizedSignature(estimates: MeasureAwareEstimate[]): string {
  return estimates
    .map((estimate) => [
      estimate.studyId,
      estimate.effect.toPrecision(12),
      estimate.standardError.toPrecision(12),
      estimate.effectMeasure ?? 'untyped',
      estimate.analysisScale ?? 'identity',
    ].join('|'))
    .sort()
    .join('||');
}

function collectEstimates(studies: ExtractedStudy[]): MeasureAwareEstimate[] {
  return studies.flatMap((study) => study.outcomes.flatMap((rawOutcome) => {
    const outcome = rawOutcome as MeasureAwareOutcome;
    if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !(outcome.standardError > 0)) return [];
    return [{
      studyId: study.studyId,
      label: study.reportIds[0] ?? study.studyId,
      outcome: outcome.name,
      effect: outcome.effect,
      standardError: outcome.standardError,
      ...(outcome.effectMeasure ? { effectMeasure: outcome.effectMeasure } : {}),
      ...(outcome.analysisScale ? { analysisScale: outcome.analysisScale } : {}),
      provenanceIds: [
        ...study.reportIds,
        ...(study.fieldEvidence.outcomes ?? []).map((excerpt) => excerpt.id),
      ],
    } satisfies MeasureAwareEstimate];
  }));
}

function groupSemantics(estimates: MeasureAwareEstimate[]): {
  compatible: boolean;
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale: QuantitativeAnalysisScale;
} {
  const measures = [...new Set(estimates.map((estimate) => estimate.effectMeasure).filter((value): value is QuantitativeEffectMeasure => Boolean(value)))];
  const scales = [...new Set(estimates.map((estimate) => estimate.analysisScale ?? 'identity'))];
  const typedCount = estimates.filter((estimate) => Boolean(estimate.effectMeasure)).length;
  const partlyTyped = typedCount > 0 && typedCount < estimates.length;
  const compatible = !partlyTyped && measures.length <= 1 && scales.length === 1;
  return {
    compatible,
    ...(measures.length === 1 ? { effectMeasure: measures[0]! } : {}),
    analysisScale: scales.length === 1 ? scales[0]! : 'identity',
  };
}

function displayValue(value: number, scale: QuantitativeAnalysisScale): number {
  return scale === 'log' ? Math.exp(value) : value;
}

function measureLabel(measure: QuantitativeEffectMeasure | undefined): string {
  if (!measure) return 'effect estimate';
  const labels: Record<QuantitativeEffectMeasure, string> = {
    RR: 'risk ratio',
    OR: 'odds ratio',
    HR: 'hazard ratio',
    MD: 'mean difference',
    SMD: 'standardised mean difference',
    RD: 'risk difference',
  };
  return labels[measure];
}

function withheldSynthesis(base: SynthesisResult, studies: ExtractedStudy[], warnings: string[]): SynthesisResult {
  return {
    mode: base.mode,
    status: 'narrative',
    includedStudies: studies.length,
    narrative: 'Quantitative pooling was withheld because no outcome-specific set of at least two semantically compatible estimates passed the measure/scale gate.',
    capabilityWarnings: [
      ...(base.capabilityWarnings ?? []),
      ...warnings.filter((warning) => /not pooled|incompatible|insufficient|cross-scale/i.test(warning)),
    ],
    ...(base.evidence ? { evidence: base.evidence } : {}),
  };
}

/**
 * Guards the generic synthesis agent against cross-outcome and cross-scale pooling.
 *
 * Ratio measures enter this layer as log effects with log-scale standard errors;
 * difference measures remain on the identity scale. Outcome streams with mixed
 * measures, mixed scales, or only partly typed estimates are not pooled. When
 * this gate withholds pooling, any numeric result produced by the older generic
 * base agent is discarded rather than allowed to leak into reports or figures.
 */
export class OutcomeAwareSynthesisAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const baseResult = await this.base.execute(context);
    const baseSynthesis = baseResult.artifacts.synthesis as SynthesisResult | undefined;
    const plan = context.state.artifacts.reviewPlan as { synthesisMode?: string } | undefined;
    const studies = context.state.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    if (!baseSynthesis || !studies || plan?.synthesisMode !== 'meta-analysis') return baseResult;

    const groups = groupAnalysisEstimatesByOutcome(collectEstimates(studies));
    const analyses: OutcomeSynthesisAnalysis[] = [...groups.entries()].map(([outcome, rawEstimates]) => {
      const estimates = rawEstimates as MeasureAwareEstimate[];
      const semantics = groupSemantics(estimates);
      const canCompute = semantics.compatible && estimates.length >= 2;
      return {
        outcome,
        summary: canCompute ? analyseInverseVariance(estimates, outcome) : null,
        numericEstimateCount: estimates.length,
        studyCount: new Set(estimates.map((estimate) => estimate.studyId)).size,
        status: !semantics.compatible
          ? 'incompatible-measures'
          : estimates.length >= 2 ? 'computed' : 'insufficient-estimates',
        rowSignature: normalizedSignature(estimates),
        ...(semantics.effectMeasure ? { effectMeasure: semantics.effectMeasure } : {}),
        analysisScale: semantics.analysisScale,
        displayTransform: semantics.analysisScale === 'log' ? 'exp' : 'identity',
      };
    });

    const requestedPrimary = context.state.request.question.outcomes?.[0];
    const primary = analyses.find((analysis) => analysis.outcome === requestedPrimary && analysis.summary)
      ?? analyses.find((analysis) => analysis.summary)
      ?? null;

    const warnings = [...(baseResult.warnings ?? [])];
    if (analyses.length > 1) {
      warnings.push(`Outcome-aware synthesis separated ${analyses.length} outcome streams; cross-outcome pooling is prohibited.`);
    }
    for (const analysis of analyses.filter((candidate) => candidate.status === 'incompatible-measures')) {
      warnings.push(`Outcome '${analysis.outcome}' was not pooled because its numeric rows mix effect measures, analysis scales, or typed and untyped estimates.`);
    }
    for (const analysis of analyses.filter((candidate) => candidate.status === 'insufficient-estimates')) {
      warnings.push(`Outcome '${analysis.outcome}' has only ${analysis.numericEstimateCount} provenance-eligible numeric estimate(s); at least two are required for pooling.`);
    }

    const repeatedSignatures = new Map<string, string[]>();
    for (const analysis of analyses) {
      const outcomes = repeatedSignatures.get(analysis.rowSignature) ?? [];
      outcomes.push(analysis.outcome);
      repeatedSignatures.set(analysis.rowSignature, outcomes);
    }
    const duplicateGroups = [...repeatedSignatures.values()].filter((outcomes) => outcomes.length > 1);
    if (duplicateGroups.length > 0) {
      warnings.push(
        `Detected numerically identical study-level estimate rows across distinct outcomes (${duplicateGroups.map((group) => group.join(' / ')).join('; ')}). `
        + 'This can indicate pseudo-estimates copied across outcomes; downstream forest-plot generation will suppress duplicate outcome figures pending row-level extraction verification.',
      );
    }

    if (baseSynthesis.humanOverride) {
      warnings.push('Top-level synthesis has a human override; computed outcome-specific analyses are retained for audit but do not replace the human-overridden summary.');
      return {
        ...baseResult,
        artifacts: { ...baseResult.artifacts, synthesisOutcomeAnalyses: analyses },
        warnings,
      };
    }

    if (!primary?.summary) {
      const synthesis = withheldSynthesis(baseSynthesis, studies, warnings);
      return {
        ...baseResult,
        artifacts: {
          ...baseResult.artifacts,
          synthesis,
          synthesisOutcomeAnalyses: analyses,
        },
        warnings,
      };
    }

    const summary = primary.summary;
    const displayPooledEffect = displayValue(summary.pooledEffect, primary.analysisScale);
    const displayConfidenceInterval: [number, number] = [
      displayValue(summary.ciLow, primary.analysisScale),
      displayValue(summary.ciHigh, primary.analysisScale),
    ];
    const label = measureLabel(primary.effectMeasure);
    const synthesis = {
      ...baseSynthesis,
      status: 'computed',
      modelSpecification: `outcome-specific common-effect inverse-variance model; ${label} analysed on ${primary.analysisScale} scale; no cross-outcome or cross-scale pooling`,
      includedStudies: summary.k,
      pooledEffect: summary.pooledEffect,
      standardError: summary.pooledStandardError,
      heterogeneity: summary.i2,
      narrative: `Outcome-specific inverse-variance synthesis for ${primary.outcome}: ${summary.k} study estimates, pooled ${label}=${displayPooledEffect.toPrecision(4)} [95% CI ${displayConfidenceInterval[0].toPrecision(4)}, ${displayConfidenceInterval[1].toPrecision(4)}], I²=${summary.i2.toFixed(1)}%. Other outcomes remain separate analysis streams.`,
      ...(primary.effectMeasure ? { effectMeasure: primary.effectMeasure } : {}),
      analysisScale: primary.analysisScale,
      displayPooledEffect,
      displayConfidenceInterval,
    } as SynthesisResult & {
      effectMeasure?: QuantitativeEffectMeasure;
      analysisScale: QuantitativeAnalysisScale;
      displayPooledEffect: number;
      displayConfidenceInterval: [number, number];
    };

    return {
      ...baseResult,
      artifacts: {
        ...baseResult.artifacts,
        synthesis,
        synthesisOutcomeAnalyses: analyses,
      },
      warnings,
    };
  }
}
