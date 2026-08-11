import { scientificContentHash } from '../core/canonical-hash.js';
import {
  verifySrProspectiveHoldout,
  type SrProspectiveExecutionReceipt,
  type SrProspectiveGoldRevealReceipt,
  type SrProspectiveHoldoutRegistration,
  type SrProspectiveScoreReceipt,
} from './sr-prospective-holdout.js';

export const SR_PROSPECTIVE_INDEPENDENCE_SCHEMA_VERSION = 'medantir-sr-prospective-independence/1' as const;

export interface SrProspectiveIndependenceBundle {
  registration: SrProspectiveHoldoutRegistration;
  execution: SrProspectiveExecutionReceipt;
  gold: SrProspectiveGoldRevealReceipt;
  score: SrProspectiveScoreReceipt;
}

export interface SrProspectiveIndependenceCluster {
  qualificationCandidateHash: string;
  goldCaseHashes: string[];
  holdoutIds: string[];
  runCount: number;
  validRuns: number;
  perfectRuns: number;
  independentTrialSuccess: boolean;
  clusterHash: string;
}

export interface SrProspectiveIndependenceReport {
  schemaVersion: typeof SR_PROSPECTIVE_INDEPENDENCE_SCHEMA_VERSION;
  requestedModel: string;
  submittedHoldouts: number;
  distinctQualificationCandidates: number;
  distinctGoldCases: number;
  independentReviewTrials: number;
  perfectIndependentTrials: number;
  repeatedRuns: number;
  duplicateGoldAcrossCandidates: string[];
  inconsistentCandidateGold: string[];
  clusters: SrProspectiveIndependenceCluster[];
  reliabilityCountAdmissible: boolean;
  reportHash: string;
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

export function createSrProspectiveIndependenceReport(input: {
  requestedModel: string;
  holdouts: SrProspectiveIndependenceBundle[];
}): SrProspectiveIndependenceReport {
  const model = input.requestedModel.trim();
  if (!model) throw new Error('Prospective independence report requires requestedModel.');
  const relevant = input.holdouts.filter((holdout) => holdout.registration.requestedModel === model);
  const byCandidate = new Map<string, SrProspectiveIndependenceBundle[]>();
  for (const holdout of relevant) {
    const candidateHash = sha(holdout.gold.qualificationCandidateHash, 'Prospective qualificationCandidateHash');
    const values = byCandidate.get(candidateHash) ?? [];
    values.push(holdout);
    byCandidate.set(candidateHash, values);
  }
  const clusters: SrProspectiveIndependenceCluster[] = [...byCandidate.entries()].map(([qualificationCandidateHash, holdouts]) => {
    const goldCaseHashes = [...new Set(holdouts.map((holdout) => sha(holdout.gold.goldCaseHash, 'Prospective goldCaseHash'))) ].sort();
    const holdoutIds = [...new Set(holdouts.map((holdout) => holdout.registration.holdoutId))].sort();
    const verifications = holdouts.map((holdout) => verifySrProspectiveHoldout(holdout));
    const validRuns = verifications.filter((verification) => verification.valid).length;
    const perfectRuns = verifications.filter((verification) => verification.valid && verification.perfect).length;
    const independentTrialSuccess = goldCaseHashes.length === 1
      && validRuns === holdouts.length
      && perfectRuns === holdouts.length;
    const base = {
      qualificationCandidateHash,
      goldCaseHashes,
      holdoutIds,
      runCount: holdouts.length,
      validRuns,
      perfectRuns,
      independentTrialSuccess,
    };
    return { ...base, clusterHash: scientificContentHash(base) };
  }).sort((a, b) => a.qualificationCandidateHash.localeCompare(b.qualificationCandidateHash));

  const goldToCandidates = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    for (const goldCaseHash of cluster.goldCaseHashes) {
      const candidates = goldToCandidates.get(goldCaseHash) ?? new Set<string>();
      candidates.add(cluster.qualificationCandidateHash);
      goldToCandidates.set(goldCaseHash, candidates);
    }
  }
  const duplicateGoldAcrossCandidates = [...goldToCandidates.entries()]
    .filter(([, candidates]) => candidates.size > 1)
    .map(([goldCaseHash]) => goldCaseHash)
    .sort();
  const inconsistentCandidateGold = clusters
    .filter((cluster) => cluster.goldCaseHashes.length !== 1)
    .map((cluster) => cluster.qualificationCandidateHash)
    .sort();
  const independentReviewTrials = clusters.length;
  const perfectIndependentTrials = clusters.filter((cluster) => cluster.independentTrialSuccess).length;
  const repeatedRuns = Math.max(0, relevant.length - independentReviewTrials);
  const reliabilityCountAdmissible = duplicateGoldAcrossCandidates.length === 0 && inconsistentCandidateGold.length === 0;
  const base = {
    schemaVersion: SR_PROSPECTIVE_INDEPENDENCE_SCHEMA_VERSION,
    requestedModel: model,
    submittedHoldouts: relevant.length,
    distinctQualificationCandidates: clusters.length,
    distinctGoldCases: new Set(clusters.flatMap((cluster) => cluster.goldCaseHashes)).size,
    independentReviewTrials,
    perfectIndependentTrials,
    repeatedRuns,
    duplicateGoldAcrossCandidates,
    inconsistentCandidateGold,
    clusters,
    reliabilityCountAdmissible,
  };
  return { ...base, reportHash: scientificContentHash(base) };
}
