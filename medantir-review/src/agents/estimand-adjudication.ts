import type {
  Agent,
  AgentContext,
  AgentResult,
  ExtractedStudy,
  HumanOverrideLedger,
} from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import { recomputeCanonicalEstimandId } from './estimand-fingerprint.js';
import type {
  CanonicalEstimand,
  EstimandAdjustment,
  EstimandAnalysisPopulation,
  EstimandEffectTarget,
  EstimandLedgerRow,
  EstimandSubgroup,
} from './estimand-identity.js';

export interface EstimandAdjudicationOverride {
  timeHorizon?: string;
  analysisPopulation?: EstimandAnalysisPopulation;
  subgroup?: {
    value: EstimandSubgroup;
    label?: string;
  };
  adjustment?: EstimandAdjustment;
  effectTarget?: EstimandEffectTarget;
}

export interface EstimandHumanAdjudicationReceipt {
  itemId: string;
  studyId: string;
  recordId: string;
  outcome: string;
  previousEstimandId: string;
  amendedEstimandId: string;
  amendedDimensions: string[];
  rationale: string;
  reviewerId?: string;
  decidedAt: string;
}

type EstimandAwareOutcome = ExtractedStudy['outcomes'][number] & {
  estimandId?: string;
  estimand?: CanonicalEstimand & {
    humanOverride?: EstimandHumanAdjudicationReceipt;
  };
};

const ANALYSIS_POPULATIONS = new Set<EstimandAnalysisPopulation>([
  'intention-to-treat',
  'modified-intention-to-treat',
  'per-protocol',
  'as-treated',
  'safety-population',
]);
const ADJUSTMENTS = new Set<EstimandAdjustment>(['adjusted', 'unadjusted']);
const EFFECT_TARGETS = new Set<EstimandEffectTarget>(['total-effect', 'direct-effect', 'indirect-effect']);
const SUBGROUPS = new Set<EstimandSubgroup>(['overall', 'subgroup']);

export function estimandVerificationItemId(estimand: CanonicalEstimand): string {
  return `estimand:${stableHash({
    studyId: estimand.source.studyId,
    outcome: normaliseText(estimand.outcome),
    tableId: estimand.source.tableId ?? '',
    page: estimand.source.page ?? 0,
  }).slice(0, 18)}`;
}

function canonicalHumanTime(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  const match = normalized.match(/^(\d{1,4})-(hour|day|week|month|year)s?$/);
  if (!match) {
    throw new Error(`Invalid human estimand time horizon '${value}'. Use forms such as 28-day, 14-week, or 6-month.`);
  }
  return `${Number(match[1])}-${match[2]}`;
}

function validatedOverride(value: unknown): EstimandAdjudicationOverride {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Estimand amendment must be an object containing one or more typed estimand dimensions.');
  }
  const raw = value as Record<string, unknown>;
  const override: EstimandAdjudicationOverride = {};
  if (raw.timeHorizon !== undefined) {
    if (typeof raw.timeHorizon !== 'string') throw new Error('Estimand timeHorizon amendment must be a string.');
    override.timeHorizon = canonicalHumanTime(raw.timeHorizon);
  }
  if (raw.analysisPopulation !== undefined) {
    if (typeof raw.analysisPopulation !== 'string' || !ANALYSIS_POPULATIONS.has(raw.analysisPopulation as EstimandAnalysisPopulation)) {
      throw new Error(`Invalid estimand analysisPopulation amendment '${String(raw.analysisPopulation)}'.`);
    }
    override.analysisPopulation = raw.analysisPopulation as EstimandAnalysisPopulation;
  }
  if (raw.adjustment !== undefined) {
    if (typeof raw.adjustment !== 'string' || !ADJUSTMENTS.has(raw.adjustment as EstimandAdjustment)) {
      throw new Error(`Invalid estimand adjustment amendment '${String(raw.adjustment)}'.`);
    }
    override.adjustment = raw.adjustment as EstimandAdjustment;
  }
  if (raw.effectTarget !== undefined) {
    if (typeof raw.effectTarget !== 'string' || !EFFECT_TARGETS.has(raw.effectTarget as EstimandEffectTarget)) {
      throw new Error(`Invalid estimand effectTarget amendment '${String(raw.effectTarget)}'.`);
    }
    override.effectTarget = raw.effectTarget as EstimandEffectTarget;
  }
  if (raw.subgroup !== undefined) {
    if (!raw.subgroup || typeof raw.subgroup !== 'object' || Array.isArray(raw.subgroup)) {
      throw new Error('Estimand subgroup amendment must be an object with value overall|subgroup.');
    }
    const subgroup = raw.subgroup as Record<string, unknown>;
    if (typeof subgroup.value !== 'string' || !SUBGROUPS.has(subgroup.value as EstimandSubgroup)) {
      throw new Error(`Invalid estimand subgroup amendment '${String(subgroup.value)}'.`);
    }
    const label = typeof subgroup.label === 'string' ? subgroup.label.trim() : undefined;
    if (subgroup.value === 'subgroup' && !label) {
      throw new Error('A human subgroup estimand amendment must include a non-empty subgroup label.');
    }
    override.subgroup = {
      value: subgroup.value as EstimandSubgroup,
      ...(label ? { label } : {}),
    };
  }
  if (Object.keys(override).length === 0) {
    throw new Error('Estimand amendment did not contain any supported dimension.');
  }
  return override;
}

