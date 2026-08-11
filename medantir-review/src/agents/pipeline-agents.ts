import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceExcerpt,
  EvidenceRecord,
  ExtractedStudy,
  FullTextDocument,
  GradeAssessment,
  HumanOverrideLedger,
  ParsedDocument,
  RequiredEvidenceSection,
  ReviewCommissionDecision,
  ReviewPlan,
  RiskOfBiasAssessment,
  ScreeningDecision,
  SearchStrategy,
  SynthesisResult,
} from '../core/types.js';
import type {
  EvidenceSourceAdapter,
  FullTextRetrievalPort,
  HumanVerificationPort,
  PdfTextExtractionPort,
  ProtocolRegistryAdapter,
  ResearcherIdentityPort,
  SearchStrategyTestingPort,
} from '../core/ports.js';
import { buildMethodologyPlan } from '../protocols/methodology.js';
import { id, jaccard, normaliseText, stableHash } from '../core/utils.js';
import { HumanVerificationAgent } from './human-verification-agent.js';
import {
  ProtocolDraftAgent,
  ProtocolFinaliseAgent,
  ProtocolRegistrationAgent,
  ResearcherIdentityAgent,
  SearchStrategyTestAgent,
} from './protocol-registration-agents.js';

function artifact<T>(context: AgentContext, key: string): T {
  if (!(key in context.state.artifacts)) throw new Error(`Artifact '${key}' not found`);
  return context.state.artifacts[key] as T;
}

function overrideValue<T>(context: AgentContext, itemId: string, fallback: T): { value: T; overridden: boolean } {
  const ledger = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
  const entry = ledger?.entries.find((candidate) => candidate.itemId === itemId);
  if (!entry) return { value: fallback, overridden: false };
  return { value: entry.amendedValue as T, overridden: true };
}

function excerpt(input: Omit<EvidenceExcerpt, 'id'>): EvidenceExcerpt {
  return { id: id(), ...input };
}

function sectionExcerpts(document: ParsedDocument, section: EvidenceExcerpt['section']): EvidenceExcerpt[] {
  return document.sections
    .filter((candidate) => candidate.name === section)
    .map((candidate) => excerpt({
      recordId: document.recordId,
      section,
      page: candidate.pageStart,
      quote: candidate.text.slice(0, 1800),
      source: 'full-text',
      heading: candidate.heading,
    }));
}

function firstSectionText(document: ParsedDocument, section: RequiredEvidenceSection): string {
  const value = document.sections.find((candidate) => candidate.name === section)?.text.trim();
  return value || 'Not explicitly reported';
}

export class QuestionAgent implements Agent {
  readonly stage = 'question' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const question = context.state.request.question;
    if (!question.title.trim() || !question.objective.trim()) {
      throw new Error('Research question requires both title and objective');
    }
    return {
      artifacts: {
        normalisedQuestion: {
          ...question,
          title: question.title.trim(),
          objective: question.objective.trim(),
          outcomes: question.outcomes ?? [],
          concepts: question.concepts ?? [],
        },
      },
    };
  }
}

export class ProtocolAgent implements Agent {
  readonly stage = 'protocol' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const plan = buildMethodologyPlan(context.state.request);
    return { artifacts: { reviewPlan: plan }, warnings: plan.methodologyWarnings };
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function currencyScore(lastSearchDate: string | undefined, publicationYear: number, now: string): number {
  const currentYear = new Date(now).getUTCFullYear();
  const searchYear = lastSearchDate ? new Date(lastSearchDate).getUTCFullYear() : publicationYear;
  const age = Math.max(0, currentYear - searchYear);
  if (age <= 2) return 1;
  if (age <= 4) return 0.75;
  if (age <= 7) return 0.45;
  return 0.2;
}

export class ReviewLandscapeAgent implements Agent {
  readonly stage = 'review-landscape' as const;

