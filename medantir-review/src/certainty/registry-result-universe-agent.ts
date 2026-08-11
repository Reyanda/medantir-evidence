import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import type { TrialRegistryEvidenceRecord, TrialRegistryMetadata } from '../core/trial-registry-metadata.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { ReviewSpec } from '../question/review-spec.js';
import type { InterventionOutcomeRandomEffectsAnalysis } from '../synthesis/intervention-random-effects-agent.js';
import type { RegistryResultUniverseRecord, RegistryEligibilityStatus } from './publication-bias-universe.js';
import {
  assessRegistrySourceEligibility,
  type RegistrySourceEligibilityAssessment,
} from './registry-source-eligibility.js';

interface SearchRecordLike extends TrialRegistryEvidenceRecord {
  recordId?: string;
  registryId?: string;
  registryIds?: string[];
  nctId?: string;
  metadata?: Record<string, unknown>;
}

interface StudyLike {
  studyId: string;
  reportIds: string[];
  outcomes: Array<{ name: string; effect?: number; standardError?: number }>;
}

interface StudyFamilyLinkLike {
  recordId?: string;
  familyId?: string;
  registryIds?: string[];
  linkageBasis?: string;
}

export interface RegistryUniverseAdjudication {
  version: 1;
  registryId: string;
  outcome: string;
  eligibilityStatus: RegistryEligibilityStatus;
  resultsAvailable: boolean | 'unknown';
  prespecifiedPrimaryOutcomeFound: boolean | 'unknown';
  targetOutcomeReported: boolean | 'unknown';
  publicationStatus: RegistryResultUniverseRecord['publicationStatus'];
  evidenceIds: string[];
  rationale: string;
  actorId: string;
  decidedAt: string;
  adjudicationHash: string;
}

export type RegistryUniverseRequiredField =
  | 'eligibilityStatus'
  | 'resultsAvailable'
  | 'prespecifiedPrimaryOutcomeFound'
  | 'targetOutcomeReported'
  | 'publicationStatus';

export interface RegistryUniverseReviewItem {
  registryId: string;
  outcome: string;
  title?: string;
  reason: string;
  requiredFields: RegistryUniverseRequiredField[];
  evidenceIds: string[];
  sourceDerived: {
    eligibilityStatus: RegistryEligibilityStatus;
    eligibilityAssessmentHash?: string;
    eligibilityExactMatches: number;
    eligibilityContradictedFacets: string[];
    eligibilityUnresolvedFacets: string[];
    registryResultsPosted: boolean | 'unknown';
    resultsAvailable: boolean | 'unknown';
    prespecifiedPrimaryOutcomeFound: boolean | 'unknown';
    targetOutcomeReported: boolean | 'unknown';
    publicationStatus: RegistryResultUniverseRecord['publicationStatus'];
    exactPrimaryOutcomeMatches: string[];
    exactReportedOutcomeMatches: string[];
  };
}

export interface RegistryUniverseReviewPackage {
  version: 1;
  items: RegistryUniverseReviewItem[];
  createdAt: string;
}

function registryIds(record: SearchRecordLike): string[] {
  const values = new Set<string>();
  for (const value of [record.registryId, record.nctId, record.trialRegistry?.registryId, ...(record.registryIds ?? [])]) {
    if (typeof value === 'string' && value.trim()) values.add(value.trim().toUpperCase());
  }
  for (const candidate of [record.id, record.recordId, record.title, record.abstract]) {
    if (typeof candidate !== 'string') continue;
    for (const match of candidate.matchAll(/\bNCT\d{8}\b/gi)) values.add(match[0]!.toUpperCase());
  }
  const metadata = record.metadata ?? {};
  for (const value of Object.values(metadata)) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bNCT\d{8}\b/gi)) values.add(match[0]!.toUpperCase());
    }
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string' && /^NCT\d{8}$/i.test(item.trim())) values.add(item.trim().toUpperCase());
    }
  }
  return [...values].sort();
}

function isRegistrySearchRecord(record: SearchRecordLike): boolean {
  const sources = (record.sourceDatabases ?? []).map((value) => normaliseText(value));
  return Boolean(record.trialRegistry)
    || registryIds(record).length > 0
    || sources.some((source) => /clinicaltrials|trial registry|registry/.test(source));
}

function registrySearchExecuted(context: AgentContext): boolean {
  const provenance = Array.isArray(context.state.artifacts.searchProvenance)
    ? context.state.artifacts.searchProvenance as Array<{ database?: unknown; platform?: unknown }>
    : [];
  return provenance.some((item) => /clinicaltrials|trial registry|registry/i.test(`${String(item.database ?? '')} ${String(item.platform ?? '')}`));
}

