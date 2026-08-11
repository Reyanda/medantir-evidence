import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSrProspectiveExecutionReceipt,
  createSrProspectiveGoldRevealReceipt,
  createSrProspectiveHoldoutRegistration,
  createSrProspectiveScoreReceipt,
  summarizeSrProspectiveQualification,
  verifySrProspectiveHoldout,
} from '../src/benchmark/sr-prospective-holdout.js';

function holdout(id = 'H1', domain = 'nutrition') {
  const registration = createSrProspectiveHoldoutRegistration({
    holdoutId: id,
    domain,
    registeredAt: '2026-08-01T09:00:00Z',
    evidenceCutoff: '2026-08-05T23:59:59Z',
    requestedModel: 'model-a',
    pinnedModelIdentity: 'provider/model-a@2026-08-01',
    pinnedProvider: 'provider-a',
    suiteHash: '1'.repeat(64),
    codeIdentityHash: '2'.repeat(64),
    promptContractHash: '3'.repeat(64),
    protocolHash: '4'.repeat(64),
    plannedPipelineCoverage: 100,
    publicAnchor: {
      kind: 'transparency-log',
      anchorId: `anchor-${id}`,
      anchorHash: '5'.repeat(64),
      anchoredAt: '2026-08-01T09:05:00Z',
    },
  });
  const execution = createSrProspectiveExecutionReceipt({
    holdoutId: id,
    registrationHash: registration.registrationHash,
    submittedAt: '2026-08-06T12:00:00Z',
    actualModelIdentity: 'provider/model-a@2026-08-01',
    provider: 'provider-a',
    modelOutputBundleHash: '6'.repeat(64),
    scientificRunSeal: '7'.repeat(64),
    executionEnvironmentHash: '8'.repeat(64),
  });
  const gold = createSrProspectiveGoldRevealReceipt({
    holdoutId: id,
    registrationHash: registration.registrationHash,
    goldReleasedAt: '2026-08-10T09:00:00Z',
    goldCaseHash: '9'.repeat(64),
    qualificationCandidateHash: 'a'.repeat(64),
    cryptographicQualificationVerificationHash: 'b'.repeat(64),
  });
  const score = createSrProspectiveScoreReceipt({
    holdoutId: id,
    registrationHash: registration.registrationHash,
    executionHash: execution.executionHash,
    goldRevealHash: gold.goldRevealHash,
    modelOutputBundleHash: execution.modelOutputBundleHash,
    goldCaseHash: gold.goldCaseHash,
    reproductionScore: 100,
    pipelineCoverage: 100,
    criticalFailures: 0,
    exactTasks: 10,
    totalTasks: 10,
    scoredAt: '2026-08-10T10:00:00Z',
  });
  return { registration, execution, gold, score, domain };
}

test('preregistered model output submitted before gold release can produce a perfect prospective holdout', () => {
  const h = holdout();
  const verification = verifySrProspectiveHoldout(h);
  assert.equal(verification.valid, true);
  assert.equal(verification.perfect, true);
  assert.deepEqual(verification.errors, []);
  assert.match(verification.verificationHash, /^[a-f0-9]{64}$/);
});

test('execution submitted after gold release is rejected as temporally contaminated', () => {
  const h = holdout();
  h.execution = createSrProspectiveExecutionReceipt({
    holdoutId: h.registration.holdoutId,
    registrationHash: h.registration.registrationHash,
    submittedAt: '2026-08-10T09:00:01Z',
    actualModelIdentity: h.registration.pinnedModelIdentity,
    provider: h.registration.pinnedProvider,
    modelOutputBundleHash: '6'.repeat(64),
    scientificRunSeal: '7'.repeat(64),
    executionEnvironmentHash: '8'.repeat(64),
  });
  h.score = createSrProspectiveScoreReceipt({
    ...h.score,
    executionHash: h.execution.executionHash,
    modelOutputBundleHash: h.execution.modelOutputBundleHash,
  });
  const verification = verifySrProspectiveHoldout(h);
  assert.equal(verification.valid, false);
  assert.equal(verification.perfect, false);
  assert.ok(verification.errors.some((error) => /after gold release|temporal holdout is contaminated/i.test(error)));
});

test('model/provider identity drift invalidates the prospective holdout', () => {
  const h = holdout();
  h.execution = createSrProspectiveExecutionReceipt({
    holdoutId: h.registration.holdoutId,
    registrationHash: h.registration.registrationHash,
    submittedAt: '2026-08-06T12:00:00Z',
    actualModelIdentity: 'provider/model-b@2026-08-01',
    provider: 'provider-b',
    modelOutputBundleHash: '6'.repeat(64),
    scientificRunSeal: '7'.repeat(64),
    executionEnvironmentHash: '8'.repeat(64),
  });
  h.score = createSrProspectiveScoreReceipt({
    ...h.score,
    executionHash: h.execution.executionHash,
    modelOutputBundleHash: h.execution.modelOutputBundleHash,
  });
  const verification = verifySrProspectiveHoldout(h);
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /different actual model identity/i.test(error)));
  assert.ok(verification.errors.some((error) => /different provider/i.test(error)));
});

test('post-hoc scoring cannot substitute a different model output or gold case', () => {
  const h = holdout();
  h.score = createSrProspectiveScoreReceipt({
    ...h.score,
    modelOutputBundleHash: 'f'.repeat(64),
    goldCaseHash: 'e'.repeat(64),
  });
  const verification = verifySrProspectiveHoldout(h);
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /prerelease model output bundle/i.test(error)));
  assert.ok(verification.errors.some((error) => /different gold reveal\/case/i.test(error)));
});

test('two perfect prereveal holdouts in two domains satisfy default prospective qualification', () => {
  const a = holdout('H1', 'nutrition');
  const b = holdout('H2', 'cardiology');
  const summary = summarizeSrProspectiveQualification({
    requestedModel: 'model-a',
    holdouts: [
      { domain: a.domain, verification: verifySrProspectiveHoldout(a) },
      { domain: b.domain, verification: verifySrProspectiveHoldout(b) },
    ],
  });
  assert.equal(summary.validHoldouts, 2);
  assert.equal(summary.perfectHoldouts, 2);
  assert.deepEqual(summary.distinctDomains, ['cardiology', 'nutrition']);
  assert.equal(summary.allPerfect, true);
  assert.equal(summary.qualificationReady, true);
  assert.match(summary.summaryHash, /^[a-f0-9]{64}$/);
});

test('one imperfect prospective holdout cannot be averaged away by another perfect holdout', () => {
  const a = holdout('H1', 'nutrition');
  const b = holdout('H2', 'cardiology');
  b.score = createSrProspectiveScoreReceipt({ ...b.score, reproductionScore: 99 });
  const summary = summarizeSrProspectiveQualification({
    requestedModel: 'model-a',
    holdouts: [
      { domain: a.domain, verification: verifySrProspectiveHoldout(a) },
      { domain: b.domain, verification: verifySrProspectiveHoldout(b) },
    ],
  });
  assert.equal(summary.perfectHoldouts, 1);
  assert.equal(summary.allPerfect, false);
  assert.equal(summary.qualificationReady, false);
});
