import { scientificContentHash } from '../core/canonical-hash.js';
import type {
  HistoricalPlaneProvenance,
  HistoricalReviewFrozenPlane,
  HistoricalReviewReproductionEnvelope,
} from '../historical/review-reproduction.js';
import type {
  SrBenchmarkStage,
  SrStageGoldCoverage,
} from './sr-reproduction-benchmark.js';

export interface HistoricalSrbenchStageReceipt {
  stage: SrBenchmarkStage;
  envelopeId: string;
  planeHashes: Array<{
    plane: HistoricalReviewFrozenPlane['plane'];
    hash: string;
    replayFidelity: HistoricalReviewFrozenPlane['replayFidelity'];
    historicalProvenance: HistoricalPlaneProvenance;
  }>;
  statisticalRuntimeHash?: string;
  executionEnvironmentHash?: string;
  receiptHash: string;
}

export interface HistoricalSrbenchCoverage {
  scientificStageGold: Record<SrBenchmarkStage, SrStageGoldCoverage>;
  scientificReceiptObjects: Partial<Record<SrBenchmarkStage, HistoricalSrbenchStageReceipt>>;
  historicalProcessStatus: Record<SrBenchmarkStage, 'complete' | 'partial' | 'missing'>;
  scientificCoverage: number;
  historicalProcessCoverage: number;
  coverageHash: string;
}

const WEIGHTS: Record<SrBenchmarkStage, number> = {
  question: 5,
  protocol: 5,
  search: 15,
  deduplication: 5,
  'tiab-screening': 15,
  'fulltext-screening': 10,
  extraction: 15,
  appraisal: 10,
  synthesis: 15,
  report: 5,
};

const STAGE_PLANES: Partial<Record<SrBenchmarkStage, HistoricalReviewFrozenPlane['plane'][]>> = {
  search: ['search-import-dedup'],
  deduplication: ['search-import-dedup'],
  'tiab-screening': ['screening-decisions'],
  'fulltext-screening': ['fulltext-corpus', 'parsed-documents', 'screening-decisions'],
  extraction: ['fulltext-corpus', 'parsed-documents', 'extraction-ledger'],
  appraisal: ['appraisal-ledger'],
  synthesis: ['extraction-ledger', 'synthesis-inputs', 'synthesis-results'],
  report: ['report'],
};

function statusWeight(status: 'complete' | 'partial' | 'missing'): number {
  return status === 'complete' ? 1 : status === 'partial' ? 0.5 : 0;
}

function processStatus(planes: HistoricalReviewFrozenPlane[]): 'complete' | 'partial' | 'missing' {
  if (planes.length === 0 || planes.some((plane) => plane.replayFidelity === 'unavailable' || plane.historicalProvenance === 'unavailable')) return 'missing';
  if (planes.every((plane) => plane.replayFidelity === 'exact' && plane.historicalProvenance === 'original-exact')) return 'complete';
  return 'partial';
}

function scientificStatus(planes: HistoricalReviewFrozenPlane[]): 'complete' | 'partial' | 'missing' {
  if (planes.length === 0 || planes.some((plane) => plane.replayFidelity === 'unavailable' || plane.historicalProvenance === 'unavailable')) return 'missing';
  // A source-reconstructed plane is valid benchmark gold when the computation is
  // replay-exact and evidence-bound. Aggregate-only history remains partial.
  if (planes.every((plane) => plane.replayFidelity === 'exact'
    && (plane.historicalProvenance === 'original-exact' || plane.historicalProvenance === 'source-reconstructed'))) return 'complete';
  return 'partial';
}

function reason(stage: SrBenchmarkStage, status: 'partial' | 'missing', planes: HistoricalReviewFrozenPlane[]): string {
  if (planes.length === 0) return `Historical replay envelope has no frozen plane supporting SRBench stage '${stage}'.`;
  return `Historical replay support for '${stage}' is ${status}: ${planes.map((plane) => `${plane.plane}[${plane.replayFidelity}/${plane.historicalProvenance}]`).join(', ')}.`;
}