function contributingStudyIds(analysis: InterventionOutcomeRandomEffectsAnalysis): string[] {
  return analysis.sensitivity?.primary.contributions.map((item) => item.studyId) ?? [];
}

function searchRecordId(record: SearchRecordLike): string {
  return String(record.id ?? record.recordId ?? record.doi ?? record.pmid ?? stableHash(record));
}

function evidenceId(prefix: string, value: unknown): string {
  return `${prefix}:${stableHash(value).slice(0, 24)}`;
}

function adjudicationFor(
  values: RegistryUniverseAdjudication[],
  registryId: string,
  outcome: string,
): RegistryUniverseAdjudication | undefined {
  const matches = values.filter((item) => item.registryId.toUpperCase() === registryId.toUpperCase() && normaliseText(item.outcome) === normaliseText(outcome));
  if (matches.length > 1) throw new Error(`Multiple registry-universe adjudications exist for ${registryId}/${outcome}`);
  return matches[0];
}

function sourceDerivedOutcomeStatus(metadata: TrialRegistryMetadata | undefined, outcome: string): {
  registryResultsPosted: boolean | 'unknown';
  resultsAvailable: boolean | 'unknown';
  prespecifiedPrimaryOutcomeFound: boolean | 'unknown';
  targetOutcomeReported: boolean | 'unknown';
  publicationStatus: RegistryResultUniverseRecord['publicationStatus'];
  exactPrimaryOutcomeMatches: string[];
  exactReportedOutcomeMatches: string[];
} {
  if (!metadata) {
    return {
      registryResultsPosted: 'unknown',
      resultsAvailable: 'unknown',
      prespecifiedPrimaryOutcomeFound: 'unknown',
      targetOutcomeReported: 'unknown',
      publicationStatus: 'unknown',
      exactPrimaryOutcomeMatches: [],
      exactReportedOutcomeMatches: [],
    };
  }
  const target = normaliseText(outcome);
  const primary = metadata.primaryOutcomes.filter((item) => normaliseText(item.measure) === target);
  const reported = metadata.reportedOutcomes.filter((item) => normaliseText(item.title) === target);
  const reportedWithData = reported.some((item) => item.hasOutcomeData);
  return {
    registryResultsPosted: metadata.hasPostedResults,
    // Posted registry results prove that results exist somewhere. Absence of
    // registry-posted results cannot prove absence of a journal/preprint result.
    resultsAvailable: metadata.hasPostedResults ? true : 'unknown',
    prespecifiedPrimaryOutcomeFound: primary.length > 0 ? true : 'unknown',
    // Exact posted target data prove reporting. Registry silence does not prove
    // non-reporting in publications outside the registry.
    targetOutcomeReported: reportedWithData ? true : 'unknown',
    publicationStatus: 'unknown',
    exactPrimaryOutcomeMatches: primary.map((item) => item.measure),
    exactReportedOutcomeMatches: reported.map((item) => item.title),
  };
}

function sourceEligibility(
  reviewSpec: ReviewSpec | undefined,
  metadata: TrialRegistryMetadata | undefined,
  outcome: string,
): RegistrySourceEligibilityAssessment | undefined {
  return reviewSpec && metadata
    ? assessRegistrySourceEligibility({ reviewSpec, metadata, outcome })
    : undefined;
}

function requiredFields(input: {
  eligibility: RegistryEligibilityStatus;
  resultsAvailable: boolean | 'unknown';
  primary: boolean | 'unknown';
  reported: boolean | 'unknown';
  publicationStatus: RegistryResultUniverseRecord['publicationStatus'];
}): RegistryUniverseRequiredField[] {
  const required: RegistryUniverseRequiredField[] = [];
  if (input.eligibility === 'unresolved') required.push('eligibilityStatus');
  if (input.eligibility !== 'ineligible') {
    if (input.resultsAvailable === 'unknown') required.push('resultsAvailable');
    if (input.primary === 'unknown') required.push('prespecifiedPrimaryOutcomeFound');
    if (input.reported === 'unknown') required.push('targetOutcomeReported');
    if (input.publicationStatus === 'unknown') required.push('publicationStatus');
  }
  return required;
}

function reviewReason(input: {
  fields: RegistryUniverseRequiredField[];
  unresolvedFacets: string[];
}): string {
  const labels = input.fields.map((field) => field === 'eligibilityStatus'
    ? input.unresolvedFacets.length > 0 ? `eligibility (${input.unresolvedFacets.join(', ')})` : 'eligibility'
    : field === 'resultsAvailable' ? 'result availability outside/inside the registry'
      : field === 'prespecifiedPrimaryOutcomeFound' ? 'prespecified-primary-outcome status'
        : field === 'targetOutcomeReported' ? 'target-outcome reporting status across available results'
          : 'publication status/linkage');
  return `Registry-discovered study requires adjudication only for unresolved material field(s): ${labels.join('; ')}.`;
}

