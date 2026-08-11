import type { Agent, AgentContext, AgentResult, ParsedDocument, ScreeningDecision } from '../core/types.js';
import { normaliseText } from '../core/utils.js';

interface SearchConceptBlockLike {
  role?: string;
  terms?: string[];
  required?: boolean;
}

type SearchAwareRequest = AgentContext['state']['request'] & {
  searchConcepts?: { blocks?: SearchConceptBlockLike[] };
};

export interface SectionEligibilityAssessment {
  dominantNonClinical: boolean;
  secondaryResearchDominant: boolean;
  nonClinicalSignals: string[];
  secondaryResearchSignals: string[];
  clinicalStudyAnchors: string[];
  requiredInterventionGroups: string[][];
  matchedInterventionGroups: string[][];
  missingInterventionGroups: string[][];
  comparatorEstablished: boolean;
  requestedDesignEstablished: boolean;
  linkedProtocolOutcomes: string[];
  missingProtocolOutcomes: string[];
}

const NON_CLINICAL_CORE_PATTERNS: Array<[RegExp, string]> = [
  [/spectrofluor/i, 'spectrofluorimetry'],
  [/spectrophotometr/i, 'spectrophotometry'],
  [/chromatograph/i, 'chromatography'],
  [/\bsimultaneous (?:determination|quantification|estimation)\b/i, 'analytical-determination'],
  [/\banalytical (?:method|technique|procedure)\b|\bmethod validation\b/i, 'analytical-method'],
  [/\bpharmaceutical formulations?\b|\btablets?\b|\bdosage forms?\b/i, 'formulation'],
  [/\bmolecular docking\b|\bdocking score\b/i, 'molecular-docking'],
  [/\bin[ -]?vitro\b|\bcell lines?\b/i, 'in-vitro'],
  [/\b(?:spiked|synthetic) plasma\b|\bspiked serum\b/i, 'spiked-matrix'],
  [/\b(?:linearity|precision|accuracy|recovery)\b.{0,80}\b(?:assay|analytical|method)\b/i, 'assay-validation'],
  [/\b(?:limit of detection|limit of quantification|lod|loq)\b/i, 'analytical-limit'],
];

const SECONDARY_RESEARCH_PATTERNS: Array<[RegExp, string]> = [
  [/\bsystematic review\b/i, 'systematic-review'],
  [/\bmeta[- ]analysis\b/i, 'meta-analysis'],
  [/\bscoping review\b/i, 'scoping-review'],
  [/\bnarrative review\b|\bliterature review\b/i, 'literature-review'],
  [/\bprisma\b/i, 'prisma'],
  [/\bprospero\b/i, 'prospero'],
  [/\b(?:searched|searches of)\s+(?:pubmed|medline|embase|cochrane|web of science|cinahl)\b/i, 'database-search'],
  [/\b(?:electronic|literature) search(?:es| strategy)?\b/i, 'literature-search'],
  [/\bstudies were (?:included|eligible|selected)\b|\bincluded studies\b/i, 'included-studies'],
  [/\bsecondary data\b.{0,120}\b(?:no patients?|no patient data|did not involve patients?)\b/i, 'non-patient-secondary-data'],
];

const CLINICAL_STUDY_ANCHORS: Array<[RegExp, string]> = [
  [/\b(?:patients?|participants?|subjects?)\s+(?:were\s+)?(?:randomi[sz]ed|enrolled|recruited|(?:randomly\s+)?assigned|(?:randomly\s+)?allocated|followed)\b/i, 'participant-flow'],
  [/\b(?:we|investigators?)\s+(?:randomi[sz]ed|enrolled|recruited|included|(?:randomly\s+)?assigned|(?:randomly\s+)?allocated|followed)\b/i, 'investigator-enrolment'],
  [/\b(?:randomi[sz]ed|randomised)\s+(?:double[- ]blind\s+|open[- ]label\s+)?(?:controlled\s+)?(?:clinical\s+)?trial\b/i, 'randomized-trial'],
  [/\b(?:prospective|retrospective)\s+(?:observational\s+)?(?:cohort|clinical)\s+study\b/i, 'clinical-cohort'],
  [/\b(?:case[- ]control|cross[- ]sectional)\s+study\b/i, 'analytical-observational-study'],
  [/\b(?:cohort|sample)\s+of\s+\d+[\d,]*\s+(?:patients?|participants?|subjects?)\b/i, 'numbered-clinical-cohort'],
  [/\b(?:a total of\s+)?\d+[\d,]*\s+(?:patients?|participants?|subjects?)\s+(?:were\s+)?(?:enrolled|recruited|randomi[sz]ed|(?:randomly\s+)?assigned|(?:randomly\s+)?allocated|followed)\b/i, 'numbered-participant-flow'],
  [/\b(?:medical|hospital|electronic health) records?\b.{0,80}\b(?:patients?|participants?|cohort)\b/i, 'clinical-records-cohort'],
];

