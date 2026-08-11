import { createHash } from 'node:crypto';

export interface IccEvidenceReceipt {
  icc: number;
  sourceId: string;
  rationale: string;
  sourceType: 'study-reported' | 'external-empirical';
}

export interface ClusterDesignInput {
  clusters: number;
  participants: number;
  icc: IccEvidenceReceipt;
  clusterSizeCv?: number;
}

export interface ClusterAdjustmentReceipt {
  designEffect: number;
  meanClusterSize: number;
  effectiveSampleSize: number;
  icc: number;
  iccSourceId: string;
  clusterSizeCv?: number;
  method: 'equal-cluster-size-design-effect' | 'cv-adjusted-design-effect';
  inputHash: string;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validate(input: ClusterDesignInput): void {
  if (!Number.isInteger(input.clusters) || input.clusters < 2) throw new Error('Cluster adjustment requires at least two clusters');
  if (!Number.isInteger(input.participants) || input.participants < input.clusters) throw new Error('Cluster participants must be an integer >= number of clusters');
  if (!Number.isFinite(input.icc.icc) || input.icc.icc < 0 || input.icc.icc > 1) throw new Error('ICC must be within [0,1]');
  if (!input.icc.sourceId.trim()) throw new Error('ICC requires a sourceId');
  if (!input.icc.rationale.trim()) throw new Error('ICC requires a rationale');
  if (input.clusterSizeCv !== undefined && (!Number.isFinite(input.clusterSizeCv) || input.clusterSizeCv < 0)) {
    throw new Error('Cluster-size coefficient of variation must be >= 0');
  }
}

export function deriveClusterAdjustment(input: ClusterDesignInput): ClusterAdjustmentReceipt {
  validate(input);
  const meanClusterSize = input.participants / input.clusters;
  const designEffect = input.clusterSizeCv === undefined
    ? 1 + ((meanClusterSize - 1) * input.icc.icc)
    : 1 + ((((input.clusterSizeCv ** 2) + 1) * meanClusterSize - 1) * input.icc.icc);
  if (!(designEffect >= 1) || !Number.isFinite(designEffect)) throw new Error('Derived cluster design effect is invalid');
  return {
    designEffect,
    meanClusterSize,
    effectiveSampleSize: input.participants / designEffect,
    icc: input.icc.icc,
    iccSourceId: input.icc.sourceId,
    ...(input.clusterSizeCv !== undefined ? { clusterSizeCv: input.clusterSizeCv } : {}),
    method: input.clusterSizeCv === undefined ? 'equal-cluster-size-design-effect' : 'cv-adjusted-design-effect',
    inputHash: hash({
      clusters: input.clusters,
      participants: input.participants,
      icc: input.icc,
      ...(input.clusterSizeCv !== undefined ? { clusterSizeCv: input.clusterSizeCv } : {}),
    }),
  };
}

export function adjustUnclusteredStandardError(input: {
  standardError: number;
  design: ClusterDesignInput;
}): { standardError: number; varianceInflation: number; adjustment: ClusterAdjustmentReceipt } {
  if (!(input.standardError > 0) || !Number.isFinite(input.standardError)) throw new Error('Unadjusted standard error must be > 0');
  const adjustment = deriveClusterAdjustment(input.design);
  return {
    standardError: input.standardError * Math.sqrt(adjustment.designEffect),
    varianceInflation: adjustment.designEffect,
    adjustment,
  };
}

export function adjustBinaryEffectiveCounts(input: {
  events: number;
  participants: number;
  design: ClusterDesignInput;
}): { effectiveEvents: number; effectiveParticipants: number; adjustment: ClusterAdjustmentReceipt } {
  if (!Number.isInteger(input.events) || input.events < 0 || input.events > input.participants) throw new Error('Cluster binary events are invalid');
  if (input.participants !== input.design.participants) throw new Error('Binary participant count must match cluster design participant count');
  const adjustment = deriveClusterAdjustment(input.design);
  return {
    effectiveEvents: input.events / adjustment.designEffect,
    effectiveParticipants: input.participants / adjustment.designEffect,
    adjustment,
  };
}

export function requireClusterAdjustment(input: {
  isClusterRandomized: boolean;
  effectAlreadyClusterAdjusted: boolean;
  adjustment?: ClusterAdjustmentReceipt;
}): void {
  if (!input.isClusterRandomized || input.effectAlreadyClusterAdjusted) return;
  if (!input.adjustment) {
    throw new Error('Unadjusted cluster-randomized evidence cannot enter synthesis without a sourced ICC/design-effect adjustment receipt');
  }
  if (!(input.adjustment.designEffect >= 1) || !input.adjustment.iccSourceId.trim()) {
    throw new Error('Cluster adjustment receipt is invalid');
  }
}
