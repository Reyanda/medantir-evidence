import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult, ProtocolPackage } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { GradePolicyProtocolGateAgent } from '../src/certainty/grade-protocol-gate.js';
import { freezeGradePolicySet, type GradePolicyConfiguration } from '../src/certainty/grade-policy.js';

const configuration: GradePolicyConfiguration = {
  version: '1.0.0',
  rationale: 'Prospective certainty thresholds.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};

function protocol(checksum: string): ProtocolPackage {
  return {
    id: 'protocol-1', reviewType: 'systematic', title: 'Protocol', version: '1', status: 'final',
    finalisedAt: '2026-08-11T06:00:00.000Z', documentMarkdown: '# Protocol',
    structuredProtocol: {
      id: 'draft-1', reviewType: 'systematic', title: 'Protocol', version: '1', status: 'draft',
      createdAt: '2026-08-11T05:00:00.000Z', authors: [], sections: [], citations: [], checklist: [],
    },
    searchStrategies: [],
    searchTestReport: { status: 'passed', results: [], peerReviewRequired: false, peerReviewStatus: 'not-required', completedAt: '2026-08-11T05:30:00.000Z' },
    citations: [], checksum, files: [],
  };
}

class ProtocolStub implements Agent {
  readonly stage = 'protocol-finalise' as const;
  constructor(private readonly checksum: string) {}
  async execute(_context: AgentContext): Promise<AgentResult> {
    return { artifacts: { protocolPackage: protocol(this.checksum) } };
  }
}

function context(checksum = 'protocol-final'): AgentContext {
  return { state: createPipelineState(fixtureRequest), now: () => '2026-08-11T06:00:00.000Z' };
}

test('protocol finalisation waits for a prospective GRADE policy', async () => {
  const ctx = context();
  const result = await new GradePolicyProtocolGateAgent(new ProtocolStub('protocol-final')).execute(ctx);
  assert.ok(result.awaitingHuman);
  assert.equal((result.artifacts.gradePolicyRequirement as { status: string }).status, 'required');
  assert.equal(result.artifacts.gradePolicyProtocolReady, false);
  assert.ok(result.artifacts.protocolPackage, 'final protocol/checksum must still be available for policy binding');
});

test('checksum-matched GRADE policy allows protocol finalisation to pass', async () => {
  const ctx = context();
  ctx.state.artifacts.gradePolicySet = freezeGradePolicySet({
    protocolHash: 'protocol-final', configuration, frozenAt: '2026-08-11T05:59:00.000Z',
  });
  const result = await new GradePolicyProtocolGateAgent(new ProtocolStub('protocol-final')).execute(ctx);
  assert.equal(result.awaitingHuman, undefined);
  assert.equal(result.artifacts.gradePolicyProtocolReady, true);
  assert.equal((result.artifacts.gradePolicyRequirement as { status: string }).status, 'satisfied');
});

test('policy bound to an older protocol checksum is stale after protocol amendment', async () => {
  const ctx = context();
  ctx.state.artifacts.gradePolicySet = freezeGradePolicySet({
    protocolHash: 'old-protocol', configuration, frozenAt: '2026-08-11T05:30:00.000Z',
  });
  const result = await new GradePolicyProtocolGateAgent(new ProtocolStub('new-protocol')).execute(ctx);
  assert.ok(result.awaitingHuman);
  const requirement = result.artifacts.gradePolicyRequirement as { status: string; staleDomains: string[] };
  assert.equal(requirement.status, 'stale');
  assert.equal(requirement.staleDomains.length, 5);
  assert.equal(result.artifacts.gradePolicyProtocolReady, false);
});