const ANALYTIC_RESULT_CUE = /\b(?:compared|versus|vs\.?|hazard ratio|risk ratio|relative risk|odds ratio|rate ratio|mean difference|confidence interval|95\s*%?\s*ci|associated with|association|significantly|difference|higher|lower|faster|slower|improved|reduced|increased|median|mean|survival|recovery)\b/i;
const REPORT_OWNERSHIP_CUE = /\b(?:we (?:found|observed|identified|demonstrated|report(?:ed)?|show(?:ed)?|estimated)|our (?:study|analysis|cohort|trial)|this (?:study|analysis|cohort|trial) (?:found|observed|identified|demonstrated|show(?:ed)?|report(?:ed)?)|patients? (?:receiving|received|were treated with|treated with|were assigned to|assigned to)|patients? who (?:received|were treated with|were assigned to)|participants? (?:receiving|received|were treated with|treated with|were assigned to|assigned to|randomi[sz]ed to)|participants? who (?:received|were treated with|were assigned to)|subjects? (?:receiving|received|were treated with|treated with|were assigned to|assigned to)|subjects? who (?:received|were treated with|were assigned to)|(?:treatment|intervention|exposure|control|placebo) group)\b/i;
const QUANTIFIED_RESULT_CUE = /(?:\b\d+(?:\.\d+)?\s*(?:%|days?|hours?|weeks?|months?|years?)\b|\b(?:hr|rr|or)\s*[=:]?\s*\d|\b(?:hazard|risk|relative risk|odds|rate) ratio\b.{0,40}\d|\b95\s*%?\s*ci\b|\bp\s*[<=>]\s*0?\.\d+|\bmedian\b.{0,60}\d|\bmean\b.{0,60}\d)/i;
const PRIOR_STUDY_CUE = /\b(?:previous|prior|earlier|another|other) (?:study|trial|analysis)|\b(?:study|trial) (?:by|of)\b|\b(?:actt[- ]?1|actt[- ]?2|recovery trial|solidarity trial)\b.{0,80}\b(?:showed|reported|demonstrated|found|effect)\b/i;
const TEMPORAL_RESULT_CUE = /\b(?:time|median|mean|days?|hours?|weeks?|months?|years?|faster|slower|hazard ratio|rate ratio|survival)\b/i;

function signals(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function requiredInterventionGroups(request: SearchAwareRequest): string[][] {
  const explicit = (request.searchConcepts?.blocks ?? [])
    .filter((block) => block.role === 'intervention' && block.required !== false)
    .map((block) => [...new Set((block.terms ?? []).map((term) => term.trim()).filter(Boolean))])
    .filter((terms) => terms.length > 0);
  if (explicit.length > 0) return explicit;

  const raw = request.question.interventionOrExposure?.trim();
  if (!raw) return [];
  const segments = raw
    .split(/\s*(?:\+|\bplus\b|\band\b|\bwith\b|\bversus\b|\bvs\.?\b)\s*/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  return (segments.length > 1 ? segments : [raw]).map((term) => [term]);
}

function groupMatches(group: string[], text: string): boolean {
  return group.some((term) => {
    const normalized = normaliseText(term);
    return normalized.length > 1 && text.includes(normalized);
  });
}

function meaningfulTokens(value: string): string[] {
  return normaliseText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !['the', 'and', 'for', 'with', 'from', 'outcome', 'primary', 'secondary'].includes(token));
}

function conceptMatches(value: string, text: string): boolean {
  const normalized = normaliseText(value);
  if (!normalized) return false;
  if (text.includes(normalized)) return true;
  const tokens = meaningfulTokens(value);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => text.includes(token)).length;
  return tokens.length === 1 ? matched === 1 : matched / tokens.length >= 0.75;
}

function eventConceptMatches(value: string, text: string): boolean {
  const event = normaliseText(value);
  if (!event) return false;
  if (conceptMatches(event, text)) return true;
  if (/\brecover(?:y)?\b/.test(event)) return /\brecover(?:y|ed|ing|s)?\b/.test(text);
  if (/\b(?:death|mortality)\b/.test(event)) return /\b(?:death|deaths|died|mortality)\b/.test(text);
  if (/\bimprov(?:e|ement)\b/.test(event)) return /\bimprov(?:e|ed|ement|ements|ing)\b/.test(text);
  return false;
}

