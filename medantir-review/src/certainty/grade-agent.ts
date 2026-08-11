import type { Agent, AgentContext, AgentResult, GradeAssessment } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type { Rob2Assessment } from '../appraisal/rob2.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../synthesis/intervention-random-effects-agent.js';
import {
  assessGradeOutcome,
  evaluateGradeImprecision,
  evaluateGradeInconsistency,
  evaluateGradeIndirectness,
  evaluateGradePublicationBias,
  evaluateGradeRiskOfBias,
  type GradeDowngradeDecision,
  type GradeIndirectnessEvidence,
  type GradePolicySet,
  type GradePublicationBiasEvidence,
} from './grade.js';

export interface GradeOutcomeEvidenceInput {
  outcome: string;
  totalParticipants?: number;
  totalParticipantsEvidenceIds?: string[];
  directness?: GradeIndirectnessEvidence;
  publicationBias?: GradePublicationBiasEvidence;
  evidenceIds?: string[];
}

export interface GradeEvidenceReviewItem {
  outcome: string;
  unresolvedDomains: string[];
  proposedDecisions: GradeDowngradeDecision[];
  reason: string;
}

export interface GradeEvidenceReviewPackage {
  version: 1;
  framework: 'GRADE';
  reviewType: 'intervention-rct';
  items: GradeEvidenceReviewItem[];
  createdAt: string;
}

function analysisFor(outcome: string, analyses: InterventionOutcomeRandomEffectsAnalysis[]): InterventionOutcomeRandomEffectsAnalysis | undefined {
  return analyses.find((analysis) => analysis.outcome === outcome && analysis.status === 'computed');
}

function robEvidence(outcome: string, assessments: Rob2Assessment[], analysis: InterventionOutcomeRandomEffectsAnalysis) {
  const contributions = analysis.sensitivity?.primary.contributions ?? [];
  const byStudy = new Map(
    assessments
      .filter((assessment) => assessment.outcome === outcome && assessment.complete)
      .map((assessment) => [assessment.studyId, assessment]),
  );
  return {
    studies: contributions.flatMap((contribution) => {
      const assessment = byStudy.get(contribution.studyId);
      if (!assessment) return [];
      return [{
        studyId: contribution.studyId,
        weight: contribution.normalizedWeight,
        judgement: assessment.finalOverall,
        evidenceIds: [
          `rob2-assessment:${assessment.assessmentHash}`,
          ...assessment.domains.flatMap((domain) =>
            domain.responses.flatMap((response) => response.evidence.map((excerpt) => excerpt.id))),
        ],
      }];
    }),
  };
}

function publicationBiasAssessmentBound(evidence: GradePublicationBiasEvidence | undefined): boolean {
  return Boolean(evidence?.signals.some((signal) =>
    signal.id === '__assessment-basis__'
    && signal.strength === 0
    && signal.evidenceIds.length > 0));
}

function gradeCompatibility(assessment: ReturnType<typeof assessGradeOutcome>): GradeAssessment | null {
  if (assessment.status !== 'complete' || !assessment.finalCertainty) return null;
  return {
    outcome: assessment.outcome,
    certainty: assessment.finalCertainty,
    rationale: assessment.downgradeDecisions.map((decision) => `${decision.domain}: ${decision.concern} — ${decision.rationale}`),
  };
}

/**
 * Production GRADE stage for the RCT intervention vertical.
 * Authenticated users submit evidence only. Frozen policies plus deterministic
 * upstream artifacts remain the sole authority for domain concerns/certainty.
 */
export class InterventionGradeAgent implements Agent {
  readonly stage = 'grade' as const;

