import type { ParsedDocument } from '../core/types.js';
import { assessSectionEligibility } from '../agents/section-aware-eligibility.js';
import { documentIntelligenceOf } from '../document/document-intelligence.js';
import {
  ReviewAttentionObserver,
  type CognitiveAction,
  type CognitiveStageDecision,
  type CognitiveStageInput,
} from './review-attention.js';

const ACTION_PRIORITY: Record<CognitiveAction, number> = {
  CONTINUE: 0,
  REFOCUS: 1,
  REPLAN: 2,
  SPAWN_SPECIALIST: 3,
  VERIFY: 4,
  ESCALATE_HUMAN: 5,
  ROLLBACK: 6,
  STOP: 7,
};

function escalate(current: CognitiveAction, proposed: CognitiveAction): CognitiveAction {
  return ACTION_PRIORITY[proposed] > ACTION_PRIORITY[current] ? proposed : current;
}

interface FullTextQualityReport {
  rejectedAsHighSpecificityNonClinical?: number;
  rejectedAsSectionDominantNonClinical?: number;
  rejectedAsSecondaryResearch?: number;
  retainedAsUncertainWithoutClinicalStudyAnchor?: number;
  retainedAsUncertainWithoutProtocolInterventionEvidence?: number;
  retainedAsUncertainWithoutComparatorEvidence?: number;
  retainedAsUncertainWithoutRequestedStudyDesign?: number;
  retainedAsUncertainWithoutProtocolEstimandLink?: number;
  documentParseDowngrades?: number;
  totalParsed?: number;
}

interface DocumentParsingQualityReport {
  requested?: number;
  parsed?: number;
  quarantinedUnresolved?: number;
  coverage?: number;
}

interface RetrievalReport {
  requested?: number;
  retrieved?: number;
  missing?: string[];
}

interface StudyFamilyQualityReport {
  totalReports?: number;
  totalFamilies?: number;
  multiReportFamilies?: number;
  registryLinkedReports?: number;
  singletonReportsWithoutRegistry?: number;
  ambiguousRegistryReports?: number;
  familiesWithoutPrimaryResults?: number;
}

interface StudyFamilyLinkReport {
  recordId?: string;
  familyId?: string;
  linkageBasis?: string;
  requiresHumanReview?: boolean;
}

interface StudyFamilySynthesisConflictReport {
  familyId?: string;
  outcome?: string;
  reportIds?: string[];
}

/**
 * Adds document-intelligence, protocol-eligibility and study-family identity
 * debt to the general review attention loop. Full-text screening and the
 * contamination sentinel share one eligibility predicate; family linkage then
 * adds an independent participant-study identity layer without overwriting
 * report identity or estimand identity.
 */