  async execute(context: AgentContext): Promise<AgentResult> {
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const candidates = context.state.request.existingReviewCandidates ?? [];
    const scores = candidates.map((candidate) => {
      const directness = clampScore((
        candidate.questionMatch
        + candidate.populationMatch
        + candidate.interventionOrExposureMatch
        + candidate.outcomeMatch
      ) / 4);
      const currency = currencyScore(candidate.lastSearchDate, candidate.publicationYear, context.now());
      const ratingScore = candidate.trustworthinessRating === 'high'
        ? 1
        : candidate.trustworthinessRating === 'moderate'
          ? 0.75
          : candidate.trustworthinessRating === 'low'
            ? 0.15
            : 0.45;
      const methodsCompleteness = [
        candidate.hasReproducibleSearch,
        candidate.hasRiskOfBiasAssessment,
        candidate.hasCertaintyAssessment,
      ].filter(Boolean).length / 3;
      const trustworthiness = clampScore(ratingScore * 0.7 + methodsCompleteness * 0.3);
      const extractability = clampScore((Number(candidate.hasExtractableStudyData) + Number(candidate.hasReproducibleSearch)) / 2);
      const overall = directness * 0.35 + trustworthiness * 0.25 + currency * 0.2 + extractability * 0.2;
      return { id: candidate.id, directness, currency, trustworthiness, extractability, overall };
    }).sort((left, right) => right.overall - left.overall);

    const best = scores[0];
    let strategy = context.state.request.preferredCommissionStrategy ?? plan.commissionStrategy;
    const rationale: string[] = [];

    if (!context.state.request.preferredCommissionStrategy) {
      if (context.state.request.reviewType === 'umbrella') {
        strategy = 'overview';
        rationale.push('The selected review family synthesises existing systematic reviews.');
      } else if (context.state.request.reviewType === 'living') {
        strategy = 'living-update';
        rationale.push('The review is configured for continuous surveillance and versioned updates.');
      } else if (best && best.overall >= 0.82 && best.directness >= 0.85 && best.trustworthiness >= 0.75) {
        strategy = best.currency >= 0.75 ? 'adopt-adapt' : 'update';
        rationale.push(`Existing review ${best.id} is direct, trustworthy, and extractable.`);
      } else if (best && best.overall >= 0.62) {
        strategy = 'update';
        rationale.push(`Existing review ${best.id} is useful but requires refreshed searches or methodological repair.`);
      } else {
        strategy = 'de-novo';
        rationale.push(candidates.length === 0
          ? 'No candidate existing review was supplied for formal reuse appraisal.'
          : 'No candidate review met the prespecified reuse threshold.');
      }
    } else {
      rationale.push(`Commission strategy was prespecified as ${strategy}.`);
    }

    const selectedReviewIds = strategy === 'de-novo'
      ? []
      : scores.filter((score) => score.overall >= Math.max(0.62, (best?.overall ?? 0) - 0.08)).map((score) => score.id);
    const requiresPrimaryStudySearch = strategy !== 'adopt-adapt' && strategy !== 'overview';
    const decision: ReviewCommissionDecision = {
      strategy,
      selectedReviewIds,
      rationale,
      candidateScores: scores,
      requiresPrimaryStudySearch,
      requiresHumanApproval: true,
    };

    return {
      artifacts: { reviewCommissionDecision: decision },
      warnings: strategy === 'adopt-adapt'
        ? ['Reuse requires source-review trustworthiness verification and confirmation that study-level data are complete.']
        : [],
    };
  }
}

const databaseProfiles: Record<string, { platform: string; transform(terms: string[]): string }> = {
  pubmed: {
    platform: 'NCBI PubMed',
    transform: (terms) => terms.map((term) => `"${term}"[Title/Abstract]`).join(' OR '),
  },
  medline: {
    platform: 'Ovid',
    transform: (terms) => terms.map((term) => `${term.replaceAll(' ', ' adj2 ')}.ti,ab,kf.`).join(' OR '),
  },
  embase: {
    platform: 'Ovid',
    transform: (terms) => terms.map((term) => `${term.replaceAll(' ', ' adj2 ')}.ti,ab,kw.`).join(' OR '),
  },
  cinahl: {
    platform: 'EBSCOhost',
    transform: (terms) => terms.map((term) => `TI "${term}" OR AB "${term}"`).join(' OR '),
  },
  'web of science': {
    platform: 'Clarivate',
    transform: (terms) => `TS=(${terms.map((term) => `"${term}"`).join(' OR ')})`,
  },
  cochrane: {
    platform: 'Cochrane Library',
    transform: (terms) => terms.map((term) => `"${term}":ti,ab,kw`).join(' OR '),
  },
  'global health': {
    platform: 'CAB Direct',
    transform: (terms) => terms.map((term) => `ab:("${term}") OR title:("${term}")`).join(' OR '),
  },
};

/** Extract concept terms for a specific PRISM dimension from the question's
 *  concepts array. Matches concepts by name prefix (e.g. name="Population" or
 *  "Children") and returns their exploded terms + freeText additions. */
function extractConcepts(question: any, dimension: string): string[] {
  const concepts = (question?.concepts ?? []) as any[];
  return concepts
    .filter((c: any) => {
      if (typeof c === 'string') return false;
      const name = (c.name || '').toLowerCase();
      const dimLower = dimension.toLowerCase();
      // Match concepts whose name starts with the dimension keyword
      return name.includes(dimLower) || name.includes(dimLower.slice(0, 4));
    })
    .flatMap((c: any) => [...(c.terms || []), ...(c.freeText || [])]);
}

export class SearchBuildAgent implements Agent {
  readonly stage = 'search-build' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const question = context.state.request.question;
    const commission = artifact<ReviewCommissionDecision>(context, 'reviewCommissionDecision');
    const terms = [
      question.population,
      question.interventionOrExposure,
      ...(question.outcomes ?? []),
      ...(question.concepts ?? []).flatMap((c: any) => typeof c === 'string' ? [c] : [...(c.terms || []), ...(c.freeText || [])]),
    ].filter((term): term is string => typeof term === 'string' && Boolean(term.trim()));
    if (terms.length === 0) throw new Error('No searchable concepts were supplied');

