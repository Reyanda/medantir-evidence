import { scientificContentHash } from '../core/canonical-hash.js';
import {
  isHistoricalOutcomeRowPoolable,
  type HistoricalOutcomeRow,
  type HistoricalOutcomeRowLedger,
} from './outcome-row-ledger.js';
import {
  revMan54RandomEffectsMeanDifference,
  revMan54RandomEffectsRiskRatio,
  type RevMan54MetaAnalysisResult,
} from './revman-5.4-compat.js';
import {
  compareHistoricalPublishedResult,
  reproducedResultFromRevMan54,
  type HistoricalPublishedResultTarget,
  type HistoricalResultComparison,
  type HistoricalReproducedResult,
} from './published-result-comparator.js';

export const HISTORICAL_SYNTHESIS_REPLAY_SCHEMA_VERSION = 'medantir-historical-synthesis-replay/1' as const;

export interface HistoricalSynthesisEstimandSelector {
  outcome: string;
  measure: 'RR' | 'MD';
  timeHorizon: string;
  analysisPopulation: HistoricalOutcomeRow['analysisPopulation'];
  subgroupLabel: string | null;
}

export interface HistoricalSynthesisReplayPlan {
  selector: HistoricalSynthesisEstimandSelector;
  publishedTarget: HistoricalPublishedResultTarget;
}

export interface HistoricalSynthesisReplayReceipt {
  schemaVersion: typeof HISTORICAL_SYNTHESIS_REPLAY_SCHEMA_VERSION;
  selector: HistoricalSynthesisEstimandSelector;
  selectedRowHashes: string[];
  selectedLineageIds: string[];
  synthesisInputsHash: string;
  algorithmResult: RevMan54MetaAnalysisResult;
  reproducedResult: HistoricalReproducedResult;
  publishedComparison: HistoricalResultComparison;
  replayHash: string;
}

