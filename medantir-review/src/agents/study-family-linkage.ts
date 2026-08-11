import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceRecord,
  ExtractedStudy,
  ParsedDocument,
  ScreeningDecision,
  SynthesisResult,
} from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';

export type StudyFamilyReportRole =
  | 'primary-results'
  | 'secondary-analysis'
  | 'follow-up'
  | 'protocol'
  | 'economic-analysis'
  | 'mechanistic-substudy'
  | 'registry-report'
  | 'companion-report'
  | 'unclear';

export interface StudyFamilyLink {
  recordId: string;
  familyId: string;
  role: StudyFamilyReportRole;
  registryIds: string[];
  linkageBasis: 'single-registry-id' | 'singleton-no-registry' | 'ambiguous-multiple-registry-ids';
  confidence: number;
  eligibilityDecision?: ScreeningDecision['decision'];
  requiresHumanReview: boolean;
  reasons: string[];
}

export interface StudyFamily {
  familyId: string;
  registryIds: string[];
  memberReportIds: string[];
  primaryReportIds: string[];
  roles: Partial<Record<StudyFamilyReportRole, string[]>>;
  requiresHumanReview: boolean;
}

export interface StudyFamilyQuality {
  totalReports: number;
  totalFamilies: number;
  multiReportFamilies: number;
  registryLinkedReports: number;
  singletonReportsWithoutRegistry: number;
  ambiguousRegistryReports: number;
  familiesWithoutPrimaryResults: number;
  duplicateFamilyPoolingBlocked: boolean;
}

type FamilyAwareStudy = ExtractedStudy & {
  studyFamilyId?: string;
  reportRole?: StudyFamilyReportRole;
};

type NumericOutcome = ExtractedStudy['outcomes'][number] & {
  effectMeasure?: string;
  analysisScale?: string;
};

const REGISTRY_PATTERNS: RegExp[] = [
  /\bNCT\d{8}\b/gi,
  /\bISRCTN\d{4,12}\b/gi,
  /\bACTRN\d{14}\b/gi,
  /\bChiCTR[-A-Za-z0-9]+\b/gi,
  /\bEudraCT\s*\d{4}-\d{6}-\d{2}\b/gi,
  /\bUMIN[-A-Za-z0-9]+\b/gi,
];

function registryIds(text: string): string[] {
  const found = REGISTRY_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0] ?? ''));
  return [...new Set(found.map((value) => value.replace(/\s+/g, '').toUpperCase()).filter(Boolean))].sort();
}

function familyEvidenceText(record: EvidenceRecord, document: ParsedDocument): string {
  const methods = document.sections
    .filter((section) => section.name === 'methods')
    .map((section) => section.text)
    .join('\n');
  return [record.title, record.abstract, ...(record.keywords ?? []), methods].join('\n');
}

function reportRole(record: EvidenceRecord, document: ParsedDocument): StudyFamilyReportRole {
  const title = normaliseText(record.title);
  const methods = normaliseText(document.sections.filter((section) => section.name === 'methods').map((section) => section.text).join(' '));
  const text = `${title} ${methods}`;

  if (/\bprotocol\b|\bstudy design\b/.test(title) && !/\bresults?\b/.test(title)) return 'protocol';
  if (/\bcost effectiveness\b|\bcost-effectiveness\b|\beconomic evaluation\b|\bvalue of information\b/.test(text)) return 'economic-analysis';
  if (/\bsecondary analysis\b|\bpost hoc\b|\bpost-hoc\b|\bsubgroup analysis\b|\bexploratory analysis\b/.test(text)) return 'secondary-analysis';
  if (/\bfollow up\b|\bfollow-up\b|\blong term\b|\blong-term\b|\bextension study\b/.test(text)) return 'follow-up';
  if (/\bbiomarker\b|\bmechanis(?:m|tic)\b|\bcytokine\b|\bproteomic\b|\bmetabolomic\b|\bviral load\b/.test(text)) return 'mechanistic-substudy';
  if (/\bclinicaltrials\.gov\b|\btrial registration\b/.test(title)) return 'registry-report';
  if (/\brandomi[sz](?:ed|ation)\b|\brandomly assigned\b|\bprimary outcome\b/.test(methods)) return 'primary-results';
  if (/\bcohort\b|\bprospective\b|\bretrospective\b|\bcase control\b|\bcross sectional\b/.test(methods)) return 'primary-results';
  if (/\bcompanion\b|\bsubstudy\b|\bsub-study\b/.test(text)) return 'companion-report';
  return 'unclear';
}

function singletonFamilyId(recordId: string): string {
  return `family-report-${stableHash(recordId).slice(0, 16)}`;
}

