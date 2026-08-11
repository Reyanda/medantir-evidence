import type { Agent, AgentContext, AgentResult, StageName } from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { ReviewSpec } from '../question/review-spec.js';
import type { CanonicalEstimand, EstimandLedgerRow } from '../agents/estimand-identity.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../synthesis/intervention-random-effects-agent.js';
import { studentTCdf } from '../synthesis/random-effects.js';
import type { GradeOutcomeEvidenceInput } from './grade-agent.js';

export interface OutcomeParticipantCountReceipt {
  version: 1;
  studyId: string;
  outcome: string;
  status: 'exact' | 'unresolved';
  totalParticipants?: number;
  evidenceIds: string[];
  source: 'structured-arm-counts' | 'reported-analysis-count' | 'unresolved';
  sourceHash: string;
}

export interface AutomaticGradeEvidenceReceipt {
  version: 1;
  receiptId: string;
  outcome: string;
  domain: 'directness' | 'information-size' | 'publication-bias';
  status: 'derived' | 'not-derived';
  method: string;
  inputHash: string;
  evidenceIds: string[];
  details: Record<string, number | string | boolean | null>;
  reason: string;
}

interface PublicationBiasCatalogEntry {
  id: string;
  description: string;
  outcome: string;
  method: 'egger-regression';
  k: number;
  intercept: number;
  standardError: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  analysisHash: string;
  signal: boolean;
}

function currentEvidence(state: AgentContext['state']): GradeOutcomeEvidenceInput[] {
  return Array.isArray(state.artifacts.gradeOutcomeEvidence)
    ? structuredClone(state.artifacts.gradeOutcomeEvidence as GradeOutcomeEvidenceInput[])
    : [];
}

function upsertEvidence(values: GradeOutcomeEvidenceInput[], outcome: string): GradeOutcomeEvidenceInput {
  let value = values.find((item) => item.outcome === outcome);
  if (!value) {
    value = { outcome };
    values.push(value);
  }
  return value;
}

function contributingStudyIds(analysis: InterventionOutcomeRandomEffectsAnalysis): string[] {
  return analysis.sensitivity?.primary.contributions.map((item) => item.studyId) ?? [];
}

function estimandFor(rows: EstimandLedgerRow[], studyId: string, outcome: string): CanonicalEstimand | undefined {
  return rows.find((row) =>
    row.studyId === studyId
    && normaliseText(row.outcome) === normaliseText(outcome)
    && row.status === 'identified'
    && row.estimand)?.estimand;
}

function exactTargetDirectness(input: {
  reviewSpec: ReviewSpec;
  outcome: string;
  studyIds: string[];
  estimandLedger: EstimandLedgerRow[];
}): { derived: boolean; evidenceIds: string[]; reason: string; details: Record<string, number | string | boolean | null> } {
  const targetPopulation = input.reviewSpec.fields.population.value;
  const targetIntervention = input.reviewSpec.fields.interventionOrExposure.value;
  const targetComparator = input.reviewSpec.fields.comparator.value;
  if (!targetPopulation || !targetIntervention || !targetComparator || input.studyIds.length === 0) {
    return { derived: false, evidenceIds: [], reason: 'Target PICO or contributing study identity is incomplete.', details: { studyCount: input.studyIds.length } };
  }

  const evidenceIds: string[] = [`reviewspec:${input.reviewSpec.hash}:pico`];
  for (const studyId of input.studyIds) {
    const estimand = estimandFor(input.estimandLedger, studyId, input.outcome);
    if (!estimand) {
      return { derived: false, evidenceIds, reason: `Contributing study ${studyId} has no identified estimand for the outcome.`, details: { studyCount: input.studyIds.length } };
    }
    evidenceIds.push(`estimand:${estimand.estimandId}`);
    const exact = normaliseText(estimand.population) === normaliseText(targetPopulation)
      && normaliseText(estimand.interventionOrExposure) === normaliseText(targetIntervention)
      && normaliseText(estimand.comparator) === normaliseText(targetComparator)
      && normaliseText(estimand.outcome) === normaliseText(input.outcome);
    if (!exact) {
      return {
        derived: false,
        evidenceIds,
        reason: `Study ${studyId} does not exactly match the frozen target PICO; semantic equivalence is not assumed.`,
        details: { studyCount: input.studyIds.length, exactMatches: false },
      };
    }
  }
  return {
    derived: true,
    evidenceIds: [...new Set(evidenceIds)],
    reason: 'Every contributing estimand exactly matches the frozen ReviewSpec population, intervention/exposure, comparator and outcome after deterministic normalization.',
    details: { studyCount: input.studyIds.length, exactMatches: true },
  };
}