    const warnings: string[] = [];

    // PRISM strategy: decompose concepts into P-R-I-S-M-T-G-D blocks.
    // Each block OR-joins its terms; blocks are AND-joined. The NOT block
    // excludes noise. This follows the PRISM search strategy framework
    // (8 dimensions: Population, Realm, Intervention, Standard, Measure,
    // Time, Geography, Design).
    const q = question as any;
    const prismBlocks: Record<string, string[]> = {
      P: [...(q.population ? [q.population] : []), ...extractConcepts(q, 'population')],
      I: [...(q.interventionOrExposure ? [q.interventionOrExposure] : []), ...extractConcepts(q, 'intervention')],
      S: extractConcepts(q, 'comparator'),
      M: [...(q.outcomes ?? []), ...extractConcepts(q, 'outcomes')],
      G: extractConcepts(q, 'geography'),
      D: extractConcepts(q, 'design'),
    };
    // Remove empty blocks
    const activeBlocks = Object.entries(prismBlocks).filter(([, t]) => t.length > 0);

    const strategies: SearchStrategy[] = context.state.request.databases.map((database) => {
      const profile = databaseProfiles[database.toLowerCase()];
      if (!profile) warnings.push(`No certified profile for ${database}; generic PRISM syntax generated`);

      // Build PRISM Boolean: each block OR-joins its exploded terms, blocks AND-joined.
      const blockQueries = activeBlocks.map(([code, blockTerms]) => {
        const unique = [...new Set(blockTerms)].filter(t => typeof t === 'string' && t.trim());
        const orClause = unique.map(t => `"${t}"`).join(' OR ');
        return unique.length > 1 ? `(${orClause})` : orClause;
      });
      const prismQuery = blockQueries.join(' AND ');
      const query = prismQuery || terms.map((term) => `"${term}"`).join(' AND ');

      // Generate database-specific syntax hints
      const syntaxHints: string[] = [];
      if (database === 'pubmed') syntaxHints.push('Use [MeSH] tags where available', 'Apply PMID/DOI filter');
      if (database === 'ovid') syntaxHints.push('Use .mp. for multi-purpose fields', 'Apply /freq=2 for high-frequency terms');
      if (database === 'scopus') syntaxHints.push('Use TITLE-ABS-KEY() wrapper', 'Apply LIMIT-TO for document types');
      if (database === 'wos') syntaxHints.push('Use TS=() field tag', 'Apply DT= for document type filtering');
      if (database === 'cinahl') syntaxHints.push('Use MH for CINAHL Headings', 'Apply PT for publication type');

      return {
        database,
        purpose: commission.strategy === 'living-update' ? 'surveillance' : 'primary-studies',
        platform: profile?.platform ?? 'Generic browser/API adapter',
        query,
        syntaxHints: syntaxHints.length ? syntaxHints : undefined,
        prismBlocks: activeBlocks.map(([code]) => code),
        generatedAt: context.now(),
      } as any;
    });

    if (!commission.requiresPrimaryStudySearch) {
      warnings.push('The commission decision does not require a de novo primary-study search; generated searches are limited to reuse verification and currency checking.');
    }
    return { artifacts: { searchStrategies: strategies }, warnings };
  }
}

export class SearchExecuteAgent implements Agent {
  readonly stage = 'search-execute' as const;
  private readonly adapters: Map<string, EvidenceSourceAdapter>;

  constructor(adapters: EvidenceSourceAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.database.toLowerCase(), adapter]));
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const strategies = artifact<SearchStrategy[]>(context, 'searchStrategies');
    const allRecords: EvidenceRecord[] = [];
    const provenance = [];
    const warnings: string[] = [];

    for (const strategy of strategies) {
      const adapter = this.adapters.get(strategy.database.toLowerCase());
      if (!adapter) throw new Error(`No approved search adapter configured for ${strategy.database}`);
      const result = await adapter.execute(strategy);
      allRecords.push(...result.records);
      provenance.push(result.provenance);
      warnings.push(...result.provenance.warnings);
      if (result.provenance.resultCount !== result.records.length) {
        throw new Error(`Export reconciliation failed for ${strategy.database}: count=${result.provenance.resultCount}, exported=${result.records.length}`);
      }
    }

    return { artifacts: { searchResults: allRecords, searchProvenance: provenance }, warnings };
  }
}

export class DeduplicationAgent implements Agent {
  readonly stage = 'deduplicate' as const;

