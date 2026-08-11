import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import { normaliseText } from '../core/utils.js';
import type { RegistryResultUniverseRecord } from './publication-bias-universe.js';
import type {
  RegistryUniverseRequiredField,
  RegistryUniverseReviewItem,
  RegistryUniverseReviewPackage,
} from './registry-result-universe-agent.js';

function requiredFields(row: RegistryResultUniverseRecord): RegistryUniverseRequiredField[] {
  const fields: RegistryUniverseRequiredField[] = [];
  if (row.eligibilityStatus === 'unresolved') fields.push('eligibilityStatus');
  if (row.eligibilityStatus !== 'ineligible') {
    if (row.resultsAvailable === 'unknown') fields.push('resultsAvailable');
    if (row.prespecifiedPrimaryOutcomeFound === 'unknown') fields.push('prespecifiedPrimaryOutcomeFound');
    if (row.targetOutcomeReported === 'unknown') fields.push('targetOutcomeReported');
    if (row.publicationStatus === 'unknown') fields.push('publicationStatus');
  }
  return fields;
}

function sameSubject(item: RegistryUniverseReviewItem, row: RegistryResultUniverseRecord): boolean {
  return Boolean(row.registryId)
    && item.registryId.toUpperCase() === row.registryId!.toUpperCase()
    && normaliseText(item.outcome) === normaliseText(row.outcome);
}

/**
 * Recomputes registry review debt after cumulative adjudication/publication
 * linkage. A candidate remains active until every material field is actually
 * resolved; the mere existence of an adjudication object never suppresses debt.
 */
export class RegistryResidualDebtAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
      ? context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[]
      : [];
    const current = context.state.artifacts.registryUniverseReviewPackage as RegistryUniverseReviewPackage | undefined;
    const existing = Array.isArray(current?.items) ? current.items : [];
    const next: RegistryUniverseReviewItem[] = [];

    for (const row of universe.filter((item) => !item.contributesToSynthesis && item.registryId)) {
      const fields = requiredFields(row);
      if (fields.length === 0) continue;
      const prior = existing.find((item) => sameSubject(item, row));
      if (prior) {
        next.push({
          ...prior,
          requiredFields: fields,
          evidenceIds: [...new Set([...prior.evidenceIds, ...row.evidenceIds])],
          reason: `Registry candidate remains unresolved only for: ${fields.join(', ')}.`,
        });
        continue;
      }
      next.push({
        registryId: row.registryId!,
        outcome: row.outcome,
        reason: `Registry candidate remains unresolved only for: ${fields.join(', ')}.`,
        requiredFields: fields,
        evidenceIds: row.evidenceIds,
        sourceDerived: {
          eligibilityStatus: row.eligibilityStatus,
          eligibilityExactMatches: 0,
          eligibilityContradictedFacets: [],
          eligibilityUnresolvedFacets: row.eligibilityStatus === 'unresolved'
            ? ['design', 'population', 'intervention', 'comparator', 'outcome']
            : [],
          registryResultsPosted: 'unknown',
          resultsAvailable: row.resultsAvailable,
          prespecifiedPrimaryOutcomeFound: row.prespecifiedPrimaryOutcomeFound,
          targetOutcomeReported: row.targetOutcomeReported,
          publicationStatus: row.publicationStatus,
          exactPrimaryOutcomeMatches: [],
          exactReportedOutcomeMatches: [],
        },
      });
    }

    // Preserve contributor-specific items; their debt is finalized by the
    // ContributingRegistryDebtAgent that follows this wrapper.
    for (const item of existing) {
      if (universe.some((row) => !row.contributesToSynthesis && sameSubject(item, row))) continue;
      next.push(item);
    }

    const reviewPackage: RegistryUniverseReviewPackage = {
      version: 1,
      items: next,
      createdAt: current?.createdAt ?? context.now(),
    };
    context.state.artifacts.registryUniverseReviewPackage = reviewPackage;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registryUniverseReviewPackage: reviewPackage,
        registryResidualDebtQuality: {
          unresolvedCandidates: next.length,
          unresolvedFields: next.reduce((sum, item) => sum + item.requiredFields.length, 0),
          partialAdjudicationNeverSuppressesRemainingDebt: true,
        },
      },
    };
  }
}
