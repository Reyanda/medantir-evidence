import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_GOVERNANCE_SCHEMA_VERSION,
  adjudicateModelPromotion,
  buildScreeningModelGovernanceDossier,
  type FrozenModelBenchmarkContext,
  type ModelBenchmarkReferenceReceipt,
  type ScreeningBenchmarkCandidate,
  type ScreeningModelPromotionPolicy,
} from '../src/inference/model-governance.js';

const context: FrozenModelBenchmarkContext = {
  task: 'tiab-screening',
  evidenceSetHash: 'evidence-sha256',
  authoritativeDecisionHash: 'decisions-sha256',
  sampleDefinitionHash: 'sample-sha256',
  promptVersion: 'tiab-shadow-v1',
};

const reference: ModelBenchmarkReferenceReceipt = {
  schemaVersion: MODEL_GOVERNANCE_SCHEMA_VERSION,
  task: 'tiab-screening',
  evidenceSetHash: context.evidenceSetHash,
  authoritativeDecisionHash: context.authoritativeDecisionHash,
  sampleDefinitionHash: context.sampleDefinitionHash,
  promptVersion: context.promptVersion,
  independentlyVerified: true,
  basis: 'dual-human-adjudicated',
  verificationReceiptId: 'reference-verification-1',
  verifierId: 'reviewer-b',
  verifiedAt: '2026-08-10T09:00:00Z',
};

const policy: ScreeningModelPromotionPolicy = {
  schemaVersion: MODEL_GOVERNANCE_SCHEMA_VERSION,
  policyId: 'tiab-conservative-support',
  policyVersion: '1.0.0',
  task: 'tiab-screening',
  minSampledRecords: 100,
  minReferenceIncludes: 20,
  minCompletedRate: 0.99,
  minSensitivity: 0.95,
  minSpecificity: 0.9,
  minF1: 0.9,
  maxFalseNegatives: 1,
  maxUncertainRate: 0.05,
  maxInvalidOutputRate: 0.01,
  maxInferenceErrorRate: 0.01,
  maxTotalCostUsd: 0.1,
  requireFixedRequestedModel: true,
  requireSingleActualModel: true,
  requireSingleProvider: true,
  requireIndependentReferenceVerification: true,
};

function candidate(model = 'qwen/qwen3-fixed'): ScreeningBenchmarkCandidate {
  const suggestions = Array.from({ length: 100 }, (_, index) => {
    const authoritativeDecision = index < 20 ? 'include' as const : 'exclude' as const;
    return {
      recordId: `record-${index}`,
      authoritativeDecision,
      suggestedDecision: authoritativeDecision,
      status: 'completed' as const,
      requestHash: `request-${index}`,
      outputHash: `output-${index}`,
      routingReceipt: {
        actualProvider: 'qwen',
        actualModel: 'qwen3-fixed',
        gatewayVersion: '3.8.50',
        responseCostUsd: 0,
      },
    };
  });
  return {
    model,
    quality: {
      sampledRecords: 100,
      completed: 100,
      invalidOutputs: 0,
      inferenceErrors: 0,
      authoritativeDecisionsChanged: false,
    },
    metrics: {
      truePositive: 20,
      falsePositive: 0,
      trueNegative: 80,
      falseNegative: 0,
      uncertain: 0,
      sensitivity: 1,
      specificity: 1,
      precision: 1,
      f1: 1,
      accuracy: 1,
    },
    resources: { totalCostUsd: 0, totalTokensIn: 20_000, totalTokensOut: 2_000, meanLatencyMs: 90 },
    routedProviders: ['qwen'],
    actualModels: ['qwen3-fixed'],
    suggestions,
  };
}

test('a fixed model that passes the prespecified frozen benchmark is only eligible for human review', () => {
  const dossier = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference, policy });
  assert.equal(dossier.recommendation, 'eligible-for-human-review');
  assert.equal(dossier.checks.every((item) => item.passed), true);
  assert.equal(dossier.authorityCeiling, 'decision-support-only');
  assert.equal(dossier.mayAlterAuthoritativeDecisions, false);
  assert.equal(dossier.automaticPromotion, false);
  assert.ok(dossier.dossierHash.length > 40);
});