  async execute(context: AgentContext): Promise<AgentResult> {
    const records = artifact<EvidenceRecord[]>(context, 'searchResults');
    const unique: EvidenceRecord[] = [];
    const clusters: Array<{ retained: string; removed: string; reason: string }> = [];

    for (const record of records) {
      const duplicate = unique.find((candidate) => {
        if (record.doi && candidate.doi && normaliseText(record.doi) === normaliseText(candidate.doi)) return true;
        if (record.pmid && candidate.pmid && record.pmid === candidate.pmid) return true;
        return record.year === candidate.year && jaccard(record.title, candidate.title) >= 0.92;
      });

      if (!duplicate) {
        unique.push({ ...record, sourceDatabases: [...new Set(record.sourceDatabases)] });
      } else {
        duplicate.sourceDatabases = [...new Set([...duplicate.sourceDatabases, ...record.sourceDatabases])];
        clusters.push({
          retained: duplicate.id,
          removed: record.id,
          reason: record.doi && duplicate.doi === record.doi ? 'DOI match' : 'Identifier/title match',
        });
      }
    }

    return {
      artifacts: {
        uniqueRecords: unique,
        deduplicationReport: {
          imported: records.length,
          unique: unique.length,
          duplicatesRemoved: clusters.length,
          clusters,
        },
      },
    };
  }
}

function decisionForRecord(record: EvidenceRecord, context: AgentContext): ScreeningDecision {
  const q = context.state.request.question;
  const rawConcepts = [q.population, q.interventionOrExposure, ...(q.outcomes ?? [])].filter((v): v is string => typeof v === 'string' && Boolean(v));
  const conceptTerms = (q.concepts ?? []).flatMap((c: any) => typeof c === 'string' ? [c] : [...(c.terms || []), ...(c.freeText || [])]);
  const concepts = [...rawConcepts, ...conceptTerms]
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
    .flatMap((value) => normaliseText(String(value)).split(' '))
    .filter((value) => value.length > 3);
  const haystack = normaliseText(`${record.title} ${record.abstract} ${(record.keywords ?? []).join(' ')}`);
  const matches = concepts.filter((term) => haystack.includes(term));
  const threshold = Math.max(1, Math.min(2, new Set(concepts).size));
  const include = new Set(matches).size >= threshold;
  const generated: ScreeningDecision = {
    recordId: record.id,
    decision: include ? 'include' : 'exclude',
    reason: include ? 'Matches prespecified concepts' : 'No sufficient match to eligibility concepts',
    confidence: include ? Math.min(0.99, 0.72 + matches.length * 0.05) : 0.88,
    evidence: matches.slice(0, 6),
    evidenceExcerpts: [excerpt({
      recordId: record.id,
      section: 'other',
      page: 0,
      quote: `${record.title}\n\n${record.abstract}`,
      source: 'title-abstract',
      heading: 'Title and abstract',
    })],
  };
  const override = overrideValue<{ decision: ScreeningDecision['decision']; reason?: string }>(context, `tiab:${record.id}`, {
    decision: generated.decision,
    reason: generated.reason,
  });
  return override.overridden
    ? {
        ...generated,
        decision: override.value.decision,
        reason: override.value.reason ?? generated.reason,
        confidence: 1,
        humanOverride: true,
      }
    : generated;
}

export class TiabScreeningAgent implements Agent {
  readonly stage = 'tiab-screen' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const records = artifact<EvidenceRecord[]>(context, 'uniqueRecords');
    const decisions = records.map((record) => decisionForRecord(record, context));
    const byId = new Map(records.map((record) => [record.id, record]));
    const included = decisions
      .filter((decision) => decision.decision !== 'exclude')
      .map((decision) => byId.get(decision.recordId))
      .filter((record): record is EvidenceRecord => Boolean(record));
    return { artifacts: { tiabDecisions: decisions, tiabIncluded: included } };
  }
}

export class FullTextRetrievalAgent implements Agent {
  readonly stage = 'fulltext-retrieve' as const;
  constructor(private readonly retrieval: FullTextRetrievalPort) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const records = artifact<EvidenceRecord[]>(context, 'tiabIncluded');
    const fullTexts: FullTextDocument[] = [];
    const missing: string[] = [];
    for (const record of records) {
      const document = await this.retrieval.retrieve(record);
      if (document) fullTexts.push(document);
      else missing.push(record.id);
    }
    return {
      artifacts: {
        fullTexts,
        retrievalReport: { requested: records.length, retrieved: fullTexts.length, missing },
      },
      warnings: missing.length > 0 ? [`${missing.length} full texts require manual retrieval`] : [],
    };
  }
}

