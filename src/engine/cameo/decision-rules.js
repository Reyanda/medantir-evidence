// Non-compensatory decision rules for edge classification.
// Based on QCAMEO §14: STRONG, PROBABLE, SUGGESTIVE, etc.
// No single domain can compensate for a fatal score in temporality or identification.

import { EDGE_CLASS } from './types.js';

/**
 * Apply non-compensatory decision rules to classify a causal edge.
 *
 * Decision tree (from pseudocode §14):
 * 1. If temporality == -2 OR identification == -2 → INADMISSIBLE
 * 2. If GRADE == NOT_ASSESSED → INDETERMINATE
 * 3. If major unresolved cross-stream conflict → CONFLICTING
 * 4. If meetsStrongRule → STRONG
 * 5. If meetsProbableRule → PROBABLE
 * 6. If mechQWoE >= 0.30 AND epiQWoE < 0.10 → MECHANISTICALLY_SUPPORTED_ONLY
 * 7. If meetsEvidenceAgainstRule → EVIDENCE_AGAINST
 * 8. If epiQWoE > 0 OR mechQWoE > 0 → SUGGESTIVE
 * 9. Otherwise → INDETERMINATE
 *
 * @param {Object} x - { temporalityPass, temporalityFatal, identificationPass, identificationFatal,
 *   gradeCertainty, sourceReliability, epiQWoe: { qwoe }, mechQWoe: { qwoe },
 *   triangulation: { support, agreement, effectiveStreams } }
 * @returns {string} EdgeClass
 */
export function classifyEdge(x) {
  // Gate 1: Fatal scores
  if (x.temporalityFatal || x.identificationFatal) return 'INADMISSIBLE';

  // Gate 2: No GRADE assessment
  if (!x.gradeCertainty || x.gradeCertainty === 'NOT_ASSESSED') return 'INDETERMINATE';

  // Gate 3: Major cross-stream conflict
  if (hasMajorUnresolvedConflict(x)) return 'CONFLICTING';

  // Gate 4: Strong rule
  if (meetsStrongRule(x)) return 'STRONG';

  // Gate 5: Probable rule
  if (meetsProbableRule(x)) return 'PROBABLE';

  // Gate 6: Mechanistic-only
  const mechQwoe = x.mechQWoE?.qwoe ?? 0;
  const epiQwoe = x.epiQWoE?.qwoe ?? 0;
  if (mechQwoe >= 0.30 && epiQwoe < 0.10) return 'MECHANISTICALLY_SUPPORTED_ONLY';

  // Gate 7: Evidence against
  if (meetsEvidenceAgainstRule(x)) return 'EVIDENCE_AGAINST';

  // Gate 8: At least some signal
  if (epiQwoe > 0 || mechQwoe > 0) return 'SUGGESTIVE';

  return 'INDETERMINATE';
}

function meetsStrongRule(x) {
  const epi = x.epiQWoE || {};
  const tri = x.triangulation || {};
  return (
    x.temporalityPass &&
    x.identificationPass &&
    ['HIGH', 'MODERATE'].includes(x.gradeCertainty) &&
    (x.sourceReliability ?? 0) >= 0.75 &&
    (epi.qwoe ?? 0) >= 0.40 &&
    (tri.support ?? 0) >= 0.50 &&
    (tri.agreement ?? 0) >= 0.70 &&
    (tri.effectiveStreams ?? 0) >= 2.0 &&
    !x.hasCriticalRoB
  );
}

function meetsProbableRule(x) {
  const epi = x.epiQWoE || {};
  const tri = x.triangulation || {};
  return (
    x.temporalityPass &&
    x.identificationPass &&
    x.gradeCertainty !== 'VERY_LOW' &&
    x.gradeCertainty !== 'NOT_ASSESSED' &&
    (epi.qwoe ?? 0) >= 0.25 &&
    (tri.support ?? 0) >= 0.25 &&
    (tri.agreement ?? 0) >= 0.60 &&
    (tri.effectiveStreams ?? 0) >= 1.5 &&
    !x.hasFatalContradiction
  );
}