test('dynamic auto routing remains shadow-only even with perfect observed metrics', () => {
  const routed = candidate('auto/cheap');
  const dossier = buildScreeningModelGovernanceDossier({ candidate: routed, context, reference, policy });
  assert.equal(dossier.recommendation, 'blocked');
  assert.equal(dossier.checks.find((item) => item.code === 'fixed-requested-model')?.passed, false);
});

test('an unverified or mismatched reference set blocks promotion', () => {
  const unverified = { ...reference, independentlyVerified: false };
  const first = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference: unverified, policy });
  assert.equal(first.recommendation, 'blocked');
  assert.equal(first.checks.find((item) => item.code === 'independent-reference-verification')?.passed, false);

  const mismatched = { ...reference, evidenceSetHash: 'different-evidence' };
  const second = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference: mismatched, policy });
  assert.equal(second.recommendation, 'blocked');
  assert.equal(second.checks.find((item) => item.code === 'reference-context-match')?.passed, false);
});

test('false-negative and sensitivity thresholds cannot be hidden by high accuracy', () => {
  const unsafe = candidate();
  unsafe.metrics.falseNegative = 3;
  unsafe.metrics.truePositive = 17;
  unsafe.metrics.sensitivity = 0.85;
  unsafe.metrics.accuracy = 0.97;
  unsafe.suggestions[0]!.suggestedDecision = 'exclude';
  unsafe.suggestions[1]!.suggestedDecision = 'exclude';
  unsafe.suggestions[2]!.suggestedDecision = 'exclude';

  const dossier = buildScreeningModelGovernanceDossier({ candidate: unsafe, context, reference, policy });
  assert.equal(dossier.recommendation, 'blocked');
  assert.equal(dossier.checks.find((item) => item.code === 'sensitivity')?.passed, false);
  assert.equal(dossier.checks.find((item) => item.code === 'false-negatives')?.passed, false);
});

test('human promotion requires an eligible dossier and remains non-authoritative decision support', () => {
  const dossier = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference, policy });
  const receipt = adjudicateModelPromotion(dossier, {
    dossierHash: dossier.dossierHash,
    verdict: 'approve-decision-support',
    rationale: 'Independent benchmark met the prespecified policy; approve non-authoritative screening proposals only.',
    reviewerId: 'methods-lead',
    decidedAt: '2026-08-10T10:00:00Z',
  });

  assert.equal(receipt.status, 'approved-decision-support');
  assert.equal(receipt.authority, 'decision-support-only');
  assert.equal(receipt.mayAlterAuthoritativeDecisions, false);
  assert.equal(receipt.automaticExclusionAllowed, false);
  assert.equal(receipt.actualModel, 'qwen3-fixed');
  assert.equal(receipt.provider, 'qwen');
});

test('a human cannot waive failed benchmark checks or approve a stale dossier hash', () => {
  const blocked = buildScreeningModelGovernanceDossier({ candidate: candidate('auto'), context, reference, policy });
  assert.throws(() => adjudicateModelPromotion(blocked, {
    dossierHash: blocked.dossierHash,
    verdict: 'approve-decision-support',
    rationale: 'Override the router restriction.',
    reviewerId: 'reviewer',
    decidedAt: '2026-08-10T10:00:00Z',
  }), /blocked model dossier cannot be promoted/i);

  const eligible = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference, policy });
  assert.throws(() => adjudicateModelPromotion(eligible, {
    dossierHash: 'stale-dossier',
    verdict: 'approve-decision-support',
    rationale: 'Approve.',
    reviewerId: 'reviewer',
    decidedAt: '2026-08-10T10:00:00Z',
  }), /does not bind the current dossier hash/i);
});

test('policy/reference/candidate changes all change the dossier identity', () => {
  const base = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference, policy });
  const policyChanged = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference, policy: { ...policy, maxFalseNegatives: 0, policyVersion: '1.0.1' } });
  const referenceChanged = buildScreeningModelGovernanceDossier({ candidate: candidate(), context, reference: { ...reference, verificationReceiptId: 'reference-verification-2' }, policy });
  const candidateChanged = candidate();
  candidateChanged.resources = { ...candidateChanged.resources, totalCostUsd: 0.01 };
  const candidateDossier = buildScreeningModelGovernanceDossier({ candidate: candidateChanged, context, reference, policy });
  assert.notEqual(base.dossierHash, policyChanged.dossierHash);
  assert.notEqual(base.dossierHash, referenceChanged.dossierHash);
  assert.notEqual(base.dossierHash, candidateDossier.dossierHash);
});
