import type { Agent, AgentContext, AgentResult, FinalReport, RiskOfBiasAssessment, SynthesisResult } from '../core/types.js';
import type { OutcomeSynthesisAnalysis } from '../synthesis/outcome-aware-agent.js';
import { renderForestPlot, type ForestPlotArtifact } from './forest-plot.js';

export interface ForestPlotManifestEntry {
  id: string;
  outcome: string;
  title: string;
  contentSha256: string;
  studyCount: number;
  analysisMethod: string;
  effectMeasure?: string;
  analysisScale: 'identity' | 'log';
  displayTransform: 'identity' | 'exp';
  qaWarnings: string[];
}

function nearlyEqual(a: number | undefined, b: number, tolerance = 1e-10): boolean {
  return typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function measureLabel(analysis: OutcomeSynthesisAnalysis): string {
  const labels: Record<string, string> = {
    RR: 'Risk ratio',
    OR: 'Odds ratio',
    HR: 'Hazard ratio',
    MD: 'Mean difference',
    SMD: 'Standardised mean difference',
    RD: 'Risk difference',
  };
  return analysis.effectMeasure ? labels[analysis.effectMeasure] ?? analysis.effectMeasure : 'Effect estimate';
}

/**
 * Report-stage visualization wrapper.
 *
 * It renders only from persisted outcome-specific analysis objects. Ratio
 * measures are analysed on log scale and back-transformed by the deterministic
 * forest renderer; difference measures remain on the identity scale. If the
 * top-level synthesis summary disagrees with the primary analysis, the primary
 * plot is withheld rather than producing an authoritative-looking mismatch.
 */
export class ForestPlotReportAgent implements Agent {
  readonly stage = 'report' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const analyses = context.state.artifacts.synthesisOutcomeAnalyses as OutcomeSynthesisAnalysis[] | undefined;
    const riskOfBias = (context.state.artifacts.riskOfBias ?? []) as RiskOfBiasAssessment[];
    const synthesis = context.state.artifacts.synthesis as SynthesisResult | undefined;
    if (!analyses?.length || !synthesis) return result;

    const warnings = [...(result.warnings ?? [])];
    const signatureCounts = new Map<string, number>();
    for (const analysis of analyses) signatureCounts.set(analysis.rowSignature, (signatureCounts.get(analysis.rowSignature) ?? 0) + 1);

    const primaryOutcome = context.state.request.question.outcomes?.[0];
    const forestPlots: ForestPlotArtifact[] = [];
    for (const analysis of analyses) {
      if (!analysis.summary) continue;
      if ((signatureCounts.get(analysis.rowSignature) ?? 0) > 1) {
        warnings.push(`Forest plot for '${analysis.outcome}' withheld because its study-level numeric rows are duplicated across distinct outcome streams.`);
        continue;
      }

      const isPrimary = analysis.outcome === primaryOutcome || (!primaryOutcome && forestPlots.length === 0);
      if (isPrimary) {
        const matchesTopLevel = nearlyEqual(synthesis.pooledEffect, analysis.summary.pooledEffect)
          && nearlyEqual(synthesis.standardError, analysis.summary.pooledStandardError);
        if (!matchesTopLevel) {
          warnings.push(`Primary forest plot for '${analysis.outcome}' withheld because top-level synthesis and row-level analysis do not match exactly.`);
          continue;
        }
      }

      forestPlots.push(renderForestPlot(analysis.summary, riskOfBias, {
        title: `Forest plot — ${analysis.outcome}`,
        outcome: analysis.outcome,
        measureLabel: measureLabel(analysis),
        transform: analysis.displayTransform,
        analysisNull: 0,
        favorsLeft: 'Lower estimate',
        favorsRight: 'Higher estimate',
        showRiskOfBias: true,
      }));
    }

    if (forestPlots.length === 0) {
      return {
        ...result,
        artifacts: {
          ...result.artifacts,
          forestPlots: [],
          forestPlotManifest: [],
        },
        warnings,
      };
    }

    const analysisByOutcome = new Map(analyses.map((analysis) => [analysis.outcome, analysis]));
    const manifest: ForestPlotManifestEntry[] = forestPlots.map((plot) => {
      const analysis = analysisByOutcome.get(plot.outcome);
      return {
        id: plot.id,
        outcome: plot.outcome,
        title: plot.title,
        contentSha256: plot.provenance.contentSha256,
        studyCount: plot.summary.k,
        analysisMethod: plot.provenance.analysisMethod,
        ...(analysis?.effectMeasure ? { effectMeasure: analysis.effectMeasure } : {}),
        analysisScale: analysis?.analysisScale ?? 'identity',
        displayTransform: analysis?.displayTransform ?? 'identity',
        qaWarnings: plot.qa.warnings,
      };
    });

    const report = result.artifacts.finalReport as FinalReport | undefined;
    const finalReport = report
      ? {
          ...report,
          appendices: {
            ...report.appendices,
            visualizations: {
              forestPlots: manifest,
              note: 'Forest plots are deterministic SVG projections of the persisted outcome-specific analysis tables. Ratio measures are pooled on log scale and back-transformed only for display; the SVG and analysis table remain separate auditable artifacts.',
            },
          },
        }
      : undefined;

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        forestPlots,
        forestPlotManifest: manifest,
        ...(finalReport ? { finalReport } : {}),
      },
      warnings: [
        ...warnings,
        ...forestPlots.flatMap((plot) => plot.qa.warnings.map((warning) => `${plot.outcome}: ${warning}`)),
      ],
    };
  }
}
