import type { Agent, AgentContext, AgentResult, EvidenceRecord, ExtractedStudy } from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { RegistryResultUniverseRecord } from './publication-bias-universe.js';
import type { RegistryUniverseReviewPackage } from './registry-result-universe-agent.js';

interface StudyFamilyLinkLike {
  recordId: string;
  registryIds?: string[];
  linkageBasis?: string;
  role?: string;
}

interface PublicationDiscoveryReceiptLike {
  registryId: string;
  receiptHash: string;
  recordHashes?: string[];
}

export type RegistryPublicationLinkageRoute =
  | 'study-family-single-registry-id'
  | 'bibliographic-unique-nct'
  | 'registry-discovery-exact-nct';

export type BibliographicTrialReportRole = 'protocol' | 'study-report' | 'results-bearing';

export interface RegistryPublicationLinkReceipt {
  version: 1;
  registryId: string;
  recordId: string;
  linkageRoute: RegistryPublicationLinkageRoute;
  reportRole?: BibliographicTrialReportRole;
  publicationStatus: 'published' | 'preprint' | 'unknown';
  resultsAvailable: true | 'unknown';
  exactRegistryIdentity: true;
  targetOutcomeReported: boolean | 'unknown';
  evidenceIds: string[];
  receiptHash: string;
}

function isRegistryRecord(record: EvidenceRecord): boolean {
  return record.sourceDatabases.some((source) => /clinicaltrials|trial registry|registry/i.test(source))
    || /clinicaltrials\.gov/i.test(record.journal ?? '');
}

function isPreprint(record: EvidenceRecord): boolean {
  const text = `${record.journal ?? ''} ${record.sourceDatabases.join(' ')} ${record.title}`;
  return /\bmedrxiv\b|\bbiorxiv\b|\barxiv\b|\bresearch square\b|\bssrn\b|\bpreprint\b/i.test(text);
}

function publicationStatus(record: EvidenceRecord): RegistryPublicationLinkReceipt['publicationStatus'] {
  if (isRegistryRecord(record)) return 'unknown';
  if (isPreprint(record)) return 'preprint';
  if (record.pmid?.trim() || record.doi?.trim() || record.journal?.trim()) return 'published';
  return 'unknown';
}

function idsFromText(value: string): string[] {
  return [...new Set([...value.matchAll(/\bNCT\d{8}\b/gi)].map((match) => match[0]!.toUpperCase()))].sort();
}

function literalNctIds(record: EvidenceRecord): string[] {
  const keywords = (record.keywords ?? []).filter((keyword) => !keyword.startsWith('registry-discovery-query:'));
  return idsFromText([record.title, record.abstract, ...keywords].join('\n'));
}

function discoveryNctIds(record: EvidenceRecord): string[] {
  return [...new Set((record.keywords ?? []).flatMap((keyword) => {
    const match = keyword.match(/^registry-discovery-query:(NCT\d{8})$/i);
    return match?.[1] ? [match[1].toUpperCase()] : [];
  }))].sort();
}

function allRecords(context: AgentContext): EvidenceRecord[] {
  const records = new Map<string, EvidenceRecord>();
  for (const source of ['searchResults', 'uniqueRecords', 'registryPublicationDiscoveryRecords'] as const) {
    const values = Array.isArray(context.state.artifacts[source])
      ? context.state.artifacts[source] as EvidenceRecord[]
      : [];
    for (const record of values) records.set(record.id, record);
  }
  return [...records.values()];
}

function exactOutcomeReported(recordId: string, outcome: string, studies: ExtractedStudy[]): boolean | 'unknown' {
  const target = normaliseText(outcome);
  const linked = studies.filter((study) => study.reportIds.includes(recordId));
  if (linked.length === 0) return 'unknown';
  return linked.some((study) => study.outcomes.some((candidate) => normaliseText(candidate.name) === target))
    ? true
    : 'unknown';
}

function resultBearingRole(role: string | undefined): boolean {
  return new Set([
    'primary-results',
    'secondary-analysis',
    'follow-up',
    'economic-analysis',
    'mechanistic-substudy',
    'companion-report',
  ]).has(role ?? '');
}

