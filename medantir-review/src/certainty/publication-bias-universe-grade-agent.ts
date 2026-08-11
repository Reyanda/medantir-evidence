import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../synthesis/intervention-random-effects-agent.js';
import type { GradeOutcomeEvidenceInput } from './grade-agent.js';
import {
  auditPublicationBiasUniverse,
  type PublicationBiasUniverseAudit,
  type PublicationBiasUniversePolicy,
  type RegistryResultUniverseRecord,
} from './publication-bias-universe.js';

function evidence(state: AgentContext['state']): GradeOutcomeEvidenceInput[] {
  return Array.isArray(state.artifacts.gradeOutcomeEvidence)
    ? structuredClone(state.artifacts.gradeOutcomeEvidence as GradeOutcomeEvidenceInput[])
    : [];
}

function upsert(values: GradeOutcomeEvidenceInput[], outcome: string): GradeOutcomeEvidenceInput {
  let value = values.find((item) => item.outcome === outcome);
  if (!value) { value = { outcome }; values.push(value); }
  return value;
}

function analyses(state: AgentContext['state']): InterventionOutcomeRandomEffectsAnalysis[] {
  return Array.isArray(state.artifacts.interventionRandomEffectsAnalyses)
    ? (state.artifacts.interventionRandomEffectsAnalyses as InterventionOutcomeRandomEffectsAnalysis[])
      .filter((item) => item.status === 'computed' && item.sensitivity)
    : [];
}

function mergePublicationBias(
  current: GradeOutcomeEvidenceInput['publicationBias'],
  audit: PublicationBiasUniverseAudit,
) {
  // The full eligible-universe policy supersedes an earlier Egger-only basis.
  // Positive signals remain, but no basis is present until the prospectively
  // required universe audit is complete.
  const signals = (current?.signals ?? []).filter((item) => item.id !== '__assessment-basis__');
  const basisId = `publication-bias-universe-audit:${audit.auditHash}`;
  if (audit.assessmentBasisComplete) {
    signals.unshift({
      id: '__assessment-basis__',
      description: 'Prospective eligible-universe registry/result/publication audit met its frozen completeness policy.',
      strength: 0,
      evidenceIds: [basisId, ...audit.assessmentBasisEvidenceIds],
    });
  }
  for (const signal of audit.signals) {
    if (signals.some((item) => item.id === signal.id)) continue;
    signals.push({
      id: signal.id,
      description: signal.description,
      strength: 1,
      evidenceIds: [...signal.evidenceIds, basisId],
    });
  }
  return signals.length ? { signals } : undefined;
}

/**
 * Full eligible-universe publication-bias evidence wrapper.
 *
 * Positive evidence is preserved immediately, but the GRADE domain receives an
 * assessment-basis receipt only after the prospectively required completeness
 * audit is complete. Completeness debt can therefore never masquerade as either
 * evidence of bias or a valid negative clearance.
 */
export class PublicationBiasUniverseGradeAgent implements Agent {
  readonly stage = 'grade' as const;
  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const policy = context.state.artifacts.publicationBiasUniversePolicy as PublicationBiasUniversePolicy | undefined;
    const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
      ? context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[] : [];
    const values = evidence(context.state);
    const audits: PublicationBiasUniverseAudit[] = [];
    const catalog = Array.isArray(context.state.artifacts.publicationBiasEvidenceCatalog)
      ? structuredClone(context.state.artifacts.publicationBiasEvidenceCatalog as Array<Record<string, unknown>>) : [];

    if (policy && universe.length > 0) {
      for (const analysis of analyses(context.state)) {
        const studyIds = analysis.sensitivity!.primary.contributions.map((item) => item.studyId);
        try {
          const audit = auditPublicationBiasUniverse({ outcome: analysis.outcome, contributingStudyIds: studyIds, records: universe, policy });
          audits.push(audit);
          const basisId = `publication-bias-universe-audit:${audit.auditHash}`;
          if (!catalog.some((item) => item.id === basisId)) {
            catalog.push({
              id: basisId,
              outcome: audit.outcome,
              method: 'eligible-universe-registry-result-publication-audit',
              description: audit.assessmentBasisComplete
                ? 'Eligible-universe registry/result/publication audit met the prospective completeness policy.'
                : `Eligible-universe audit remains incomplete: ${audit.unresolvedReasons.join(' ')}`,
              auditHash: audit.auditHash,
              assessmentBasisComplete: audit.assessmentBasisComplete,
              evidenceIds: audit.assessmentBasisEvidenceIds,
            });
          }
          for (const signal of audit.signals) {
            if (!catalog.some((item) => item.id === signal.id)) {
              catalog.push({
                id: signal.id,
                outcome: signal.outcome,
                method: 'eligible-universe-registry-result-publication-audit',
                evidenceClass: 'positive-publication-bias-signal',
                description: signal.description,
                signalKind: signal.kind,
                evidenceIds: signal.evidenceIds,
                signalHash: signal.signalHash,
              });
            }
          }
          for (const debt of audit.auditDebt) {
            if (!catalog.some((item) => item.id === debt.id)) {
              catalog.push({
                id: debt.id,
                outcome: debt.outcome,
                method: 'eligible-universe-registry-result-publication-audit',
                evidenceClass: 'completeness-debt',
                description: debt.description,
                debtKind: debt.kind,
                evidenceIds: debt.evidenceIds,
                debtHash: debt.debtHash,
              });
            }
          }
          const target = upsert(values, analysis.outcome);
          const merged = mergePublicationBias(target.publicationBias, audit);
          if (merged) target.publicationBias = merged;
          else delete target.publicationBias;
        } catch (error) {
          const failure = error instanceof Error ? error.message : String(error);
          audits.push({
            version: 2,
            outcome: analysis.outcome,
            contributingStudyCount: studyIds.length,
            eligibleUniverseCount: 0,
            unresolvedEligibilityCount: 0,
            eligibleRegistrySearchCoverage: 0,
            knownResultAvailabilityCount: 0,
            knownPrimaryOutcomeSpecificationCount: 0,
            knownTargetOutcomeStatusCount: 0,
            knownPublicationStatusCount: 0,
            signals: [],
            auditDebt: [],
            assessmentBasisComplete: false,
            assessmentBasisEvidenceIds: [],
            unresolvedReasons: [failure],
            policyId: policy.id,
            auditHash: `failed:${analysis.outcome}:${policy.id}`,
          });
          const target = upsert(values, analysis.outcome);
          if (target.publicationBias) {
            target.publicationBias = {
              signals: target.publicationBias.signals.filter((item) => item.id !== '__assessment-basis__'),
            };
            if (target.publicationBias.signals.length === 0) delete target.publicationBias;
          }
        }
      }
    }

    context.state.artifacts.gradeOutcomeEvidence = values;
    context.state.artifacts.publicationBiasUniverseAudits = audits;
    context.state.artifacts.publicationBiasEvidenceCatalog = catalog;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        gradeOutcomeEvidence: values,
        publicationBiasUniverseAudits: audits,
        publicationBiasEvidenceCatalog: catalog,
      },
    };
  }
}
