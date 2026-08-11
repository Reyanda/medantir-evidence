import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { freezeGradePolicySet, type GradePolicyConfiguration } from '../src/certainty/grade-policy.js';
import {
  freezePublicationBiasUniversePolicy,
  recordPublicationBiasUniversePolicy,
  type PublicationBiasUniversePolicyConfiguration,
} from '../src/certainty/publication-bias-universe-policy.js';
import { createProductionInterventionProtocolFinaliseAgent } from '../src/certainty/intervention-certainty-agents.js';

class Finalise implements Agent {
  readonly stage = 'protocol-finalise' as const;
  async execute(_context: AgentContext): Promise<AgentResult> {
    return { artifacts: { protocolPackage: { checksum: 'protocol-pb-test' } } };
  }
}

const gradeConfig: GradePolicyConfiguration = {
  version: '1', rationale: 'Prospective GRADE policy.',
  riskOfBias: { highRiskWeightSerious: 0.2, highRiskWeightVerySerious: 0.5, someConcernsWeightSerious: 0.5 },
  inconsistency: { i2Serious: 50, i2VerySerious: 75, predictionIntervalDecisionConflictSerious: true },
  imprecision: { nullValue: 0, benefitThreshold: -0.1, harmThreshold: 0.1, requiredInformationSize: 1000, verySeriousOisFraction: 0.5 },
  indirectness: { seriousIfPartialDimensionsAtLeast: 2, verySeriousIfIndirectDimensionsAtLeast: 2 },
  publicationBias: { seriousSignalWeight: 1, verySeriousSignalWeight: 2 },
};
const pbConfig: PublicationBiasUniversePolicyConfiguration = {
  version: '1', rationale: 'Prospective eligible-universe completeness policy.',
  minimumEligibleUniverseRegistryCoverage: 1,
  requireEligibilityResolvedForAssessmentBasis: true,
  requireResultAvailabilityKnownForAssessmentBasis: true,
  requireTargetOutcomeStatusKnownForAssessmentBasis: true,
};

function state() { return createPipelineState(fixtureRequest); }
const context = (value: ReturnType<typeof state>): AgentContext => ({
  state: value,
  now: () => '2026-08-11T08:00:00.000Z',
});

function freezeBoth(value: ReturnType<typeof state>): void {
  value.artifacts.gradePolicySet = freezeGradePolicySet({
    protocolHash: 'protocol-pb-test', configuration: gradeConfig, frozenAt: '2026-08-11T08:00:00.000Z',
  });
  value.artifacts.publicationBiasUniversePolicy = freezePublicationBiasUniversePolicy({
    protocolHash: 'protocol-pb-test', configuration: pbConfig, frozenAt: '2026-08-11T08:00:00.000Z',
  });
}

test('protocol-finalise exposes both prospective certainty requirements when both are absent', async () => {
  const value = state();
  const actual = await createProductionInterventionProtocolFinaliseAgent(new Finalise()).execute(context(value));
  assert.ok(actual.awaitingHuman);
  assert.equal((actual.artifacts.gradePolicyRequirement as { status: string }).status, 'required');
  assert.equal((actual.artifacts.publicationBiasUniversePolicyRequirement as { status: string }).status, 'required');
  assert.equal(actual.artifacts.publicationBiasUniversePolicyReady, false);
});

test('after GRADE policy is frozen, registry-universe policy becomes the next material protocol gate', async () => {
  const value = state();
  value.artifacts.gradePolicySet = freezeGradePolicySet({ protocolHash: 'protocol-pb-test', configuration: gradeConfig, frozenAt: '2026-08-11T08:00:00.000Z' });
  const result = await createProductionInterventionProtocolFinaliseAgent(new Finalise()).execute(context(value));
  assert.ok(result.awaitingHuman);
  assert.equal((result.artifacts.gradePolicyRequirement as { status: string }).status, 'satisfied');
  assert.equal((result.artifacts.publicationBiasUniversePolicyRequirement as { status: string }).status, 'required');
});

test('coverage-requiring policy is still blocked when no registry source is planned', async () => {
  const value = state();
  freezeBoth(value);
  const result = await createProductionInterventionProtocolFinaliseAgent(new Finalise()).execute(context(value));
  assert.ok(result.awaitingHuman);
  const requirement = result.artifacts.publicationBiasUniversePolicyRequirement as {
    status: string;
    searchPlanCompatible: boolean;
    plannedRegistrySources: string[];
    searchAmendmentEndpoint: string;
  };
  assert.equal(requirement.status, 'search-plan-incompatible');
  assert.equal(requirement.searchPlanCompatible, false);
  assert.deepEqual(requirement.plannedRegistrySources, []);
  assert.equal(requirement.searchAmendmentEndpoint, '/runs/:runId/grade/publication-bias-search');
});

test('both policies plus a supported registry source allow protocol finalisation', async () => {
  const value = createPipelineState({
    ...fixtureRequest,
    databases: [...fixtureRequest.databases, 'ClinicalTrials.gov'],
  });
  freezeBoth(value);
  const result = await createProductionInterventionProtocolFinaliseAgent(new Finalise()).execute({
    state: value,
    now: () => '2026-08-11T08:00:00.000Z',
  });
  assert.equal(result.awaitingHuman, undefined);
  assert.equal(result.artifacts.gradePolicyProtocolReady, true);
  assert.equal(result.artifacts.publicationBiasUniversePolicyReady, true);
  const requirement = result.artifacts.publicationBiasUniversePolicyRequirement as {
    status: string;
    plannedRegistrySources: string[];
  };
  assert.equal(requirement.status, 'satisfied');
  assert.deepEqual(requirement.plannedRegistrySources, ['clinicaltrials.gov']);
});

test('zero-coverage policy may deliberately proceed without a registry source', async () => {
  const value = state();
  value.artifacts.gradePolicySet = freezeGradePolicySet({ protocolHash: 'protocol-pb-test', configuration: gradeConfig, frozenAt: '2026-08-11T08:00:00.000Z' });
  value.artifacts.publicationBiasUniversePolicy = freezePublicationBiasUniversePolicy({
    protocolHash: 'protocol-pb-test',
    configuration: { ...pbConfig, minimumEligibleUniverseRegistryCoverage: 0 },
    frozenAt: '2026-08-11T08:00:00.000Z',
  });
  const result = await createProductionInterventionProtocolFinaliseAgent(new Finalise()).execute(context(value));
  assert.equal(result.awaitingHuman, undefined);
  assert.equal(result.artifacts.publicationBiasUniversePolicyReady, true);
});

test('policy amendment after historical synthesis remains post-results even after stage reset', () => {
  const value = state();
  value.artifacts.protocolPackage = { checksum: 'protocol-pb-test' };
  value.artifacts.scientificRunLedger = { version: 1, attempts: [{ stage: 'synthesise', attempt: 1, status: 'passed' }] };
  value.stages.synthesise.status = 'pending';
  const result = recordPublicationBiasUniversePolicy({
    state: value,
    configuration: pbConfig,
    actorId: 'user:methodologist',
    decidedAt: '2026-08-11T09:00:00.000Z',
  });
  assert.equal(result.receipt.timing, 'post-results-amendment');
  assert.match(result.receipt.warning ?? '', /after results existed/);
});