function unresolvedDimensions(estimand: CanonicalEstimand): string[] {
  return [
    ['timeHorizon', estimand.timeHorizon.status],
    ['analysisPopulation', estimand.analysisPopulation.status],
    ['subgroup', estimand.subgroup.status],
    ['adjustment', estimand.adjustment.status],
    ['effectTarget', estimand.effectTarget.status],
  ].filter(([, status]) => status !== 'resolved').map(([name]) => String(name));
}

function humanEvidence(existing: string[], rationale: string): string[] {
  return [...existing, `Human adjudication: ${rationale}`];
}

function applyOverride(
  estimand: CanonicalEstimand,
  rawValue: unknown,
  metadata: { rationale: string; reviewerId?: string; decidedAt: string },
): CanonicalEstimand & { humanOverride: EstimandHumanAdjudicationReceipt } {
  const override = validatedOverride(rawValue);
  const amended: CanonicalEstimand = {
    ...estimand,
    ...(override.timeHorizon ? {
      timeHorizon: {
        status: 'resolved',
        value: override.timeHorizon,
        evidence: humanEvidence(estimand.timeHorizon.evidence, metadata.rationale),
      },
    } : {}),
    ...(override.analysisPopulation ? {
      analysisPopulation: {
        status: 'resolved',
        value: override.analysisPopulation,
        evidence: humanEvidence(estimand.analysisPopulation.evidence, metadata.rationale),
      },
    } : {}),
    ...(override.subgroup ? {
      subgroup: {
        status: 'resolved',
        value: override.subgroup.value,
        ...(override.subgroup.label ? { label: override.subgroup.label } : {}),
        evidence: humanEvidence(estimand.subgroup.evidence, metadata.rationale),
      },
    } : {}),
    ...(override.adjustment ? {
      adjustment: {
        status: 'resolved',
        value: override.adjustment,
        evidence: humanEvidence(estimand.adjustment.evidence, metadata.rationale),
      },
    } : {}),
    ...(override.effectTarget ? {
      effectTarget: {
        status: 'resolved',
        value: override.effectTarget,
        evidence: humanEvidence(estimand.effectTarget.evidence, metadata.rationale),
      },
    } : {}),
  };
  amended.unresolvedDimensions = unresolvedDimensions(amended);
  const previousEstimandId = estimand.estimandId;
  amended.estimandId = recomputeCanonicalEstimandId(amended);
  const amendedDimensions = Object.keys(override);
  const receipt: EstimandHumanAdjudicationReceipt = {
    itemId: estimandVerificationItemId(estimand),
    studyId: estimand.source.studyId,
    recordId: estimand.source.recordId,
    outcome: estimand.outcome,
    previousEstimandId,
    amendedEstimandId: amended.estimandId,
    amendedDimensions,
    rationale: metadata.rationale,
    ...(metadata.reviewerId ? { reviewerId: metadata.reviewerId } : {}),
    decidedAt: metadata.decidedAt,
  };
  return { ...amended, humanOverride: receipt };
}

function overrideEntryFor(context: AgentContext, estimand: CanonicalEstimand) {
  const ledger = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
  return ledger?.entries.find((entry) => entry.itemId === estimandVerificationItemId(estimand));
}

/**
 * Replay typed human estimand amendments after canonical extraction and before
 * synthesis. The source cell remains unchanged; only the adjudicated scientific
 * target dimensions are amended and the estimand ID is regenerated.
 */
export class EstimandAdjudicationExtractionAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = result.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    const ledger = result.artifacts.estimandLedger as EstimandLedgerRow[] | undefined;
    if (!studies || !ledger) {
      throw new Error('Estimand adjudication replay requires canonical extracted studies and the estimand ledger.');
    }

    const receipts: EstimandHumanAdjudicationReceipt[] = [];
    const amendedByItem = new Map<string, CanonicalEstimand & { humanOverride: EstimandHumanAdjudicationReceipt }>();

    const amendedStudies = studies.map((study) => ({
      ...study,
      outcomes: study.outcomes.map((rawOutcome) => {
        const outcome = rawOutcome as EstimandAwareOutcome;
        if (!outcome.estimand) return outcome;
        const entry = overrideEntryFor(context, outcome.estimand);
        if (!entry) return outcome;
        if (entry.sourceStage !== 'extract') {
          throw new Error(`Estimand override '${entry.itemId}' must replay from extract, not ${entry.sourceStage}.`);
        }
        const amended = applyOverride(outcome.estimand, entry.amendedValue, {
          rationale: entry.rationale,
          ...(entry.reviewerId ? { reviewerId: entry.reviewerId } : {}),
          decidedAt: entry.decidedAt,
        });
        receipts.push(amended.humanOverride);
        amendedByItem.set(entry.itemId, amended);
        return { ...outcome, estimandId: amended.estimandId, estimand: amended };
      }),
    }));

    const amendedLedger = ledger.map((row) => {
      if (row.status !== 'identified' || !row.estimand) return row;
      const amended = amendedByItem.get(estimandVerificationItemId(row.estimand));
      return amended ? { ...row, estimand: amended } : row;
    });
    const identified = amendedLedger.filter((row) => row.status === 'identified');
    const fullyResolved = identified.filter((row) => row.estimand?.unresolvedDimensions.length === 0).length;

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        extractedStudies: amendedStudies,
        estimandLedger: amendedLedger,
        estimandHumanAdjudications: receipts,
        estimandIdentityQuality: {
          ...(result.artifacts.estimandIdentityQuality as Record<string, unknown> | undefined ?? {}),
          numericEstimates: identified.length,
          fullyResolved,
          partiallyResolved: identified.length - fullyResolved,
          humanAdjudicated: receipts.length,
          unresolvedDimensionsAreNeverImputed: true,
        },
      },
    };
  }
}
