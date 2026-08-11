import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSrProspectiveExecutionReceipt,
  createSrProspectiveGoldRevealReceipt,
  createSrProspectiveHoldoutRegistration,
  createSrProspectiveScoreReceipt,
} from '../src/benchmark/sr-prospective-holdout.js';
import { createSrProspectiveIndependenceReport } from '../src/benchmark/sr-prospective-independence.js';

function holdout(input: {
  holdoutId: string;
  candidateHash: string;
  goldCaseHash: string;
  reproductionScore?: number;
}) {
  const registration = createSrProspectiveHoldoutRegistration({
    holdoutId: input.holdoutId,
    domain: 'nutrition',
    registeredAt: '2026-08-01T09:00:00Z',
    evidenceCutoff: '2026-08-05T23:59:59Z',
    requestedModel: 'model-a',
    pinnedModelIdentity: 'provider/model-a@1',
    pinnedProvider: 'provider-a',
    suiteHash: '1'.repeat(64), codeIdentityHash: '2'.repeat(64), promptContractHash: '3'.repeat(64), protocolHash: '4'.repeat(64),
    plannedPipelineCoverage: 100,
    publicAnchor: { kind: 'transparency-log', anchorId: `anchor-${input.holdoutId}`, anchorHash: '5'.repeat(64), anchoredAt: '2026-08-01T09:05:00Z' },
  });
  const execution = createSrProspectiveExecutionReceipt({
    holdoutId: input.holdoutId, registrationHash: registration.registrationHash, submittedAt: '2026-08-06T12:00:00Z',
    actualModelIdentity: 'provider/model-a@1', provider: 'provider-a', modelOutputBundleHash: '6'.repeat(64), scientificRunSeal: '7'.repeat(64), executionEnvironmentHash: '8'.repeat(64),
  });
  const gold = createSrProspectiveGoldRevealReceipt({
    holdoutId: input.holdoutId, registrationHash: registration.registrationHash, goldReleasedAt: '2026-08-10T09:00:00Z',
    goldCaseHash: input.goldCaseHash, qualificationCandidateHash: input.candidateHash, cryptographicQualificationVerificationHash: '9'.repeat(64),
  });
  const score = createSrProspectiveScoreReceipt({
    holdoutId: input.holdoutId, registrationHash: registration.registrationHash, executionHash: execution.executionHash,
    goldRevealHash: gold.goldRevealHash, modelOutputBundleHash: execution.modelOutputBundleHash, goldCaseHash: gold.goldCaseHash,
    reproductionScore: input.reproductionScore ?? 100, pipelineCoverage: 100, criticalFailures: 0,
    exactTasks: input.reproductionScore === undefined || input.reproductionScore === 100 ? 10 : 9, totalTasks: 10, scoredAt: '2026-08-10T10:00:00Z',
  });
  return { registration, execution, gold, score };
}

test('59 repeated executions of one qualified prospective review count as one independent review trial', () => {
  const holdouts = Array.from({ length: 59 }, (_, index) => holdout({
    holdoutId: `H${index + 1}`,
    candidateHash: 'a'.repeat(64),
    goldCaseHash: 'b'.repeat(64),
  }));
  const report = createSrProspectiveIndependenceReport({ requestedModel: 'model-a', holdouts });
  assert.equal(report.submittedHoldouts, 59);
  assert.equal(report.independentReviewTrials, 1);
  assert.equal(report.perfectIndependentTrials, 1);
  assert.equal(report.repeatedRuns, 58);
  assert.equal(report.reliabilityCountAdmissible, true);
});

test('one failed repeat makes that independent review trial a failure instead of being hidden by perfect repeats', () => {
  const holdouts = [
    holdout({ holdoutId: 'H1', candidateHash: 'a'.repeat(64), goldCaseHash: 'b'.repeat(64) }),
    holdout({ holdoutId: 'H2', candidateHash: 'a'.repeat(64), goldCaseHash: 'b'.repeat(64), reproductionScore: 99 }),
  ];
  const report = createSrProspectiveIndependenceReport({ requestedModel: 'model-a', holdouts });
  assert.equal(report.independentReviewTrials, 1);
  assert.equal(report.perfectIndependentTrials, 0);
  assert.equal(report.clusters[0]!.runCount, 2);
  assert.equal(report.clusters[0]!.independentTrialSuccess, false);
});

test('same gold case relabeled as two qualification candidates is inadmissible reliability evidence', () => {
  const report = createSrProspectiveIndependenceReport({
    requestedModel: 'model-a',
    holdouts: [
      holdout({ holdoutId: 'H1', candidateHash: 'a'.repeat(64), goldCaseHash: 'c'.repeat(64) }),
      holdout({ holdoutId: 'H2', candidateHash: 'b'.repeat(64), goldCaseHash: 'c'.repeat(64) }),
    ],
  });
  assert.equal(report.reliabilityCountAdmissible, false);
  assert.deepEqual(report.duplicateGoldAcrossCandidates, ['c'.repeat(64)]);
});

test('one qualification candidate mapping to different gold case hashes is inadmissible as one independent trial', () => {
  const report = createSrProspectiveIndependenceReport({
    requestedModel: 'model-a',
    holdouts: [
      holdout({ holdoutId: 'H1', candidateHash: 'a'.repeat(64), goldCaseHash: 'b'.repeat(64) }),
      holdout({ holdoutId: 'H2', candidateHash: 'a'.repeat(64), goldCaseHash: 'c'.repeat(64) }),
    ],
  });
  assert.equal(report.reliabilityCountAdmissible, false);
  assert.deepEqual(report.inconsistentCandidateGold, ['a'.repeat(64)]);
});