function outcomeConceptMatches(value: string, text: string): boolean {
  if (conceptMatches(value, text)) return true;
  const normalized = normaliseText(value);
  const timeTo = normalized.match(/^time\s+to\s+(.+)$/);
  if (!timeTo) return false;
  return eventConceptMatches(timeTo[1] ?? '', text) && TEMPORAL_RESULT_CUE.test(text);
}

function requestedDesignEstablished(methodsText: string, studyDesigns: string[] | undefined): boolean {
  if (!studyDesigns?.length) return true;
  const normalized = normaliseText(methodsText);
  return studyDesigns.some((design) => {
    const value = normaliseText(design);
    if (value && normalized.includes(value)) return true;
    if (/random|rct/.test(value)) return /\brandomi[sz](?:ed|ation)|\brct\b|\brandomly\s+(?:assigned|allocated)\b/.test(normalized);
    if (/cohort|observational/.test(value)) return /\bcohort\b|\bobservational\b|\bretrospective\b|\bprospective\b/.test(normalized);
    if (/case control/.test(value)) return /\bcase control\b/.test(normalized);
    if (/cross sectional/.test(value)) return /\bcross sectional\b/.test(normalized);
    if (/case report|case series/.test(value)) return /\bcase report\b|\bcase series\b/.test(normalized);
    return false;
  });
}

function resultSegments(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 20);
}

function ownsResult(window: string): boolean {
  return REPORT_OWNERSHIP_CUE.test(window)
    && QUANTIFIED_RESULT_CUE.test(window)
    && !PRIOR_STUDY_CUE.test(window);
}

function linkedProtocolOutcomes(
  resultsText: string,
  groups: string[][],
  comparator: string | undefined,
  outcomes: string[] | undefined,
): string[] {
  if (!outcomes?.length || groups.length === 0) return outcomes ?? [];
  const segments = resultSegments(resultsText);
  return outcomes.filter((outcome) => segments.some((segment, index) => {
    // Results often define treatment groups in one sentence and quantify the
    // outcome in the next. The bounded three-sentence window must nevertheless
    // look like this report's own quantified result, not a citation or narrative
    // mention of another trial. Time-to-event outcomes may be expressed through
    // quantified event language (e.g. "recovered ... faster") without repeating
    // the protocol's literal outcome phrase.
    const window = [segments[index - 1], segment, segments[index + 1]].filter(Boolean).join(' ');
    const normalized = normaliseText(window);
    const interventionLinked = groups.every((group) => groupMatches(group, normalized));
    const comparatorLinked = !comparator || conceptMatches(comparator, normalized);
    return interventionLinked
      && comparatorLinked
      && outcomeConceptMatches(outcome, normalized)
      && ANALYTIC_RESULT_CUE.test(window)
      && ownsResult(window);
  }));
}

/**
 * Shared full-text eligibility assessment used by both the screening gate and
 * the cognitive contamination sentinel. Keeping one semantic predicate avoids
 * screening/attention drift and makes protocol compliance executable.
 */
export function assessSectionEligibility(
  document: ParsedDocument,
  request: AgentContext['state']['request'],
): SectionEligibilityAssessment {
  const methodsText = document.sections
    .filter((section) => section.name === 'methods')
    .map((section) => section.text)
    .join('\n');
  const resultsText = document.sections
    .filter((section) => section.name === 'results')
    .map((section) => section.text)
    .join('\n');
  const evidentiaryCore = document.sections
    .filter((section) => ['methods', 'results', 'discussion', 'limitations'].includes(section.name))
    .map((section) => section.text)
    .join('\n');
  const nonClinicalText = evidentiaryCore.trim() ? evidentiaryCore : document.text;
  const clinicalStudyAnchors = signals(methodsText, CLINICAL_STUDY_ANCHORS);
  const nonClinicalSignals = signals(nonClinicalText, NON_CLINICAL_CORE_PATTERNS);
  const secondaryResearchSignals = signals(`${methodsText}\n${resultsText}`, SECONDARY_RESEARCH_PATTERNS);
  const strongInstrumentalSignature = nonClinicalSignals.some((signal) =>
    ['spectrofluorimetry', 'spectrophotometry', 'chromatography', 'molecular-docking'].includes(signal),
  );
  const dominantNonClinical = clinicalStudyAnchors.length === 0
    && (nonClinicalSignals.length >= 2 || strongInstrumentalSignature);
  const secondaryResearchDominant = secondaryResearchSignals.length >= 2
    || secondaryResearchSignals.some((signal) => ['systematic-review', 'meta-analysis', 'scoping-review'].includes(signal));

  const groups = requiredInterventionGroups(request as SearchAwareRequest);
  const protocolCore = normaliseText(`${methodsText}\n${resultsText}`);
  const matchedInterventionGroups = groups.filter((group) => groupMatches(group, protocolCore));
  const missingInterventionGroups = groups.filter((group) => !groupMatches(group, protocolCore));
  const comparatorEstablished = !request.question.comparator || conceptMatches(request.question.comparator, protocolCore);
  const designEstablished = requestedDesignEstablished(methodsText, request.question.studyDesigns);
  const linkedOutcomes = linkedProtocolOutcomes(
    resultsText,
    groups,
    request.question.comparator,
    request.question.outcomes,
  );
  const missingOutcomes = (request.question.outcomes ?? []).filter((outcome) => !linkedOutcomes.includes(outcome));

  return {
    dominantNonClinical,
    secondaryResearchDominant,
    nonClinicalSignals,
    secondaryResearchSignals,
    clinicalStudyAnchors,
    requiredInterventionGroups: groups,
    matchedInterventionGroups,
    missingInterventionGroups,
    comparatorEstablished,
    requestedDesignEstablished: designEstablished,
    linkedProtocolOutcomes: linkedOutcomes,
    missingProtocolOutcomes: missingOutcomes,
  };
}