function exactParticipantCount(input: {
  outcome: string;
  studyIds: string[];
  ledger: OutcomeParticipantCountReceipt[];
}): { derived: boolean; totalParticipants?: number; evidenceIds: string[]; reason: string; details: Record<string, number | string | boolean | null> } {
  if (input.studyIds.length === 0) return { derived: false, evidenceIds: [], reason: 'No contributing studies are available.', details: { studyCount: 0 } };
  let total = 0;
  const evidenceIds: string[] = [];
  for (const studyId of input.studyIds) {
    const rows = input.ledger.filter((row) => row.studyId === studyId && normaliseText(row.outcome) === normaliseText(input.outcome));
    if (rows.length !== 1 || rows[0]!.status !== 'exact' || !Number.isInteger(rows[0]!.totalParticipants) || !(rows[0]!.totalParticipants! > 0)) {
      return {
        derived: false,
        evidenceIds,
        reason: `Study ${studyId} does not have one exact structured participant-count receipt for this outcome.`,
        details: { studyCount: input.studyIds.length, exactStudyCounts: false },
      };
    }
    total += rows[0]!.totalParticipants!;
    evidenceIds.push(...rows[0]!.evidenceIds, `participant-count:${rows[0]!.sourceHash}`);
  }
  return {
    derived: true,
    totalParticipants: total,
    evidenceIds: [...new Set(evidenceIds)],
    reason: 'Total information size is the sum of one exact structured participant-count receipt per independent contributing study.',
    details: { studyCount: input.studyIds.length, totalParticipants: total, exactStudyCounts: true },
  };
}

function eggerAssessment(analysis: InterventionOutcomeRandomEffectsAnalysis): PublicationBiasCatalogEntry | null {
  const rows = analysis.sensitivity?.primary.contributions ?? [];
  if (rows.length < 10) return null;
  const x = rows.map((row) => 1 / Math.sqrt(row.variance));
  const y = rows.map((row) => row.effect / Math.sqrt(row.variance));
  const n = rows.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const sxx = x.reduce((sum, value) => sum + ((value - meanX) ** 2), 0);
  if (!(sxx > 0)) return null;
  const slope = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index]! - meanY), 0) / sxx;
  const intercept = meanY - slope * meanX;
  const residualSumSquares = x.reduce((sum, value, index) => {
    const residual = y[index]! - (intercept + slope * value);
    return sum + residual ** 2;
  }, 0);
  const df = n - 2;
  if (!(df > 0)) return null;
  const residualVariance = residualSumSquares / df;
  const seIntercept = Math.sqrt(residualVariance * ((1 / n) + ((meanX ** 2) / sxx)));
  if (!(seIntercept > 0) || !Number.isFinite(seIntercept)) return null;
  const tStatistic = intercept / seIntercept;
  const pValue = Math.max(0, Math.min(1, 2 * (1 - studentTCdf(Math.abs(tStatistic), df))));
  const analysisHash = stableHash({ outcome: analysis.outcome, rows: rows.map((row) => ({ studyId: row.studyId, effect: row.effect, variance: row.variance })) });
  return {
    id: `egger:${stableHash({ analysisHash, intercept, seIntercept }).slice(0, 24)}`,
    description: `Egger regression for ${analysis.outcome}: intercept=${intercept.toPrecision(5)}, SE=${seIntercept.toPrecision(5)}, t=${tStatistic.toPrecision(5)}, df=${df}, two-sided p=${pValue.toPrecision(5)}. This is a small-study-effect diagnostic, not proof of publication bias.`,
    outcome: analysis.outcome,
    method: 'egger-regression',
    k: n,
    intercept,
    standardError: seIntercept,
    tStatistic,
    degreesOfFreedom: df,
    pValue,
    analysisHash,
    signal: pValue < 0.10,
  };
}