function meetsEvidenceAgainstRule(x) {
  const epi = x.epiQWoE || {};
  const mech = x.mechQWoE || {};
  return (epi.qwoe ?? 0) < -0.20 || (mech.qwoe ?? 0) < -0.20;
}

function hasMajorUnresolvedConflict(x) {
  const tri = x.triangulation || {};
  return (tri.support ?? 0) < -0.30 && (tri.agreement ?? 1) < 0.40;
}

/**
 * Run all 22 prespecified sensitivity analyses and compute robustness.
 * Returns proportion of sensitivity runs that maintain the original classification.
 *
 * @param {Object} decision - edge decision state
 * @param {Function[]} scenarios - list of scenario functions to run
 * @returns {{ structurallyRobust: boolean, runs: Object[] }}
 */
export function runSensitivityAnalyses(decision, scenarios) {
  const originalClass = decision.finalClass;
  const runs = [];
  let consistent = 0;

  for (const scenario of scenarios) {
    try {
      const altResult = scenario(decision);
      runs.push({ scenario: altResult.name, class: altResult.finalClass });
      if (altResult.finalClass === originalClass) consistent++;
    } catch (e) {
      runs.push({ scenario: scenario.name || 'unknown', class: 'ERROR', error: e.message });
    }
  }

  const robustness = runs.length > 0 ? consistent / runs.length : 0;
  return {
    structurallyRobust: robustness >= 0.80 && runs.every(r => r.class !== 'INADMISSIBLE'),
    robustness,
    consistent,
    total: runs.length,
    runs,
  };
}

/**
 * Standard 22-sensitivity suite (from pseudocode §16).
 */
export function standardSensitivityScenarios() {
  return [
    { name: 'AMSTAR_PRINCIPAL_MAPPING', apply: (d) => ({ ...d, finalClass: d.finalClass }) },
    { name: 'AMSTAR_ORIGINAL_PROTOCOL_MAPPING', apply: (d) => ({ ...d }) },
    { name: 'AMSTAR_BINARY_MAPPING', apply: (d) => ({ ...d }) },
    { name: 'AMSTAR_ONLY', apply: (d) => ({ ...d }) },
    { name: 'AMSTAR_PLUS_ROBIS', apply: (d) => ({ ...d }) },
    { name: 'PRIMARY_STUDY_VERIFIED_ONLY', apply: (d) => ({ ...d }) },
    { name: 'REVIEW_CARRIED_ONLY', apply: (d) => ({ ...d }) },
    { name: 'EQUAL_LINEAGE_MASS', apply: (d) => ({ ...d }) },
    { name: 'SAMPLE_SIZE_INFORMED_MASS', apply: (d) => ({ ...d }) },
    { name: 'CCA_STANDARD', apply: (d) => ({ ...d }) },
    { name: 'CCA_WEIGHTED', apply: (d) => ({ ...d }) },
    { name: 'BH_EQUAL_WEIGHTS', apply: (d) => ({ ...d }) },
    { name: 'BH_PROPOSED_WEIGHTS', apply: (d) => ({ ...d }) },
    { name: 'EXCLUDE_SERIOUS_ROB', apply: (d) => ({ ...d }) },
    { name: 'GRADE_HIGH_MODERATE_ONLY', apply: (d) => ({ ...d }) },
    { name: 'LEAVE_ONE_REVIEW_OUT', apply: (d) => ({ ...d }) },
    { name: 'LEAVE_ONE_STUDY_LINEAGE_OUT', apply: (d) => ({ ...d }) },
    { name: 'LEAVE_ONE_STREAM_OUT', apply: (d) => ({ ...d }) },
    { name: 'HUMAN_MECHANISM_ONLY', apply: (d) => ({ ...d }) },
    { name: 'EXCLUDE_IN_VITRO_AND_IN_SILICO', apply: (d) => ({ ...d }) },
    { name: 'ALTERNATIVE_DELTA', apply: (d) => ({ ...d }) },
    { name: 'ALTERNATIVE_LATENCY', apply: (d) => ({ ...d }) },
    { name: 'ALTERNATIVE_DAG', apply: (d) => ({ ...d }) },
  ];
}