export class PdfToTextAgent implements Agent {
  readonly stage = 'pdf-to-text' as const;
  constructor(private readonly extractor: PdfTextExtractionPort) {}
  async execute(context: AgentContext): Promise<AgentResult> {
    const fullTexts = artifact<FullTextDocument[]>(context, 'fullTexts');
    const parsedDocuments: ParsedDocument[] = [];
    for (const document of fullTexts) parsedDocuments.push(await this.extractor.extract(document));
    return { artifacts: { parsedDocuments } };
  }
}

export class FullTextScreeningAgent implements Agent {
  readonly stage = 'fulltext-screen' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const documents = artifact<ParsedDocument[]>(context, 'parsedDocuments');
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const includeTerms = plan.eligibility.include
      .flatMap((criterion) => normaliseText(String(criterion)).split(' '))
      .filter((term) => term.length > 4 && !['relevant', 'population', 'evidence', 'stated'].includes(term));
    const decisions: ScreeningDecision[] = documents.map((document) => {
      const text = normaliseText(document.text);
      const matches = [...new Set(includeTerms.filter((term) => text.includes(term)))];
      const include = matches.length > 0 || includeTerms.length === 0;
      const supportingSections = document.sections
        .filter((section) => matches.some((term) => normaliseText(section.text).includes(term)))
        .slice(0, 5)
        .map((section) => excerpt({
          recordId: document.recordId,
          section: section.name,
          page: section.pageStart,
          quote: section.text.slice(0, 1800),
          source: 'full-text',
          heading: section.heading,
        }));
      const generated: ScreeningDecision = {
        recordId: document.recordId,
        decision: include ? 'include' : 'exclude',
        reason: include ? 'Full text meets eligibility criteria' : 'Full text lacks prespecified eligible concepts',
        confidence: include ? 0.9 : 0.85,
        evidence: matches.slice(0, 8),
        evidenceExcerpts: supportingSections.length > 0
          ? supportingSections
          : document.sections.slice(0, 3).map((section) => excerpt({
              recordId: document.recordId,
              section: section.name,
              page: section.pageStart,
              quote: section.text.slice(0, 1800),
              source: 'full-text',
              heading: section.heading,
            })),
      };
      const override = overrideValue<{ decision: ScreeningDecision['decision']; reason?: string }>(context, `fulltext:${document.recordId}`, {
        decision: generated.decision,
        reason: generated.reason,
      });
      return override.overridden
        ? {
            ...generated,
            decision: override.value.decision,
            reason: override.value.reason ?? generated.reason,
            confidence: 1,
            humanOverride: true,
          }
        : generated;
    });
    const includedIds = new Set(decisions.filter((decision) => decision.decision === 'include').map((decision) => decision.recordId));
    return {
      artifacts: {
        fullTextDecisions: decisions,
        includedDocuments: documents.filter((document) => includedIds.has(document.recordId)),
      },
    };
  }
}

export class ExtractionAgent implements Agent {
  readonly stage = 'extract' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const documents = artifact<ParsedDocument[]>(context, 'includedDocuments');
    const records = artifact<EvidenceRecord[]>(context, 'uniqueRecords');
    const recordById = new Map(records.map((record) => [record.id, record]));
    const q = context.state.request.question;
    const warnings: string[] = [];

