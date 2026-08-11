import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentContext, AgentResult } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { ContributingRegistryDebtAgent } from '../src/certainty/contributing-registry-debt-agent.js';
import type { RegistryResultUniverseRecord } from '../src/certainty/publication-bias-universe.js';

class Capture implements Agent {
  readonly stage = 'grade' as const;
  async execute(context: AgentContext): Promise<AgentResult> {
    return {
      artifacts: {
        capturedUniverse: structuredClone(context.state.artifacts.registeredStudyResultUniverse),
        capturedReviewPackage: structuredClone(context.state.artifacts.registryUniverseReviewPackage),
      },
    };
  }
}

function contributing(): RegistryResultUniverseRecord {
  return {
    version: 2,
    studyId: 's1',
    outcome: 'mortality',
    eligibilityStatus: 'eligible',
    contributesToSynthesis: true,
    registrySearched: true,
    registrationFound: false,
    resultsAvailable: true,
    prespecifiedPrimaryOutcomeFound: 'unknown',
    targetOutcomeReported: true,
    publicationStatus: 'published',
    evidenceIds: ['included-study:s1'],
    sourceHash: 'source-s1',
  };
}

test('included contributor with unknown primary-outcome specification becomes one-field review debt', async () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.registeredStudyResultUniverse = [contributing()];
  state.artifacts.registryUniverseReviewPackage = { version: 1, items: [], createdAt: '2026-08-11T10:00:00.000Z' };
  const result = await new ContributingRegistryDebtAgent(new Capture()).execute({ state, now: () => '2026-08-11T10:00:00.000Z' });
  const review = result.artifacts.capturedReviewPackage as { items: Array<{ registryId: string; requiredFields: string[] }> };
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0]?.registryId, 'STUDY:s1');
  assert.deepEqual(review.items[0]?.requiredFields, ['prespecifiedPrimaryOutcomeFound']);
});

test('attributable STUDY subject resolution clears contributing-study primary-outcome debt', async () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.registeredStudyResultUniverse = [contributing()];
  state.artifacts.registryUniverseReviewPackage = { version: 1, items: [], createdAt: '2026-08-11T10:00:00.000Z' };
  state.artifacts.registryUniverseAdjudications = [{
    version: 1,
    registryId: 'STUDY:s1',
    outcome: 'mortality',
    eligibilityStatus: 'eligible',
    resultsAvailable: true,
    prespecifiedPrimaryOutcomeFound: true,
    targetOutcomeReported: true,
    publicationStatus: 'published',
    evidenceIds: ['included-study:s1', 'protocol-outcome:s1'],
    rationale: 'Protocol evidence confirms mortality was prespecified primary.',
    actorId: 'user:reviewer',
    decidedAt: '2026-08-11T10:05:00.000Z',
    adjudicationHash: 'adj-s1',
  }];
  const result = await new ContributingRegistryDebtAgent(new Capture()).execute({ state, now: () => '2026-08-11T10:10:00.000Z' });
  const universe = result.artifacts.capturedUniverse as RegistryResultUniverseRecord[];
  assert.equal(universe[0]?.prespecifiedPrimaryOutcomeFound, true);
  assert.ok(universe[0]?.evidenceIds.includes('protocol-outcome:s1'));
  const review = result.artifacts.capturedReviewPackage as { items: unknown[] };
  assert.equal(review.items.length, 0);
});
