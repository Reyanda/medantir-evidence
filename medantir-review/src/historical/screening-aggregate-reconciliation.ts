import type {
  HistoricalScreeningAggregate,
  HistoricalScreeningDecision,
  HistoricalScreeningDecisionLedger,
  HistoricalScreeningStage,
} from './screening-decision-ledger.js';

export interface HistoricalScreeningAggregateCount {
  stage: HistoricalScreeningStage;
  included: number;
  excluded: number;
  uncertain: number;
  total: number;
}

export interface HistoricalScreeningAggregateDifference {
  stage: HistoricalScreeningStage;
  field: 'included' | 'excluded' | 'uncertain' | 'total';
  expected: number;
  actual: number;
}

export interface HistoricalScreeningAggregateReconciliation {
  aggregateComparable: boolean;
  aggregateMatch: boolean;
  rowHistoryExact: false;
  stages: HistoricalScreeningAggregateCount[];
  differences: HistoricalScreeningAggregateDifference[];
  firstDifference?: HistoricalScreeningAggregateDifference;
}

function replayCounts(
  replay: Array<{ stage: HistoricalScreeningStage; decision: HistoricalScreeningDecision }>,
): Map<HistoricalScreeningStage, HistoricalScreeningAggregateCount> {
  const counts = new Map<HistoricalScreeningStage, HistoricalScreeningAggregateCount>();
  for (const item of replay) {
    const current = counts.get(item.stage) ?? { stage: item.stage, included: 0, excluded: 0, uncertain: 0, total: 0 };
    if (item.decision === 'include') current.included += 1;
    else if (item.decision === 'exclude') current.excluded += 1;
    else current.uncertain += 1;
    current.total += 1;
    counts.set(item.stage, current);
  }
  return counts;
}

function expectedTotal(aggregate: HistoricalScreeningAggregate): number | undefined {
  const values = [aggregate.included, aggregate.excluded, aggregate.uncertain];
  if (values.every((value) => value === undefined)) return undefined;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function reconcileHistoricalScreeningAggregates(
  historical: HistoricalScreeningDecisionLedger,
  replay: Array<{ stage: HistoricalScreeningStage; recordId: string; decision: HistoricalScreeningDecision }>,
): HistoricalScreeningAggregateReconciliation {
  const counts = replayCounts(replay);
  const differences: HistoricalScreeningAggregateDifference[] = [];
  for (const aggregate of historical.aggregates) {
    const actual = counts.get(aggregate.stage) ?? { stage: aggregate.stage, included: 0, excluded: 0, uncertain: 0, total: 0 };
    for (const field of ['included', 'excluded', 'uncertain'] as const) {
      const expected = aggregate[field];
      if (expected !== undefined && expected !== actual[field]) {
        differences.push({ stage: aggregate.stage, field, expected, actual: actual[field] });
      }
    }
    const total = expectedTotal(aggregate);
    if (total !== undefined && total !== actual.total) {
      differences.push({ stage: aggregate.stage, field: 'total', expected: total, actual: actual.total });
    }
  }
  const aggregateComparable = historical.aggregates.length > 0;
  const stages = [...counts.values()].sort((a, b) => a.stage.localeCompare(b.stage));
  return {
    aggregateComparable,
    aggregateMatch: aggregateComparable && differences.length === 0,
    rowHistoryExact: false,
    stages,
    differences,
    ...(differences[0] ? { firstDifference: differences[0] } : {}),
  };
}
