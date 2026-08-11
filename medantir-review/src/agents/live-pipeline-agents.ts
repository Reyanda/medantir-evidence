import { createPipelineAgents } from './pipeline-agents.js';
import type { Agent, AgentContext, AgentResult, EvidenceRecord, ParsedDocument, ScreeningDecision, SearchStrategy } from '../core/types.js';
import { normaliseText } from '../core/utils.js';
import { documentIntelligenceOf } from '../document/document-intelligence.js';
import { OutcomeAwareSynthesisAgent } from '../synthesis/outcome-aware-agent.js';
import { ForestPlotReportAgent } from '../visualization/forest-plot-agent.js';

export interface SearchConceptBlock {
  code: string;
  role: 'population' | 'intervention' | 'design' | 'geography' | 'other';
  terms: string[];
  required?: boolean;
}

export interface SearchConceptPlan {
  population?: string[];
  intervention?: string[];
  design?: string[];
  geography?: string[];
  /**
   * Explicit compositional concept groups. Terms inside a block are synonyms
   * (OR); required blocks are combined with AND. This is how combination
   * interventions and multi-exposure questions avoid being flattened into one
   * brittle phrase.
   */
  blocks?: SearchConceptBlock[];
}

type RequestWithSearchConcepts = AgentContext['state']['request'] & {
  /**
   * Optional source-neutral semantic search expansion supplied by the search
   * intelligence layer. This is deliberately separate from the protocol's
   * human-readable PICO wording: search terms may be broader than eligibility.
   */
  searchConcepts?: SearchConceptPlan;
};

function cleanTerms(values: Array<string | undefined>): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function quote(term: string): string {
  return `"${term.replaceAll('"', '\\"')}"`;
}

function orBlock(terms: string[]): string | null {
  const unique = cleanTerms(terms);
  if (unique.length === 0) return null;
  const rendered = unique.map(quote).join(' OR ');
  return unique.length === 1 ? rendered : `(${rendered})`;
}

function isRecallFirstInterventionReview(reviewType: string): boolean {
  return ['systematic', 'intervention', 'rapid', 'living'].includes(reviewType);
}

interface PlannedBlock {
  code: string;
  role: SearchConceptBlock['role'];
  query: string;
  terms: string[];
}

function explicitBlocks(plan: SearchConceptPlan): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  for (const block of plan.blocks ?? []) {
    if (block.required === false) continue;
    const terms = cleanTerms(block.terms);
    const query = orBlock(terms);
    if (query) blocks.push({ code: block.code, role: block.role, query, terms });
  }
  return blocks;
}

function fallbackBlocks(
  question: AgentContext['state']['request']['question'],
  plan: SearchConceptPlan,
): PlannedBlock[] {
  const candidates: Array<{ code: string; role: SearchConceptBlock['role']; terms: string[] }> = [
    { code: 'P', role: 'population', terms: cleanTerms([question.population, ...(plan.population ?? [])]) },
    { code: 'I', role: 'intervention', terms: cleanTerms([question.interventionOrExposure, ...(plan.intervention ?? [])]) },
    { code: 'D', role: 'design', terms: cleanTerms(plan.design ?? []) },
    { code: 'G', role: 'geography', terms: cleanTerms(plan.geography ?? []) },
  ];
  const blocks: PlannedBlock[] = [];
  for (const candidate of candidates) {
    const query = orBlock(candidate.terms);
    if (query) blocks.push({ ...candidate, query });
  }
  return blocks;
}

/**
 * Wrap the existing semantic search builder with a recall-first scientific
 * planning policy for live execution.
 *
 * The protocol question remains unchanged. Only the retrieval expression is
 * widened. In intervention-effect reviews, outcome terms are intentionally not
 * made mandatory in the primary search because outcome reporting/wording is
 * too variable and can create false negatives. Population/condition and
 * intervention concept families are searched; optional validated design or
 * geography blocks may be added explicitly by the search-intelligence layer.
 */
export class RecallFirstSearchBuildAgent implements Agent {
  readonly stage = 'search-build' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const baseResult = await this.base.execute(context);
    if (!isRecallFirstInterventionReview(context.state.request.reviewType)) return baseResult;

    const request = context.state.request as RequestWithSearchConcepts;
    const plan = request.searchConcepts;
    if (!plan) {
      return {
        ...baseResult,
        warnings: [
          ...(baseResult.warnings ?? []),
          'Recall-first live execution has no explicit searchConcepts expansion; retaining the generated strategy unchanged.',
        ],
      };
    }

    const question = request.question;
    const specified = explicitBlocks(plan);
    const blocks = specified.length > 0 ? specified : fallbackBlocks(question, plan);

