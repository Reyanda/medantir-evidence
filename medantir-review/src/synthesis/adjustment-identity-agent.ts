import type { Agent, AgentContext, AgentResult, EvidenceExcerpt, ExtractedStudy } from '../core/types.js';
import {
  createAdjustmentIdentity,
  type AdjustmentEstimand,
  type AdjustmentIdentity,
} from './adjustment-compatibility.js';

export interface OutcomeAdjustmentMetadata {
  kind: 'raw-arm-data' | 'reported-estimate';
  adjustmentStatus?: 'unadjusted' | 'adjusted';
  estimand?: AdjustmentEstimand;
  covariates?: string[];
  evidenceIds?: string[];
  rationale?: string;
}

interface AdjustmentAwareOutcome extends ExtractedStudy['outcomes'][number] {
  adjustmentMetadata?: OutcomeAdjustmentMetadata;
  adjustmentIdentity?: AdjustmentIdentity;
}

export interface AdjustmentIdentityLedgerRow {
  studyId: string;
  outcome: string;
  status: AdjustmentIdentity['status'];
  identityHash: string;
  sourceEvidenceIds: string[];
  reason: string;
}

function evidenceIndex(study: ExtractedStudy): Map<string, EvidenceExcerpt> {
  const all = [
    ...Object.values(study.fieldEvidence).flat(),
    ...Object.values(study.sectionEvidence).flat(),
  ];
  return new Map(all.map((excerpt) => [excerpt.id, excerpt]));
}

function identityFor(
  study: ExtractedStudy,
  outcome: AdjustmentAwareOutcome,
): { identity: AdjustmentIdentity; reason: string } {
  const metadata = outcome.adjustmentMetadata;
  const evidence = evidenceIndex(study);
  if (!metadata) {
    return {
      identity: createAdjustmentIdentity({
        status: 'unknown',
        estimand: 'unspecified',
        rationale: `No structured adjustment metadata was extracted for ${study.studyId}/${outcome.name}.`,
      }),
      reason: 'missing-structured-adjustment-metadata',
    };
  }

  const evidenceIds = [...new Set((metadata.evidenceIds ?? []).filter((id) => evidence.has(id)))];
  if (metadata.kind === 'raw-arm-data') {
    if (metadata.adjustmentStatus === 'adjusted') {
      throw new Error(`Raw-arm-data outcome ${study.studyId}/${outcome.name} cannot simultaneously claim adjusted status`);
    }
    if (evidenceIds.length === 0) {
      return {
        identity: createAdjustmentIdentity({
          status: 'unknown', estimand: 'unspecified',
          rationale: `Raw-arm-data derivation for ${study.studyId}/${outcome.name} lacks source evidence IDs.`,
        }),
        reason: 'raw-arm-data-without-source-evidence',
      };
    }
    return {
      identity: createAdjustmentIdentity({
        status: 'unadjusted',
        estimand: metadata.estimand ?? 'marginal',
        sourceEvidenceIds: evidenceIds,
        rationale: metadata.rationale?.trim() || 'MEDANTIR effect estimate was deterministically derived from reported arm-level data rather than an adjusted regression model.',
      }),
      reason: 'raw-arm-data-unadjusted',
    };
  }

  if (metadata.adjustmentStatus === 'unadjusted') {
    if (evidenceIds.length === 0) {
      return {
        identity: createAdjustmentIdentity({ status: 'unknown', estimand: 'unspecified', rationale: 'Reported estimate was labelled unadjusted but the label lacks a source evidence locator.' }),
        reason: 'unadjusted-label-without-source-evidence',
      };
    }
    return {
      identity: createAdjustmentIdentity({
        status: 'unadjusted',
        estimand: metadata.estimand ?? 'marginal',
        sourceEvidenceIds: evidenceIds,
        rationale: metadata.rationale?.trim() || 'Source explicitly identifies the reported estimate as crude/unadjusted.',
      }),
      reason: 'reported-unadjusted',
    };
  }

  if (metadata.adjustmentStatus === 'adjusted') {
    const covariates = metadata.covariates ?? [];
    if (evidenceIds.length === 0 || covariates.length === 0) {
      return {
        identity: createAdjustmentIdentity({
          status: 'unknown', estimand: metadata.estimand ?? 'unspecified',
          rationale: `Adjusted estimate for ${study.studyId}/${outcome.name} lacks ${evidenceIds.length === 0 ? 'source evidence' : 'the reported covariate set'}.`,
        }),
        reason: 'adjusted-estimate-incomplete-metadata',
      };
    }
    return {
      identity: createAdjustmentIdentity({
        status: 'adjusted',
        estimand: metadata.estimand ?? 'conditional',
        covariates,
        sourceEvidenceIds: evidenceIds,
        rationale: metadata.rationale?.trim() || 'Source reports an adjusted model and its adjustment covariates.',
      }),
      reason: 'reported-adjusted',
    };
  }

  return {
    identity: createAdjustmentIdentity({
      status: 'unknown', estimand: metadata.estimand ?? 'unspecified',
      rationale: `Reported-estimate metadata for ${study.studyId}/${outcome.name} does not classify the adjustment status.`,
    }),
    reason: 'reported-estimate-adjustment-unknown',
  };
}

/**
 * Adds a hash-bound adjustment identity to every numeric extracted outcome.
 *
 * This agent never infers "unadjusted" merely because the trial is randomized.
 * Only explicit structured provenance or deterministic raw-arm derivation can mint
 * a known identity. Everything else stays unknown and is later blocked by the
 * adjustment compatibility synthesis guard.
 */
export class AdjustmentIdentityExtractionAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    const studies = (result.artifacts.extractedStudies ?? context.state.artifacts.extractedStudies) as ExtractedStudy[] | undefined;
    if (!studies) return result;
    const ledger: AdjustmentIdentityLedgerRow[] = [];
    let numericOutcomes = 0;
    let known = 0;

    const normalized = studies.map((study) => ({
      ...study,
      outcomes: study.outcomes.map((raw) => {
        const outcome = raw as AdjustmentAwareOutcome;
        if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !(outcome.standardError > 0)) return outcome;
        numericOutcomes += 1;
        const classified = identityFor(study, outcome);
        if (classified.identity.status !== 'unknown') known += 1;
        ledger.push({
          studyId: study.studyId,
          outcome: outcome.name,
          status: classified.identity.status,
          identityHash: classified.identity.identityHash,
          sourceEvidenceIds: [...classified.identity.sourceEvidenceIds],
          reason: classified.reason,
        });
        return { ...outcome, adjustmentIdentity: classified.identity };
      }),
    }));

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        extractedStudies: normalized,
        adjustmentIdentityLedger: ledger,
        adjustmentIdentityQuality: {
          numericOutcomes,
          knownAdjustmentIdentity: known,
          unknownAdjustmentIdentity: numericOutcomes - known,
          complete: numericOutcomes === known,
        },
      },
      warnings: [
        ...(result.warnings ?? []),
        ...(numericOutcomes > known
          ? [`${numericOutcomes - known} numeric outcome estimate(s) have unknown adjustment identity and cannot be promoted to pooled synthesis without source-bound metadata.`]
          : []),
      ],
    };
  }
}