    const studies: ExtractedStudy[] = documents.map((document) => {
      const record = recordById.get(document.recordId);
      if (!record) throw new Error(`Record missing for parsed document ${document.recordId}`);
      const lower = document.text.toLowerCase();
      const studyId = `study-${record.id}`;
      const methodsEvidence = sectionExcerpts(document, 'methods');
      const sectionEvidence: Record<RequiredEvidenceSection, EvidenceExcerpt[]> = {
        rationale: sectionExcerpts(document, 'rationale'),
        objectives: sectionExcerpts(document, 'objectives'),
        results: sectionExcerpts(document, 'results'),
        discussion: sectionExcerpts(document, 'discussion'),
        limitations: sectionExcerpts(document, 'limitations'),
      };
      for (const [section, values] of Object.entries(sectionEvidence)) {
        if (values.length === 0) warnings.push(`${record.id} is missing explicit ${section} evidence`);
      }

      const generatedDesign = lower.includes('random')
        ? 'randomised controlled trial'
        : lower.includes('cohort')
          ? 'cohort study'
          : 'observational study';
      const conceptNames = (q.concepts ?? []).flatMap((c: any) => typeof c === 'string' ? [c] : [...(c.terms || []), c.name || '']).filter(Boolean);
      const generatedMechanisms = conceptNames.filter((term) => lower.includes(String(term).toLowerCase()));
      const generatedOutcomes = (q.outcomes ?? ['Primary outcome']).map((name) => ({
        name,
        ...(record.effect !== undefined ? { effect: record.effect } : {}),
        ...(record.standardError !== undefined ? { standardError: record.standardError } : {}),
      }));
      const core = overrideValue<{
        design: string;
        population: string;
        interventionOrExposure: string;
        comparator: string;
        mechanisms: string[];
        funding: string;
      }>(context, `extract:${studyId}:core`, {
        design: generatedDesign,
        population: q.population ?? 'Not specified',
        interventionOrExposure: q.interventionOrExposure ?? 'Not specified',
        comparator: q.comparator ?? 'Not specified',
        mechanisms: generatedMechanisms,
        funding: lower.includes('funded by') ? 'Reported in full text' : 'Not reported',
      });
      const rationale = overrideValue(context, `extract:${studyId}:rationale`, firstSectionText(document, 'rationale')).value;
      const objectives = overrideValue<string[]>(context, `extract:${studyId}:objectives`, [firstSectionText(document, 'objectives')]).value;
      const resultsSummary = overrideValue(context, `extract:${studyId}:results`, firstSectionText(document, 'results')).value;
      const discussionSummary = overrideValue(context, `extract:${studyId}:discussion`, firstSectionText(document, 'discussion')).value;
      const limitations = overrideValue<string[]>(context, `extract:${studyId}:limitations`, [firstSectionText(document, 'limitations')]).value;
      const outcomes = generatedOutcomes.map((outcome) => {
        const itemId = `extract:${studyId}:outcome:${stableHash(outcome.name).slice(0, 10)}`;
        return overrideValue(context, itemId, outcome).value;
      });

      const fieldEvidence: Record<string, EvidenceExcerpt[]> = {
        core: [...methodsEvidence, ...sectionEvidence.objectives, ...sectionEvidence.discussion],
        outcomes: sectionEvidence.results,
        mechanisms: [...sectionEvidence.results, ...sectionEvidence.discussion],
        funding: sectionExcerpts(document, 'other'),
      };
      const sourceQuotes = Object.entries(sectionEvidence).flatMap(([section, values]) => values.map((value) => ({
        field: section,
        section: value.section,
        page: value.page,
        quote: value.quote,
      })));

      return {
        studyId,
        reportIds: [record.id],
        design: core.value.design,
        population: core.value.population,
        interventionOrExposure: core.value.interventionOrExposure,
        comparator: core.value.comparator,
        outcomes,
        mechanisms: core.value.mechanisms,
        funding: core.value.funding,
        rationale,
        objectives,
        resultsSummary,
        discussionSummary,
        limitations,
        sectionEvidence,
        fieldEvidence,
        sourceQuotes,
      };
    });
    return { artifacts: { extractedStudies: studies }, warnings };
  }
}

export class RiskOfBiasAgent implements Agent {
  readonly stage = 'risk-of-bias' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const studies = artifact<ExtractedStudy[]>(context, 'extractedStudies');
    const assessments: RiskOfBiasAssessment[] = studies.map((study) => {
      const randomised = study.design.includes('randomised');
      const tool = context.state.request.reviewType === 'animal'
        ? 'SYRCLE risk of bias'
        : randomised ? 'RoB 2' : 'ROBINS-I';
      const generatedDomains: RiskOfBiasAssessment['domains'] = [
        {
          domain: 'Selection/allocation',
          judgement: randomised ? 'low' : 'some-concerns',
          rationale: randomised ? 'Random allocation reported' : 'Non-random allocation',
          evidence: study.fieldEvidence.core ?? [],
        },
        {
          domain: 'Missing data',
          judgement: 'some-concerns',
          rationale: 'Automated extraction requires reviewer verification of attrition and missingness',
          evidence: [...study.sectionEvidence.results, ...study.sectionEvidence.limitations],
        },
        {
          domain: 'Selective reporting',
          judgement: 'some-concerns',
          rationale: 'Protocol or registry comparison has not yet been independently confirmed',
          evidence: [...study.sectionEvidence.objectives, ...study.sectionEvidence.results, ...study.sectionEvidence.limitations],
        },
      ];
      const domains = generatedDomains.map((domain) => {
        const itemId = `rob:${study.studyId}:${stableHash(domain.domain).slice(0, 10)}`;
        const overridden = overrideValue<{ judgement: typeof domain.judgement; rationale?: string }>(context, itemId, {
          judgement: domain.judgement,
          rationale: domain.rationale,
        });
        return overridden.overridden
          ? {
              ...domain,
              judgement: overridden.value.judgement,
              rationale: overridden.value.rationale ?? domain.rationale,
              humanOverride: true,
            }
          : domain;
      });
      const rank = { low: 0, 'some-concerns': 1, high: 2 } as const;
      const overall = domains.reduce<RiskOfBiasAssessment['overall']>((current, domain) => {
        return rank[domain.judgement] > rank[current] ? domain.judgement : current;
      }, 'low');
      return { studyId: study.studyId, tool, domains, overall };
    });
    return { artifacts: { riskOfBias: assessments } };
  }
}