  async execute(context: AgentContext): Promise<AgentResult> {
    const policies = context.state.artifacts.gradePolicySet as GradePolicySet | undefined;
    const inputs = Array.isArray(context.state.artifacts.gradeOutcomeEvidence)
      ? context.state.artifacts.gradeOutcomeEvidence as GradeOutcomeEvidenceInput[]
      : [];
    const analyses = Array.isArray(context.state.artifacts.interventionRandomEffectsAnalyses)
      ? context.state.artifacts.interventionRandomEffectsAnalyses as InterventionOutcomeRandomEffectsAnalysis[]
      : [];
    const rob2 = Array.isArray(context.state.artifacts.rob2Assessments)
      ? context.state.artifacts.rob2Assessments as Rob2Assessment[]
      : [];
    const outcomes = context.state.request.question.outcomes ?? [];
    if (outcomes.length === 0) throw new Error('GRADE intervention assessment requires protocol-defined outcomes');

    const assessments: Array<ReturnType<typeof assessGradeOutcome>> = [];
    const reviewItems: GradeEvidenceReviewItem[] = [];

    for (const outcome of outcomes) {
      const evidenceInput = inputs.find((input) => input.outcome === outcome);
      const analysis = analysisFor(outcome, analyses);
      const decisions: GradeDowngradeDecision[] = [];

      if (analysis?.sensitivity) {
        decisions.push(evaluateGradeRiskOfBias(robEvidence(outcome, rob2, analysis), policies?.riskOfBias));
        const primary = analysis.sensitivity.primary;
        decisions.push(evaluateGradeInconsistency({
          k: primary.k,
          i2: primary.qBasedI2,
          tauSquared: primary.tauSquared,
          ...(primary.predictionInterval ? { predictionInterval: primary.predictionInterval } : {}),
          nullValue: 0,
          evidenceIds: [`random-effects-analysis:${stableHash({ outcome, primary })}`],
        }, policies?.inconsistency));
        const informationEvidence = evidenceInput?.totalParticipantsEvidenceIds ?? [];
        decisions.push(evaluateGradeImprecision({
          confidenceInterval: primary.confidenceInterval,
          totalParticipants: evidenceInput?.totalParticipants ?? 0,
          evidenceIds: informationEvidence,
        }, evidenceInput?.totalParticipants !== undefined && informationEvidence.length > 0 ? policies?.imprecision : undefined));
      } else {
        decisions.push(evaluateGradeRiskOfBias({ studies: [] }, policies?.riskOfBias));
        decisions.push(evaluateGradeInconsistency({ k: 1, i2: 0, tauSquared: 0, nullValue: 0, evidenceIds: [] }, undefined));
        decisions.push(evaluateGradeImprecision({ confidenceInterval: [-1, 1], totalParticipants: 0, evidenceIds: [] }, undefined));
      }

      decisions.push(evaluateGradeIndirectness(
        evidenceInput?.directness ?? {
          population: 'direct', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct', evidenceIds: [],
        },
        evidenceInput?.directness && evidenceInput.directness.evidenceIds.length > 0 ? policies?.indirectness : undefined,
      ));
      decisions.push(evaluateGradePublicationBias(
        evidenceInput?.publicationBias ?? { signals: [] },
        publicationBiasAssessmentBound(evidenceInput?.publicationBias) ? policies?.publicationBias : undefined,
      ));

      const assessment = assessGradeOutcome({
        outcome,
        population: context.state.request.question.population ?? 'Unresolved population',
        interventionOrExposure: context.state.request.question.interventionOrExposure ?? 'Unresolved intervention',
        comparator: context.state.request.question.comparator ?? 'Unresolved comparator',
        startingCertainty: 'high',
        downgradeDecisions: decisions,
      });
      assessments.push(assessment);
      if (assessment.status !== 'complete') {
        reviewItems.push({
          outcome,
          unresolvedDomains: assessment.unresolvedDomains,
          proposedDecisions: decisions,
          reason: 'One or more GRADE domains lack a frozen policy or complete source-bound upstream/outcome evidence.',
        });
      }
    }

    const grade = assessments.map(gradeCompatibility).filter((value): value is GradeAssessment => Boolean(value));
    const reviewPackage: GradeEvidenceReviewPackage = {
      version: 1,
      framework: 'GRADE',
      reviewType: 'intervention-rct',
      items: reviewItems,
      createdAt: context.now(),
    };
    const artifacts: Record<string, unknown> = {
      gradeOutcomeAssessments: assessments,
      gradeEvidenceReviewPackage: reviewPackage,
      grade,
      gradeQuality: {
        expectedOutcomes: outcomes.length,
        completeOutcomes: grade.length,
        unresolvedOutcomes: reviewItems.length,
        complete: reviewItems.length === 0,
        humanCertaintyLabelsAccepted: false,
        policyRequiredForDeterministicThresholds: true,
        publicationBiasAssessmentBasisRequired: true,
      },
    };
    if (reviewItems.length > 0) {
      return {
        artifacts,
        warnings: [`GRADE has ${reviewItems.length} unresolved outcome-level certainty assessment(s); no incomplete outcome received a final certainty rating.`],
        awaitingHuman: { summary: `GRADE requires policy/evidence resolution for ${reviewItems.length} outcome(s).` },
      };
    }
    return { artifacts };
  }
}