/**
 * Full-text verification boundary for human clinical reviews.
 *
 * Automatic inclusion requires a primary human clinical-study anchor, every
 * required intervention/exposure concept, any prespecified comparator/design,
 * and at least one bounded Results-level link between the protocol treatment or
 * exposure and a prespecified outcome that is recognisably this report's own
 * quantified result. Missing proof becomes explicit verification debt, never a
 * fabricated exclusion or an extraction input.
 */
export class SectionAwareFullTextEligibilityAgent implements Agent {
  readonly stage = 'fulltext-screen' as const;
  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const population = normaliseText(context.state.request.question.population ?? '');
    const expectsHumanClinical = /\b(?:adults?|patients?|participants?|humans?|people|hospital(?:s|ized|ised)?)\b/.test(population);
    if (!expectsHumanClinical) return result;

    const documents = context.state.artifacts.parsedDocuments as ParsedDocument[] | undefined;
    const original = result.artifacts.fullTextDecisions as ScreeningDecision[] | undefined;
    if (!documents || !original) return result;
    const byId = new Map(documents.map((document) => [document.recordId, document]));
    let rejectedNonClinical = 0;
    let rejectedSecondary = 0;
    let uncertainStudyDesign = 0;
    let uncertainProtocolLink = 0;
    let uncertainComparator = 0;
    let uncertainRequestedDesign = 0;
    let uncertainEstimand = 0;