    const hasPopulation = blocks.some((block) => block.role === 'population');
    const hasIntervention = blocks.some((block) => block.role === 'intervention');
    if (!hasPopulation || !hasIntervention) {
      throw new Error('Recall-first intervention search requires at least one population/condition block and one intervention block.');
    }

    const semanticQuery = blocks.map((block) => block.query).join(' AND ');
    const generated = (baseResult.artifacts.searchStrategies ?? []) as SearchStrategy[];
    const strategies = generated.map((strategy) => ({
      ...strategy,
      query: semanticQuery,
      prismBlocks: blocks.map((block) => block.code),
      searchRationale: {
        mode: 'recall-first-intervention',
        searchedConcepts: Object.fromEntries(blocks.map((block) => [block.code, block.terms])),
        conceptRoles: Object.fromEntries(blocks.map((block) => [block.code, block.role])),
        omittedMandatoryConcepts: question.outcomes?.length ? ['outcome'] : [],
        protocolOutcomesRetainedForEligibility: question.outcomes ?? [],
      },
    }));

    return {
      ...baseResult,
      artifacts: { ...baseResult.artifacts, searchStrategies: strategies },
      warnings: [
        ...(baseResult.warnings ?? []),
        ...(question.outcomes?.length
          ? ['Recall-first intervention retrieval omitted outcome terms as mandatory search blocks; outcomes remain locked eligibility/extraction criteria.']
          : []),
      ],
    };
  }
}

interface EvidenceKindAssessment {
  clinicalSignals: string[];
  nonClinicalSignals: string[];
  highSpecificityNonClinical: boolean;
}

const CLINICAL_PATTERNS: Array<[RegExp, string]> = [
  [/\brandomi[sz](?:ed|ation)?\b/i, 'randomized'],
  [/\bclinical trial\b/i, 'clinical-trial'],
  [/\bpatients?\b/i, 'patients'],
  [/\bparticipants?\b/i, 'participants'],
  [/\bhospitali[sz]ed\b|\bhospital\b/i, 'hospital'],
  [/\bplacebo\b/i, 'placebo'],
  [/\bcohort\b/i, 'cohort'],
  [/\bmortality\b|\bsurvival\b/i, 'mortality-survival'],
  [/\brecovery\b|\bclinical improvement\b/i, 'recovery'],
  [/\badverse events?\b|\bsafety\b/i, 'safety'],
  [/\bfollow[- ]?up\b/i, 'follow-up'],
  [/\bintensive care\b|\bicu\b/i, 'critical-care'],
];

const NON_CLINICAL_PATTERNS: Array<[RegExp, string]> = [
  [/spectrofluor/i, 'spectrofluorimetry'],
  [/spectrophotometr/i, 'spectrophotometry'],
  [/chromatograph/i, 'chromatography'],
  [/\bsimultaneous determination\b/i, 'analytical-determination'],
  [/\banalytical method\b|\bmethod validation\b/i, 'analytical-method'],
  [/\bpharmaceutical formulation\b|\btablets?\b|\bdosage form\b/i, 'formulation'],
  [/\bmolecular docking\b/i, 'molecular-docking'],
  [/\bin vitro\b|\bcell lines?\b/i, 'in-vitro'],
  [/\bquantification\b.*\bplasma\b|\bassay\b/i, 'assay'],
];

function evidenceKind(text: string): EvidenceKindAssessment {
  const clinicalSignals = CLINICAL_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const nonClinicalSignals = NON_CLINICAL_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return {
    clinicalSignals,
    nonClinicalSignals,
    highSpecificityNonClinical: nonClinicalSignals.length > 0 && clinicalSignals.length === 0,
  };
}

function expectsHumanClinicalEvidence(context: AgentContext): boolean {
  if (!isRecallFirstInterventionReview(context.state.request.reviewType)) return false;
  const population = normaliseText(context.state.request.question.population ?? '');
  return /\b(?:adults?|patients?|participants?|humans?|people|hospital(?:s|ized|ised)?)\b/.test(population);
}

export class EvidenceGatedTiabScreeningAgent implements Agent {
  readonly stage = 'tiab-screen' as const;
  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    if (!expectsHumanClinicalEvidence(context)) return result;

    const records = context.state.artifacts.uniqueRecords as EvidenceRecord[];
    const byId = new Map(records.map((record) => [record.id, record]));
    const original = (result.artifacts.tiabDecisions ?? []) as ScreeningDecision[];
    let excludedAsNonClinical = 0;
    let downgradedToUncertain = 0;