/**
 * Builds one registry/result universe per quantitative outcome from contributing
 * study-family identities and registry records discovered by the actual search.
 *
 * Registry-local facts are kept distinct from evidence-universe facts. In
 * particular, ClinicalTrials.gov `hasPostedResults=false` never becomes a claim
 * that no publication/result exists elsewhere. Conservative eligibility may be
 * source-resolved, but non-exact wording remains unresolved.
 */
export class RegistryResultUniverseAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const analyses = Array.isArray(context.state.artifacts.interventionRandomEffectsAnalyses)
      ? context.state.artifacts.interventionRandomEffectsAnalyses as InterventionOutcomeRandomEffectsAnalysis[] : [];
    const studies = Array.isArray(context.state.artifacts.extractedStudies)
      ? context.state.artifacts.extractedStudies as StudyLike[] : [];
    const links = Array.isArray(context.state.artifacts.studyFamilyLinks)
      ? context.state.artifacts.studyFamilyLinks as StudyFamilyLinkLike[] : [];
    const searchResults = Array.isArray(context.state.artifacts.searchResults)
      ? context.state.artifacts.searchResults as SearchRecordLike[] : [];
    const adjudications = Array.isArray(context.state.artifacts.registryUniverseAdjudications)
      ? context.state.artifacts.registryUniverseAdjudications as RegistryUniverseAdjudication[] : [];
    const reviewSpec = context.state.artifacts.reviewSpec as ReviewSpec | undefined;
    const searchedRegistry = registrySearchExecuted(context);
    const rows: RegistryResultUniverseRecord[] = [];
    const reviewItems: RegistryUniverseReviewItem[] = [];

    const registrySearchRecords = searchResults.filter(isRegistrySearchRecord);
    const registryRecordById = new Map<string, SearchRecordLike>();
    for (const record of registrySearchRecords) {
      for (const id of registryIds(record)) {
        const existing = registryRecordById.get(id);
        if (existing && stableHash(existing) !== stableHash(record)) continue;
        registryRecordById.set(id, record);
      }
    }

    for (const analysis of analyses.filter((item) => item.status === 'computed' && item.sensitivity)) {
      const outcome = analysis.outcome;
      const contributors = contributingStudyIds(analysis);
      const linkedRegistryIds = new Set<string>();

      for (const studyId of contributors) {
        const study = studies.find((item) => item.studyId === studyId);
        if (!study) throw new Error(`Registry universe requires extracted contributing study ${studyId}`);
        const studyLinks = links.filter((link) => link.recordId && study.reportIds.includes(link.recordId));
        const ids = [...new Set(studyLinks.flatMap((link) => link.registryIds ?? []).map((id) => id.toUpperCase()))];
        for (const id of ids) linkedRegistryIds.add(id);
        const registryRecord = ids.length === 1 ? registryRecordById.get(ids[0]!) : undefined;
        const derived = sourceDerivedOutcomeStatus(registryRecord?.trialRegistry, outcome);
        const source = {
          studyId, outcome, reportIds: study.reportIds, registryIds: ids,
          trialRegistry: registryRecord?.trialRegistry ?? null,
          studyLinks: studyLinks.map((link) => ({ familyId: link.familyId ?? null, registryIds: link.registryIds ?? [], linkageBasis: link.linkageBasis ?? null })),
        };
        rows.push({
          version: 2,
          studyId,
          outcome,
          ...(ids.length === 1 ? { registryId: ids[0] } : {}),
          eligibilityStatus: 'eligible',
          contributesToSynthesis: true,
          registrySearched: searchedRegistry || ids.some((id) => registryRecordById.has(id)),
          registrationFound: ids.length > 0,
          resultsAvailable: true,
          prespecifiedPrimaryOutcomeFound: derived.prespecifiedPrimaryOutcomeFound,
          targetOutcomeReported: true,
          publicationStatus: 'published',
          evidenceIds: [
            evidenceId('contributing-study', source),
            ...ids.map((id) => evidenceId('registry-link', { studyId, id })),
            ...(registryRecord?.trialRegistry ? [evidenceId('registry-source-structure', registryRecord.trialRegistry)] : []),
          ],
          sourceHash: stableHash(source),
        });
      }

      for (const [id, record] of registryRecordById) {
        if (linkedRegistryIds.has(id)) continue;
        const adjudication = adjudicationFor(adjudications, id, outcome);
        const derived = sourceDerivedOutcomeStatus(record.trialRegistry, outcome);
        const eligibility = sourceEligibility(reviewSpec, record.trialRegistry, outcome);
        const effectiveEligibility = adjudication?.eligibilityStatus ?? eligibility?.eligibilityStatus ?? 'unresolved';
        const source = {
          registryId: id,
          outcome,
          searchRecordId: searchRecordId(record),
          title: record.title ?? null,
          sourceDatabases: record.sourceDatabases ?? [],
          trialRegistry: record.trialRegistry ?? null,
          sourceEligibilityHash: eligibility?.assessmentHash ?? null,
          searchHash: stableHash(record),
          adjudicationHash: adjudication?.adjudicationHash ?? null,
        };
        const row: RegistryResultUniverseRecord = {
          version: 2,
          studyId: `registry:${id}`,
          outcome,
          registryId: id,
          eligibilityStatus: effectiveEligibility,
          contributesToSynthesis: false,
          registrySearched: true,
          registrationFound: true,
          resultsAvailable: adjudication?.resultsAvailable ?? derived.resultsAvailable,
          prespecifiedPrimaryOutcomeFound: adjudication?.prespecifiedPrimaryOutcomeFound ?? derived.prespecifiedPrimaryOutcomeFound,
          targetOutcomeReported: adjudication?.targetOutcomeReported ?? derived.targetOutcomeReported,
          publicationStatus: adjudication?.publicationStatus ?? derived.publicationStatus,
          evidenceIds: [
            evidenceId('registry-search-record', source),
            ...(record.trialRegistry ? [evidenceId('registry-source-structure', record.trialRegistry)] : []),
            ...(eligibility?.evidenceIds ?? []),
            ...(adjudication?.evidenceIds ?? []),
          ],
          sourceHash: stableHash(source),
        };
        rows.push(row);

        const fields = requiredFields({
          eligibility: row.eligibilityStatus,
          resultsAvailable: row.resultsAvailable,
          primary: row.prespecifiedPrimaryOutcomeFound,
          reported: row.targetOutcomeReported,
          publicationStatus: row.publicationStatus,
        });
        if (!adjudication && fields.length > 0) {
          reviewItems.push({
            registryId: id,
            outcome,
            ...(record.title ? { title: record.title } : {}),
            reason: reviewReason({ fields, unresolvedFacets: eligibility?.unresolvedFacets ?? [] }),
            requiredFields: fields,
            evidenceIds: row.evidenceIds,
            sourceDerived: {
              eligibilityStatus: eligibility?.eligibilityStatus ?? 'unresolved',
              ...(eligibility ? { eligibilityAssessmentHash: eligibility.assessmentHash } : {}),
              eligibilityExactMatches: eligibility?.exactMatchCount ?? 0,
              eligibilityContradictedFacets: eligibility?.contradictedFacets ?? [],
              eligibilityUnresolvedFacets: eligibility?.unresolvedFacets ?? ['design', 'population', 'intervention', 'comparator', 'outcome'],
              ...derived,
            },
          });
        }
      }
    }

    const reviewPackage: RegistryUniverseReviewPackage = {
      version: 1,
      items: reviewItems,
      createdAt: context.now(),
    };
    context.state.artifacts.registeredStudyResultUniverse = rows;
    context.state.artifacts.registryUniverseReviewPackage = reviewPackage;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registeredStudyResultUniverse: rows,
        registryUniverseReviewPackage: reviewPackage,
        registryUniverseQuality: {
          outcomes: analyses.filter((item) => item.status === 'computed').length,
          records: rows.length,
          unresolvedCandidates: reviewItems.length,
          unresolvedFields: reviewItems.reduce((sum, item) => sum + item.requiredFields.length, 0),
          registrySearchExecuted: searchedRegistry,
          sourceStructuredRegistryRecords: registrySearchRecords.filter((record) => Boolean(record.trialRegistry)).length,
          sourceAutoEligible: rows.filter((row) => row.studyId.startsWith('registry:') && row.eligibilityStatus === 'eligible' && !adjudications.some((item) => `registry:${item.registryId}` === row.studyId && normaliseText(item.outcome) === normaliseText(row.outcome))).length,
          sourceAutoIneligible: rows.filter((row) => row.studyId.startsWith('registry:') && row.eligibilityStatus === 'ineligible' && !adjudications.some((item) => `registry:${item.registryId}` === row.studyId && normaliseText(item.outcome) === normaliseText(row.outcome))).length,
          unlinkedRegistryRecordsAreNeverAssumedEligible: true,
          registryPostedResultsAreNeverTreatedAsGlobalPublicationStatus: true,
          structuralContradictionOnlyForAutomaticExclusion: true,
          exactAllFacetMatchRequiredForAutomaticInclusion: true,
          nonExactOutcomeWordingIsNeverSilentlyMapped: true,
        },
      },
    };
  }
}
