import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../core/types.js';
import { normaliseText } from '../core/utils.js';
import type { QuantitativeAnalysisScale, QuantitativeEffectMeasure } from './provenance-first-extraction.js';
import type { StudyFamilyReportRole } from './study-family-linkage.js';
import {
  compareEstimands,
  type CanonicalEstimand,
  type EstimandSynthesisConflict,
} from './estimand-identity.js';

type FamilyAwareStudy = ExtractedStudy & {
  studyFamilyId?: string;
  reportRole?: StudyFamilyReportRole;
};

type EstimandAwareOutcome = ExtractedStudy['outcomes'][number] & {
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
  estimand?: CanonicalEstimand;
};

type Row = {
  studyId: string;
  recordId: string;
  familyId: string;
  outcome: string;
  effectMeasure: string;
  analysisScale: string;
  estimand: CanonicalEstimand;
};

function rows(studies: FamilyAwareStudy[]): Row[] {
  return studies.flatMap((study) => study.outcomes.flatMap((rawOutcome) => {
    const outcome = rawOutcome as EstimandAwareOutcome;
    if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !outcome.estimand) return [];
    return [{
      studyId: study.studyId,
      recordId: study.reportIds[0] ?? study.studyId,
      familyId: study.studyFamilyId ?? `unlinked:${study.studyId}`,
      outcome: outcome.name,
      effectMeasure: outcome.effectMeasure ?? 'untyped',
      analysisScale: outcome.analysisScale ?? 'identity',
      estimand: outcome.estimand,
    }];
  }));
}

function distinctButDependentConflicts(studies: FamilyAwareStudy[]): EstimandSynthesisConflict[] {
  const grouped = new Map<string, Row[]>();
  for (const row of rows(studies)) {
    const key = [row.familyId, normaliseText(row.outcome), row.effectMeasure, row.analysisScale].join('|');
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }

  const conflicts: EstimandSynthesisConflict[] = [];
  for (const group of grouped.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i]!;
        const right = group[j]!;
        const comparison = compareEstimands(left.estimand, right.estimand);
        if (comparison.relationship !== 'different') continue;
        conflicts.push({
          kind: 'cross-study-estimand-mismatch',
          familyId: left.familyId,
          outcome: left.outcome,
          reportIds: [left.recordId, right.recordId].sort(),
          studyIds: [left.studyId, right.studyId].sort(),
          estimandIds: [left.estimand.estimandId, right.estimand.estimandId].sort(),
          relationship: 'different',
          differingDimensions: comparison.differingDimensions,
          unresolvedDimensions: comparison.unresolvedDimensions,
        });
      }
    }
  }
  return conflicts;
}

/**
 * Distinct estimands do not imply statistical independence.
 *
 * Two reports from one participant-study family may legitimately target day 28
 * and day 60, ITT and per-protocol, or other different estimands. That proves
 * they are not duplicate estimands, but the same cohort still cannot contribute
 * both rows as if they were independent studies to one ordinary meta-analysis.
 * Future repeated-measures/multivariate synthesis may model this dependence;
 * until then MEDANTIR fails closed.
 */
export class EstimandDependenceGuardAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = context.state.artifacts.extractedStudies as FamilyAwareStudy[] | undefined;
    const synthesis = result.artifacts.synthesis as SynthesisResult | undefined;
    if (!studies || !synthesis) return result;

    const conflicts = distinctButDependentConflicts(studies);
    if (conflicts.length === 0) return result;

    const existing = Array.isArray(result.artifacts.estimandSynthesisConflicts)
      ? result.artifacts.estimandSynthesisConflicts as EstimandSynthesisConflict[]
      : [];
    const warnings = [
      ...(result.warnings ?? []),
      ...conflicts.map((conflict) =>
        `Study family ${conflict.familyId} contributes distinct '${conflict.outcome}' estimands (${conflict.differingDimensions.join(', ')}) from the same participant cohort. They are not duplicate estimands, but ordinary independent-study pooling is blocked until dependence is explicitly modeled.`),
    ];

    const guarded: SynthesisResult = {
      mode: synthesis.mode,
      status: 'narrative',
      includedStudies: studies.length,
      narrative: 'Quantitative pooling was withheld because one participant-study family contributes multiple demonstrably different estimands to the same named outcome stream. Estimand distinctness does not establish statistical independence; use an explicit repeated-measures/multivariate model or select one estimand per family.',
      capabilityWarnings: [...(synthesis.capabilityWarnings ?? []), ...warnings],
      ...(synthesis.evidence ? { evidence: synthesis.evidence } : {}),
    };

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        synthesis: guarded,
        estimandSynthesisConflicts: [...existing, ...conflicts],
      },
      warnings,
    };
  }
}
