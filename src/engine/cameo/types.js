// Q-CAMEO: Quality-weighted Causal Architecture Mapping of Evidence for Outcomes
// Data types — machine-readable implementation of the CAMEO-SAM type system.
// Based on QCAMEO_Algorithm_Pseudocode.md v1.0 and CAMEO-SAM per-edge pipeline v2.

export const SIGNED_SCORE = Object.freeze({ '-2': -2, '-1': -1, '0': 0, '1': 1, '2': 2, U: null, NA: null });
export const AMSTAR_CONFIDENCE = Object.freeze(['HIGH', 'MODERATE', 'LOW', 'CRITICALLY_LOW']);
export const ROBIS_RISK = Object.freeze(['LOW', 'UNCLEAR', 'HIGH']);
export const GRADE_CERTAINTY = Object.freeze(['HIGH', 'MODERATE', 'LOW', 'VERY_LOW', 'NOT_ASSESSED']);
export const USE_CLASS = Object.freeze(['PRINCIPAL', 'SUPPORTING', 'EXCLUDED', 'DISCOVERY_ONLY']);
export const EDGE_CLASS = Object.freeze([
  'STRONG', 'PROBABLE', 'SUGGESTIVE', 'MECHANISTICALLY_SUPPORTED_ONLY',
  'INDETERMINATE', 'CONFLICTING', 'EVIDENCE_AGAINST', 'INADMISSIBLE'
]);
export const REVIEW_TYPE = Object.freeze(['INTERVENTION', 'AETIOLOGY', 'PROGNOSIS', 'DIAGNOSIS', 'MIXED']);
export const TIME_INDEX = Object.freeze(['t0', 't1a', 't1b', 't2']);

// Default configuration — identical to pseudocode §3
export const DEFAULT_CONFIG = Object.freeze({
  amstarCoefficient: { HIGH: 1.00, MODERATE: 0.75, LOW: 0.25, CRITICALLY_LOW: 0.00 },
  robisCoefficient: { LOW: 1.00, UNCLEAR: 0.50, HIGH: 0.00 },
  gradeCoefficient: { HIGH: 1.00, MODERATE: 0.75, LOW: 0.50, VERY_LOW: 0.25, NOT_ASSESSED: 0.00 },
  epiWeights: {
    TEMPORALITY: 3.0, IDENTIFICATION: 3.0, STRENGTH: 2.0, CONSISTENCY: 2.0,
    GRADIENT: 1.5, EXPERIMENT: 2.0, COHERENCE: 1.0, PREDICTIONS: 0.5,
  },
  mechWeights: {
    BIOLOGICAL_PLAUSIBILITY: 2.0, ESSENTIALITY: 2.0, TEMPORAL_CONCORDANCE: 1.5,
    DOSE_CONCORDANCE: 1.0, INCIDENCE_CONCORDANCE: 1.0, HUMAN_RELEVANCE: 1.5,
    REPLICATION: 1.0, CLINICAL_COHERENCE: 1.0,
  },
  dependenceLevels: {
    DIFFERENT_DATA_DIFFERENT_BIAS: 0.00,
    INDEPENDENT_PARTLY_SHARED_ASSUMPTIONS: 0.25,
    INDEPENDENT_SAME_DOMINANT_BIAS: 0.50,
    SHARED_COHORT_OR_MEASUREMENT: 0.75,
    DUPLICATE_DATA_OR_ANALYSIS: 1.00,
  },
});

// Factory functions
export function createEdgeSpec(overrides = {}) {
  return {
    edgeId: '', population: '', sourceNode: '', targetNode: '',
    sourceTime: 't0', targetTime: 't0', exposureStrategy: '', comparatorStrategy: '',
    outcomeDefinition: '', followUp: null, estimand: '', meaningfulEffectDelta: null,
    expectedLatency: null, candidateConfounders: [], candidateMediators: [],
    candidateColliders: [], competingHypotheses: [], negativeControlPredictions: [],
    effectModifiers: [], proposedKeyEventChain: [],
    ...overrides,
  };
}

export function createDomainJudgement(domain, score = 'U') {
  return { domain, reviewerA: score, reviewerB: score, adjudicated: score,
    evidenceSpans: [], rationale: '', alternativeExplanation: '', confidence: 'MODERATE' };
}

export function createEdgeDecision(edgeSpec) {
  return {
    edgeSpec, cca: 0, pairwiseCCA: {}, sourceReliability: 0,
    grade: null, epiDomains: {}, epiQWoE: null, mechDomains: {},
    mechQWoE: null, triangulation: null, finalClass: 'INDETERMINATE',
    dagEncoding: null, robustness: null, evidenceLog: [],
  };
}