function receipt(input: Omit<AutomaticGradeEvidenceReceipt, 'version' | 'receiptId' | 'inputHash'> & { inputs: unknown }): AutomaticGradeEvidenceReceipt {
  const inputHash = stableHash(input.inputs);
  return {
    version: 1,
    receiptId: `grade-auto-${stableHash({ outcome: input.outcome, domain: input.domain, method: input.method, inputHash }).slice(0, 24)}`,
    outcome: input.outcome,
    domain: input.domain,
    status: input.status,
    method: input.method,
    inputHash,
    evidenceIds: input.evidenceIds,
    details: input.details,
    reason: input.reason,
  };
}

/**
 * Conservative automatic evidence builder for the GRADE stage.
 *
 * It does not assign GRADE concern labels. It only constructs source-bound inputs
 * that the frozen GRADE policy may later evaluate. Non-derivation remains explicit
 * debt; semantic equivalence, participant counts and absence of publication bias
 * are never guessed.
 */
export class AutomaticGradeEvidenceAgent implements Agent {
  readonly stage: StageName = 'grade';

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const reviewSpec = context.state.artifacts.reviewSpec as ReviewSpec | undefined;
    const estimandLedger = Array.isArray(context.state.artifacts.estimandLedger)
      ? context.state.artifacts.estimandLedger as EstimandLedgerRow[] : [];
    const analyses = Array.isArray(context.state.artifacts.interventionRandomEffectsAnalyses)
      ? context.state.artifacts.interventionRandomEffectsAnalyses as InterventionOutcomeRandomEffectsAnalysis[] : [];
    const countLedger = Array.isArray(context.state.artifacts.outcomeParticipantCountLedger)
      ? context.state.artifacts.outcomeParticipantCountLedger as OutcomeParticipantCountReceipt[] : [];
    const evidence = currentEvidence(context.state);
    const receipts: AutomaticGradeEvidenceReceipt[] = [];
    const publicationCatalog: PublicationBiasCatalogEntry[] = Array.isArray(context.state.artifacts.publicationBiasEvidenceCatalog)
      ? structuredClone(context.state.artifacts.publicationBiasEvidenceCatalog as PublicationBiasCatalogEntry[]) : [];

