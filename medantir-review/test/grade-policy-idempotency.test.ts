import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { recordGradePolicyConfiguration, type GradePolicyConfiguration } from '../src/certainty/grade-policy.js';

const configuration: GradePolicyConfiguration = {
  version: '1.0.0',
  rationale: 'Frozen certainty policy.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

test('same GRADE policy retried with a different server timestamp is idempotent', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.protocolPackage = { checksum: 'semantic-grade-protocol' };
  const first = recordGradePolicyConfiguration({
    state, configuration, actorId: 'user:r', decidedAt: '2026-08-11T06:00:00.000Z',
  });
  const firstFrozen = (state.artifacts.gradePolicySet as { imprecision?: { frozenAt: string } }).imprecision?.frozenAt;
  const second = recordGradePolicyConfiguration({
    state, configuration, actorId: 'user:r', decidedAt: '2026-08-11T06:05:00.000Z',
  });
  assert.equal(second.changed, false);
  assert.equal(second.receipt.amendmentId, first.receipt.amendmentId);
  assert.equal((state.artifacts.gradePolicyAmendments as unknown[]).length, 1);
  assert.equal((state.artifacts.gradePolicySet as { imprecision?: { frozenAt: string } }).imprecision?.frozenAt, firstFrozen);
});

test('real policy change remains a new amendment', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.protocolPackage = { checksum: 'semantic-grade-protocol' };
  const first = recordGradePolicyConfiguration({ state, configuration, actorId: 'user:r', decidedAt: '2026-08-11T06:00:00.000Z' });
  const changed = {
    ...configuration,
    version: '1.0.1',
    rationale: 'Updated OIS after protocol amendment.',
    imprecision: { ...configuration.imprecision, requiredInformationSize: 1500 },
  };
  const second = recordGradePolicyConfiguration({ state, configuration: changed, actorId: 'user:r', decidedAt: '2026-08-11T06:05:00.000Z' });
  assert.equal(second.changed, true);
  assert.notEqual(second.receipt.amendmentId, first.receipt.amendmentId);
  assert.equal((state.artifacts.gradePolicyAmendments as unknown[]).length, 2);
});