export class DocumentAwareReviewAttentionObserver extends ReviewAttentionObserver {
  override assess(input: CognitiveStageInput): CognitiveStageDecision {
    const decision = super.assess(input);
    const reasons = [...decision.reasons];
    let action = decision.action;
    let score = decision.score;
    let methodDrift = decision.metrics.methodDrift;
    let contaminationRisk = decision.metrics.downstreamContaminationRisk;

    const documents = Array.isArray(input.state.artifacts.parsedDocuments)
      ? input.state.artifacts.parsedDocuments as ParsedDocument[]
      : [];
    const intelligence = documents.map(documentIntelligenceOf).filter((value) => value !== null);
    const belowThreshold = intelligence.filter((item) => item.qualityScore < item.threshold);
    const downgrades = intelligence.filter((item) => item.downgradeOccurred);
    const poorLocator = intelligence.filter((item) => item.locatorFidelity === 'synthetic-chunk');
    const postDocumentStages = [
      'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias',
      'synthesise', 'grade', 'report', 'human-verify',
    ];

    if (postDocumentStages.includes(input.stage)) {
      if (belowThreshold.length > 0) {
        action = escalate(action, 'STOP');
        methodDrift = Math.max(methodDrift, 1);
        contaminationRisk = Math.max(contaminationRisk, 1);
        reasons.push(`${belowThreshold.length} parsed document(s) are below their document-intelligence quality threshold`);
      }
      if (downgrades.length > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(methodDrift, Math.min(0.6, downgrades.length / Math.max(1, intelligence.length)));
        reasons.push(`${downgrades.length} document(s) used a lower reading tier after LiteParse did not satisfy the quality gate`);
      }
      if (poorLocator.length > 0) {
        reasons.push(`${poorLocator.length} document(s) have synthetic-chunk rather than true page/coordinate locators`);
      }

      const parsing = input.state.artifacts.documentParsingQuality as DocumentParsingQualityReport | undefined;
      const quarantined = parsing?.quarantinedUnresolved ?? 0;
      if (quarantined > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(
          methodDrift,
          Math.min(0.8, quarantined / Math.max(1, parsing?.requested ?? quarantined)),
        );
        reasons.push(`${quarantined} retrieved full-text document(s) are quarantined as unresolved after document-intelligence quality failure`);
      }

      const retrieval = input.state.artifacts.retrievalReport as RetrievalReport | undefined;
      const notRetrieved = retrieval?.missing?.length ?? 0;
      if (notRetrieved > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(
          methodDrift,
          Math.min(0.8, notRetrieved / Math.max(1, retrieval?.requested ?? notRetrieved)),
        );
        reasons.push(`${notRetrieved} title/abstract-included record(s) still require lawful full-text retrieval and remain unresolved`);
      }
    }

    const screenQuality = input.state.artifacts.fullTextScreeningQuality as FullTextQualityReport | undefined;
    if (screenQuality && ['fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify'].includes(input.stage)) {
      const rejectedNonClinical = (screenQuality.rejectedAsHighSpecificityNonClinical ?? 0)
        + (screenQuality.rejectedAsSectionDominantNonClinical ?? 0);
      const rejectedSecondary = screenQuality.rejectedAsSecondaryResearch ?? 0;
      if (rejectedNonClinical > 0) {
        reasons.push(`full-text evidence gates intercepted ${rejectedNonClinical} non-clinical document(s) before extraction`);
      }
      if (rejectedSecondary > 0) {
        reasons.push(`full-text evidence gate intercepted ${rejectedSecondary} secondary-research report(s) before the primary-study extraction stream`);
      }
      if ((screenQuality.documentParseDowngrades ?? 0) > 0) action = escalate(action, 'VERIFY');

      const uncertainDesign = screenQuality.retainedAsUncertainWithoutClinicalStudyAnchor ?? 0;
      const uncertainProtocol = screenQuality.retainedAsUncertainWithoutProtocolInterventionEvidence ?? 0;
      const uncertainComparator = screenQuality.retainedAsUncertainWithoutComparatorEvidence ?? 0;
      const uncertainRequestedDesign = screenQuality.retainedAsUncertainWithoutRequestedStudyDesign ?? 0;
      const uncertainEstimand = screenQuality.retainedAsUncertainWithoutProtocolEstimandLink ?? 0;
      const uncertain = uncertainDesign + uncertainProtocol + uncertainComparator + uncertainRequestedDesign + uncertainEstimand;
      if (uncertain > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(
          methodDrift,
          Math.min(0.8, uncertain / Math.max(1, screenQuality.totalParsed ?? uncertain)),
        );
        if (uncertainDesign > 0) reasons.push(`${uncertainDesign} parsed full-text report(s) remain uncertain because Methods did not establish a primary human clinical study`);
        if (uncertainProtocol > 0) reasons.push(`${uncertainProtocol} primary-study report(s) remain uncertain because Methods/Results did not establish every prespecified intervention/exposure concept`);
        if (uncertainComparator > 0) reasons.push(`${uncertainComparator} primary-study report(s) remain uncertain because the prespecified comparator was not established`);
        if (uncertainRequestedDesign > 0) reasons.push(`${uncertainRequestedDesign} report(s) remain uncertain because no prespecified eligible study design was established`);
        if (uncertainEstimand > 0) reasons.push(`${uncertainEstimand} report(s) remain uncertain because Results did not establish a bounded protocol treatment/exposure-to-outcome link`);
      }
    }

    const familyQuality = input.state.artifacts.studyFamilyQuality as StudyFamilyQualityReport | undefined;
    const familyLinks = Array.isArray(input.state.artifacts.studyFamilyLinks)
      ? input.state.artifacts.studyFamilyLinks as StudyFamilyLinkReport[]
      : [];
    if (familyQuality && ['fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify'].includes(input.stage)) {
      const ambiguous = familyQuality.ambiguousRegistryReports ?? 0;
      if (ambiguous > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(methodDrift, Math.min(0.8, ambiguous / Math.max(1, familyQuality.totalReports ?? ambiguous)));
        reasons.push(`${ambiguous} report(s) contain multiple registry identifiers and require study-family adjudication`);
      }

      const includedIds = new Set(
        (Array.isArray(input.state.artifacts.includedDocuments)
          ? input.state.artifacts.includedDocuments as ParsedDocument[]
          : []).map((document) => document.recordId),
      );
      const includedUnresolvedFamilies = familyLinks.filter((link) =>
        Boolean(link.recordId && includedIds.has(link.recordId) && link.requiresHumanReview));
      if (includedUnresolvedFamilies.length > 0) {
        action = escalate(action, 'VERIFY');
        methodDrift = Math.max(methodDrift, Math.min(0.8, includedUnresolvedFamilies.length / Math.max(1, includedIds.size)));
        reasons.push(`${includedUnresolvedFamilies.length} extraction-eligible report(s) have unresolved study-family identity and must not be assumed independent in synthesis`);
      }

      const multiReportFamilies = familyQuality.multiReportFamilies ?? 0;
      if (multiReportFamilies > 0) {
        reasons.push(`${multiReportFamilies} multi-report study famil${multiReportFamilies === 1 ? 'y' : 'ies'} detected; report identity remains separate from participant-study identity`);
      }
    }

    const familyConflicts = Array.isArray(input.state.artifacts.studyFamilySynthesisConflicts)
      ? input.state.artifacts.studyFamilySynthesisConflicts as StudyFamilySynthesisConflictReport[]
      : [];
    if (familyConflicts.length > 0 && ['synthesise', 'grade', 'report', 'human-verify'].includes(input.stage)) {
      action = escalate(action, 'VERIFY');
      methodDrift = Math.max(methodDrift, Math.min(1, familyConflicts.length / 2));
      reasons.push(`${familyConflicts.length} same-family quantitative conflict(s) were withheld from pooling pending estimand/report adjudication`);
    }

    // Final invariant: anything admitted to extraction must satisfy the exact
    // protocol predicate used by full-text screening. If this fires, a wrapper
    // or state mutation has bypassed the eligibility boundary and the run stops.
    const included = Array.isArray(input.state.artifacts.includedDocuments)
      ? input.state.artifacts.includedDocuments as ParsedDocument[]
      : [];
    const eligibilityViolations = included.filter((document) => {
      const assessment = assessSectionEligibility(document, input.state.request);
      const outcomesRequired = (input.state.request.question.outcomes?.length ?? 0) > 0;
      return assessment.dominantNonClinical
        || assessment.secondaryResearchDominant
        || assessment.clinicalStudyAnchors.length === 0
        || assessment.missingInterventionGroups.length > 0
        || !assessment.comparatorEstablished
        || !assessment.requestedDesignEstablished
        || (outcomesRequired && assessment.linkedProtocolOutcomes.length === 0);
    });
    if (
      eligibilityViolations.length > 0
      && ['extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify'].includes(input.stage)
    ) {
      action = escalate(action, 'STOP');
      contaminationRisk = 1;
      reasons.push(`${eligibilityViolations.length} protocol-inconsistent document(s) survived into the extraction corpus`);
    }

    score = Math.max(score, (methodDrift + contaminationRisk) / 4);
    return {
      ...decision,
      action,
      score: Math.min(1, score),
      reasons: [...new Set(reasons)],
      metrics: {
        ...decision.metrics,
        methodDrift,
        downstreamContaminationRisk: contaminationRisk,
      },
    };
  }
}