    const decisions = original.map((decision) => {
      if (decision.decision !== 'include') return decision;
      const document = byId.get(decision.recordId);
      if (!document) return decision;
      const assessment = assessSectionEligibility(document, context.state.request);
      if (assessment.dominantNonClinical) {
        rejectedNonClinical += 1;
        return {
          ...decision,
          decision: 'exclude' as const,
          reason: `Section-aware full-text gate identified a dominant non-clinical evidentiary core (${assessment.nonClinicalSignals.join(', ')}) with no primary human clinical-study anchor in Methods`,
          confidence: 0.995,
          evidence: [...new Set([...decision.evidence, ...assessment.nonClinicalSignals])],
        };
      }
      if (assessment.secondaryResearchDominant) {
        rejectedSecondary += 1;
        return {
          ...decision,
          decision: 'exclude' as const,
          reason: `Section-aware full-text gate identified secondary research rather than a primary study (${assessment.secondaryResearchSignals.join(', ')})`,
          confidence: 0.99,
          evidence: [...new Set([...decision.evidence, ...assessment.secondaryResearchSignals])],
        };
      }
      if (assessment.clinicalStudyAnchors.length === 0) {
        uncertainStudyDesign += 1;
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: 'Full text matches review concepts but Methods do not establish a primary human clinical study; retain for verification and withhold from extraction',
          confidence: Math.min(decision.confidence, 0.6),
        };
      }
      if (assessment.missingInterventionGroups.length > 0) {
        uncertainProtocolLink += 1;
        const missing = assessment.missingInterventionGroups.map((group) => group.join(' OR ')).join('; ');
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: `Primary clinical-study structure is present, but Methods/Results do not establish every required protocol intervention/exposure concept (${missing}); retain for verification and withhold from extraction`,
          confidence: Math.min(decision.confidence, 0.65),
          evidence: [...new Set([...decision.evidence, ...assessment.clinicalStudyAnchors])],
        };
      }
      if (!assessment.comparatorEstablished) {
        uncertainComparator += 1;
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: `Primary study structure is present, but the prespecified comparator (${context.state.request.question.comparator}) is not established in Methods/Results; retain for verification and withhold from extraction`,
          confidence: Math.min(decision.confidence, 0.65),
        };
      }
      if (!assessment.requestedDesignEstablished) {
        uncertainRequestedDesign += 1;
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: `Primary study structure is present, but none of the prespecified eligible study designs (${context.state.request.question.studyDesigns?.join(', ')}) is established in Methods; retain for verification and withhold from extraction`,
          confidence: Math.min(decision.confidence, 0.65),
        };
      }
      if ((context.state.request.question.outcomes?.length ?? 0) > 0 && assessment.linkedProtocolOutcomes.length === 0) {
        uncertainEstimand += 1;
        return {
          ...decision,
          decision: 'uncertain' as const,
          reason: `The report contains the protocol interventions/exposures but Results do not establish this report's own bounded, quantified treatment/exposure-to-outcome contrast for the prespecified outcomes (${assessment.missingProtocolOutcomes.join(', ')}); retain for verification and withhold from extraction`,
          confidence: Math.min(decision.confidence, 0.6),
        };
      }
      return {
        ...decision,
        evidence: [...new Set([
          ...decision.evidence,
          ...assessment.clinicalStudyAnchors,
          ...assessment.matchedInterventionGroups.flat(),
          ...assessment.linkedProtocolOutcomes,
        ])],
      };
    });

    const includedIds = new Set(decisions.filter((decision) => decision.decision === 'include').map((decision) => decision.recordId));
    const previousQuality = (result.artifacts.fullTextScreeningQuality ?? {}) as Record<string, unknown>;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        fullTextDecisions: decisions,
        includedDocuments: documents.filter((document) => includedIds.has(document.recordId)),
        fullTextScreeningQuality: {
          ...previousQuality,
          rejectedAsSectionDominantNonClinical: rejectedNonClinical,
          rejectedAsSecondaryResearch: rejectedSecondary,
          retainedAsUncertainWithoutClinicalStudyAnchor: uncertainStudyDesign,
          retainedAsUncertainWithoutProtocolInterventionEvidence: uncertainProtocolLink,
          retainedAsUncertainWithoutComparatorEvidence: uncertainComparator,
          retainedAsUncertainWithoutRequestedStudyDesign: uncertainRequestedDesign,
          retainedAsUncertainWithoutProtocolEstimandLink: uncertainEstimand,
          automaticClinicalIncludeRequiresMethodsOrResultsAnchor: true,
          automaticClinicalIncludeRequiresPrimaryMethodsAnchor: true,
          automaticClinicalIncludeRequiresProtocolInterventionEvidence: true,
          automaticClinicalIncludeRequiresComparatorWhenPrespecified: true,
          automaticClinicalIncludeRequiresStudyDesignWhenPrespecified: true,
          automaticClinicalIncludeRequiresBoundedOutcomeLink: true,
          automaticClinicalIncludeRequiresReportOwnedQuantifiedResult: true,
        },
      },
      warnings: [
        ...(result.warnings ?? []),
        ...(rejectedNonClinical > 0 ? [`Section-aware full-text gate excluded ${rejectedNonClinical} dominant analytical/laboratory evidence object(s) before extraction.`] : []),
        ...(rejectedSecondary > 0 ? [`Section-aware full-text gate excluded ${rejectedSecondary} secondary-research report(s) from a primary-study evidence stream.`] : []),
        ...(uncertainStudyDesign > 0 ? [`Section-aware full-text gate retained ${uncertainStudyDesign} concept-matching report(s) as uncertain because Methods did not establish a primary human clinical study.`] : []),
        ...(uncertainProtocolLink > 0 ? [`Section-aware full-text gate retained ${uncertainProtocolLink} primary-study report(s) as uncertain because the prespecified intervention/exposure concepts were not all established in Methods/Results.`] : []),
        ...(uncertainComparator > 0 ? [`Section-aware full-text gate retained ${uncertainComparator} report(s) as uncertain because the prespecified comparator was not established.`] : []),
        ...(uncertainRequestedDesign > 0 ? [`Section-aware full-text gate retained ${uncertainRequestedDesign} report(s) as uncertain because an eligible study design was not established.`] : []),
        ...(uncertainEstimand > 0 ? [`Section-aware full-text gate retained ${uncertainEstimand} report(s) as uncertain because no report-owned, quantified protocol treatment/exposure-to-outcome contrast was established in Results.`] : []),
      ],
    };
  }
}
