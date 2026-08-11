import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceExcerpt,
  EvidenceRecord,
  HumanOverrideLedger,
  ParsedDocument,
} from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type {
  StudyFamily,
  StudyFamilyLink,
  StudyFamilyQuality,
  StudyFamilyReportRole,
} from './study-family-linkage.js';

export type EvidenceBoundLinkageBasis = StudyFamilyLink['linkageBasis'] | 'human-adjudicated';

export interface EvidenceBoundStudyFamilyLink extends Omit<StudyFamilyLink, 'linkageBasis'> {
  linkageBasis: EvidenceBoundLinkageBasis;
  evidence: EvidenceExcerpt[];
  humanOverride?: {
    itemId: string;
    rationale: string;
    reviewerId?: string;
    decidedAt: string;
  };
}

export interface StudyFamilyAdjudicationOverride {
  familyId?: string;
  role?: StudyFamilyReportRole;
  registryIds?: string[];
}

const REGISTRY_PATTERNS: RegExp[] = [
  /\bNCT\d{8}\b/gi,
  /\bISRCTN\d{4,12}\b/gi,
  /\bACTRN\d{14}\b/gi,
  /\bChiCTR[-A-Za-z0-9]+\b/gi,
  /\bEudraCT\s*\d{4}-\d{6}-\d{2}\b/gi,
  /\bUMIN[-A-Za-z0-9]+\b/gi,
];

function registryIds(text: string): string[] {
  const values = REGISTRY_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[0] ?? ''));
  return [...new Set(values
    .map((value) => value.replace(/\s+/g, '').toUpperCase())
    .filter(Boolean))].sort();
}

function excerpt(input: Omit<EvidenceExcerpt, 'id'>): EvidenceExcerpt {
  return {
    id: `family-evidence-${stableHash({
      recordId: input.recordId,
      section: input.section,
      page: input.page,
      heading: input.heading,
      quote: input.quote,
    }).slice(0, 20)}`,
    ...input,
  };
}