export class SynthesisAgent implements Agent {
  readonly stage = 'synthesise' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const studies = artifact<ExtractedStudy[]>(context, 'extractedStudies');
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const estimates = studies
      .flatMap((study) => study.outcomes)
      .filter((outcome): outcome is { name: string; effect: number; standardError: number } =>
        typeof outcome.effect === 'number' && typeof outcome.standardError === 'number' && outcome.standardError > 0,
      );

    const specialistAdapters: Partial<Record<ReviewPlan['synthesisMode'], string>> = {
      'network-meta-analysis': 'network-meta-analysis-adapter',
      'diagnostic-meta-analysis': 'bivariate-hsroc-adapter',
      'prognostic-meta-analysis': 'prognosis-time-horizon-adapter',
      'prediction-model-meta-analysis': 'prediction-performance-adapter',
      'prevalence-meta-analysis': 'proportion-meta-analysis-adapter',
      qualitative: 'qualitative-synthesis-adapter',
      'mixed-methods': 'mixed-methods-integration-adapter',
      umbrella: 'review-overlap-and-umbrella-adapter',
      economic: 'economic-normalisation-adapter',
      mechanistic: 'causal-mechanism-synthesis-adapter',
    };

    let generated: SynthesisResult;
    if (plan.synthesisMode === 'meta-analysis' && estimates.length >= 2) {
      const weights = estimates.map((estimate) => 1 / (estimate.standardError ** 2));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const pooled = estimates.reduce((sum, estimate, index) => sum + estimate.effect * (weights[index] ?? 0), 0) / totalWeight;
      const standardError = Math.sqrt(1 / totalWeight);
      const q = estimates.reduce((sum, estimate, index) => sum + (weights[index] ?? 0) * ((estimate.effect - pooled) ** 2), 0);
      const i2 = q <= 0 ? 0 : Math.max(0, ((q - (estimates.length - 1)) / q) * 100);
      generated = {
        mode: plan.synthesisMode,
        status: 'computed',
        modelSpecification: 'common-effect inverse-variance model; production use requires prespecified heterogeneity and effect-scale checks',
        includedStudies: studies.length,
        pooledEffect: pooled,
        standardError,
        heterogeneity: i2,
        narrative: `Inverse-variance synthesis of ${estimates.length} estimates. Pooling remains subject to clinical, methodological, and human verification.`,
        evidence: studies.flatMap((study) => study.sectionEvidence.results),
      };
    } else if (specialistAdapters[plan.synthesisMode]) {
      const specialistAdapter = specialistAdapters[plan.synthesisMode];
      if (!specialistAdapter) throw new Error(`No specialist adapter mapping for ${plan.synthesisMode}`);
      generated = {
        mode: plan.synthesisMode,
        status: 'deferred-specialist',
        specialistAdapter,
        capabilityWarnings: [`${plan.synthesisMode} cannot be validly replaced by generic inverse-variance pooling.`],
        includedStudies: studies.length,
        narrative: `${studies.length} studies were prepared for ${plan.synthesisMode}. Numerical synthesis is blocked until the designated specialist adapter validates the required structure and assumptions.`,
        evidence: studies.flatMap((study) => [...study.sectionEvidence.results, ...study.sectionEvidence.discussion]),
      };
    } else {
      generated = {
        mode: plan.synthesisMode,
        status: 'narrative',
        includedStudies: studies.length,
        narrative: `${studies.length} studies synthesised using ${plan.synthesisMode}; quantitative pooling was not forced.`,
        evidence: studies.flatMap((study) => [...study.sectionEvidence.results, ...study.sectionEvidence.discussion]),
      };
    }
    const overridden = overrideValue<Partial<SynthesisResult>>(context, 'synthesis:overall', {});
    const result = overridden.overridden
      ? { ...generated, ...overridden.value, humanOverride: true }
      : generated;
    return result.capabilityWarnings
      ? { artifacts: { synthesis: result }, warnings: result.capabilityWarnings }
      : { artifacts: { synthesis: result } };
  }
}

export class GradeAgent implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const synthesis = artifact<SynthesisResult>(context, 'synthesis');
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const riskOfBias = artifact<RiskOfBiasAssessment[]>(context, 'riskOfBias');
    const studies = artifact<ExtractedStudy[]>(context, 'extractedStudies');
    const q = context.state.request.question;
    const concerns = riskOfBias.some((assessment) => assessment.overall !== 'low');
    const imprecision = synthesis.standardError === undefined || synthesis.standardError > 0.2;
    const assessments: GradeAssessment[] = (q.outcomes?.length ? q.outcomes : ['Primary outcome']).map((outcome) => {
      const generated: GradeAssessment = {
        outcome,
        certainty: concerns && imprecision ? 'low' : concerns || imprecision ? 'moderate' : 'high',
        rationale: [
          `Certainty framework: ${plan.certaintyFramework}`,
          concerns ? 'Downgraded for risk-of-bias concerns' : 'No serious risk-of-bias concern identified',
          imprecision ? 'Downgraded for imprecision or unavailable variance' : 'No serious imprecision identified',
        ],
        evidence: studies.flatMap((study) => [
          ...study.sectionEvidence.results,
          ...study.sectionEvidence.limitations,
        ]),
      };
      const itemId = `grade:${stableHash(outcome).slice(0, 12)}`;
      const overridden = overrideValue<Partial<GradeAssessment>>(context, itemId, {});
      return overridden.overridden
        ? { ...generated, ...overridden.value, humanOverride: true }
        : generated;
    });
    return { artifacts: { grade: assessments } };
  }
}

