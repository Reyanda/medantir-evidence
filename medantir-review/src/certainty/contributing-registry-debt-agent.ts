import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type {
  RegistryUniverseAdjudication,
  RegistryUniverseReviewItem,
  RegistryUniverseReviewPackage,
} from './registry-result-universe-agent.js';
import type { RegistryResultUniverseRecord } from './publication-bias-universe.js';

function subjectKey(row: RegistryResultUniverseRecord): string {
  return row.registryId?.toUpperCase() ?? `STUDY:${row.studyId}`;
}

function adjudicationFor(
  values: RegistryUniverseAdjudication[],
  key: string,
  outcome: string,
): RegistryUniverseAdjudication | undefined {
  const matches = values.filter((item) => item.registryId.toUpperCase() === key.toUpperCase() && normaliseText(item.outcome) === normaliseText(outcome));
  if (matches.length > 1) throw new Error(`Multiple contributing-study registry adjudications exist for ${key}/${outcome}`);
  return matches[0];
}

/**
 * Makes completeness debt on already-included contributors resolvable.
 *
 * Inclusion, result availability, target-outcome reporting and publication status
 * are already established by the included-study pipeline. The common remaining
 * registry-specific question is whether the target outcome was prespecified as a
 * primary outcome. That question is surfaced independently of whether an NCT ID
 * was successfully linked.
 */
export class ContributingRegistryDebtAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
      ? structuredClone(context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])
      : [];
    const reviewPackage = context.state.artifacts.registryUniverseReviewPackage as RegistryUniverseReviewPackage | undefined;
    const reviewItems: RegistryUniverseReviewItem[] = Array.isArray(reviewPackage?.items)
      ? structuredClone(reviewPackage.items)
      : [];
    const adjudications = Array.isArray(context.state.artifacts.registryUniverseAdjudications)
      ? context.state.artifacts.registryUniverseAdjudications as RegistryUniverseAdjudication[]
      : [];

    for (const row of universe.filter((item) => item.contributesToSynthesis && item.eligibilityStatus === 'eligible')) {
      const key = subjectKey(row);
      const adjudication = adjudicationFor(adjudications, key, row.outcome);
      if (row.prespecifiedPrimaryOutcomeFound === 'unknown' && adjudication?.prespecifiedPrimaryOutcomeFound !== 'unknown' && adjudication?.prespecifiedPrimaryOutcomeFound !== undefined) {
        row.prespecifiedPrimaryOutcomeFound = adjudication.prespecifiedPrimaryOutcomeFound;
        row.evidenceIds = [...new Set([...row.evidenceIds, ...adjudication.evidenceIds])];
        row.sourceHash = stableHash({ sourceHash: row.sourceHash, adjudicationHash: adjudication.adjudicationHash });
      }
      if (row.prespecifiedPrimaryOutcomeFound !== 'unknown') continue;
      if (reviewItems.some((item) => item.registryId.toUpperCase() === key.toUpperCase() && normaliseText(item.outcome) === normaliseText(row.outcome))) continue;
      reviewItems.push({
        registryId: key,
        outcome: row.outcome,
        reason: 'Included contributing study requires one remaining publication-bias completeness decision: whether the target outcome was prespecified as primary.',
        requiredFields: ['prespecifiedPrimaryOutcomeFound'],
        evidenceIds: row.evidenceIds,
        sourceDerived: {
          eligibilityStatus: 'eligible',
          eligibilityExactMatches: 0,
          eligibilityContradictedFacets: [],
          eligibilityUnresolvedFacets: [],
          registryResultsPosted: 'unknown',
          resultsAvailable: true,
          prespecifiedPrimaryOutcomeFound: 'unknown',
          targetOutcomeReported: true,
          publicationStatus: 'published',
          exactPrimaryOutcomeMatches: [],
          exactReportedOutcomeMatches: [row.outcome],
        },
      });
    }

    const nextPackage: RegistryUniverseReviewPackage = {
      version: 1,
      items: reviewItems,
      createdAt: reviewPackage?.createdAt ?? context.now(),
    };
    context.state.artifacts.registeredStudyResultUniverse = universe;
    context.state.artifacts.registryUniverseReviewPackage = nextPackage;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registeredStudyResultUniverse: universe,
        registryUniverseReviewPackage: nextPackage,
        contributingRegistryDebtQuality: {
          contributingStudies: universe.filter((item) => item.contributesToSynthesis).length,
          unresolvedPrimaryOutcomeSpecifications: reviewItems.filter((item) => item.requiredFields.includes('prespecifiedPrimaryOutcomeFound')).length,
          syntheticStudySubjectKeysAllowed: true,
        },
      },
    };
  }
}
