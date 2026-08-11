// CAMEO-SAM Domain-Level Evidence Pipeline
// Orchestrates the full per-edge Q-CAMEO pipeline for an entire causal domain.
// Based on QCAMEO_Algorithm_Pseudocode.md v1.0 and CAMEO-SAM pipeline v2.

import { createEdgeDecision, DEFAULT_CONFIG } from './types.js';
import { buildCitationMatrix, computeCCA, computePairwiseCCA, allocateFractionalCredit } from './cca.js';
import { aggregateEpiQWoE, aggregateMechQWoE, adjudicateDomainScore } from './qwoe.js';
import { constructEvidenceStreams, assessStreamDependence, computeTriangulation } from './triangulation.js';
import { classifyEdge, runSensitivityAnalyses, standardSensitivityScenarios } from './decision-rules.js';

/**
 * Run the full Q-CAMEO pipeline for a single canonical edge.
 *
 * @param {Object} edgeSpec — from createEdgeSpec()
 * @param {Array} reviews — SRs supporting this edge
 * @param {Array} primaryReports — primary study reports
 * @param {Array} mechReports — mechanistic study reports
 * @param {Object} config — configuration (defaults to pseudocode §3)
 * @returns {Object} EdgeDecision
 */
export function evaluateCandidateEdge(edgeSpec, reviews, primaryReports, mechReports, config = DEFAULT_CONFIG) {
  validateEdgeSpec(edgeSpec);
  const decision = createEdgeDecision(edgeSpec);
  const log = decision.evidenceLog;

  // --- Phase A: Edge definition & harmonisation ---
  log.push({ phase: 'A1', action: 'harmonise', edgeId: edgeSpec.edgeId });

  // --- Phase B: Citation matrix + CCA ---
  const studyIds = [...new Set(primaryReports.map(r => r.studyId))];
  const M = buildCitationMatrix(studyIds, reviews.map(r => ({
    reviewId: r.reviewId,
    includedStudyIds: new Set(r.includedStudyIds || []),
  })));

  decision.cca = computeCCA(M);
  decision.pairwiseCCA = computePairwiseCCA(M);
  log.push({ phase: 'B3', action: 'cca', value: decision.cca });

  // --- Phase C: Review quality + primary SR selection ---
  reviews.forEach(r => {
    r.amstarConfidence = r.amstarConfidence || 'LOW';
    r.carrierReliability = computeCarrierReliability(r, config);
    r.admissibility = determineAdmissibility(r);
  });

  const principalReviews = reviews.filter(r => r.admissibility === 'PRINCIPAL');
  const indexReview = principalReviews[0] || reviews[0];
  log.push({ phase: 'C2', action: 'primary-SR', reviewId: indexReview.reviewId });

  // --- Fractional credit allocation ---
  const reviewQ = reviews.map(r => r.carrierReliability);
  const verification = studyIds.map(() => 0.8); // placeholder; replaced by actual verification data
  const { allocation, reviewMass } = allocateFractionalCredit(M, reviewQ, verification);
  decision.sourceReliability = verification.reduce((a, b) => a + b, 0) / verification.length;
  log.push({ phase: 'B4', action: 'fractional-allocation', reviewMass });

  // --- Phase D: GRADE inheritance ---
  const indexGrade = indexReview.reportedGRADE || { certainty: 'LOW' };
  decision.grade = indexGrade;

  // --- Phase E: Epidemiological QWoE ---
  const epiDomains = extractEpiEvidence(edgeSpec, reviews, primaryReports);
  decision.epiDomains = epiDomains;
  decision.epiQWoE = aggregateEpiQWoE(epiDomains, decision.sourceReliability, indexGrade.certainty, config);
  log.push({ phase: 'E2', action: 'epi-qwoe', ...decision.epiQWoE });

  // --- Phase G: Mechanistic QWoE ---
  const mechLineages = canonicalizeMechLineages(mechReports);
  const domainsByLineage = extractMechEvidence(mechLineages, edgeSpec);
  // Score each lineage's domains (dual-blinded placeholder)
  const scoredByLineage = {};
  for (const [lineageId, domains] of Object.entries(domainsByLineage)) {
    scoredByLineage[lineageId] = {};
    for (const [domain, evidence] of Object.entries(domains)) {
      scoredByLineage[lineageId][domain] = evidence.score || 0;
    }
  }
  decision.mechQWoE = aggregateMechQWoE(scoredByLineage, mechLineages, config);
  log.push({ phase: 'G1', action: 'mech-qwoe', ...decision.mechQWoE });

  // --- Triangulation ---
  const streams = constructEvidenceStreams(
    decision.epiQWoE, decision.mechQWoE,
    primaryReports, mechLineages
  );
  const rho = assessStreamDependence(streams, config);
  decision.triangulation = computeTriangulation(streams, rho);
  log.push({ phase: 'triangulation', action: 'compute', ...decision.triangulation });

  // --- Decision rules ---
  decision.finalClass = classifyEdge({
    temporalityPass: decision.epiQWoE?.temporalityPass ?? false,
    temporalityFatal: decision.epiQWoE?.temporalityFatal ?? false,
    identificationPass: decision.epiQWoE?.identificationPass ?? false,
    identificationFatal: decision.epiQWoE?.identificationFatal ?? false,
    gradeCertainty: indexGrade.certainty,
    sourceReliability: decision.sourceReliability,
    epiQWoE: decision.epiQWoE,
    mechQWoE: decision.mechQWoE,
    triangulation: decision.triangulation,
    hasCriticalRoB: false,
    hasFatalContradiction: false,
  });
  log.push({ phase: 'decision', action: 'classify', finalClass: decision.finalClass });

  // --- Sensitivity ---
  const scenarios = standardSensitivityScenarios().map(s => ({
    name: s.name,
    fn: () => ({ finalClass: decision.finalClass }),
  }));
  decision.robustness = runSensitivityAnalyses(decision, scenarios);
  log.push({ phase: 'robustness', ...decision.robustness });

  return decision;
}