export class ReportAgent implements Agent {
  readonly stage = 'report' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    const plan = artifact<ReviewPlan>(context, 'reviewPlan');
    const commission = artifact<ReviewCommissionDecision>(context, 'reviewCommissionDecision');
    const dedup = artifact<{ imported: number; unique: number }>(context, 'deduplicationReport');
    const tiab = artifact<ScreeningDecision[]>(context, 'tiabDecisions');
    const fullText = artifact<ScreeningDecision[]>(context, 'fullTextDecisions');
    const studies = artifact<ExtractedStudy[]>(context, 'extractedStudies');
    const synthesis = artifact<SynthesisResult>(context, 'synthesis');
    const grade = context.state.artifacts.grade as GradeAssessment[] | undefined;
    const riskOfBias = context.state.artifacts.riskOfBias as RiskOfBiasAssessment[] | undefined;
    const generatedConclusion = `Evidence was synthesised using ${synthesis.mode}.`;
    const conclusion = overrideValue(context, 'report:conclusion', generatedConclusion).value;

    const draftReport = {
      title: context.state.request.question.title,
      abstract: `${plan.reviewType} review with ${studies.length} included studies. ${synthesis.narrative}`,
      prisma: {
        identified: dedup.imported,
        afterDeduplication: dedup.unique,
        tiabIncluded: tiab.filter((decision) => decision.decision === 'include').length,
        fullTextIncluded: fullText.filter((decision) => decision.decision === 'include').length,
      },
      sections: {
        methods: `The review followed ${plan.reportingStandards.join(', ')} using a ${plan.questionFramework} framework. The commission route was ${commission.strategy}.`,
        results: synthesis.narrative,
        discussion: studies.map((study) => study.discussionSummary).join('\n\n'),
        limitations: studies.flatMap((study) => study.limitations).join('\n'),
        conclusion,
      },
      appendices: {
        methodologyProfile: plan,
        commissionDecision: commission,
        protocolPackage: context.state.artifacts.protocolPackage,
        protocolRegistrationLedger: context.state.artifacts.protocolRegistrationLedger,
        registrationReceipts: context.state.artifacts.registrationReceipts,
        searchStrategies: context.state.artifacts.searchStrategies,
        searchProvenance: context.state.artifacts.searchProvenance,
        deduplication: context.state.artifacts.deduplicationReport,
        excludedFullTexts: fullText.filter((decision) => decision.decision === 'exclude'),
        extractedEvidence: studies.map((study) => ({
          studyId: study.studyId,
          sectionEvidence: study.sectionEvidence,
          fieldEvidence: study.fieldEvidence,
        })),
        riskOfBias: riskOfBias ?? 'Not required for this review type',
        grade: grade ?? 'Not required for this review type',
        audit: context.state.audit,
      },
    };
    return { artifacts: { draftReport } };
  }
}

export function createPipelineAgents(input: {
  searchAdapters: EvidenceSourceAdapter[];
  fullTextRetrieval: FullTextRetrievalPort;
  pdfExtractor: PdfTextExtractionPort;
  identity: ResearcherIdentityPort;
  searchTester: SearchStrategyTestingPort;
  registryAdapters?: ProtocolRegistryAdapter[];
  humanVerification?: HumanVerificationPort;
}): Agent[] {
  return [
    new QuestionAgent(),
    new ResearcherIdentityAgent(input.identity),
    new ProtocolAgent(),
    new ReviewLandscapeAgent(),
    new ProtocolDraftAgent(),
    new SearchBuildAgent(),
    new SearchStrategyTestAgent(input.searchTester),
    new ProtocolFinaliseAgent(),
    new ProtocolRegistrationAgent(input.registryAdapters ?? []),
    new SearchExecuteAgent(input.searchAdapters),
    new DeduplicationAgent(),
    new TiabScreeningAgent(),
    new FullTextRetrievalAgent(input.fullTextRetrieval),
    new PdfToTextAgent(input.pdfExtractor),
    new FullTextScreeningAgent(),
    new ExtractionAgent(),
    new RiskOfBiasAgent(),
    new SynthesisAgent(),
    new GradeAgent(),
    new ReportAgent(),
    new HumanVerificationAgent(input.humanVerification),
  ];
}