    const decisions = original.map((decision) => {
      if (decision.decision === 'exclude') return decision;
      const record = byId.get(decision.recordId);
      if (!record) return decision;
      const assessment = evidenceKind(`${record.title}\n${record.abstract}\n${(record.keywords ?? []).join(' ')}`);
      if (assessment.highSpecificityNonClinical) {
        excludedAsNonClinical += 1;
        return {
          ...decision,
          decision: 'exclude' as const,
          reason: `High-specificity non-clinical evidence object (${assessment.nonClinicalSignals.join(', ')}) with no human/clinical study signal`,
          confidence: 0.97,
          evidence: [...new Set([...decision.evidence, ...assessment.nonClinicalSignals])],
        };
      }
      if (assessment.clinicalSignals.length === 0 && decision.decision === 'include') {
        downgradedToUncertain += 1;
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: 'Search concepts match, but title/abstract lacks a sufficiently specific human clinical-study signal; retain for recall and verify at full text',
          confidence: Math.min(decision.confidence, 0.65),
        };
      }
      return {
        ...decision,
        evidence: [...new Set([...decision.evidence, ...assessment.clinicalSignals])],
      };
    });

    const includedIds = new Set(decisions.filter((decision) => decision.decision !== 'exclude').map((decision) => decision.recordId));
    const included = records.filter((record) => includedIds.has(record.id));
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        tiabDecisions: decisions,
        tiabIncluded: included,
        tiabScreeningQuality: {
          total: decisions.length,
          excludedAsHighSpecificityNonClinical: excludedAsNonClinical,
          retainedAsUncertainForRecall: downgradedToUncertain,
          clinicalSignalRequiredForAutomaticInclude: true,
        },
      },
      warnings: [
        ...(result.warnings ?? []),
        ...(excludedAsNonClinical > 0 ? [`Evidence gate excluded ${excludedAsNonClinical} high-specificity non-clinical title/abstract records.`] : []),
        ...(downgradedToUncertain > 0 ? [`Evidence gate retained ${downgradedToUncertain} records as uncertain rather than auto-including without a clinical-study signal.`] : []),
      ],
    };
  }
}

export class EvidenceGatedFullTextScreeningAgent implements Agent {
  readonly stage = 'fulltext-screen' as const;
  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    if (!expectsHumanClinicalEvidence(context)) return result;

    const documents = context.state.artifacts.parsedDocuments as ParsedDocument[];
    const byId = new Map(documents.map((document) => [document.recordId, document]));
    const original = (result.artifacts.fullTextDecisions ?? []) as ScreeningDecision[];
    let rejectedNonClinical = 0;
    let documentDowngrades = 0;

    const decisions = original.map((decision) => {
      const document = byId.get(decision.recordId);
      if (!document) return decision;
      const intelligence = documentIntelligenceOf(document);
      if (intelligence?.downgradeOccurred) documentDowngrades += 1;
      if (decision.decision !== 'include') return decision;
      const assessment = evidenceKind(document.text);
      if (assessment.highSpecificityNonClinical) {
        rejectedNonClinical += 1;
        return {
          ...decision,
          decision: 'exclude' as const,
          reason: `Full text is a high-specificity non-clinical evidence object (${assessment.nonClinicalSignals.join(', ')}) without a human clinical-study signal`,
          confidence: 0.99,
          evidence: [...new Set([...decision.evidence, ...assessment.nonClinicalSignals])],
        };
      }
      return {
        ...decision,
        evidence: [...new Set([...decision.evidence, ...assessment.clinicalSignals])],
      };
    });

    const includedIds = new Set(decisions.filter((decision) => decision.decision === 'include').map((decision) => decision.recordId));
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        fullTextDecisions: decisions,
        includedDocuments: documents.filter((document) => includedIds.has(document.recordId)),
        fullTextScreeningQuality: {
          totalParsed: documents.length,
          rejectedAsHighSpecificityNonClinical: rejectedNonClinical,
          documentParseDowngrades: documentDowngrades,
        },
      },
      warnings: [
        ...(result.warnings ?? []),
        ...(rejectedNonClinical > 0 ? [`Full-text evidence gate excluded ${rejectedNonClinical} high-specificity non-clinical documents before extraction.`] : []),
        ...(documentDowngrades > 0 ? [`${documentDowngrades} document(s) were read through a lower document-intelligence tier after LiteParse did not satisfy the quality gate.`] : []),
      ],
    };
  }
}

export function createLivePipelineAgents(
  input: Parameters<typeof createPipelineAgents>[0],
): Agent[] {
  return createPipelineAgents(input).map((agent) => {
    if (agent.stage === 'search-build') return new RecallFirstSearchBuildAgent(agent);
    if (agent.stage === 'tiab-screen') return new EvidenceGatedTiabScreeningAgent(agent);
    if (agent.stage === 'fulltext-screen') return new EvidenceGatedFullTextScreeningAgent(agent);
    if (agent.stage === 'synthesise') return new OutcomeAwareSynthesisAgent(agent);
    if (agent.stage === 'report') return new ForestPlotReportAgent(agent);
    return agent;
  });
}