function scannedEvidence(record: EvidenceRecord, document: ParsedDocument): EvidenceExcerpt[] {
  const titleAbstract = [
    record.title,
    record.abstract,
    (record.keywords ?? []).length ? `Keywords: ${(record.keywords ?? []).join('; ')}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 2200);

  const evidence: EvidenceExcerpt[] = [];
  if (titleAbstract.trim()) {
    evidence.push(excerpt({
      recordId: record.id,
      section: 'other',
      page: 0,
      quote: titleAbstract,
      source: 'title-abstract',
      heading: 'Title, abstract and keywords',
    }));
  }

  for (const section of document.sections.filter((candidate) => candidate.name === 'methods')) {
    if (!section.text.trim()) continue;
    evidence.push(excerpt({
      recordId: record.id,
      section: 'methods',
      page: section.pageStart,
      quote: section.text.slice(0, 2200),
      source: 'full-text',
      heading: section.heading,
    }));
  }
  return evidence;
}

function evidenceForLink(
  link: StudyFamilyLink,
  record: EvidenceRecord,
  document: ParsedDocument,
): EvidenceExcerpt[] {
  const scanned = scannedEvidence(record, document);
  if (link.registryIds.length === 0) return scanned;
  const registryBearing = scanned.filter((item) => registryIds(item.quote).length > 0);
  return registryBearing.length > 0 ? registryBearing : scanned;
}

export function studyFamilyVerificationItemId(recordId: string): string {
  return `family:${stableHash(recordId).slice(0, 16)}`;
}

function overrideFor(
  context: AgentContext,
  recordId: string,
): { value: StudyFamilyAdjudicationOverride; rationale: string; reviewerId?: string; decidedAt: string } | null {
  const ledger = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
  const entry = ledger?.entries.find((candidate) => candidate.itemId === studyFamilyVerificationItemId(recordId));
  if (!entry) return null;
  const value = (entry.amendedValue ?? {}) as StudyFamilyAdjudicationOverride;
  return {
    value,
    rationale: entry.rationale,
    ...(entry.reviewerId ? { reviewerId: entry.reviewerId } : {}),
    decidedAt: entry.decidedAt,
  };
}

function applyOverride(
  link: EvidenceBoundStudyFamilyLink,
  override: NonNullable<ReturnType<typeof overrideFor>>,
): EvidenceBoundStudyFamilyLink {
  const familyId = override.value.familyId?.trim() || link.familyId;
  const registry = override.value.registryIds
    ? [...new Set(override.value.registryIds.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort()
    : link.registryIds;
  const role = override.value.role ?? link.role;
  const itemId = studyFamilyVerificationItemId(link.recordId);
  return {
    ...link,
    familyId,
    role,
    registryIds: registry,
    linkageBasis: 'human-adjudicated',
    confidence: 1,
    requiresHumanReview: false,
    reasons: [
      ...link.reasons,
      `Human-adjudicated study-family identity: ${override.rationale}`,
    ],
    humanOverride: {
      itemId,
      rationale: override.rationale,
      ...(override.reviewerId ? { reviewerId: override.reviewerId } : {}),
      decidedAt: override.decidedAt,
    },
  };
}

function buildFamilies(links: EvidenceBoundStudyFamilyLink[]): StudyFamily[] {
  const grouped = new Map<string, EvidenceBoundStudyFamilyLink[]>();
  for (const link of links) {
    const members = grouped.get(link.familyId) ?? [];
    members.push(link);
    grouped.set(link.familyId, members);
  }
  return [...grouped.entries()].map(([familyId, members]) => {
    const roles: Partial<Record<StudyFamilyReportRole, string[]>> = {};
    for (const member of members) (roles[member.role] ??= []).push(member.recordId);
    return {
      familyId,
      registryIds: [...new Set(members.flatMap((member) => member.registryIds))].sort(),
      memberReportIds: members.map((member) => member.recordId).sort(),
      primaryReportIds: members
        .filter((member) => member.role === 'primary-results')
        .map((member) => member.recordId)
        .sort(),
      roles,
      requiresHumanReview: members.some((member) => member.requiresHumanReview),
    };
  }).sort((a, b) => a.familyId.localeCompare(b.familyId));
}

export type EvidenceBoundStudyFamilyQuality = StudyFamilyQuality & {
  humanAdjudicatedReports: number;
  evidenceBoundReports: number;
};

function familyQuality(
  links: EvidenceBoundStudyFamilyLink[],
  families: StudyFamily[],
): EvidenceBoundStudyFamilyQuality {
  return {
    totalReports: links.length,
    totalFamilies: families.length,
    multiReportFamilies: families.filter((family) => family.memberReportIds.length > 1).length,
    registryLinkedReports: links.filter((link) => link.linkageBasis === 'single-registry-id').length,
    singletonReportsWithoutRegistry: links.filter((link) => link.linkageBasis === 'singleton-no-registry').length,
    ambiguousRegistryReports: links.filter((link) => link.linkageBasis === 'ambiguous-multiple-registry-ids').length,
    familiesWithoutPrimaryResults: families.filter((family) => family.primaryReportIds.length === 0).length,
    duplicateFamilyPoolingBlocked: true,
    humanAdjudicatedReports: links.filter((link) => link.linkageBasis === 'human-adjudicated').length,
    evidenceBoundReports: links.filter((link) => link.evidence.length > 0).length,
  };
}

/**
 * Evidence/adjudication layer over the stable family classifier.
 *
 * It does not re-infer family identity. It binds the classifier's proposal to
 * deterministic source excerpts and replays explicit human overrides. Any
 * override regenerates family aggregates before extraction/synthesis so a human
 * amendment cannot disappear on rerun.
 */
export class EvidenceBoundStudyFamilyAgent implements Agent {
  readonly stage = 'fulltext-screen' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const baseLinks = result.artifacts.studyFamilyLinks as StudyFamilyLink[] | undefined;
    const records = context.state.artifacts.uniqueRecords as EvidenceRecord[] | undefined;
    const documents = context.state.artifacts.parsedDocuments as ParsedDocument[] | undefined;
    if (!baseLinks || !records || !documents) {
      throw new Error('Evidence-bound study-family linkage requires links, unique records and parsed documents.');
    }

    const recordById = new Map(records.map((record) => [record.id, record]));
    const documentById = new Map(documents.map((document) => [document.recordId, document]));

    const links: EvidenceBoundStudyFamilyLink[] = baseLinks.map((link) => {
      const record = recordById.get(link.recordId);
      const document = documentById.get(link.recordId);
      if (!record || !document) throw new Error(`Cannot bind study-family evidence for ${link.recordId}`);
      const evidenceBound: EvidenceBoundStudyFamilyLink = {
        ...link,
        evidence: evidenceForLink(link, record, document),
      };
      const override = overrideFor(context, link.recordId);
      return override ? applyOverride(evidenceBound, override) : evidenceBound;
    });

    const families = buildFamilies(links);
    const quality = familyQuality(links, families);
    const warnings = (result.warnings ?? []).filter((warning) =>
      !/remain singleton study families pending verification|require human study-family adjudication/i.test(warning));
    if (quality.ambiguousRegistryReports > 0) {
      warnings.push(`${quality.ambiguousRegistryReports} evidence-bound report(s) contain multiple registry identifiers and require human study-family adjudication.`);
    }
    if (quality.singletonReportsWithoutRegistry > 0) {
      warnings.push(`${quality.singletonReportsWithoutRegistry} evidence-bound report(s) have no unique registry identifier and remain singleton study families pending verification.`);
    }
    if (quality.humanAdjudicatedReports > 0) {
      warnings.push(`${quality.humanAdjudicatedReports} study-family report identity decision(s) were human-adjudicated and replayed into downstream family aggregates.`);
    }

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        studyFamilyLinks: links,
        studyFamilies: families,
        studyFamilyQuality: quality,
        studyFamilyEvidenceLedger: links.map((link) => ({
          recordId: link.recordId,
          familyId: link.familyId,
          linkageBasis: link.linkageBasis,
          evidence: link.evidence,
          reasons: link.reasons,
          requiresHumanReview: link.requiresHumanReview,
        })),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