function bibliographicTrialReportRole(record: EvidenceRecord): BibliographicTrialReportRole | undefined {
  const text = normaliseText([record.title, record.abstract, ...(record.keywords ?? [])].join(' '));
  const explicitNonReport = /\b(systematic review|meta analysis|scoping review|narrative review|editorial|commentary|perspective|correspondence|letter to|news|erratum|correction)\b/.test(text);
  if (explicitNonReport) return undefined;

  if (/\b(protocol|study protocol|trial protocol|design and rationale|rationale and design)\b/.test(text)) {
    return 'protocol';
  }

  const quantitativeEvidence = Number.isFinite(record.effect) || Number.isFinite(record.standardError);
  const resultsWords = /\b(results?|findings?|efficacy|effect(?:iveness)?|outcomes?|mortality|survival|safety|adverse|follow up|response|recovery)\b/.test(text);
  const studyWords = /\b(randomi[sz]ed|controlled trial|clinical trial|trial|prospective study|cohort|participants?|patients?|children|adults)\b/.test(text);
  if (quantitativeEvidence || (resultsWords && studyWords)) return 'results-bearing';

  if (/\b(trial publication|trial report|study report|clinical trial|randomi[sz]ed trial|prospective study|cohort study)\b/.test(text)) {
    return 'study-report';
  }
  return undefined;
}

function createReceipt(input: {
  registryId: string;
  record: EvidenceRecord;
  linkageRoute: RegistryPublicationLinkageRoute;
  linkageEvidenceIds: string[];
  resultsAvailable: true | 'unknown';
  reportRole?: BibliographicTrialReportRole;
}): RegistryPublicationLinkReceipt | undefined {
  const status = publicationStatus(input.record);
  if (status === 'unknown') return undefined;
  const evidenceIds = [
    ...input.linkageEvidenceIds,
    `publication-record:${stableHash({
      id: input.record.id,
      doi: input.record.doi ?? null,
      pmid: input.record.pmid ?? null,
      journal: input.record.journal ?? null,
    })}`,
  ];
  const hashable = {
    registryId: input.registryId.toUpperCase(),
    recordId: input.record.id,
    linkageRoute: input.linkageRoute,
    ...(input.reportRole ? { reportRole: input.reportRole } : {}),
    publicationStatus: status,
    resultsAvailable: input.resultsAvailable,
    exactRegistryIdentity: true as const,
    evidenceIds: [...new Set(evidenceIds)].sort(),
  };
  return {
    version: 1,
    ...hashable,
    targetOutcomeReported: 'unknown',
    receiptHash: stableHash(hashable),
  };
}