function receiptForStage(
  stage: SrBenchmarkStage,
  envelope: HistoricalReviewReproductionEnvelope,
  planes: HistoricalReviewFrozenPlane[],
): HistoricalSrbenchStageReceipt {
  const base = {
    stage,
    envelopeId: envelope.envelopeId,
    planeHashes: planes.map((plane) => ({
      plane: plane.plane,
      hash: plane.hash,
      replayFidelity: plane.replayFidelity,
      historicalProvenance: plane.historicalProvenance,
    })).sort((a, b) => a.plane.localeCompare(b.plane)),
    ...(stage === 'synthesis' && envelope.statisticalRuntime
      ? { statisticalRuntimeHash: scientificContentHash(envelope.statisticalRuntime) }
      : {}),
    ...(envelope.executionEnvironmentHash ? { executionEnvironmentHash: envelope.executionEnvironmentHash } : {}),
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}

export function deriveHistoricalSrbenchCoverage(input: {
  envelope: HistoricalReviewReproductionEnvelope;
  questionGoldReceipt?: unknown;
  protocolGoldReceipt?: unknown;
}): HistoricalSrbenchCoverage {
  const scientificStageGold = {} as Record<SrBenchmarkStage, SrStageGoldCoverage>;
  const scientificReceiptObjects: Partial<Record<SrBenchmarkStage, HistoricalSrbenchStageReceipt>> = {};
  const historicalProcessStatus = {} as Record<SrBenchmarkStage, 'complete' | 'partial' | 'missing'>;

  for (const stage of Object.keys(WEIGHTS) as SrBenchmarkStage[]) {
    if (stage === 'question' || stage === 'protocol') {
      const supplied = stage === 'question' ? input.questionGoldReceipt : input.protocolGoldReceipt;
      if (supplied !== undefined) {
        const receiptHash = scientificContentHash({ stage, source: supplied, methodsContractHash: input.envelope.methodsContractHash });
        scientificStageGold[stage] = { status: 'complete', receiptHash };
        historicalProcessStatus[stage] = 'partial';
      } else {
        scientificStageGold[stage] = {
          status: 'partial',
          reason: `Published methods constrain '${stage}', but no independently frozen ${stage} gold receipt is bound.`,
        };
        historicalProcessStatus[stage] = 'partial';
      }
      continue;
    }

    const required = STAGE_PLANES[stage] ?? [];
    const planes = required
      .map((name) => input.envelope.frozenPlanes.find((plane) => plane.plane === name))
      .filter((plane): plane is HistoricalReviewFrozenPlane => Boolean(plane));
    const scientific = planes.length === required.length ? scientificStatus(planes) : 'missing';
    const process = planes.length === required.length ? processStatus(planes) : 'missing';
    historicalProcessStatus[stage] = process;
    if (scientific === 'complete') {
      const receipt = receiptForStage(stage, input.envelope, planes);
      scientificReceiptObjects[stage] = receipt;
      scientificStageGold[stage] = { status: 'complete', receiptHash: receipt.receiptHash };
    } else {
      scientificStageGold[stage] = { status: scientific, reason: reason(stage, scientific, planes) };
    }
  }

  let scientificCoverage = 0;
  let historicalProcessCoverage = 0;
  for (const [stage, weight] of Object.entries(WEIGHTS) as Array<[SrBenchmarkStage, number]>) {
    scientificCoverage += weight * statusWeight(scientificStageGold[stage].status);
    historicalProcessCoverage += weight * statusWeight(historicalProcessStatus[stage]);
  }
  const base = {
    envelopeId: input.envelope.envelopeId,
    scientificStageGold,
    scientificReceiptHashes: Object.fromEntries(Object.entries(scientificReceiptObjects).map(([stage, receipt]) => [stage, receipt?.receiptHash])),
    historicalProcessStatus,
    scientificCoverage,
    historicalProcessCoverage,
  };
  return {
    scientificStageGold,
    scientificReceiptObjects,
    historicalProcessStatus,
    scientificCoverage,
    historicalProcessCoverage,
    coverageHash: scientificContentHash(base),
  };
}