function normalized(value: string | null): string | null {
  return value === null ? null : value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function selectorMatches(row: HistoricalOutcomeRow, selector: HistoricalSynthesisEstimandSelector): boolean {
  return normalized(row.outcome) === normalized(selector.outcome)
    && row.measure === selector.measure
    && normalized(row.timeHorizon) === normalized(selector.timeHorizon)
    && row.analysisPopulation === selector.analysisPopulation
    && normalized(row.subgroupLabel) === normalized(selector.subgroupLabel);
}

function outcomeMeasurePotentiallyMatches(row: HistoricalOutcomeRow, selector: HistoricalSynthesisEstimandSelector): boolean {
  return normalized(row.outcome) === normalized(selector.outcome) && row.measure === selector.measure;
}

function validatePlan(plan: HistoricalSynthesisReplayPlan): void {
  if (!plan.selector.outcome.trim()) throw new Error('Historical synthesis replay requires an outcome selector.');
  if (!plan.selector.timeHorizon.trim()) throw new Error(`Historical synthesis replay '${plan.selector.outcome}' requires an explicit time horizon.`);
  if (plan.selector.analysisPopulation === 'unspecified') {
    throw new Error(`Historical synthesis replay '${plan.selector.outcome}' requires an explicit analysis population.`);
  }
  if (normalized(plan.selector.outcome) !== normalized(plan.publishedTarget.outcome)) {
    throw new Error(`Historical synthesis selector outcome '${plan.selector.outcome}' does not match published target '${plan.publishedTarget.outcome}'.`);
  }
  if (plan.selector.measure !== plan.publishedTarget.measure) {
    throw new Error(`Historical synthesis selector measure '${plan.selector.measure}' does not match published target '${plan.publishedTarget.measure}'.`);
  }
}

function exactRows(ledger: HistoricalOutcomeRowLedger, selector: HistoricalSynthesisEstimandSelector): HistoricalOutcomeRow[] {
  const unresolvedPotential = ledger.rows.filter((row) =>
    outcomeMeasurePotentiallyMatches(row, selector)
    && row.contributionStatus === 'unresolved');
  if (unresolvedPotential.length > 0) {
    throw new Error(
      `Historical synthesis '${selector.outcome}' has ${unresolvedPotential.length} unresolved potentially contributing row(s): ${unresolvedPotential.map((row) => row.lineageId).join(', ')}.`,
    );
  }
  const selected = ledger.rows.filter((row) => selectorMatches(row, selector) && row.contributionStatus === 'contributing');
  if (selected.length === 0) throw new Error(`Historical synthesis '${selector.outcome}' selected no contributing rows.`);
  const nonPoolable = selected.filter((row) => !isHistoricalOutcomeRowPoolable(row));
  if (nonPoolable.length > 0) {
    throw new Error(`Historical synthesis '${selector.outcome}' contains non-poolable source rows: ${nonPoolable.map((row) => row.lineageId).join(', ')}.`);
  }
  return selected.sort((a, b) => a.lineageId.localeCompare(b.lineageId));
}

function participantCount(rows: HistoricalOutcomeRow[]): number {
  return rows.reduce((total, row) => {
    if (row.dataShape === 'binary-2x2') return total + row.experimentalTotal! + row.controlTotal!;
    return total + row.experimentalTotal! + row.controlTotal!;
  }, 0);
}

function runRevMan(rows: HistoricalOutcomeRow[], measure: 'RR' | 'MD'): RevMan54MetaAnalysisResult {
  if (measure === 'RR') {
    if (rows.some((row) => row.dataShape !== 'binary-2x2')) throw new Error('Historical RR synthesis contains a non-binary row.');
    return revMan54RandomEffectsRiskRatio(rows.map((row) => {
      const binary = row as Extract<HistoricalOutcomeRow, { dataShape: 'binary-2x2' }>;
      return {
        studyId: binary.lineageId,
        experimentalEvents: binary.experimentalEvents!,
        experimentalTotal: binary.experimentalTotal!,
        controlEvents: binary.controlEvents!,
        controlTotal: binary.controlTotal!,
      };
    }));
  }
  if (rows.some((row) => row.dataShape !== 'continuous-arm-summary')) throw new Error('Historical MD synthesis contains a non-continuous row.');
  return revMan54RandomEffectsMeanDifference(rows.map((row) => {
    const continuous = row as Extract<HistoricalOutcomeRow, { dataShape: 'continuous-arm-summary' }>;
    return {
      studyId: continuous.lineageId,
      experimentalMean: continuous.experimentalMean!,
      experimentalSd: continuous.experimentalSd!,
      experimentalTotal: continuous.experimentalTotal!,
      controlMean: continuous.controlMean!,
      controlSd: continuous.controlSd!,
      controlTotal: continuous.controlTotal!,
    };
  }));
}

export function replayHistoricalSynthesis(
  ledger: HistoricalOutcomeRowLedger,
  plan: HistoricalSynthesisReplayPlan,
): HistoricalSynthesisReplayReceipt {
  validatePlan(plan);
  const rows = exactRows(ledger, plan.selector);
  const algorithmResult = runRevMan(rows, plan.selector.measure);
  const reproducedResult = reproducedResultFromRevMan54({
    outcome: plan.selector.outcome,
    participants: participantCount(rows),
    result: algorithmResult,
  });
  const publishedComparison = compareHistoricalPublishedResult(plan.publishedTarget, reproducedResult);
  const selectedRowHashes = rows.map((row) => row.rowHash).sort();
  const selectedLineageIds = rows.map((row) => row.lineageId).sort();
  const synthesisInputsHash = scientificContentHash({ selector: plan.selector, selectedRowHashes });
  const withoutReplayHash = {
    schemaVersion: HISTORICAL_SYNTHESIS_REPLAY_SCHEMA_VERSION,
    selector: plan.selector,
    selectedRowHashes,
    selectedLineageIds,
    synthesisInputsHash,
    algorithmResult,
    reproducedResult,
    publishedComparison,
  };
  return { ...withoutReplayHash, replayHash: scientificContentHash(withoutReplayHash) };
}