function registryFamilyId(registryId: string): string {
  return `family-registry-${registryId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function buildLinks(
  records: EvidenceRecord[],
  documents: ParsedDocument[],
  decisions: ScreeningDecision[],
): StudyFamilyLink[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const decisionById = new Map(decisions.map((decision) => [decision.recordId, decision]));

  return documents.map((document) => {
    const record = recordById.get(document.recordId);
    if (!record) throw new Error(`Study-family linkage cannot resolve record ${document.recordId}`);
    const ids = registryIds(familyEvidenceText(record, document));
    const role = reportRole(record, document);
    const eligibilityDecision = decisionById.get(document.recordId)?.decision;

    if (ids.length === 1) {
      return {
        recordId: record.id,
        familyId: registryFamilyId(ids[0]!),
        role,
        registryIds: ids,
        linkageBasis: 'single-registry-id' as const,
        confidence: 0.99,
        ...(eligibilityDecision ? { eligibilityDecision } : {}),
        requiresHumanReview: false,
        reasons: [`Unique trial-registry identifier ${ids[0]} found in title/abstract/keywords/Methods evidence.`],
      };
    }

    if (ids.length > 1) {
      return {
        recordId: record.id,
        familyId: singletonFamilyId(record.id),
        role,
        registryIds: ids,
        linkageBasis: 'ambiguous-multiple-registry-ids' as const,
        confidence: 0.25,
        ...(eligibilityDecision ? { eligibilityDecision } : {}),
        requiresHumanReview: true,
        reasons: [`Multiple trial-registry identifiers were found (${ids.join(', ')}); MEDANTIR refuses to guess the parent study family.`],
      };
    }

    return {
      recordId: record.id,
      familyId: singletonFamilyId(record.id),
      role,
      registryIds: [],
      linkageBasis: 'singleton-no-registry' as const,
      confidence: 0.5,
      ...(eligibilityDecision ? { eligibilityDecision } : {}),
      requiresHumanReview: true,
      reasons: ['No unique trial-registry identifier was found in high-specificity report-family evidence; retained as a singleton family pending verification.'],
    };
  });
}

function buildFamilies(links: StudyFamilyLink[]): StudyFamily[] {
  const grouped = new Map<string, StudyFamilyLink[]>();
  for (const link of links) {
    const members = grouped.get(link.familyId) ?? [];
    members.push(link);
    grouped.set(link.familyId, members);
  }

  return [...grouped.entries()].map(([familyId, members]) => {
    const roles: Partial<Record<StudyFamilyReportRole, string[]>> = {};
    for (const member of members) {
      (roles[member.role] ??= []).push(member.recordId);
    }
    return {
      familyId,
      registryIds: [...new Set(members.flatMap((member) => member.registryIds))].sort(),
      memberReportIds: members.map((member) => member.recordId).sort(),
      primaryReportIds: members.filter((member) => member.role === 'primary-results').map((member) => member.recordId).sort(),
      roles,
      requiresHumanReview: members.some((member) => member.requiresHumanReview),
    };
  }).sort((a, b) => a.familyId.localeCompare(b.familyId));
}

function familyQuality(links: StudyFamilyLink[], families: StudyFamily[]): StudyFamilyQuality {
  return {
    totalReports: links.length,
    totalFamilies: families.length,
    multiReportFamilies: families.filter((family) => family.memberReportIds.length > 1).length,
    registryLinkedReports: links.filter((link) => link.linkageBasis === 'single-registry-id').length,
    singletonReportsWithoutRegistry: links.filter((link) => link.linkageBasis === 'singleton-no-registry').length,
    ambiguousRegistryReports: links.filter((link) => link.linkageBasis === 'ambiguous-multiple-registry-ids').length,
    familiesWithoutPrimaryResults: families.filter((family) => family.primaryReportIds.length === 0).length,
    duplicateFamilyPoolingBlocked: true,
  };
}

/**
 * Adds a study-family identity ledger after full-text screening while retaining
 * report identity and eligibility decisions. Only a unique registry identifier
 * may auto-link reports. Missing or conflicting identifiers fail closed to a
 * singleton family and explicit verification debt.
 */
export class StudyFamilyLinkageAgent implements Agent {
  readonly stage = 'fulltext-screen' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const records = context.state.artifacts.uniqueRecords as EvidenceRecord[] | undefined;
    const documents = context.state.artifacts.parsedDocuments as ParsedDocument[] | undefined;
    const decisions = result.artifacts.fullTextDecisions as ScreeningDecision[] | undefined;
    if (!records || !documents || !decisions) {
      throw new Error('Study-family linkage requires unique records, parsed documents and full-text decisions.');
    }

    const links = buildLinks(records, documents, decisions);
    const families = buildFamilies(links);
    const quality = familyQuality(links, families);
    const warnings = [...(result.warnings ?? [])];
    if (quality.ambiguousRegistryReports > 0) {
      warnings.push(`${quality.ambiguousRegistryReports} report(s) contain multiple registry identifiers and require human study-family adjudication.`);
    }
    if (quality.singletonReportsWithoutRegistry > 0) {
      warnings.push(`${quality.singletonReportsWithoutRegistry} report(s) have no unique registry identifier and remain singleton study families pending verification.`);
    }

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        studyFamilyLinks: links,
        studyFamilies: families,
        studyFamilyQuality: quality,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

/** Attach family identity to extracted report-level studies without collapsing reports. */
export class StudyFamilyAwareExtractionAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = result.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    const links = context.state.artifacts.studyFamilyLinks as StudyFamilyLink[] | undefined;
    if (!studies || !links) throw new Error('Family-aware extraction requires extracted studies and the study-family linkage ledger.');
    const byRecordId = new Map(links.map((link) => [link.recordId, link]));

    const enriched: FamilyAwareStudy[] = studies.map((study) => {
      const reportId = study.reportIds[0];
      const link = reportId ? byRecordId.get(reportId) : undefined;
      if (!link) throw new Error(`No study-family link exists for extracted report ${reportId ?? study.studyId}`);
      return {
        ...study,
        studyFamilyId: link.familyId,
        reportRole: link.role,
      };
    });

    return {
      ...result,
      artifacts: { ...result.artifacts, extractedStudies: enriched },
    };
  }
}

interface DuplicateFamilyConflict {
  familyId: string;
  outcome: string;
  effectMeasure: string;
  analysisScale: string;
  reportIds: string[];
  studyIds: string[];
}

function duplicateFamilyConflicts(studies: FamilyAwareStudy[]): DuplicateFamilyConflict[] {
  const rows = studies.flatMap((study) => study.outcomes.flatMap((rawOutcome) => {
    const outcome = rawOutcome as NumericOutcome;
    if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !(outcome.standardError > 0)) return [];
    return [{
      familyId: study.studyFamilyId ?? `unlinked:${study.studyId}`,
      outcome: outcome.name,
      effectMeasure: outcome.effectMeasure ?? 'untyped',
      analysisScale: outcome.analysisScale ?? 'identity',
      reportId: study.reportIds[0] ?? study.studyId,
      studyId: study.studyId,
    }];
  }));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = [row.familyId, row.outcome, row.effectMeasure, row.analysisScale].join('|');
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }

  return [...grouped.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      familyId: group[0]!.familyId,
      outcome: group[0]!.outcome,
      effectMeasure: group[0]!.effectMeasure,
      analysisScale: group[0]!.analysisScale,
      reportIds: group.map((row) => row.reportId).sort(),
      studyIds: group.map((row) => row.studyId).sort(),
    }));
}

/**
 * Final no-double-counting guard. Multiple numerical rows from the same family
 * for the same outcome/measure/scale are not pooled automatically because they
 * may be companion reports, secondary analyses or repeated publications of one
 * participant cohort.
 */
export class StudyFamilyGuardedSynthesisAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = context.state.artifacts.extractedStudies as FamilyAwareStudy[] | undefined;
    const synthesis = result.artifacts.synthesis as SynthesisResult | undefined;
    if (!studies || !synthesis) return result;

    const conflicts = duplicateFamilyConflicts(studies);
    if (conflicts.length === 0) {
      return {
        ...result,
        artifacts: { ...result.artifacts, studyFamilySynthesisConflicts: [] },
      };
    }

    const warnings = [
      ...(result.warnings ?? []),
      ...conflicts.map((conflict) =>
        `Study family ${conflict.familyId} contributes ${conflict.reportIds.length} numeric report-level estimates to '${conflict.outcome}' (${conflict.effectMeasure}, ${conflict.analysisScale}); pooling is blocked pending estimand/report adjudication.`),
    ];

    const guarded: SynthesisResult = {
      mode: synthesis.mode,
      status: 'narrative',
      includedStudies: studies.length,
      narrative: 'Quantitative pooling was withheld because at least one study family contributes multiple report-level numerical estimates to the same outcome/measure/analysis scale. Select the estimand-bearing report or adjudicate dependence before pooling.',
      capabilityWarnings: [...(synthesis.capabilityWarnings ?? []), ...warnings],
      ...(synthesis.evidence ? { evidence: synthesis.evidence } : {}),
    };

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        synthesis: guarded,
        studyFamilySynthesisConflicts: conflicts,
      },
      warnings,
    };
  }
}

/** Persist study-family identity and no-double-counting receipts in the report. */
export class StudyFamilyReportAgent implements Agent {
  readonly stage = 'report' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const draft = result.artifacts.draftReport as { appendices?: Record<string, unknown> } | undefined;
    if (!draft) return result;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        draftReport: {
          ...draft,
          appendices: {
            ...(draft.appendices ?? {}),
            studyFamilies: context.state.artifacts.studyFamilies ?? [],
            studyFamilyLinks: context.state.artifacts.studyFamilyLinks ?? [],
            studyFamilyQuality: context.state.artifacts.studyFamilyQuality ?? null,
            studyFamilySynthesisConflicts: context.state.artifacts.studyFamilySynthesisConflicts ?? [],
          },
        },
      },
    };
  }
}