function linkReceipts(context: AgentContext): {
  receipts: RegistryPublicationLinkReceipt[];
  ambiguousBibliographicMultiNct: number;
  ambiguousDiscoveryMultiNct: number;
  rejectedBibliographicInsufficientReportRole: number;
} {
  const records = allRecords(context);
  const byRecord = new Map(records.map((record) => [record.id, record]));
  const links = Array.isArray(context.state.artifacts.studyFamilyLinks)
    ? context.state.artifacts.studyFamilyLinks as StudyFamilyLinkLike[]
    : [];
  const discoveryReceipts = Array.isArray(context.state.artifacts.registryPublicationDiscoveryReceipts)
    ? context.state.artifacts.registryPublicationDiscoveryReceipts as PublicationDiscoveryReceiptLike[]
    : [];
  const studies = Array.isArray(context.state.artifacts.extractedStudies)
    ? context.state.artifacts.extractedStudies as ExtractedStudy[]
    : [];
  const extractedRecordIds = new Set(studies.flatMap((study) => study.reportIds));
  const receipts = new Map<string, RegistryPublicationLinkReceipt>();

  for (const link of links) {
    const ids = [...new Set((link.registryIds ?? []).map((id) => id.trim().toUpperCase()).filter(Boolean))];
    if (link.linkageBasis !== 'single-registry-id' || ids.length !== 1) continue;
    const record = byRecord.get(link.recordId);
    if (!record || isRegistryRecord(record)) continue;
    const receipt = createReceipt({
      registryId: ids[0]!,
      record,
      linkageRoute: 'study-family-single-registry-id',
      linkageEvidenceIds: [
        `study-family-link:${stableHash({ recordId: link.recordId, registryId: ids[0], basis: link.linkageBasis, role: link.role ?? null })}`,
      ],
      resultsAvailable: resultBearingRole(link.role) || extractedRecordIds.has(record.id) ? true : 'unknown',
    });
    if (receipt) receipts.set(`${receipt.registryId}|${receipt.recordId}`, receipt);
  }

  let ambiguousBibliographicMultiNct = 0;
  let ambiguousDiscoveryMultiNct = 0;
  let rejectedBibliographicInsufficientReportRole = 0;
  for (const record of records) {
    if (isRegistryRecord(record)) continue;
    const literalIds = literalNctIds(record);
    const discoveryIds = discoveryNctIds(record);
    if (literalIds.length > 1) {
      ambiguousBibliographicMultiNct += 1;
      continue;
    }
    if (literalIds.length === 0 && discoveryIds.length > 1) {
      ambiguousDiscoveryMultiNct += 1;
      continue;
    }
    const route: RegistryPublicationLinkageRoute | undefined = literalIds.length === 1
      ? 'bibliographic-unique-nct'
      : discoveryIds.length === 1
        ? 'registry-discovery-exact-nct'
        : undefined;
    const registryId = literalIds[0] ?? discoveryIds[0];
    if (!route || !registryId) continue;
    const key = `${registryId}|${record.id}`;
    if (receipts.has(key)) continue;
    const reportRole = bibliographicTrialReportRole(record);
    if (!reportRole) {
      rejectedBibliographicInsufficientReportRole += 1;
      continue;
    }

    const linkageEvidenceIds = route === 'bibliographic-unique-nct'
      ? [
          `bibliographic-unique-nct:${stableHash({
            recordId: record.id,
            registryId,
            reportRole,
            evidence: [
              record.title,
              record.abstract,
              ...(record.keywords ?? []).filter((keyword) => !keyword.startsWith('registry-discovery-query:')),
            ],
          })}`,
        ]
      : [
          `registry-discovery-query-link:${stableHash({ recordId: record.id, registryId, reportRole })}`,
          ...discoveryReceipts
            .filter((receipt) => receipt.registryId.toUpperCase() === registryId)
            .map((receipt) => `registry-publication-discovery:${receipt.receiptHash}`),
        ];
    const receipt = createReceipt({
      registryId,
      record,
      linkageRoute: route,
      reportRole,
      linkageEvidenceIds,
      resultsAvailable: extractedRecordIds.has(record.id) || reportRole === 'results-bearing' ? true : 'unknown',
    });
    if (receipt) receipts.set(key, receipt);
  }

  return {
    receipts: [...receipts.values()],
    ambiguousBibliographicMultiNct,
    ambiguousDiscoveryMultiNct,
    rejectedBibliographicInsufficientReportRole,
  };
}

/**
 * Resolves publication linkage only through exact registry identity plus an
 * explicit report-role signal. Literal NCT text and exact discovery-query source
 * association are preserved as distinct provenance routes. Publication existence
 * and results availability remain separate facts.
 */
export class RegistryPublicationLinkageAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
      ? structuredClone(context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])
      : [];
    const studies = Array.isArray(context.state.artifacts.extractedStudies)
      ? context.state.artifacts.extractedStudies as ExtractedStudy[]
      : [];
    const discovered = linkReceipts(context);
    const applied: RegistryPublicationLinkReceipt[] = [];

    for (const row of universe) {
      if (!row.registryId) continue;
      const matches = discovered.receipts.filter((receipt) => receipt.registryId === row.registryId!.toUpperCase());
      if (matches.length === 0) continue;
      const hasPublished = matches.some((receipt) => receipt.publicationStatus === 'published');
      const hasPreprint = matches.some((receipt) => receipt.publicationStatus === 'preprint');
      const resolvedStatus: RegistryResultUniverseRecord['publicationStatus'] = hasPublished
        ? 'published'
        : hasPreprint
          ? 'preprint'
          : row.publicationStatus;
      if (row.publicationStatus === 'unknown' || row.publicationStatus === 'registry-only') row.publicationStatus = resolvedStatus;

      for (const receipt of matches) {
        const outcomeStatus = exactOutcomeReported(receipt.recordId, row.outcome, studies);
        const outcomeReceipt: RegistryPublicationLinkReceipt = {
          ...receipt,
          targetOutcomeReported: outcomeStatus,
          resultsAvailable: outcomeStatus === true ? true : receipt.resultsAvailable,
        };
        applied.push(outcomeReceipt);
        if (outcomeReceipt.resultsAvailable === true) row.resultsAvailable = true;
        if (outcomeStatus === true) row.targetOutcomeReported = true;
        row.evidenceIds = [...new Set([
          ...row.evidenceIds,
          ...receipt.evidenceIds,
          `registry-publication-link:${receipt.receiptHash}`,
        ])];
      }
      row.sourceHash = stableHash({
        prior: row.sourceHash,
        publicationLinks: matches.map((receipt) => receipt.receiptHash).sort(),
        publicationStatus: row.publicationStatus,
        resultsAvailable: row.resultsAvailable,
        targetOutcomeReported: row.targetOutcomeReported,
      });
    }

    const reviewPackage = context.state.artifacts.registryUniverseReviewPackage as RegistryUniverseReviewPackage | undefined;
    const items = (reviewPackage?.items ?? []).flatMap((item) => {
      const row = universe.find((candidate) =>
        candidate.registryId?.toUpperCase() === item.registryId.toUpperCase()
        && normaliseText(candidate.outcome) === normaliseText(item.outcome));
      if (!row) return [item];
      const requiredFields = item.requiredFields.filter((field) => {
        if (field === 'resultsAvailable') return row.resultsAvailable === 'unknown';
        if (field === 'targetOutcomeReported') return row.targetOutcomeReported === 'unknown';
        if (field === 'publicationStatus') return row.publicationStatus === 'unknown';
        if (field === 'prespecifiedPrimaryOutcomeFound') return row.prespecifiedPrimaryOutcomeFound === 'unknown';
        if (field === 'eligibilityStatus') return row.eligibilityStatus === 'unresolved';
        return true;
      });
      if (requiredFields.length === 0) return [];
      return [{
        ...item,
        requiredFields,
        evidenceIds: [...new Set([...item.evidenceIds, ...row.evidenceIds])],
        reason: `Registry/publication reconciliation leaves only: ${requiredFields.join(', ')}.`,
      }];
    });
    const nextPackage: RegistryUniverseReviewPackage = {
      version: 1,
      items,
      createdAt: reviewPackage?.createdAt ?? context.now(),
    };

    context.state.artifacts.registeredStudyResultUniverse = universe;
    context.state.artifacts.registryUniverseReviewPackage = nextPackage;
    context.state.artifacts.registryPublicationLinkReceipts = applied;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registeredStudyResultUniverse: universe,
        registryUniverseReviewPackage: nextPackage,
        registryPublicationLinkReceipts: applied,
        registryPublicationLinkageQuality: {
          exactUniqueRegistryLinks: applied.length,
          studyFamilyLinks: applied.filter((item) => item.linkageRoute === 'study-family-single-registry-id').length,
          bibliographicUniqueNctLinks: applied.filter((item) => item.linkageRoute === 'bibliographic-unique-nct').length,
          exactDiscoveryQueryLinks: applied.filter((item) => item.linkageRoute === 'registry-discovery-exact-nct').length,
          ambiguousBibliographicMultiNct: discovered.ambiguousBibliographicMultiNct,
          ambiguousDiscoveryMultiNct: discovered.ambiguousDiscoveryMultiNct,
          rejectedBibliographicInsufficientReportRole: discovered.rejectedBibliographicInsufficientReportRole,
          semanticLinkingUsed: false,
          publicationDoesNotImplyResults: true,
          discoveryQueryAssociationDistinctFromLiteralNct: true,
          registrySilenceNeverMeansPublicationAbsence: true,
        },
      },
    };
  }
}