    for (const analysis of analyses.filter((item) => item.status === 'computed' && item.sensitivity)) {
      const studyIds = contributingStudyIds(analysis);
      const target = upsertEvidence(evidence, analysis.outcome);

      if (!target.directness && reviewSpec) {
        const directness = exactTargetDirectness({ reviewSpec, outcome: analysis.outcome, studyIds, estimandLedger });
        receipts.push(receipt({
          outcome: analysis.outcome,
          domain: 'directness',
          status: directness.derived ? 'derived' : 'not-derived',
          method: 'exact-reviewspec-estimand-pico-match-v1',
          evidenceIds: directness.evidenceIds,
          details: directness.details,
          reason: directness.reason,
          inputs: { reviewSpecHash: reviewSpec.hash, outcome: analysis.outcome, studyIds, estimandIds: directness.evidenceIds.filter((id) => id.startsWith('estimand:')) },
        }));
        if (directness.derived) {
          target.directness = {
            population: 'direct', interventionOrExposure: 'direct', comparator: 'direct', outcome: 'direct',
            evidenceIds: directness.evidenceIds,
          };
        }
      }

      if (target.totalParticipants === undefined) {
        const count = exactParticipantCount({ outcome: analysis.outcome, studyIds, ledger: countLedger });
        receipts.push(receipt({
          outcome: analysis.outcome,
          domain: 'information-size',
          status: count.derived ? 'derived' : 'not-derived',
          method: 'exact-structured-participant-count-sum-v1',
          evidenceIds: count.evidenceIds,
          details: count.details,
          reason: count.reason,
          inputs: { outcome: analysis.outcome, studyIds, countRows: countLedger.filter((row) => studyIds.includes(row.studyId) && normaliseText(row.outcome) === normaliseText(analysis.outcome)).map((row) => row.sourceHash) },
        }));
        if (count.derived && count.totalParticipants !== undefined) {
          target.totalParticipants = count.totalParticipants;
          target.totalParticipantsEvidenceIds = count.evidenceIds;
        }
      }

      if (!target.publicationBias) {
        const egger = eggerAssessment(analysis);
        if (!egger) {
          receipts.push(receipt({
            outcome: analysis.outcome,
            domain: 'publication-bias',
            status: 'not-derived',
            method: 'egger-small-study-effect-v1',
            evidenceIds: [],
            details: { k: studyIds.length, minimumK: 10 },
            reason: 'Automatic Egger assessment is unavailable or inapplicable; publication bias remains unresolved.',
            inputs: { outcome: analysis.outcome, studyIds },
          }));
        } else {
          if (!publicationCatalog.some((item) => item.id === egger.id)) publicationCatalog.push(egger);
          const basisId = egger.id;
          const signalId = egger.signal ? `${egger.id}:asymmetry-signal` : null;
          if (signalId && !publicationCatalog.some((item) => item.id === signalId)) {
            publicationCatalog.push({
              ...egger,
              id: signalId,
              description: `Prespecified small-study-effect signal from ${egger.id}: Egger two-sided p < 0.10. This is a publication-bias signal for GRADE policy evaluation, not standalone proof of missing studies.`,
              signal: true,
            });
          }
          receipts.push(receipt({
            outcome: analysis.outcome,
            domain: 'publication-bias',
            status: egger.signal ? 'derived' : 'not-derived',
            method: 'egger-small-study-effect-v1',
            evidenceIds: [basisId, ...(signalId ? [signalId] : [])],
            details: { k: egger.k, intercept: egger.intercept, standardError: egger.standardError, tStatistic: egger.tStatistic, pValue: egger.pValue, signal: egger.signal },
            reason: egger.signal
              ? 'Applicable Egger regression detected a prespecified small-study-effect signal; the GRADE publication-bias policy may evaluate this signal.'
              : 'Applicable Egger regression did not detect asymmetry, but a negative small-study test does not establish absence of publication bias; the domain remains unresolved.',
            inputs: { analysisHash: egger.analysisHash, k: egger.k },
          }));
          if (egger.signal && signalId) {
            target.publicationBias = {
              signals: [
                { id: '__assessment-basis__', description: 'Applicable small-study-effect assessment was performed.', strength: 0, evidenceIds: [basisId] },
                { id: 'egger-small-study-asymmetry', description: 'Egger regression asymmetry signal.', strength: 1, evidenceIds: [signalId] },
              ],
            };
          }
        }
      }
    }

    context.state.artifacts.gradeOutcomeEvidence = evidence;
    context.state.artifacts.gradeAutomaticEvidenceReceipts = receipts;
    context.state.artifacts.publicationBiasEvidenceCatalog = publicationCatalog;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        gradeOutcomeEvidence: evidence,
        gradeAutomaticEvidenceReceipts: receipts,
        publicationBiasEvidenceCatalog: publicationCatalog,
      },
    };
  }
}