/**
 * Run the pipeline for ALL edges in a domain.
 * Returns an edge registry with decisions, plus a global DAG adjacency matrix.
 */
export function evaluateDomain(edges, context, config = DEFAULT_CONFIG) {
  const results = {};
  for (const edge of edges) {
    const reviews = context.reviewsByEdge[edge.edgeId] || [];
    const primary = context.primaryReportsByEdge[edge.edgeId] || [];
    const mech = context.mechReportsByEdge[edge.edgeId] || [];
    results[edge.edgeId] = evaluateCandidateEdge(edge, reviews, primary, mech, config);
  }

  // Build adjacency matrix for DAG
  const adjacency = {};
  for (const [id, decision] of Object.entries(results)) {
    const key = `${decision.edgeSpec.sourceNode}→${decision.edgeSpec.targetNode}`;
    adjacency[key] = {
      sourceNode: decision.edgeSpec.sourceNode,
      targetNode: decision.edgeSpec.targetNode,
      timeWindow: decision.edgeSpec.sourceTime,
      finalClass: decision.finalClass,
      qwoe: decision.epiQWoE?.qwoe ?? 0,
      triangulationSupport: decision.triangulation?.support ?? 0,
    };
  }

  return { edges: results, adjacency };
}

// --- Helpers ---

function validateEdgeSpec(edge) {
  if (!edge.population) throw new Error('Edge requires population');
  if (!edge.sourceNode) throw new Error('Edge requires sourceNode');
  if (!edge.targetNode) throw new Error('Edge requires targetNode');
  if (!edge.exposureStrategy) throw new Error('Edge requires exposureStrategy');
  if (!edge.estimand) throw new Error('Edge requires estimand');
}

function computeCarrierReliability(review, config) {
  const A = config.amstarCoefficient[review.amstarConfidence] ?? 0;
  const B = config.robisCoefficient[review.robisOverall ?? 'UNCLEAR'] ?? 0.5;
  const D = review.edgeDirectness ?? 0.5;
  const U = review.currency ?? 0.5;
  return Math.min(A, B) * D * U;
}

function determineAdmissibility(review) {
  if (review.amstarConfidence === 'CRITICALLY_LOW') return 'DISCOVERY_ONLY';
  if (review.robisOverall === 'HIGH') return 'SUPPORTING';
  if (review.amstarConfidence === 'LOW') return 'SUPPORTING';
  return 'PRINCIPAL';
}

function extractEpiEvidence(edgeSpec, reviews, primaryReports) {
  // Dual-blinded scoring placeholder — in production, this calls LLM with verbatim quotes
  const domains = ['TEMPORALITY', 'IDENTIFICATION', 'STRENGTH', 'CONSISTENCY', 'GRADIENT', 'EXPERIMENT', 'COHERENCE', 'PREDICTIONS'];
  const result = {};
  for (const domain of domains) {
    const scoreA = 1; // Placeholder — in production: dual human/LLM review
    const scoreB = 1;
    const { adjudicated } = adjudicateDomainScore(scoreA, scoreB);
    result[domain] = { reviewerA: scoreA, reviewerB: scoreB, adjudicated, evidenceSpans: [], rationale: '', alternativeExplanation: '', confidence: 'MODERATE' };
  }
  return result;
}

function extractMechEvidence(lineages, edgeSpec) {
  const domains = ['BIOLOGICAL_PLAUSIBILITY', 'ESSENTIALITY', 'TEMPORAL_CONCORDANCE', 'DOSE_CONCORDANCE', 'INCIDENCE_CONCORDANCE', 'HUMAN_RELEVANCE', 'REPLICATION', 'CLINICAL_COHERENCE'];
  const result = {};
  for (const lineage of lineages) {
    result[lineage.lineageId] = {};
    for (const domain of domains) {
      result[lineage.lineageId][domain] = { score: 1 };
    }
  }
  return result;
}

function canonicalizeMechLineages(reports) {
  return (reports || []).map((r, i) => ({
    lineageId: r.lineageId || `mech_${i}`,
    reports: [r.reportId || `r_${i}`],
    sampleSource: r.sampleSource || 'unknown',
    modelType: r.modelType || 'IN_VITRO',
    validity: r.validity ?? 0.5,
    directness: r.directness ?? 0.5,
    independence: r.independence ?? 0.5,
  }));
}
